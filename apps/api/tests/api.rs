//! End-to-end API check against a real Postgres (`DATABASE_URL`, e.g. `docker-compose up -d db`).
use api::{AppState, app};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use domain::migration::{Migrator, MigratorTrait};
use http_body_util::BodyExt;
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
    let app = test_app().await;

    let (s, _, _) = call(&app, "GET", "/api/auth/me", "", None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    let a = signup(&app).await;
    let (s, _, me) = call(&app, "GET", "/api/auth/me", &a, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(me["default_currency"], "USD");
    let (s, _, me) = call(
        &app,
        "PATCH",
        "/api/auth/me",
        &a,
        Some(json!({ "default_currency": "idr" })),
    )
    .await;
    assert_eq!(
        (s, me["default_currency"].clone()),
        (StatusCode::OK, json!("IDR"))
    );
    let (s, _, _) = call(
        &app,
        "PATCH",
        "/api/auth/me",
        &a,
        Some(json!({ "default_currency": "rupiah" })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
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

    // Every account starts with a Cash source.
    let (_, _, sources) = call(&app, "GET", "/api/sources", &a, None).await;
    assert_eq!(sources[0]["name"], "Cash");
    let cash = sources[0]["id"].clone();

    // 2026-09-30T20:00Z is 2026-10-01 03:00 at +07:00, so it belongs to October locally.
    let memos = [
        json!({ "direction": "expense", "amount_minor": 1250, "currency": "usd", "occurred_at": "2026-09-10T12:00:00Z", "category_id": cat["id"], "source_id": cash, "note": " lunch " }),
        json!({ "direction": "expense", "amount_minor": 750, "currency": "USD", "occurred_at": "2026-09-11T12:00:00Z", "source_id": cash }),
        json!({ "direction": "income", "amount_minor": 5000000, "currency": "IDR", "occurred_at": "2026-09-01T00:00:00Z" }),
        json!({ "direction": "income", "amount_minor": 999, "currency": "USD", "occurred_at": "2026-09-30T20:00:00Z" }),
    ];
    let mut ids = vec![];
    for m in memos {
        let (s, _, body) = call(&app, "POST", "/api/memos", &a, Some(m)).await;
        assert_eq!(s, StatusCode::CREATED, "{body}");
        ids.push(body["id"].as_str().unwrap().to_owned());
    }
    let (s, _, _) = call(&app, "POST", "/api/memos", &a, Some(json!({ "direction": "expense", "amount_minor": 0, "currency": "USD", "occurred_at": "2026-09-10T12:00:00Z", "source_id": cash }))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _, err) = call(&app, "POST", "/api/memos", &a, Some(json!({ "direction": "expense", "amount_minor": 1, "currency": "USD", "occurred_at": "2026-09-10T12:00:00Z" }))).await;
    assert_eq!(
        (s, err["error"].clone()),
        (StatusCode::BAD_REQUEST, json!("an expense needs a source"))
    );

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

/// Tests run in parallel; migrations must run once, not race each other.
static MIGRATED: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();

async fn test_app() -> Router {
    dotenvy::dotenv().ok();
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let db = sea_orm::Database::connect(&url).await.unwrap();
    MIGRATED
        .get_or_init(|| async { Migrator::up(&db, None).await.unwrap() })
        .await;
    app(AppState {
        db,
        cookie_secure: false,
    })
}

#[tokio::test]
async fn sources_and_transfers() {
    let app = test_app().await;
    let a = signup(&app).await;
    let src = |body: Value| {
        let app = app.clone();
        let a = a.clone();
        async move { call(&app, "POST", "/api/sources", &a, Some(body)).await }
    };
    let memo = |body: Value| {
        let app = app.clone();
        let a = a.clone();
        async move { call(&app, "POST", "/api/memos", &a, Some(body)).await }
    };

    let (_, _, list) = call(&app, "GET", "/api/sources", &a, None).await;
    let cash = list[0]["id"].clone();
    assert_eq!(
        list[0]["balance_minor"],
        Value::Null,
        "untracked has no balance"
    );

    let (s, _, _) = src(json!({ "name": "BCA", "kind": "bank", "track_balance": true })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "tracking needs a currency");
    let (s, _, _) = src(json!({ "name": "Cash", "kind": "cash" })).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _, bca) = src(json!({ "name": "BCA", "kind": "bank", "emoji": "🏦", "track_balance": true, "currency": "idr", "opening_minor": 1_000_000 })).await;
    assert_eq!(
        (s, bca["balance_minor"].clone()),
        (StatusCode::CREATED, json!(1_000_000))
    );
    // A credit card owing 200k starts at −200k.
    let (_, _, visa) = src(json!({ "name": "Visa", "kind": "credit", "track_balance": true, "currency": "IDR", "opening_minor": -200_000 })).await;
    let (bca, visa) = (bca["id"].clone(), visa["id"].clone());

    let at = "2026-09-10T12:00:00Z";
    let (s, _, _) = memo(json!({ "direction": "income", "amount_minor": 500_000, "currency": "IDR", "occurred_at": at, "source_id": bca })).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _, _) = memo(json!({ "direction": "expense", "amount_minor": 50_000, "currency": "IDR", "occurred_at": at, "source_id": visa })).await;
    assert_eq!(s, StatusCode::CREATED);
    // Income may skip the source.
    let (s, _, _) = memo(
        json!({ "direction": "income", "amount_minor": 1, "currency": "IDR", "occurred_at": at }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    // Paying the card bill is a transfer: BCA → Visa.
    let (s, _, bill) = memo(json!({ "direction": "transfer", "amount_minor": 250_000, "currency": "IDR", "occurred_at": at, "source_id": bca, "to_source_id": visa })).await;
    assert_eq!(s, StatusCode::CREATED, "{bill}");

    for (bad, why) in [
        (
            json!({ "direction": "expense", "amount_minor": 1, "currency": "USD", "occurred_at": at, "source_id": bca }),
            "currency lock",
        ),
        (
            json!({ "direction": "transfer", "amount_minor": 1, "currency": "IDR", "occurred_at": at, "source_id": bca }),
            "transfer needs two",
        ),
        (
            json!({ "direction": "transfer", "amount_minor": 1, "currency": "IDR", "occurred_at": at, "source_id": bca, "to_source_id": bca }),
            "same source",
        ),
    ] {
        let (s, _, _) = memo(bad).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{why}");
    }

    let (_, _, list) = call(&app, "GET", "/api/sources", &a, None).await;
    let bal = |id: &Value| {
        list.as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == *id)
            .unwrap()["balance_minor"]
            .clone()
    };
    assert_eq!(bal(&bca), json!(1_000_000 + 500_000 - 250_000));
    assert_eq!(bal(&visa), json!(-200_000 - 50_000 + 250_000));
    assert_eq!(bal(&cash), Value::Null);

    // Transfers never count as income or expense.
    let (_, _, sum) = call(&app, "GET", "/api/summary?month=2026-09", &a, None).await;
    assert_eq!(
        sum["totals"],
        json!([
            { "currency": "IDR", "direction": "expense", "total_minor": 50_000 },
            { "currency": "IDR", "direction": "income", "total_minor": 500_001 },
        ])
    );
    // The source filter matches both sides of a transfer.
    let (_, _, visa_memos) = call(
        &app,
        "GET",
        &format!(
            "/api/memos?month=2026-09&source_id={}",
            visa.as_str().unwrap()
        ),
        &a,
        None,
    )
    .await;
    assert_eq!(visa_memos.as_array().unwrap().len(), 2);

    // Switching a transfer to an expense drops the destination.
    let (s, _, flipped) = call(
        &app,
        "PATCH",
        &format!("/api/memos/{}", bill["id"].as_str().unwrap()),
        &a,
        Some(json!({ "direction": "expense" })),
    )
    .await;
    assert_eq!(
        (s, flipped["to_source_id"].clone()),
        (StatusCode::OK, Value::Null)
    );

    // A currency lock can't be put on a source that already has other currencies.
    let (s, _, _) = memo(json!({ "direction": "expense", "amount_minor": 100, "currency": "USD", "occurred_at": at, "source_id": cash })).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _, _) = call(
        &app,
        "PATCH",
        &format!("/api/sources/{}", cash.as_str().unwrap()),
        &a,
        Some(json!({ "track_balance": true, "currency": "IDR" })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Archived sources can't be picked again, and the last active one can't be archived.
    let (s, _, _) = call(
        &app,
        "DELETE",
        &format!("/api/sources/{}", visa.as_str().unwrap()),
        &a,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _, _) = memo(json!({ "direction": "expense", "amount_minor": 1, "currency": "IDR", "occurred_at": at, "source_id": visa })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _, _) = call(
        &app,
        "DELETE",
        &format!("/api/sources/{}", bca.as_str().unwrap()),
        &a,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _, _) = call(
        &app,
        "DELETE",
        &format!("/api/sources/{}", cash.as_str().unwrap()),
        &a,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Other users can't see, use or edit A's sources.
    let b = signup(&app).await;
    let (_, _, b_list) = call(&app, "GET", "/api/sources", &b, None).await;
    assert_eq!(b_list.as_array().unwrap().len(), 1);
    let (s, _, _) = call(&app, "POST", "/api/memos", &b, Some(json!({ "direction": "expense", "amount_minor": 1, "currency": "IDR", "occurred_at": at, "source_id": cash }))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _, _) = call(
        &app,
        "PATCH",
        &format!("/api/sources/{}", cash.as_str().unwrap()),
        &b,
        Some(json!({ "name": "mine" })),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
