use axum::{
    extract::Request,
    http::{HeaderValue, header},
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

const REQUEST_ID_HEADER: &str = "x-request-id";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequestId(String);

impl Default for RequestId {
    fn default() -> Self {
        Self::new()
    }
}

impl RequestId {
    pub fn from_request(request: &Request) -> Self {
        request
            .headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .and_then(Self::parse)
            .unwrap_or_else(Self::new)
    }

    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn parse(value: &str) -> Option<Self> {
        (value.len() == 36)
            .then(|| Uuid::parse_str(value).ok())
            .flatten()
            .map(|uuid| Self(uuid.hyphenated().to_string()))
    }
}

pub async fn attach(mut request: Request, next: Next) -> Response {
    let request_id = RequestId::from_request(&request);
    request.extensions_mut().insert(request_id.clone());

    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::HeaderName::from_static(REQUEST_ID_HEADER),
        HeaderValue::from_str(request_id.as_str()).expect("UUID is a valid header value"),
    );
    response
}
