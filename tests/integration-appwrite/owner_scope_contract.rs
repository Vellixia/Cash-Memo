//! Compile/runtime contract for mandatory owner predicates.

use cashmemo_application::authorization::AuthenticatedOwner;
use cashmemo_appwrite_adapter::query::OwnerScope;
use cashmemo_domain::{LabelId, MoneyMemoId, OwnerId};
use uuid::Uuid;

#[test]
fn every_target_list_and_mutation_shape_contains_exactly_one_derived_owner_predicate()
-> Result<(), String> {
    let owner = AuthenticatedOwner::after_account_validation(
        OwnerId::parse_authenticated_account("owner_scope_test")
            .map_err(|_| "owner fixture invalid")?,
    );
    let scope = OwnerScope::new(&owner);
    let memo = MoneyMemoId::new(Uuid::new_v4());
    let label = LabelId::new(Uuid::new_v4());

    for queries in [
        scope.memo_target(memo),
        scope.memo_list(),
        scope.memo_mutation_target(memo),
        scope.label_target(label),
        scope.label_list(),
        scope.label_mutation_target(label),
        scope.journal_target(),
    ] {
        assert_eq!(
            queries
                .iter()
                .filter(|query| query.contains("\"attribute\":\"owner_id\""))
                .count(),
            1
        );
        assert!(
            queries
                .first()
                .is_some_and(|query| query.contains("\"attribute\":\"owner_id\""))
        );
    }

    assert!(scope.extra_equal("owner_id", "attacker").is_err());
    Ok(())
}
