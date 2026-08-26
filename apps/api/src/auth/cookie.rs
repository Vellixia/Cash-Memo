use axum::{
    http::{HeaderValue, header},
    response::Response,
};

pub fn session_cookie(token: &str) -> String {
    format!("__Host-cashmemo_session={token}; Path=/; Secure; HttpOnly; SameSite=Lax")
}

pub fn clear_session_cookie(response: &mut Response) {
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static(
            "__Host-cashmemo_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
        ),
    );
}
