# Task 21 report: budget and recurring-rule management

- Implemented exact budget progress/status rendering, single Progress composition, archived budget category references, Base UI Select controls, Dialog edit forms, and AlertDialog deletion confirmation.
- Implemented recurring wallet/category context, status Badge/direction indicators, local DATE-only due-date formatting, future-only edit copy, pause/no-occurrence and resume/no-backfill copy.
- Added RED assertions for exact negative-zero/malformed remaining and date-only rendering; initial RED observed before fixes. Updated focused tests and E2E selection helpers for Base UI controls.
- RED command: mandated `pnpm --dir apps/web vitest ...` is unsupported by workspace pnpm (`[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL]`); equivalent `pnpm --dir apps/web exec vitest ...` used.
- GREEN: focused Vitest 16/16; full web Vitest 169/169; focused ESLint; TypeScript; Next build; representative Playwright E2E 1/1.
- `pnpm toolchain:check` passed Node 24.14.0/pnpm 11.13.1. No generated Orval files changed.
- Primitive inventory updated. Pre-existing `.claude/settings.json`, `.serena/`, `AGENTS.md`, `CLAUDE.md` intentionally untouched/unstaged.
- Self-review: no money conversion through Number/parseFloat; only bounded server progress uses existing helper. E2E initially found role collision; removed card `role=status` while preserving visible non-color status text.
- Concern: unrelated `wallets-categories.spec.ts` still uses legacy `selectOption` for older cross-slice flow; Task 21 representative E2E was migrated and passes.
