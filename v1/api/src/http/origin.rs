use axum::{
    extract::{Request, State},
    http::{Method, header},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::{error::HttpError, http::RequestId};

#[derive(Clone, Debug)]
pub struct OriginPolicy {
    allowed_origins: Vec<String>,
}

impl OriginPolicy {
    pub fn new(allowed_origins: Vec<String>) -> Self {
        Self { allowed_origins }
    }

    fn allows(&self, request: &Request) -> bool {
        request
            .headers()
            .get(header::ORIGIN)
            .and_then(|origin| origin.to_str().ok())
            .is_some_and(|origin| self.allowed_origins.iter().any(|allowed| allowed == origin))
    }
}

pub async fn enforce_exact_origin(
    State(policy): State<OriginPolicy>,
    request: Request,
    next: Next,
) -> Response {
    if is_unsafe(request.method()) && !policy.allows(&request) {
        let request_id = request
            .extensions()
            .get::<RequestId>()
            .cloned()
            .unwrap_or_else(RequestId::new);
        return HttpError::forbidden(request_id).into_response();
    }

    next.run(request).await
}

fn is_unsafe(method: &Method) -> bool {
    matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    )
}
