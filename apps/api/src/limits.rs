use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::http::HeaderMap;

use crate::error::{AppError, Result};

/// Fixed-window counters keyed by an arbitrary string (IP, email, …).
// ponytail: in-memory, so limits are per API instance; move to Postgres/Redis if the API scales out.
#[derive(Default)]
pub struct RateLimiter {
    hits: Mutex<HashMap<String, (Instant, Duration, u32)>>,
}

impl RateLimiter {
    pub fn check(&self, key: String, max: u32, window: Duration) -> Result<()> {
        let now = Instant::now();
        let mut hits = self.hits.lock().unwrap_or_else(|e| e.into_inner());
        if hits.len() > 10_000 {
            hits.retain(|_, (start, w, _)| now.duration_since(*start) < *w);
        }
        let entry = hits.entry(key).or_insert((now, window, 0));
        if now.duration_since(entry.0) >= entry.1 {
            *entry = (now, window, 0);
        }
        entry.2 += 1;
        if entry.2 > max {
            return Err(AppError::TooManyRequests);
        }
        Ok(())
    }
}

/// The browser's IP as forwarded by the web proxy. The API is internal-only, so only the
/// proxy can set this header.
pub fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-client-ip")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_per_key_and_resets_after_the_window() {
        let l = RateLimiter::default();
        let w = Duration::from_millis(50);
        assert!(l.check("a".into(), 2, w).is_ok());
        assert!(l.check("a".into(), 2, w).is_ok());
        assert!(l.check("a".into(), 2, w).is_err());
        assert!(l.check("b".into(), 2, w).is_ok());
        std::thread::sleep(w);
        assert!(l.check("a".into(), 2, w).is_ok());
    }
}
