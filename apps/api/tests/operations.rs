mod support;

use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use cashmemo_api::app::{AppState, build_app};
use serde_json::Value;
use sqlx::{PgPool, postgres::PgPoolOptions};
use tower::ServiceExt;

const REQUEST_ID: &str = "c5c2b736-c4bc-48ea-98a1-239d0e4f8f35";
const MATCHED_REQUEST_ID: &str = "50890d83-05bd-4dc0-a926-8e3549788522";

fn unavailable_app() -> axum::Router {
    let pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(50))
        .connect_lazy("postgres://cashmemo:cashmemo@127.0.0.1:1/cashmemo")
        .unwrap();
    build_app(AppState { pool })
}

#[tokio::test]
async fn liveness_does_not_require_database_connectivity() {
    let response = unavailable_app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health/live")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
}

#[tokio::test]
async fn readiness_fails_when_database_is_unavailable() {
    let response = unavailable_app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
}

#[derive(Debug, PartialEq, Eq)]
struct DatabaseSnapshot {
    tables: Vec<String>,
    columns: Vec<(String, String, String, String, i32)>,
    migrations: Vec<(i64, bool, String)>,
}

async fn snapshot_database(pool: &PgPool) -> DatabaseSnapshot {
    let tables = sqlx::query_scalar(
        "SELECT tablename
         FROM pg_catalog.pg_tables
         WHERE schemaname = 'public'
         ORDER BY tablename",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    let columns = sqlx::query_as(
        "SELECT table_name, column_name, data_type, is_nullable, ordinal_position
         FROM information_schema.columns
         WHERE table_schema = 'public'
         ORDER BY table_name, ordinal_position",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    let migrations = if tables.iter().any(|table| table == "_sqlx_migrations") {
        sqlx::query_as(
            "SELECT version, success, encode(checksum, 'hex')
             FROM _sqlx_migrations
             ORDER BY version",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    } else {
        Vec::new()
    };

    DatabaseSnapshot {
        tables,
        columns,
        migrations,
    }
}

async fn assert_readiness(pool: &PgPool, expected_status: StatusCode) {
    let before = snapshot_database(pool).await;
    let response = build_app(AppState { pool: pool.clone() })
        .oneshot(
            Request::builder()
                .uri("/api/v1/health/ready")
                .header("x-request-id", REQUEST_ID)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), expected_status);
    assert_eq!(response.headers()["x-request-id"], REQUEST_ID);
    if expected_status == StatusCode::SERVICE_UNAVAILABLE {
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(body["error"]["code"], "SERVICE_UNAVAILABLE");
        assert_eq!(body["error"]["request_id"], REQUEST_ID);
    }
    assert_eq!(snapshot_database(pool).await, before);
}

#[sqlx::test(migrations = false)]
async fn readiness_accepts_only_current_exact_v1_without_mutation(pool: PgPool) {
    support::migrate_v1(&pool).await;

    assert_readiness(&pool, StatusCode::OK).await;
}

#[sqlx::test(migrations = false)]
async fn readiness_rejects_empty_database_without_mutation(pool: PgPool) {
    assert_readiness(&pool, StatusCode::SERVICE_UNAVAILABLE).await;
}

#[sqlx::test(migrations = false)]
async fn readiness_rejects_v1_migration_prefix_without_mutation(pool: PgPool) {
    support::migrate_v1(&pool).await;
    sqlx::query("DELETE FROM _sqlx_migrations WHERE version = 9")
        .execute(&pool)
        .await
        .unwrap();

    assert_readiness(&pool, StatusCode::SERVICE_UNAVAILABLE).await;
}

#[sqlx::test(migrations = false)]
async fn readiness_rejects_failed_migration_without_mutation(pool: PgPool) {
    support::migrate_v1(&pool).await;
    sqlx::query("UPDATE _sqlx_migrations SET success = FALSE WHERE version = 9")
        .execute(&pool)
        .await
        .unwrap();

    assert_readiness(&pool, StatusCode::SERVICE_UNAVAILABLE).await;
}

#[sqlx::test(migrations = false)]
async fn readiness_rejects_checksum_divergence_without_mutation(pool: PgPool) {
    support::migrate_v1(&pool).await;
    sqlx::query("UPDATE _sqlx_migrations SET checksum = '\\x00' WHERE version = 9")
        .execute(&pool)
        .await
        .unwrap();

    assert_readiness(&pool, StatusCode::SERVICE_UNAVAILABLE).await;
}

#[sqlx::test(migrations = false)]
async fn readiness_rejects_unknown_non_empty_database_without_mutation(pool: PgPool) {
    sqlx::query("CREATE TABLE alien_data(id bigint primary key)")
        .execute(&pool)
        .await
        .unwrap();

    assert_readiness(&pool, StatusCode::SERVICE_UNAVAILABLE).await;
}

#[test]
fn serve_config_rejects_invalid_log_level_before_connecting() {
    let output = Command::new(env!("CARGO_BIN_EXE_cashmemo-api"))
        .arg("serve")
        .env_clear()
        .env("CASHMEMO_V1_DATABASE_URL", "not-a-database-url")
        .env("CASHMEMO_V1_PUBLIC_ORIGIN", "https://cashmemo.example")
        .env("CASHMEMO_V1_SMTP_HOST", "smtp.example")
        .env("CASHMEMO_V1_SMTP_FROM", "cashmemo@example.test")
        .env("CASHMEMO_V1_APP_ENV", "production")
        .env("CASHMEMO_V1_LOG_LEVEL", "password=secret")
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("CASHMEMO_V1_LOG_LEVEL"),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn scheduled_commands_reject_out_of_range_bounds_before_loading_config() {
    for args in [
        vec![
            "process-recurring",
            "--batch-size",
            "0",
            "--max-occurrences-per-recurring-transaction",
            "1",
        ],
        vec!["purge-trash", "--batch-size", "10001"],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_cashmemo-api"))
            .args(&args)
            .env_clear()
            .output()
            .unwrap();

        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(!output.status.success());
        assert!(
            stderr.contains(&format!("invalid value '{}'", args[2])),
            "stderr: {stderr}"
        );
        assert!(stderr.contains("--batch-size"), "stderr: {stderr}");
    }
}

#[sqlx::test(migrations = false)]
async fn scheduled_command_outputs_bounded_content_minimal_summary(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let database_url = current_test_database_url(&pool).await;
    let output = Command::new(env!("CARGO_BIN_EXE_cashmemo-api"))
        .args(["cleanup-auth-tokens", "--batch-size", "1"])
        .env_clear()
        .env("CASHMEMO_V1_DATABASE_URL", database_url)
        .env("CASHMEMO_V1_PUBLIC_ORIGIN", "http://localhost:3000")
        .env("CASHMEMO_V1_SMTP_HOST", "localhost")
        .env("CASHMEMO_V1_SMTP_FROM", "cashmemo@example.test")
        .env("CASHMEMO_V1_APP_ENV", "test")
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let summary: Value = serde_json::from_slice(&output.stdout).expect("one JSON summary");
    assert_eq!(summary["command"], "cleanup-auth-tokens");
    assert_eq!(summary["processed"], 0);
    assert_eq!(summary.as_object().unwrap().len(), 2);
}

#[sqlx::test(migrations = false)]
async fn sigterm_allows_server_to_exit_successfully(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let database_url = current_test_database_url(&pool).await;
    let (mut child, address) = spawn_server(&database_url);
    wait_until_live(address);

    terminate(&child);
    let status = wait_for_exit(&mut child);
    assert!(status.success(), "server exited with {status}");
}

#[sqlx::test(migrations = false)]
async fn request_log_has_only_canonical_operational_fields(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let database_url = current_test_database_url(&pool).await;
    let (child, address) = spawn_server(&database_url);
    wait_until_live(address);

    let secret_body = r#"{"password":"secret-password","token":"secret-token","note":"private note","amount":"999.99"}"#;
    let response = request(
        address,
        &format!(
            "POST /api/v1/missing?password=query-password&note=private-query-note&amount=999.99 HTTP/1.1\r\nHost: {address}\r\nOrigin: https://cashmemo.example\r\nX-Request-Id: {REQUEST_ID}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{secret_body}",
            secret_body.len()
        ),
    );
    assert!(response.starts_with("HTTP/1.1 404"), "response: {response}");

    let response = request(
        address,
        &format!(
            "GET /api/v1/health/live?token=matched-token&note=matched-private-note HTTP/1.1\r\nHost: {address}\r\nX-Request-Id: {MATCHED_REQUEST_ID}\r\nConnection: close\r\n\r\n"
        ),
    );
    assert!(response.starts_with("HTTP/1.1 200"), "response: {response}");

    terminate(&child);
    let output = child.wait_with_output().unwrap();
    let events = String::from_utf8(output.stdout).unwrap();
    let event = events
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find(|event| {
            event["fields"]["event"] == "http_request"
                && event["fields"]["request_id"] == REQUEST_ID
        })
        .expect("structured http_request event");
    let fields = event["fields"].as_object().unwrap();
    assert_eq!(fields["request_id"], REQUEST_ID);
    assert_eq!(fields["status"], 404);
    assert!(fields["latency_ms"].is_u64());
    assert_eq!(
        fields.keys().map(String::as_str).collect::<Vec<_>>(),
        [
            "event",
            "latency_ms",
            "method",
            "request_id",
            "route",
            "service",
            "status",
            "version",
        ]
    );
    assert_eq!(fields["method"], "POST");
    assert_eq!(fields["route"], "<unmatched>");
    assert_eq!(fields["service"], "cashmemo-api");
    assert_eq!(fields["version"], "0.1.0");
    let matched = events
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find(|event| {
            event["fields"]["event"] == "http_request"
                && event["fields"]["request_id"] == MATCHED_REQUEST_ID
        })
        .expect("matched structured http_request event");
    assert_eq!(matched["fields"]["method"], "GET");
    assert_eq!(matched["fields"]["route"], "/api/v1/health/live");
    for secret in [
        "secret-password",
        "secret-token",
        "private note",
        "999.99",
        "password",
        "token",
        "note",
        "amount",
        "query-password",
        "private-query-note",
        "matched-token",
        "matched-private-note",
        "/api/v1/missing?",
        "/api/v1/health/live?",
    ] {
        assert!(!events.contains(secret), "log leaked {secret}: {events}");
    }
}

async fn current_test_database_url(pool: &PgPool) -> String {
    let database_name: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(pool)
        .await
        .unwrap();
    let base = std::env::var("DATABASE_URL").expect("DATABASE_URL for sqlx tests");
    let (prefix, _) = base.rsplit_once('/').unwrap();
    format!("{prefix}/{database_name}")
}

fn spawn_server(database_url: &str) -> (Child, SocketAddr) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let child = Command::new(env!("CARGO_BIN_EXE_cashmemo-api"))
        .arg("serve")
        .env_clear()
        .env("CASHMEMO_V1_DATABASE_URL", database_url)
        .env("CASHMEMO_V1_BIND_ADDR", address.to_string())
        .env("CASHMEMO_V1_PUBLIC_ORIGIN", "https://cashmemo.example")
        .env("CASHMEMO_V1_SMTP_HOST", "localhost")
        .env("CASHMEMO_V1_SMTP_FROM", "cashmemo@example.test")
        .env("CASHMEMO_V1_APP_ENV", "test")
        .env("CASHMEMO_V1_LOG_LEVEL", "info")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    (child, address)
}

fn wait_until_live(address: SocketAddr) {
    let started = Instant::now();
    loop {
        if let Ok(response) = try_request(
            address,
            &format!(
                "GET /api/v1/health/live HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
            ),
        ) && response.starts_with("HTTP/1.1 200")
        {
            return;
        }
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "server start timeout"
        );
        thread::sleep(Duration::from_millis(25));
    }
}

fn request(address: SocketAddr, request: &str) -> String {
    try_request(address, request).unwrap()
}

fn try_request(address: SocketAddr, request: &str) -> std::io::Result<String> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(250))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.write_all(request.as_bytes())?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    Ok(response)
}

fn terminate(child: &Child) {
    let status = Command::new("kill")
        .args(["-TERM", &child.id().to_string()])
        .status()
        .unwrap();
    assert!(status.success());
}

fn wait_for_exit(child: &mut Child) -> std::process::ExitStatus {
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        if started.elapsed() >= Duration::from_secs(5) {
            child.kill().unwrap();
            panic!("server shutdown timeout");
        }
        thread::sleep(Duration::from_millis(25));
    }
}
