//! Job queue against a real Postgres (`DATABASE_URL`).
use domain::{
    jobs,
    migration::{Migrator, MigratorTrait},
};
use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

#[tokio::test]
async fn claim_is_exclusive_and_retries_then_scrubs() {
    dotenvy::dotenv().ok();
    let db = Database::connect(std::env::var("DATABASE_URL").unwrap())
        .await
        .unwrap();
    Migrator::up(&db, None).await.unwrap();
    // A kind of its own, so other tests' jobs don't interfere.
    let kind = format!("test-{}", uuid::Uuid::new_v4());
    let id = jobs::enqueue(&db, &kind, serde_json::json!({ "secret": "link" }), None)
        .await
        .unwrap();

    // Two workers race for one job: exactly one wins.
    let db2 = Database::connect(std::env::var("DATABASE_URL").unwrap())
        .await
        .unwrap();
    let kinds = [kind.as_str()];
    let (a, b) = tokio::join!(jobs::claim(&db, &kinds), jobs::claim(&db2, &kinds));
    let (a, b) = (a.unwrap(), b.unwrap());
    assert_eq!(a.is_some() as u8 + b.is_some() as u8, 1);
    let job = a.or(b).unwrap();
    assert_eq!((job.id, job.attempts), (id, 1));

    // A failure is retried later, not immediately.
    assert!(!jobs::fail(&db, &job, "boom", 3).await.unwrap());
    assert!(jobs::claim(&db, &[&kind]).await.unwrap().is_none());
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE jobs SET run_after = now() WHERE id = $1",
        [id.into()],
    ))
    .await
    .unwrap();
    let job = jobs::claim(&db, &[&kind]).await.unwrap().unwrap();
    assert_eq!(job.attempts, 2);

    jobs::finish(&db, id, None, true).await.unwrap();
    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT status, payload::text AS payload FROM jobs WHERE id = $1",
            [id.into()],
        ))
        .await
        .unwrap()
        .unwrap();
    let status: String = row.try_get("", "status").unwrap();
    let payload: String = row.try_get("", "payload").unwrap();
    assert_eq!((status.as_str(), payload.as_str()), ("done", "{}"));
}
