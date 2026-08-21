mod routes;
mod service;

pub use routes::router;
pub use service::{
    ArchiveResult, Category, CategoryError, CategoryKind, CategoryService, NewCategory,
    UpdateCategory,
};
