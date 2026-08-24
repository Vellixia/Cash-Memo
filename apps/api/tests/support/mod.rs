use sqlx::PgPool;

pub async fn migrate_v1(pool: &PgPool) {
    sqlx::migrate!("./migrations").run(pool).await.unwrap();
}
