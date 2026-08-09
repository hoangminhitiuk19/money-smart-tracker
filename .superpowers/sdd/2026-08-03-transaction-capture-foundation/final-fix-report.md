# Transaction Capture Foundation — Final Fix Report

## 2026-08-09 pre-implementation investigation and plan

### Sources and scope

Reviewed `AGENTS.md`; all nine Important findings in `final-review-findings.md`;
the approved program design sections Unified Draft Model, Spreadsheet Capture,
Privacy/Retention, Living Ledger interaction, Accessibility, Failure Handling,
and Verification; implementation-plan Tasks 2–6 and 8–12; product specification
§§3.1, 5, 6.1–6.5, 7, 8.2, 12–13, 19–20, and 27–31; and prompting-guide
Golden Rules plus Phases 6, 7, and 15. The keyboard finding is compatible with
the approved design: Enter begins editing, Escape restores the edit snapshot,
and native text/select behavior remains available while editing. No
source-of-truth conflict was found. Email/OAuth/OCR/AI and Production deployment
remain out of scope.

### Root causes and mutation targets

1. **Retention transition race.** `cleanupExpiredTransactionDrafts()` selects
   editable expired IDs, then deletes by ID alone. A row locked and transitioned
   to `IMPORTED`/`DISMISSED` after selection still matches the delete. Mutation
   caught: remove repeated expiry, editable-status, or selected-owner predicates
   from the delete boundary. Real PostgreSQL will hold a row lock, observe the
   cleanup delete waiting, transition/redact the row, then release it.
2. **Dismissal is server-only.** `dismissTransactionDrafts()` has no workspace
   command, confirmation, pending/error state, exact dismissed-ID result, or
   post-removal focus path. Mutation caught: bypass confirmation, hide failure,
   remove the wrong rows, or fail to restore/move focus. Rendered component and
   Chromium flows will use the real dialog and visible ledger behavior.
3. **Fee-waiver defaults lose provenance.** A non-card source materializes
   `false`; because drafts persist only the value, a later card source cannot
   distinguish that untouched default from a manual `false`. Mutation caught:
   erase the touched flag, default an untouched card to false, or overwrite a
   manual false after bank/card changes, reload, paste, or fill.
4. **Category quality defaults are absent from draft references/options.** The
   capture page strips `defaultQualityRating`, canonical owned references do not
   load it, and drafts have no quality touched/clear provenance. Mutation caught:
   omit the owned default, apply it after an explicit override/clear, or lose the
   touched state across Quick, Paste, edit, reload, or import.
5. **Duplicate acknowledgement is inferred only from current editable peers.**
   Import terminally clears the earlier fingerprint, so reassessment can promote
   the remaining unacknowledged duplicate. Mutation caught: remove the durable
   acknowledgement-required boolean or clear it during partial import. Real
   PostgreSQL will import only the earlier row and prove the later row stays
   blocked without retaining terminal candidate data/fingerprint.
6. **Import eligibility models server status only.** Local edits, delayed patch
   requests, and the bulk queue do not participate in `canImport`; import can
   race stale READY state. Mutation caught: permit a selected dirty/pending row,
   fail to await queued work, or import after delayed patch failure. Render tests
   cover delayed success/failure; PostgreSQL covers overlapping mutation/import.
7. **Invalid mapped enums collapse to null.** Mapping helpers return `null` for
   populated invalid quality/direction/target cells, making invalid input
   indistinguishable from blank. Mutation caught: silently clear any populated
   invalid enum instead of persisting a safe field marker and field-specific
   blocking finding until correction.
8. **Bulk chronology has no stable tie-break.** `createManyAndReturn()` supplies
   random IDs and one transaction-stable `createdAt`; calculations sort same-day
   rows by date, then createdAt, then random ID. Mutation caught: give pasted
   rows equal/reversed chronology or change replay IDs/order. Persist sequential
   millisecond `createdAt` values in prepared-row order and prove a
   non-commutative same-date card sequence plus idempotent replay in PostgreSQL.
9. **Ledger edits have no edit session.** Controlled inputs mutate immediately;
   blur saves the current value and Escape has nothing to restore. Arrow handlers
   also cannot distinguish navigation from active native editing. Mutation
   caught: Enter fails to establish a snapshot, Escape saves the edited value,
   blur re-saves a cancelled value, or active text/select editing loses native
   key behavior.

### Dependency-ordered strict-TDD execution plan

1. Add RED real-PostgreSQL retention-race coverage; repeat `{id,userId}` plus
   expiry/editable predicates at delete; run focused RED/GREEN retention gates.
2. Add RED schema/domain tests for safe draft-only provenance metadata:
   fee-waiver touched, quality touched, durable duplicate acknowledgement, and
   invalid mapped enum fields. Add a forward-only migration, generate Prisma,
   deploy to the disposable database, and run schema validation before consumers.
3. Add RED pure/action/integration tests for default provenance and sticky
   duplicates. Extend owned category references with `defaultQualityRating`,
   apply defaults only while untouched, preserve explicit override/clear, and
   redact all new candidate/provenance state at import/dismissal.
4. Add RED paste and rendered behavior for invalid populated quality,
   adjustment direction, and adjustment target. Persist only bounded safe field
   markers (raw values remain in editable `rawRow`), merge field-specific
   findings server-side, and clear each marker only through correction.
5. Add RED transaction-create and PostgreSQL chronology/replay cases. Persist
   ordered `createdAt` instants for bulk rows without changing Decimal,
   canonical preparation, IDs on replay, or existing calculation ordering.
6. Add RED workspace tests for dirty fields, delayed patch success/failure,
   queued fills, and import overlap. Track dirty fields and in-flight mutations,
   await the mutation/bulk queues before import, re-evaluate authoritative READY
   state, and keep selection/retry state honest on failure. Add the PostgreSQL
   overlap regression at the action boundary.
7. Add RED user-visible dismissal tests. Expose confirmed selected-row dismissal
   through the existing Living Ledger toolbar/dialog, return exact dismissed
   IDs, remove only confirmed terminal rows, announce partial/failure outcomes,
   and restore or advance focus predictably. Add dismissal activity to filters
   only if that already-touched surface is safe.
8. Add RED real-component keyboard tests for pointer/native edit, Enter snapshot,
   Escape rollback, and blur-after-cancel. Implement cell edit sessions in the
   desktop ledger without trapping focus or intercepting arrows/characters while
   native text/select editing is active; keep the visual direction unchanged.
9. Run focused regressions after every GREEN/refactor, then fresh Node 22 full
   `npm run verify`, complete `npm run test:integration`, `npx prisma validate`,
   disposable `npm run prisma:deploy` twice, production audit/build as covered by
   verify, `git diff --check`, and proportionate Chromium acceptance for
   dismissal, pending-save blocking, and Enter/Escape cancellation. Restore
   generated `next-env.d.ts`/`tsconfig.tsbuildinfo` noise, self-review
   `43b1016..HEAD` against every finding and scope constraint, append exact
   evidence/limits/concerns here, and create logical non-amended commits.

### Risk and acceptance boundaries

- Schema changes are draft-only, forward-only, bounded, ownership-scoped, and
  terminally redacted; canonical `Transaction` financial fields are unchanged.
- Import remains one serializable, atomic, idempotent transaction through the
  canonical prepare/persist boundary; no binary-number money conversion is
  introduced.
- UI completion keeps the approved Living Ledger palette, typography, status
  rail, responsive cards, and 44-pixel targets. Confirmation, focus visibility,
  safe errors, and native editing behavior are acceptance criteria, not redesign.
- Browser observations will be reported exactly; unavailable visual/runtime
  checks will remain explicit concerns rather than inferred passes.

## 2026-08-09 implementation and final evidence

### Closed findings

1. Retention cleanup now repeats the expiry and editable-status predicates at
   delete time and binds every selected ID to its owner. A forced PostgreSQL
   row-lock race proves a selected row that becomes `IMPORTED` is not deleted.
2. The Living Ledger exposes `Dismiss selected`, uses the established modal
   focus trap for explicit confirmation, shows pending and recoverable error
   states, consumes exact server-returned IDs, removes only those rows, reports
   partial success, and focuses the next row or review heading. The action
   returns exact owned IDs in request order and redacts all candidate metadata.
3. Drafts persist `countTowardFeeWaiverTouched`. Owned card/category rules
   derive untouched values after Quick/Paste, reload, direct edit, and fill;
   explicit false remains authoritative across bank/card transitions.
4. Capture options and canonical owned category references include
   `defaultQualityRating`; `qualityRatingTouched` preserves explicit override
   and explicit clear while untouched rows continue to receive owned defaults.
5. `duplicateAcknowledgementRequired` persists the need for confirmation after
   an earlier duplicate is partially imported and terminally redacted, without
   retaining terminal fingerprints or candidate values.
6. Import eligibility now includes selected dirty fields, pending patch counts,
   and the serialized bulk queue. Import drains queued/pending work and rereads
   current selected rows before calling the action. Failed patches stay dirty;
   no-op blur saves are skipped. A forced PostgreSQL patch/import overlap proves
   the committed edited title, rather than stale READY data, is imported.
7. Populated invalid pasted quality/direction/target enums persist only bounded
   field markers in editable drafts, produce field-specific blocking findings,
   and clear only when the exact field is corrected. Terminal redaction clears
   the markers.
8. Canonical bulk persistence assigns one-millisecond `createdAt` increments in
   prepared-row order. A non-commutative same-date card sequence proves stable
   card debt/credit chronology and idempotent replay IDs/order in PostgreSQL.
9. Desktop text cells now establish edit snapshots on Enter or pointer editing,
   keep arrows native during an active edit, restore and clear dirty state on
   Escape, skip blur-save after cancellation, and retain pre-edit cross-cell
   arrow navigation. Native select key handling remains unmodified.

The forward-only draft provenance migration adds four safe, bounded columns:
two boolean touched flags, one durable duplicate-acknowledgement boolean, and a
JSON array of invalid mapped field names. Canonical `Transaction` money and
directional fields are unchanged. Every new draft-only field is cleared on
import and dismissal.

### Strict RED to GREEN and mutation evidence

- Retention PostgreSQL race: RED deleted the row after it transitioned to
  `IMPORTED`; GREEN retained it with the repeated delete predicates.
- Schema/default/paste tests: RED observed missing provenance columns, absent
  category/card defaults, and invalid enums promoted as blank/READY; GREEN
  passed schema, validation, mapping, action, rendered UI, reload/import, and
  real-PostgreSQL correction cases.
- Sticky duplicate mutation: temporarily removing the durable preservation
  condition promoted the remaining duplicate to READY; restoring it kept the
  row blocked. The final test owns the GREEN PostgreSQL evidence.
- Chronology unit test: RED had no explicit `createdAt`; GREEN observed
  successive milliseconds and the PostgreSQL card sequence produced debt
  `0.00`, credit `50.00`, then replayed identically.
- Import coordination rendered tests were RED for local dirty, delayed success,
  delayed failure, and queued fill cases; all four are GREEN. The real
  PostgreSQL overlap imported the committed edited title and left the draft
  terminally redacted.
- Dismissal action/UI tests were RED for missing exact IDs and missing workflow;
  GREEN covers confirmation, cancel focus, disabled pending state, recoverable
  failure, partial removal, exact next-row focus, ownership, redaction, and
  metadata-only activity.
- Keyboard rendered tests were RED because Escape retained the edited value and
  boundary ArrowRight left an active edit; GREEN restores the snapshot, skips
  the patch, and leaves arrows inside the text control while active.

Focused final regression set:

```text
npx vitest run tests/transaction-capture.ui.test.tsx \
  tests/transaction-drafts.actions.test.ts \
  tests/transaction-draft-validation.test.ts \
  tests/transaction-paste.test.ts tests/transaction-create.test.ts \
  tests/transaction-draft-schema.test.ts tests/confirm-dialog.test.tsx
PASS — 7 files, 163 tests

npm run typecheck
PASS

npm run lint
PASS — zero warnings
```

The first complete unit-suite run found one stale retention mock expectation
(`select` now includes `userId` and delete repeats lifecycle predicates). The
expectation and fixture were corrected without weakening behavior; its focused
suite passed 6/6 before the fresh final gate.

### Fresh Node.js 22 gates

All commands below used cached Node.js `v22.23.2` directly.

```text
npm run verify
PASS — zero-warning lint; typecheck; 54 files / 659 unit tests; Prisma schema
valid; production audit found 0 vulnerabilities; optimized production build
compiled and generated 21 pages/routes successfully.

npm run test:integration
PASS — 17 files / 135 real-PostgreSQL tests in 79.57 seconds.
The transaction-draft file passed 30/30, including both forced races, sticky
duplicate state, defaults/explicit clears, invalid enum correction, exact
dismissal IDs, chronology, 200-row atomic replay, and retention bounds.

npx prisma validate
PASS — schema valid.

npm run prisma:deploy
PASS — 6 migrations found; no pending migrations.

npm run prisma:deploy (repeat)
PASS — 6 migrations found; no pending migrations.

git diff --check
PASS
```

The new migration was applied successfully to the disposable Neon database
during the focused schema gate. The two fresh final deploy invocations prove
idempotent replay. No Production deployment or Vercel action was performed.

### Focused Chromium acceptance

An authenticated headless Chromium run under Node.js `v22.23.2` created a
disposable `audit.invalid` user and owned bank account through the UI, pasted
two READY rows, and completed seven recorded checks:

- Enter edit followed by Escape restored the original title, cleared the dirty
  blocker, skipped blur-save, and kept import eligible;
- a deliberately delayed real patch request displayed the selected-row pending
  reason and disabled import until the authoritative response arrived;
- Escape from the real dismissal dialog restored focus to `Dismiss selected`;
- a deliberately delayed dismissal exposed a disabled `Dismissing drafts`
  state; and
- confirmed dismissal removed the exact first row, announced success, retained
  the second row, and focused its renumbered checkbox.

Final diagnostics were zero page errors, zero HTTP error responses, zero
unexpected console warning/error entries, and zero unexpected request failures.
Two Next RSC/server-action requests reported `net::ERR_ABORTED` while the local
server logged their normal 200 responses; the established browser harness treats
these navigation/action aborts as expected. The first run completed all six
interaction checks but classified one such GET abort as unexpected; after
narrowing only that diagnostic rule, the identical flow passed. Evidence is
retained locally in the ignored `final-fix-browser` directory, including the
machine-readable result and final screenshot.

Headless Chromium cannot display an operating-system virtual keyboard. This
round therefore claims real key events, focus, enabled/disabled states, server
actions, and painted DOM behavior—not OS keyboard chrome or manual browser-
chrome zoom.

### Final self-review and scope

Reviewed `43b1016..db0d74f` against every Important finding and the approved
scope. Private reads and mutations remain authenticated and owner-scoped;
foreign-key checks continue through canonical owned references; import remains
serializable, atomic, idempotent, Decimal-safe, and directional; terminal rows
retain no candidate values, raw rows, invalid markers, or duplicate
fingerprints. No `AUTH_SECRET`/`AUTH_URL`, full card data, OAuth, email capture,
OCR, AI, Production deployment, or unrelated refactor was introduced.

Implementation commit: `db0d74f fix transaction capture final safety gaps`.
The report is committed separately after final evidence so the implementation
commit remains an auditable checkpoint. No commits were amended.

Remaining product concerns: none. Verification limitations are the headless
browser constraints above and the benign Next worktree-root build warning caused
by the repository and worktree both containing lockfiles.
