pub use sea_orm_migration::prelude::*;

mod m20260924_000001_init;
mod m20260924_000002_category_emoji;
mod m20260925_000003_default_currency;
mod m20261001_000004_sources;
mod m20261002_000005_jobs_email;
mod m20261003_000006_csv;
mod m20261006_000009_credit;
mod m20261007_000010_search;
mod m20261009_000012_attachments;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260924_000001_init::Migration),
            Box::new(m20260924_000002_category_emoji::Migration),
            Box::new(m20260925_000003_default_currency::Migration),
            Box::new(m20261001_000004_sources::Migration),
            Box::new(m20261002_000005_jobs_email::Migration),
            Box::new(m20261003_000006_csv::Migration),
            Box::new(m20261006_000009_credit::Migration),
            Box::new(m20261007_000010_search::Migration),
            Box::new(m20261009_000012_attachments::Migration),
        ]
    }
}
