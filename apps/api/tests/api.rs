//! End-to-end API check against a real Postgres (`DATABASE_URL`, e.g. `docker-compose up -d db`).
use api::{AppState, app};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use migration::{Migrator, MigratorTrait};
use serde_json::{Value, json};
use tower::ServiceExt;

async fn call(
    app: &Router,
    method: &str,
    path: &str,
    cookie: &str,
    body: Option<Value>,
) -> (StatusCode, Option<String>, Value) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header(header::COOKIE, cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.map_or(Body::empty(), |b| Body::from(b.to_string())))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let set_cookie = res
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_owned());
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        set_cookie,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn signup(app: &Router) -> String {
    let email = format!("{}@test.dev", uuid::Uuid::new_v4());
    let creds = json!({ "email": email, "password": "correct horse" });
    let (s, _, _) = call(app, "POST", "/api/auth/signup", "", Some(creds.clone())).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _, _) = call(app, "POST", "/api/auth/signup", "", Some(creds.clone())).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let bad = json!({ "email": email, "password": "wrong password" });
    let (s, _, _) = call(app, "POST", "/api/auth/login", "", Some(bad)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, cookie, _) = call(app, "POST", "/api/auth/login", "", Some(creds)).await;
    assert_eq!(s, StatusCode::OK);
    cookie.unwrap()
}

#[tokio::test]
async fn memo_flow() {
    dotenvy::dotenv().ok();
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let db = sea_orm::Database::connect(&url).await.unwrap();
    Migrator::up(&db, None).await.unwrap();
    let app = app(AppState {
        db,
        cookie_secure: false,
    });

    let (s, _, _) = call(&app, "GET", "/api/auth/me", "", None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    let a = signup(&app).await;
    let (s, _, me) = call(&app, "GET", "/api/auth/me", &a, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(me["email"].as_str().unwrap().ends_with("@test.dev"));

    let (s, _, cat) = call(
        &app,
        "POST",
        "/api/categories",
        &a,
        Some(json!({ "name": "Food", "direction": "expense" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    // 2026-09-30T20:00Z is 2026-10-01 03:00 at +07:00, so it belongs to October locally.
    let memos = [
        json!({ "direction": "expense", "amount_minor": 1250, "currency": "usd", "occurred_at": "2026-09-10T12:00:00Z", "category_id": cat["id"], "note": " lunch " }),
        json!({ "direction": "expense", "amount_minor": 750, "currency": "USD", "occurred_at": "2026-09-11T12:00:00Z" }),
        json!({ "direction": "income", "amount_minor": 5000000, "currency": "IDR", "occurred_at": "2026-09-01T00:00:00Z" }),
        json!({ "direction": "income", "amount_minor": 999, "currency": "USD", "occurred_at": "2026-09-30T20:00:00Z" }),
    ];
    let mut ids = vec![];
    for m in memos {
        let (s, _, body) = call(&app, "POST", "/api/memos", &a, Some(m)).await;
        assert_eq!(s, StatusCode::CREATED, "{body}");
        ids.push(body["id"].as_str().unwrap().to_owned());
    }
    let (s, _, _) = call(&app, "POST", "/api/memos", &a, Some(json!({ "direction": "expense", "amount_minor": 0, "currency": "USD", "occurred_at": "2026-09-10T12:00:00Z" }))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (_, _, first) = call(&app, "GET", &format!("/api/memos/{}", ids[0]), &a, None).await;
    assert_eq!(first["currency"], "USD");
    assert_eq!(first["note"], "lunch");

    let (_, _, sum) = call(
        &app,
        "GET",
        "/api/summary?month=2026-09&offset=420",
        &a,
        None,
    )
    .await;
    assert_eq!(
        sum["totals"],
        json!([
            { "currency": "IDR", "direction": "income", "total_minor": 5000000 },
            { "currency": "USD", "direction": "expense", "total_minor": 2000 },
        ])
    );

    assert_eq!(
        sum["by_category"],
        json!([
            { "category_id": null, "currency": "IDR", "direction": "income", "total_minor": 5000000 },
            { "category_id": cat["id"], "currency": "USD", "direction": "expense", "total_minor": 1250 },
            { "category_id": null, "currency": "USD", "direction": "expense", "total_minor": 750 },
        ])
    );

    // An expense category can't be put on an income memo, including by flipping only the direction.
    let (s, _, _) = call(&app, "POST", "/api/memos", &a, Some(json!({ "direction": "income", "amount_minor": 1, "currency": "USD", "occurred_at": "2026-09-10T12:00:00Z", "category_id": cat["id"] }))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _, _) = call(
        &app,
        "PATCH",
        &format!("/api/memos/{}", ids[0]),
        &a,
        Some(json!({ "direction": "income" })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Malformed input gets the same JSON error shape as everything else.
    let (s, _, err) = call(&app, "GET", "/api/memos?month=2026-09&offset=abc", &a, None).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(err["error"].is_string());

    let (s, _, renamed) = call(
        &app,
        "PATCH",
        &format!("/api/categories/{}", cat["id"].as_str().unwrap()),
        &a,
        Some(json!({ "name": " Groceries ", "emoji": "🛒" })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(renamed["name"], "Groceries");
    assert_eq!(renamed["emoji"], "🛒");
    // emoji-only PATCH keeps the name; null clears the emoji
    let (_, _, cleared) = call(
        &app,
        "PATCH",
        &format!("/api/categories/{}", cat["id"].as_str().unwrap()),
        &a,
        Some(json!({ "emoji": null })),
    )
    .await;
    assert_eq!(
        (cleared["name"].clone(), cleared["emoji"].clone()),
        (json!("Groceries"), Value::Null)
    );

    // PATCH: only touched fields change; explicit null clears the category.
    let (s, _, upd) = call(
        &app,
        "PATCH",
        &format!("/api/memos/{}", ids[0]),
        &a,
        Some(json!({ "amount_minor": 1300, "category_id": null })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        (
            upd["amount_minor"].clone(),
            upd["category_id"].clone(),
            upd["note"].clone()
        ),
        (json!(1300), Value::Null, json!("lunch"))
    );

    // Another user can't see or touch A's data.
    let b = signup(&app).await;
    for (method, body) in [
        ("GET", None),
        ("PATCH", Some(json!({ "amount_minor": 1 }))),
        ("DELETE", None),
    ] {
        let (s, _, _) = call(&app, method, &format!("/api/memos/{}", ids[0]), &b, body).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{method}");
    }
    let (_, _, b_list) = call(&app, "GET", "/api/memos?month=2026-09", &b, None).await;
    assert_eq!(b_list, json!([]));

    let (s, _, _) = call(&app, "DELETE", &format!("/api/memos/{}", ids[1]), &a, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, _, list) = call(&app, "GET", "/api/memos?month=2026-09&offset=420", &a, None).await;
    let listed: Vec<&str> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap())
        .collect();
    assert_eq!(listed, vec![ids[0].as_str(), ids[2].as_str()]);

    let (s, _, _) = call(&app, "POST", "/api/auth/logout", &a, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _, _) = call(&app, "GET", "/api/auth/me", &a, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}
