//! Real proof that browser and user-session callers cannot read backend-private `TablesDB` rows.

mod support;

use cashmemo_application::authorization::SessionValidator;
use cashmemo_application::ports::LabelRepository;
use cashmemo_appwrite_adapter::{AppwriteClient, AppwriteSessionValidator, LabelStore};
use cashmemo_domain::label::LabelKind;
use cashmemo_domain::{Label, LabelId, Timestamp};
use reqwest::Method;
use uuid::Uuid;

use support::TestEnvironment;

#[tokio::test]
async fn unauthenticated_and_user_session_direct_tablesdb_access_cannot_observe_rows()
-> Result<(), String> {
    let environment = TestEnvironment::from_environment()?;
    let user = environment.create_user_session().await?;
    let client = AppwriteClient::new(environment.config.clone())?;
    let validator = AppwriteSessionValidator::new(client.clone());
    let owner = validator
        .validate(&user.secret)
        .await
        .map_err(|_| "session validation failed")?;
    let store = LabelStore::new(client);
    let label = Label::new(
        LabelId::random(),
        owner.id().clone(),
        LabelKind::Category,
        "Private Direct Access Probe",
        Timestamp::from_micros(1_767_225_600_000_000),
    )
    .map_err(|_| "label fixture rejected")?;
    let row = store
        .create_if_absent(&owner, &label)
        .await
        .map_err(|_| "label seed failed")?;
    let path = format!(
        "/tablesdb/{}/tables/labels/rows/{}",
        environment.config.database_id, row.id
    );

    let unknown_id = Uuid::new_v4().to_string();
    let unknown_path = format!(
        "/tablesdb/{}/tables/labels/rows/{unknown_id}",
        environment.config.database_id
    );
    for session in [None, Some(user.secret.as_str())] {
        let (existing_status, existing_body) =
            environment.direct(Method::GET, &path, session).await?;
        let (unknown_status, unknown_body) = environment
            .direct(Method::GET, &unknown_path, session)
            .await?;
        assert!(matches!(existing_status, 401 | 403 | 404));
        assert_eq!(existing_status, unknown_status);
        let existing_projection = denial_projection(&existing_body, &row.id.to_string());
        let unknown_projection = denial_projection(&unknown_body, &unknown_id);
        assert_eq!(existing_projection, unknown_projection);
    }

    environment.delete_user(&user.user_id).await?;
    Ok(())
}

fn denial_projection(
    body: &serde_json::Value,
    caller_id: &str,
) -> (Option<i64>, Option<String>, Option<String>) {
    (
        body.get("code").and_then(serde_json::Value::as_i64),
        body.get("type")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        body.get("message")
            .and_then(serde_json::Value::as_str)
            .map(|message| message.replace(caller_id, "[ID]")),
    )
}
