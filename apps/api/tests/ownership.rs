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
async fn rejects_direct_wallet_currency_change_and_allows_opening_balance_change(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let user: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash) VALUES ('wallet-immutable@example.test', 'hash') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let wallet: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance)
         VALUES ($1, 'Cash', 'USD', 10) RETURNING id",
    )
    .bind(user)
    .fetch_one(&pool)
    .await
    .unwrap();

    let currency_change = sqlx::query("UPDATE wallets SET currency_code = 'EUR' WHERE id = $1")
        .bind(wallet)
        .execute(&pool)
        .await;
    assert!(
        currency_change.is_err(),
        "wallet currency must be immutable"
    );

    let opening_balance_change =
        sqlx::query("UPDATE wallets SET opening_balance = 20 WHERE id = $1")
            .bind(wallet)
            .execute(&pool)
            .await;
    assert_eq!(opening_balance_change.unwrap().rows_affected(), 1);

    sqlx::query("UPDATE wallets SET name = 'Pocket', archived_at = now() WHERE id = $1")
        .bind(wallet)
        .execute(&pool)
        .await
        .unwrap();
    let stored: (String, rust_decimal::Decimal, bool) = sqlx::query_as(
        "SELECT currency_code, opening_balance, archived_at IS NOT NULL FROM wallets WHERE id = $1",
    )
    .bind(wallet)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored.0, "USD");
    assert_eq!(stored.1.to_string(), "20.0000");
    assert!(stored.2);
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

#[sqlx::test(migrations = false)]
async fn rejects_disabling_currency_referenced_by_user_default(pool: PgPool) {
    support::migrate_v1(&pool).await;
    sqlx::query(
        "INSERT INTO currencies (code, display_name, exponent, enabled)
         VALUES ('DEF', 'Default', 2, TRUE)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO users (email, password_hash, default_currency_code)
         VALUES ('default@example.test', 'hash', 'DEF')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let result = sqlx::query("UPDATE currencies SET enabled = FALSE WHERE code = 'DEF'")
        .execute(&pool)
        .await;

    assert!(
        result.is_err(),
        "referenced default currency must stay enabled"
    );
}

#[sqlx::test(migrations = false)]
async fn rejects_disabling_currency_referenced_by_wallet(pool: PgPool) {
    support::migrate_v1(&pool).await;
    sqlx::query(
        "INSERT INTO currencies (code, display_name, exponent, enabled)
         VALUES ('WLT', 'Wallet', 2, TRUE)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let user: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash) VALUES ('wallet@example.test', 'hash') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance)
         VALUES ($1, 'Wallet', 'WLT', 0)",
    )
    .bind(user)
    .execute(&pool)
    .await
    .unwrap();

    let result = sqlx::query("UPDATE currencies SET enabled = FALSE WHERE code = 'WLT'")
        .execute(&pool)
        .await;

    assert!(
        result.is_err(),
        "referenced wallet currency must stay enabled"
    );
}

#[sqlx::test(migrations = false)]
async fn rejects_disabling_currency_referenced_by_budget(pool: PgPool) {
    support::migrate_v1(&pool).await;
    sqlx::query(
        "INSERT INTO currencies (code, display_name, exponent, enabled)
         VALUES ('BDG', 'Budget', 2, TRUE)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let user: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash) VALUES ('budget@example.test', 'hash') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let category: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type)
         VALUES ($1, 'Budget', 'budget', 'EXPENSE') RETURNING id",
    )
    .bind(user)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO budgets (user_id, category_id, currency_code, month_start, amount)
         VALUES ($1, $2, 'BDG', DATE '2026-08-01', 10)",
    )
    .bind(user)
    .bind(category)
    .execute(&pool)
    .await
    .unwrap();

    let result = sqlx::query("UPDATE currencies SET enabled = FALSE WHERE code = 'BDG'")
        .execute(&pool)
        .await;

    assert!(
        result.is_err(),
        "referenced budget currency must stay enabled"
    );
}

#[sqlx::test(migrations = false)]
async fn rejects_nonfinite_numeric_for_every_monetary_column(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let user: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash) VALUES ('nan@example.test', 'hash') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let wallet_nan = sqlx::query(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance)
         VALUES ($1, 'NaN', 'USD', 'NaN'::NUMERIC)",
    )
    .bind(user)
    .execute(&pool)
    .await;
    assert!(wallet_nan.is_err(), "opening balance must reject NaN");
    let wallet_infinity = sqlx::query(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance)
         VALUES ($1, 'Infinity', 'USD', 'Infinity'::NUMERIC)",
    )
    .bind(user)
    .execute(&pool)
    .await;
    assert!(
        wallet_infinity.is_err(),
        "opening balance must reject infinity"
    );

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

    let transaction_nan = sqlx::query(
        "INSERT INTO transactions
            (user_id, wallet_id, category_id, transaction_type, amount, occurred_at)
         VALUES ($1, $2, $3, 'EXPENSE', 'NaN'::NUMERIC, NOW())",
    )
    .bind(user)
    .bind(wallet)
    .bind(category)
    .execute(&pool)
    .await;
    assert!(
        transaction_nan.is_err(),
        "transaction amount must reject NaN"
    );
    let transaction_infinity = sqlx::query(
        "INSERT INTO transactions
            (user_id, wallet_id, category_id, transaction_type, amount, occurred_at)
         VALUES ($1, $2, $3, 'EXPENSE', 'Infinity'::NUMERIC, NOW())",
    )
    .bind(user)
    .bind(wallet)
    .bind(category)
    .execute(&pool)
    .await;
    assert!(
        transaction_infinity.is_err(),
        "transaction amount must reject infinity"
    );

    let budget_nan = sqlx::query(
        "INSERT INTO budgets (user_id, category_id, currency_code, month_start, amount)
         VALUES ($1, $2, 'USD', DATE '2026-08-01', 'NaN'::NUMERIC)",
    )
    .bind(user)
    .bind(category)
    .execute(&pool)
    .await;
    assert!(budget_nan.is_err(), "budget amount must reject NaN");
    let budget_infinity = sqlx::query(
        "INSERT INTO budgets (user_id, category_id, currency_code, month_start, amount)
         VALUES ($1, $2, 'USD', DATE '2026-08-01', 'Infinity'::NUMERIC)",
    )
    .bind(user)
    .bind(category)
    .execute(&pool)
    .await;
    assert!(
        budget_infinity.is_err(),
        "budget amount must reject infinity"
    );

    let recurring_nan = sqlx::query(
        "INSERT INTO recurring_transactions
            (user_id, wallet_id, category_id, transaction_type, amount, frequency, start_date, next_due_date)
         VALUES ($1, $2, $3, 'EXPENSE', 'NaN'::NUMERIC, 'daily', CURRENT_DATE, CURRENT_DATE)",
    )
    .bind(user)
    .bind(wallet)
    .bind(category)
    .execute(&pool)
    .await;
    assert!(recurring_nan.is_err(), "recurring amount must reject NaN");
    let recurring_infinity = sqlx::query(
        "INSERT INTO recurring_transactions
            (user_id, wallet_id, category_id, transaction_type, amount, frequency, start_date, next_due_date)
         VALUES ($1, $2, $3, 'EXPENSE', 'Infinity'::NUMERIC, 'daily', CURRENT_DATE, CURRENT_DATE)",
    )
    .bind(user)
    .bind(wallet)
    .bind(category)
    .execute(&pool)
    .await;
    assert!(
        recurring_infinity.is_err(),
        "recurring amount must reject infinity"
    );
}
