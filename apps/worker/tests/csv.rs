//! CSV export → import round trip against real Postgres + S3 (`docker-compose up -d db s3 s3-bucket`).
use std::time::{Duration, Instant};

use domain::{
    jobs,
    migration::{Migrator, MigratorTrait},
    storage::Storage,
};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use serde_json::{Value, json};
use uuid::Uuid;
use worker::data::{Ctx, handle};

async fn sql(db: &DatabaseConnection, q: &str, v: Vec<sea_orm::Value>) {
    db.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres, q, v))
        .await
        .unwrap();
}

async fn scalar(db: &DatabaseConnection, q: &str, v: Vec<sea_orm::Value>) -> Value {
    let row = db
        .query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres, q, v))
        .await
        .unwrap()
        .unwrap();
    row.try_get::<Option<Value>>("", "v")
        .unwrap()
        .unwrap_or(Value::Null)
}

async fn user(db: &DatabaseConnection) -> Uuid {
    let id = Uuid::new_v4();
    sql(
        db,
        "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')",
        vec![id.into(), format!("{id}@test.dev").into()],
    )
    .await;
    id
}

/// Enqueues, then runs that exact job (other tests' jobs are left alone).
async fn run(ctx: &Ctx, kind: &str, payload: Value, uid: Uuid) -> Value {
    let id = jobs::enqueue(&ctx.db, kind, payload, Some(uid))
        .await
        .unwrap();
    sql(&ctx.db, "UPDATE jobs SET run_after = now() + interval '1 hour' WHERE status = 'queued' AND id <> $1 AND kind = $2", vec![id.into(), kind.into()]).await;
    let job = jobs::claim(&ctx.db, &[kind])
        .await
        .unwrap()
        .expect("job claimed");
    assert_eq!(job.id, id);
    handle(ctx, job).await;
    let status = scalar(
        &ctx.db,
        "SELECT to_jsonb(status) AS v FROM jobs WHERE id = $1",
        vec![id.into()],
    )
    .await;
    let err = scalar(
        &ctx.db,
        "SELECT to_jsonb(error) AS v FROM jobs WHERE id = $1",
        vec![id.into()],
    )
    .await;
    assert_eq!(status, json!("done"), "{err}");
    let mut result = scalar(
        &ctx.db,
        "SELECT result AS v FROM jobs WHERE id = $1",
        vec![id.into()],
    )
    .await;
    result["job_id"] = json!(id);
    result
}

#[tokio::test]
async fn export_then_import_round_trip() {
    dotenvy::dotenv().ok();
    let Some(storage) = Storage::from_env() else {
        eprintln!("S3_* not set; skipping");
        return;
    };
    let url = std::env::var("DATABASE_URL").unwrap();
    let db = Database::connect(&url).await.unwrap();
    Migrator::up(&db, None).await.unwrap();
    let ctx = Ctx {
        db: db.clone(),
        storage,
        http: reqwest::Client::new(),
    };

    // A heavy account: 50k memos across two sources, including tricky text.
    let a = user(&db).await;
    let (cash, bca, food) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    sql(&db, "INSERT INTO sources (id, user_id, name, kind) VALUES ($1, $3, 'Cash', 'cash'), ($2, $3, 'BCA', 'bank')", vec![cash.into(), bca.into(), a.into()]).await;
    sql(&db, "INSERT INTO categories (id, user_id, name, direction) VALUES ($1, $2, 'Food, \"street\"', 'expense')", vec![food.into(), a.into()]).await;
    sql(&db, "INSERT INTO memos (id, user_id, direction, amount_minor, currency, occurred_at, category_id, source_id, note)
              SELECT gen_random_uuid(), $1, 'expense', 1000 + g, 'IDR', timestamptz '2026-01-01' + g * interval '7 minutes', $2, $3,
                     CASE WHEN g % 1000 = 0 THEN '=HYPERLINK(\"x\")' WHEN g % 7 = 0 THEN 'line one
line two' END
              FROM generate_series(1, 49999) g", vec![a.into(), food.into(), cash.into()]).await;
    sql(&db, "INSERT INTO memos (id, user_id, direction, amount_minor, currency, occurred_at, source_id, to_source_id, note)
              VALUES (gen_random_uuid(), $1, 'transfer', 250000, 'IDR', '2026-03-01T10:00:00Z', $2, $3, 'top up')", vec![a.into(), bca.into(), cash.into()]).await;

    let started = Instant::now();
    let export = run(&ctx, jobs::EXPORT, json!({ "offset": 420 }), a).await;
    let took = started.elapsed();
    assert_eq!(export["rows"], json!(50_000));
    eprintln!("exported 50k rows in {took:?}");
    assert!(took < Duration::from_secs(60), "export too slow: {took:?}");

    let export_id: Uuid = serde_json::from_value(export["job_id"].clone()).unwrap();
    let csv = ctx
        .http
        .get(ctx.storage.get_url(
            &jobs::export_key(a, export_id),
            "x.csv",
            Duration::from_secs(60),
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(
        csv.starts_with("\u{feff}date,direction,amount,currency,category,source,to_source,note\n")
    );
    assert!(csv.contains("'=HYPERLINK"), "formulas are neutralized");

    // Import that file into a fresh account.
    let b = user(&db).await;
    let import_id = Uuid::new_v4();
    let key = jobs::import_key(b, import_id);
    ctx.http
        .put(ctx.storage.put_url(&key, Duration::from_secs(60)))
        .body(csv.clone())
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let mapping = json!({ "date": 0, "direction": 1, "amount": 2, "currency": 3, "category": 4,
                          "source": 5, "to_source": 6, "note": 7, "default_currency": "IDR" });
    let preview = run(
        &ctx,
        jobs::IMPORT_VALIDATE,
        json!({ "key": key, "mapping": mapping }),
        b,
    )
    .await;
    assert_eq!(
        (
            preview["rows"].clone(),
            preview["valid"].clone(),
            preview["error_count"].clone()
        ),
        (json!(50_000), json!(50_000), json!(0)),
        "{preview}"
    );
    assert_eq!(preview["duplicates"], json!(0));
    assert_eq!(preview["new_sources"].as_array().unwrap().len(), 2);

    let preview_id = preview["job_id"].clone();
    let done = run(
        &ctx,
        jobs::IMPORT_COMMIT,
        json!({ "import_id": preview_id }),
        b,
    )
    .await;
    assert_eq!(
        (done["inserted"].clone(), done["duplicates"].clone()),
        (json!(50_000), json!(0))
    );
    let same = |q: &'static str| {
        let db = db.clone();
        async move {
            (
                scalar(&db, q, vec![a.into()]).await,
                scalar(&db, q, vec![b.into()]).await,
            )
        }
    };
    let (sa, sb) =
        same("SELECT to_jsonb(sum(amount_minor)) AS v FROM memos WHERE user_id = $1").await;
    assert_eq!(sa, sb, "amounts survive the round trip");
    let (na, nb) = same("SELECT to_jsonb(count(*) FILTER (WHERE note LIKE '%\n%')) AS v FROM memos WHERE user_id = $1").await;
    assert_eq!(na, nb, "multi-line notes survive");
    let transfer = scalar(&db, "SELECT to_jsonb(count(*)) AS v FROM memos m JOIN sources s ON s.id = m.source_id JOIN sources t ON t.id = m.to_source_id
                                WHERE m.user_id = $1 AND m.direction = 'transfer' AND s.name = 'BCA' AND t.name = 'Cash'", vec![b.into()]).await;
    assert_eq!(transfer, json!(1));

    // A preview can't be committed twice; importing the same file again skips every row.
    let again = jobs::enqueue(
        &db,
        jobs::IMPORT_COMMIT,
        json!({ "import_id": preview_id }),
        Some(b),
    )
    .await
    .unwrap();
    sql(&db, "UPDATE jobs SET run_after = now() + interval '1 hour' WHERE status = 'queued' AND id <> $1 AND kind = $2", vec![again.into(), jobs::IMPORT_COMMIT.into()]).await;
    let job = jobs::claim(&db, &[jobs::IMPORT_COMMIT])
        .await
        .unwrap()
        .unwrap();
    handle(&ctx, job).await;
    assert_eq!(
        scalar(
            &db,
            "SELECT to_jsonb(status) AS v FROM jobs WHERE id = $1",
            vec![again.into()]
        )
        .await,
        json!("queued"),
        "retried, not applied"
    );
    let preview2 = run(
        &ctx,
        jobs::IMPORT_VALIDATE,
        json!({ "key": key, "mapping": mapping }),
        b,
    )
    .await;
    assert_eq!(preview2["duplicates"], json!(50_000));
    let done2 = run(
        &ctx,
        jobs::IMPORT_COMMIT,
        json!({ "import_id": preview2["job_id"] }),
        b,
    )
    .await;
    assert_eq!(
        (done2["inserted"].clone(), done2["duplicates"].clone()),
        (json!(0), json!(50_000))
    );

    // Bad rows are reported by line, and the rest still stage.
    let bad = "date;amount\n2026-01-01;-10\nnot a date;5\n2026-01-02;0\n";
    let key = jobs::import_key(b, Uuid::new_v4());
    ctx.http
        .put(ctx.storage.put_url(&key, Duration::from_secs(60)))
        .body(bad)
        .send()
        .await
        .unwrap();
    let m = json!({ "date": 0, "amount": 1, "default_currency": "USD", "delimiter": ";" });
    let p = run(
        &ctx,
        jobs::IMPORT_VALIDATE,
        json!({ "key": key, "mapping": m }),
        b,
    )
    .await;
    assert_eq!(
        (p["valid"].clone(), p["error_count"].clone()),
        (json!(1), json!(2))
    );
    assert_eq!(p["errors"][0]["line"], json!(3));

    // Account deletion sweeps the user's files.
    let purged = run(
        &ctx,
        jobs::PURGE_FILES,
        json!({ "prefix": domain::storage::user_prefix(b) }),
        b,
    )
    .await;
    assert!(purged["deleted"].as_i64().unwrap() >= 2, "{purged}");
    sql(
        &db,
        "DELETE FROM users WHERE id = ANY($1)",
        vec![vec![a, b].into()],
    )
    .await;
}
