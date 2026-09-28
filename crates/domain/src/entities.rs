pub mod user {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
    #[sea_orm(table_name = "users")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: Uuid,
        pub email: String,
        pub password_hash: String,
        pub created_at: DateTimeUtc,
        pub default_currency: String,
        // Appearance sync across devices: { theme, accent, font, size }; the API rejects unknown keys/values.
        #[sea_orm(column_type = "Json")]
        pub preferences: serde_json::Value,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

pub mod session {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
    #[sea_orm(table_name = "sessions")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub token_hash: Vec<u8>,
        pub user_id: Uuid,
        pub expires_at: DateTimeUtc,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

pub mod category {
    use sea_orm::entity::prelude::*;
    use serde::Serialize;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
    #[sea_orm(table_name = "categories")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: Uuid,
        #[serde(skip)]
        pub user_id: Uuid,
        pub name: String,
        pub direction: String,
        pub emoji: Option<String>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

pub mod source {
    use sea_orm::entity::prelude::*;
    use serde::Serialize;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
    #[sea_orm(table_name = "sources")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: Uuid,
        #[serde(skip)]
        pub user_id: Uuid,
        pub name: String,
        pub kind: String,
        pub emoji: Option<String>,
        pub track_balance: bool,
        pub currency: Option<String>,
        pub opening_minor: i64,
        /// Credit/paylater only: limit, statement and due day of month (1-31). Null otherwise.
        pub credit_limit_minor: Option<i64>,
        pub statement_day: Option<i16>,
        pub due_day: Option<i16>,
        pub archived_at: Option<DateTimeUtc>,
        #[serde(skip)]
        pub created_at: DateTimeUtc,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

pub mod memo {
    use sea_orm::entity::prelude::*;
    use serde::Serialize;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
    #[sea_orm(table_name = "memos")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: Uuid,
        #[serde(skip)]
        pub user_id: Uuid,
        pub direction: String,
        pub amount_minor: i64,
        pub currency: String,
        pub occurred_at: DateTimeUtc,
        pub category_id: Option<Uuid>,
        pub source_id: Option<Uuid>,
        pub to_source_id: Option<Uuid>,
        pub note: Option<String>,
        /// Set when this memo was created by an installment plan.
        pub installment_plan_id: Option<Uuid>,
        /// S3 key of the one optional receipt/photo attachment. Never serialized directly —
        /// callers see `has_attachment` (added by `apps/api/src/memos.rs::MemoOut`) instead.
        #[serde(skip)]
        pub attachment_key: Option<String>,
        #[serde(skip)]
        pub deleted_at: Option<DateTimeUtc>,
        pub created_at: DateTimeUtc,
        pub updated_at: DateTimeUtc,
        /// The rule that created (or was made from) this memo.
        pub recurring_rule_id: Option<Uuid>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

pub mod installment_plan {
    use sea_orm::entity::prelude::*;
    use serde::Serialize;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
    #[sea_orm(table_name = "installment_plans")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: Uuid,
        #[serde(skip)]
        pub user_id: Uuid,
        pub source_id: Uuid,
        pub category_id: Option<Uuid>,
        pub note: Option<String>,
        pub currency: String,
        pub principal_minor: i64,
        pub fee_minor: i64,
        pub months: i16,
        pub first_date: Date,
        pub created_at: DateTimeUtc,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

pub mod email_token {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
    #[sea_orm(table_name = "email_tokens")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub token_hash: Vec<u8>,
        pub user_id: Uuid,
        pub purpose: String,
        pub new_email: Option<String>,
        pub expires_at: DateTimeUtc,
        pub used_at: Option<DateTimeUtc>,
        pub created_at: DateTimeUtc,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

pub mod recurring_rule {
    use sea_orm::entity::prelude::*;
    use serde::Serialize;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
    #[sea_orm(table_name = "recurring_rules")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: Uuid,
        #[serde(skip)]
        pub user_id: Uuid,
        pub direction: String,
        pub amount_minor: i64,
        pub currency: String,
        pub category_id: Option<Uuid>,
        pub source_id: Option<Uuid>,
        pub to_source_id: Option<Uuid>,
        pub note: Option<String>,
        pub cadence: String,
        pub anchor_day: i16,
        pub next_date: Date,
        pub offset_minutes: i32,
        pub paused_at: Option<DateTimeUtc>,
        pub created_at: DateTimeUtc,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

pub mod budget {
    use sea_orm::entity::prelude::*;
    use serde::Serialize;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
    #[sea_orm(table_name = "budgets")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: Uuid,
        #[serde(skip)]
        pub user_id: Uuid,
        pub category_id: Uuid,
        pub currency: String,
        pub limit_minor: i64,
        #[serde(skip)]
        pub created_at: DateTimeUtc,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
