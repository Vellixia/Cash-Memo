# Cashmemo Feature Specifications

Spec Kit uses `.specify/feature.json` as authoritative active-feature pointer. Numeric prefixes
express product sequence; they are not unique database keys.

## Feature 001 reset

- `001-money-memo-foundation/` is preserved unchanged as historical specification, planning,
  task, and implementation-evidence context. It is superseded and MUST NOT supply requirements,
  acceptance state, assumptions, plan content, or task numbering to current work.
- `001-cashmemo-mvp/` is authoritative Feature 001 product specification. Only this directory may
  drive future clarification, planning, tasks, implementation, and acceptance for Cashmemo MVP.

Both directories intentionally retain prefix `001`. Spec Kit 0.13.0 resolves current feature from
the explicit `feature_directory` pointer, so no rename or destructive archive move is required.
