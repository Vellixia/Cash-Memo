//! Sends `email` jobs through Resend, throttled centrally so no burst can exceed the plan.
use std::time::Duration;

use domain::jobs;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

/// Resend allows 10 requests/s; stay well under it.
const MIN_GAP: Duration = Duration::from_millis(200);
const MAX_ATTEMPTS: i32 = 5;

pub enum Mailer {
    Resend {
        http: reqwest::Client,
        key: String,
        from: String,
        daily_cap: i64,
    },
    /// No RESEND_API_KEY (dev, CI): log the mail instead of sending it.
    Log,
}

impl Mailer {
    pub fn from_env() -> Self {
        match std::env::var("RESEND_API_KEY") {
            Ok(key) if !key.is_empty() => Mailer::Resend {
                http: reqwest::Client::builder()
                    .timeout(Duration::from_secs(15))
                    .build()
                    .expect("http client"),
                key,
                from: std::env::var("MAIL_FROM")
                    .expect("MAIL_FROM is required with RESEND_API_KEY"),
                daily_cap: std::env::var("EMAIL_DAILY_CAP")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(90),
            },
            _ => Mailer::Log,
        }
    }

    pub fn mode(&self) -> &'static str {
        match self {
            Mailer::Resend { .. } => "resend",
            Mailer::Log => "log only",
        }
    }

    async fn send(&self, mail: &jobs::Email) -> Result<(), String> {
        match self {
            Mailer::Log => {
                tracing::info!(to = %mail.to, subject = %mail.subject, "email (not sent):\n{}", mail.text);
                Ok(())
            }
            Mailer::Resend {
                http, key, from, ..
            } => {
                let res = http
                    .post("https://api.resend.com/emails")
                    .bearer_auth(key)
                    .json(&serde_json::json!({
                        "from": from, "to": [mail.to], "subject": mail.subject, "text": mail.text,
                    }))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                if res.status().is_success() {
                    Ok(())
                } else {
                    Err(format!(
                        "resend {}: {}",
                        res.status(),
                        res.text().await.unwrap_or_default()
                    ))
                }
            }
        }
    }
}

pub async fn run(db: DatabaseConnection, mailer: Mailer) {
    loop {
        match jobs::claim(&db, &[jobs::EMAIL]).await {
            Ok(Some(job)) => {
                handle(&db, &mailer, job).await;
                tokio::time::sleep(MIN_GAP).await;
            }
            // ponytail: polls every 2s; LISTEN/NOTIFY if latency ever matters.
            Ok(None) => tokio::time::sleep(Duration::from_secs(2)).await,
            Err(e) => {
                tracing::error!("claim email job: {e}");
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        }
    }
}

async fn handle(db: &DatabaseConnection, mailer: &Mailer, job: jobs::Job) {
    let result = async {
        let mail: jobs::Email =
            serde_json::from_value(job.payload.clone()).map_err(|e| e.to_string())?;
        if let Mailer::Resend { daily_cap, .. } = mailer
            && sent_today(db).await.map_err(|e| e.to_string())? >= *daily_cap
        {
            tracing::warn!("daily email cap ({daily_cap}) reached; deferring");
            jobs::defer(db, job.id, 3600)
                .await
                .map_err(|e| e.to_string())?;
            return Ok(false);
        }
        mailer.send(&mail).await?;
        Ok::<_, String>(true)
    }
    .await;
    let outcome = match result {
        Ok(true) => jobs::finish(db, job.id, None, true).await,
        Ok(false) => Ok(()),
        Err(e) => jobs::fail(db, &job, &e, MAX_ATTEMPTS).await.map(|gave_up| {
            if gave_up {
                tracing::error!(job = %job.id, "email failed for good: {e}");
            } else {
                tracing::warn!(job = %job.id, "email failed, will retry: {e}");
            }
        }),
    };
    if let Err(e) = outcome {
        tracing::error!(job = %job.id, "update email job: {e}");
    }
}

async fn sent_today(db: &DatabaseConnection) -> Result<i64, sea_orm::DbErr> {
    let row = db
        .query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            "SELECT count(*)::bigint AS n FROM jobs
             WHERE kind = 'email' AND status = 'done' AND updated_at > now() - interval '1 day'",
        ))
        .await?;
    Ok(row
        .map(|r| r.try_get::<i64>("", "n"))
        .transpose()?
        .unwrap_or(0))
}
