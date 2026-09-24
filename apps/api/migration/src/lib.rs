pub use sea_orm_migration::prelude::*;

mod m20260924_000001_init;
mod m20260924_000002_category_emoji;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260924_000001_init::Migration),
            Box::new(m20260924_000002_category_emoji::Migration),
        ]
    }
}
