//! Real isolated Appwrite 1.9.6 `TablesDB` capability contract.

use std::env;

use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::{Value, json};

const EXPECTED_SCHEMA: &str = include_str!("../../infra/appwrite/schema.json");

struct Appwrite {
    client: reqwest::Client,
    endpoint: String,
    database: String,
}

impl Appwrite {
    fn from_environment() -> Result<Self, String> {
        let endpoint = env::var("APPWRITE_ENDPOINT")
            .map_err(|_| "APPWRITE_ENDPOINT required for real test".to_owned())?;
        let project = env::var("APPWRITE_PROJECT_ID")
            .map_err(|_| "APPWRITE_PROJECT_ID required for real test".to_owned())?;
        let key = env::var("APPWRITE_SERVER_API_KEY")
            .map_err(|_| "APPWRITE_SERVER_API_KEY required for real test".to_owned())?;
        let database = env::var("APPWRITE_DATABASE_ID").unwrap_or_else(|_| "cashmemo".to_owned());
        let mut headers = HeaderMap::new();
        headers.insert(
            "X-Appwrite-Project",
            HeaderValue::from_str(&project).map_err(|_| "invalid project configuration")?,
        );
        headers.insert(
            "X-Appwrite-Key",
            HeaderValue::from_str(&key).map_err(|_| "invalid key configuration")?,
        );
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .map_err(|_| "real Appwrite client unavailable")?;
        Ok(Self {
            client,
            endpoint: endpoint.trim_end_matches('/').to_owned(),
            database,
        })
    }

    async fn get(&self, path: &str) -> Result<Value, String> {
        let response = self
            .client
            .get(format!("{}{}", self.endpoint, path))
            .header("Cache-Control", "no-cache")
            .send()
            .await
            .map_err(|_| "Appwrite request failed")?;
        if !response.status().is_success() {
            return Err(format!(
                "Appwrite supported API returned HTTP {}",
                response.status().as_u16()
            ));
        }
        response
            .json()
            .await
            .map_err(|_| "Appwrite response was not JSON".to_owned())
    }

    async fn get_all(&self, path: &str) -> Result<Value, String> {
        let response = self
            .client
            .get(format!("{}{}", self.endpoint, path))
            .query(&[("queries[]", r#"{"method":"limit","values":[100]}"#)])
            .header("Cache-Control", "no-cache")
            .send()
            .await
            .map_err(|_| "Appwrite request failed")?;
        if !response.status().is_success() {
            return Err(format!(
                "Appwrite supported API returned HTTP {}",
                response.status().as_u16()
            ));
        }
        response
            .json()
            .await
            .map_err(|_| "Appwrite response was not JSON".to_owned())
    }

    async fn post(&self, path: &str, body: Value) -> Result<(u16, Value), String> {
        let response = self
            .client
            .post(format!("{}{}", self.endpoint, path))
            .json(&body)
            .send()
            .await
            .map_err(|_| "Appwrite request failed")?;
        let status = response.status().as_u16();
        let value = response
            .json()
            .await
            .map_err(|_| "Appwrite response was not JSON".to_owned())?;
        Ok((status, value))
    }
}

fn entries(value: &Value, key: &str) -> Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

#[tokio::test]
async fn real_schema_columns_indexes_permissions_and_limits() -> Result<(), String> {
    let appwrite = Appwrite::from_environment()?;
    let expected: Value =
        serde_json::from_str(EXPECTED_SCHEMA).map_err(|_| "checked-in schema is invalid JSON")?;
    let tables = expected
        .get("tables")
        .and_then(Value::as_array)
        .ok_or("checked-in schema has no tables")?;
    for expected_table in tables {
        let table = expected_table
            .get("id")
            .and_then(Value::as_str)
            .ok_or("checked-in table has no id")?;
        let value = appwrite
            .get(&format!("/tablesdb/{}/tables/{table}", appwrite.database))
            .await?;
        assert_eq!(value.get("$id").and_then(Value::as_str), Some(table));
        assert_eq!(
            value.get("rowSecurity").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            value
                .get("$permissions")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );

        let columns = appwrite
            .get_all(&format!(
                "/tablesdb/{}/tables/{table}/columns",
                appwrite.database
            ))
            .await?;
        let column_total = columns
            .get("total")
            .and_then(Value::as_u64)
            .ok_or("column list has no total")?;
        let columns = entries(&columns, "columns");
        assert_eq!(
            columns.len() as u64,
            column_total,
            "column list must not be truncated"
        );
        assert!(
            columns
                .iter()
                .all(|column| column.get("status").and_then(Value::as_str) == Some("available"))
        );
        let mut actual_column_keys = columns
            .iter()
            .filter_map(|column| column.get("key").and_then(Value::as_str))
            .collect::<Vec<_>>();
        let mut expected_column_keys = expected_table
            .get("columns")
            .and_then(Value::as_array)
            .ok_or("checked-in table has no columns")?
            .iter()
            .filter_map(|column| column.get("key").and_then(Value::as_str))
            .collect::<Vec<_>>();
        actual_column_keys.sort_unstable();
        expected_column_keys.sort_unstable();
        assert_eq!(
            actual_column_keys, expected_column_keys,
            "real column drift in {table}"
        );

        let indexes = appwrite
            .get_all(&format!(
                "/tablesdb/{}/tables/{table}/indexes",
                appwrite.database
            ))
            .await?;
        let indexes = entries(&indexes, "indexes");
        assert!(
            indexes.len() < 20,
            "project limit requires fewer than twenty custom indexes per table"
        );
        assert!(
            indexes
                .iter()
                .all(|index| index.get("status").and_then(Value::as_str) == Some("available"))
        );
        let mut actual_index_keys = indexes
            .iter()
            .filter_map(|index| index.get("key").and_then(Value::as_str))
            .collect::<Vec<_>>();
        let mut expected_index_keys = expected_table
            .get("indexes")
            .and_then(Value::as_array)
            .ok_or("checked-in table has no indexes")?
            .iter()
            .filter_map(|index| index.get("key").and_then(Value::as_str))
            .collect::<Vec<_>>();
        actual_index_keys.sort_unstable();
        expected_index_keys.sort_unstable();
        assert_eq!(
            actual_index_keys, expected_index_keys,
            "real index drift in {table}"
        );
    }
    Ok(())
}

#[tokio::test]
async fn real_transactions_and_ttl_zero_queries_are_supported() -> Result<(), String> {
    let appwrite = Appwrite::from_environment()?;
    let (status, transaction) = appwrite
        .post("/tablesdb/transactions", json!({ "ttl": 60 }))
        .await?;
    assert!(
        (200..300).contains(&status),
        "transaction creation unsupported"
    );
    assert!(transaction.get("$id").and_then(Value::as_str).is_some());

    let (status, page) = appwrite
        .post(
            "/graphql",
            json!({
                "query": "query ListRows($databaseId: String!, $tableId: String!, $queries: [String!], $ttl: Int) { tablesDBListRows(databaseId: $databaseId, tableId: $tableId, queries: $queries, ttl: $ttl) { total rows { _id } } }",
                "variables": {
                    "databaseId": appwrite.database,
                    "tableId": "money_memos",
                    "queries": [],
                    "ttl": 0
                }
            }),
        )
        .await?;
    assert!(
        (200..300).contains(&status),
        "GraphQL POST-body list with ttl=0 unsupported"
    );
    assert!(
        page.get("errors").is_none(),
        "GraphQL POST-body list rejected"
    );
    assert!(
        page.pointer("/data/tablesDBListRows/rows")
            .and_then(Value::as_array)
            .is_some(),
        "GraphQL POST-body list response shape changed"
    );
    Ok(())
}
