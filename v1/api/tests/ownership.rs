mod support;

use sqlx::PgPool;

#[sqlx::test(migrations = false)]
async fn rejects_cross_user_wallet_category_transaction(pool: PgPool) {
    support::migrate_v1(&pool).await;

    let first_user: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash) VALUES ('first@example.test', 'hash') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let second_user: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash) VALUES ('second@example.test', 'hash') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let wallet: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance)
         VALUES ($1, 'Cash', 'USD', 0) RETURNING id",
    )
    .bind(first_user)
    .fetch_one(&pool)
    .await
    .unwrap();
    let second_category: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type)
         VALUES ($1, 'Food', 'food', 'EXPENSE') RETURNING id",
    )
    .bind(second_user)
    .fetch_one(&pool)
    .await
    .unwrap();

    let result = sqlx::query(
        "INSERT INTO transactions
            (user_id, wallet_id, category_id, transaction_type, amount, occurred_at)
         VALUES ($1, $2, $3, 'EXPENSE', 12.34, NOW())",
    )
    .bind(first_user)
    .bind(wallet)
    .bind(second_category)
    .execute(&pool)
    .await;

    assert!(result.is_err(), "cross-user category must be rejected");
}

#[sqlx::test(migrations = false)]
async fn rejects_inconsistent_active_and_trash_transaction_fields(pool: PgPool) {
    support::migrate_v1(&pool).await;

    let user: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash) VALUES ('user@example.test', 'hash') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let wallet: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance)
         VALUES ($1, 'Cash', 'USD', 0) RETURNING id",
    )
    .bind(user)
    .fetch_one(&pool)
    .await
    .unwrap();
    let category: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type)
         VALUES ($1, 'Food', 'food', 'EXPENSE') RETURNING id",
    )
    .bind(user)
    .fetch_one(&pool)
    .await
    .unwrap();

    let result = sqlx::query(
        "INSERT INTO transactions
            (user_id, wallet_id, category_id, transaction_type, amount, occurred_at, deleted_at)
         VALUES ($1, $2, $3, 'EXPENSE', 12.34, NOW(), NOW())",
    )
    .bind(user)
    .bind(wallet)
    .bind(category)
    .execute(&pool)
    .await;

    assert!(
        result.is_err(),
        "Trash record requires matching purge_after"
    );
}
