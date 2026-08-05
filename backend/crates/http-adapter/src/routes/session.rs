//! Live authenticated-session bootstrap for protected browser routes.

use axum::Json;

use crate::auth::Principal;
use crate::contracts::generated::AuthenticatedSession;

/// Returns the account identity only after the session extractor validates it with Appwrite.
pub async fn authenticated_session(Principal(owner): Principal) -> Json<AuthenticatedSession> {
    Json(AuthenticatedSession {
        account_id: owner.id().as_str().to_owned(),
    })
}
