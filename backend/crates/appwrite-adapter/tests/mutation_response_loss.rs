//! Mutation ambiguity injection: adapter requests are never blindly replayed.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use cashmemo_appwrite_adapter::{AppwriteClient, AppwriteConfig, AppwriteError};
use tokio::net::TcpListener;
use tokio::time::timeout;

fn client(endpoint: String) -> AppwriteClient {
    AppwriteClient::new(AppwriteConfig {
        endpoint,
        project_id: "project".to_owned(),
        api_key: "test-key-not-a-secret".to_owned(),
        database_id: "cashmemo".to_owned(),
    })
    .unwrap_or_else(|_| panic!("test client unavailable"))
}

async fn response_loss_server() -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .unwrap_or_else(|_| panic!("test listener unavailable"));
    let address = listener
        .local_addr()
        .unwrap_or_else(|_| panic!("test address unavailable"));
    let count = Arc::new(AtomicUsize::new(0));
    let observed = Arc::clone(&count);
    let task = tokio::spawn(async move {
        while let Ok(Ok((socket, _))) =
            timeout(Duration::from_millis(500), listener.accept()).await
        {
            observed.fetch_add(1, Ordering::SeqCst);
            drop(socket);
        }
    });
    (format!("http://{address}/v1"), count, task)
}

#[tokio::test]
async fn transaction_staging_response_loss_is_not_replayed() {
    let (endpoint, count, server) = response_loss_server().await;
    let result = client(endpoint).stage_operations("tx-1", vec![]).await;
    assert_eq!(result, Err(AppwriteError::Unavailable));
    server
        .await
        .unwrap_or_else(|_| panic!("test server failed"));
    assert_eq!(count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn transaction_commit_response_loss_is_not_replayed() {
    let (endpoint, count, server) = response_loss_server().await;
    let result = client(endpoint).commit_transaction("tx-1").await;
    assert_eq!(result, Err(AppwriteError::Unavailable));
    server
        .await
        .unwrap_or_else(|_| panic!("test server failed"));
    assert_eq!(count.load(Ordering::SeqCst), 1);
}
