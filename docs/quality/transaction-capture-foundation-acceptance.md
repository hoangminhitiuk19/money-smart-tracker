# Transaction Capture Foundation Acceptance

## Result and scope

The local transaction-capture foundation is **IMPLEMENTED_AND_VERIFIED** against
the disposable PostgreSQL database on 2026-08-09. This record covers Quick and
paste capture, owned draft review, atomic/idempotent import, five-type financial
reconciliation, two-user isolation, and local Chromium acceptance.

Independent specification and security reviews are owned by the task
controller and are not claimed here. Email ingestion and Production release
remain outside this phase. The only configured application environment names
remain `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`.

The controlling sources were product specification §§5–18, 20, 22, and 27–32;
the prompting guide's Golden Rules, Phase 15, security, mobile, and final-gate
requirements; and the transaction-capture program design's foundation,
accessibility, and acceptance sections.

## Automated evidence

<!-- markdownlint-disable MD013 -->

| Check | Result | Exact evidence |
| --- | --- | --- |
| Draft integration | Passed | `tests/integration/transaction-drafts.integration.test.ts`: 14/14 tests in 48.86 s after the final status-predicate fix |
| Complete PostgreSQL integration | Passed | Final Node.js 22 `npm run test:integration`: 17 files and 119 tests in 50.16 s |
| Terminal draft status guard | Passed | Direct update and dismiss probes reject owned `IMPORTING`, `IMPORTED`, and `DISMISSED` rows without mutation or activity leakage |
| Two-user direct objects | Passed | Capture-key lists, edit, dismiss, import, idempotency-key reuse, and replay are scoped independently; foreign operations return empty or generic safe results |
| Five-type ledger | Passed | A literal INCOME, EXPENSE, TRANSFER, REFUND, and ADJUSTMENT batch created five canonical transactions through the normal import boundary |
| Focused browser regressions | Passed | Node.js 22: 3 assertions for vertical keyboard navigation, smooth-scroll metadata, and favicon behavior |
| Final clean Node.js 22 gate | Passed | Clean install; 54 files/636 unit and rendered tests; valid Prisma schema; zero production vulnerabilities; successful 21-page build; 17 files/119 integration tests; five migrations current |

<!-- markdownlint-enable MD013 -->

The only recurring automated-test message was Vite's CJS API deprecation
notice; it did not fail a suite.

## Exact reconciliation

The deterministic scenario begins with a bank opening balance of `1,000.00`, a
credit card with a `500.00` limit, and an existing card expense of `30.00`. The
imported batch contains income `90071992547409.99`, card expense `45.25`,
bank-to-card transfer `100.00`, linked card refund `10.25`, and a `5.00`
decrease to card credit.

<!-- markdownlint-disable MD013 -->

| Projection | Independently asserted result |
| --- | --- |
| Bank tracked balance | `90071992548309.99` |
| Card state | Debt `0.00`; card credit `0.00`; available credit `500.00` |
| Fee waiver | Eligible spend `65.00`; progress `32.50%`; remaining `135.00` |
| Dashboard | Income `90071992547409.99`; raw expense `75.25`; net savings `90071992547334.74`; estimated net position `90071992548309.99` |
| Effective-expense reports | Income `90071992547409.99`; expense/category/quality/source totals `65.00` |
| Project | Income `90071992547409.99`; effective expense `65.00`; profit `90071992547344.99` |
| Activity | Five `TRANSACTION_CREATED` rows and one `TRANSACTION_BATCH_IMPORTED` row with count 5 |
| CSV | Exact 13-column header and six owned data rows (the existing expense plus five imported rows); `CSV_EXPORTED.rowCount` is 6 |

<!-- markdownlint-enable MD013 -->

These literal assertions distinguish raw dashboard expense from refund-adjusted
effective expense and preserve the large decimal beyond JavaScript's safe
integer range as exact money text.

## Browser acceptance

The final flow ran in headless Chromium from a Node.js `v22.23.2` automation
process against the local Node.js 22 development server. The Playwright browser
download helper itself ran under the host's newer Node runtime; that helper did
not run the application or acceptance script.

- [x] Register and authenticate a fresh user, then create a bank account and a
  credit card through the UI.
- [x] Render Quick capture at 1440×1000 and save a keyboard-entered expense
  draft, then atomically import the selected row.
- [x] Preserve malformed CSV for correction and parse both tab-separated and
  comma-separated spreadsheet rows.
- [x] Require an explicit mapping for ambiguous amount headers.
- [x] Persist and review six pasted rows covering all five transaction types.
- [x] Fill the Food category from row 1 into selected row 2.
- [x] Move focus from row 1 title to row 2 title with `ArrowDown`; the focused
  regression also verifies `ArrowUp`.
- [x] Correct the adjustment source in the row inspector and reach six READY
  rows.
- [x] Match `prefers-reduced-motion: reduce`; the ledger row transition measured
  `0.00001s`.
- [x] Reflow the 1440px desktop surface into a 720 CSS-pixel viewport as a
  200%-zoom equivalent with zero document overflow.
- [x] Render mobile cards at 375×812 with document width 375, card width 295,
  desktop ledger hidden, and a 44px edit target.
- [x] Keep the focused mobile title input within the visible viewport.
- [x] Abort the exact first import request, retain all six selected drafts and
  show retry, then reuse the attempt and atomically create all six transactions.
- [x] Explicitly request `/favicon.ico` and receive HTTP 200.

Headless Chromium cannot display an operating-system virtual keyboard, so the
OS keyboard itself was not visually observed. The mobile input was focused and
measured inside the viewport instead. The 200% check is a CSS viewport reflow
equivalent, not browser-chrome zoom UI.

The final diagnostic record contains zero page errors, zero HTTP responses at
400 or above, zero unexpected console warnings/errors, and zero unexpected
request failures. Eight `ERR_ABORTED` entries were Next navigation cancellations.
One exact POST to `/transactions/capture` was deliberately failed with
`ERR_FAILED` to exercise retry, and was tagged by request object identity. No
5xx, Prisma, uniqueness, ownership, fatal, or unhandled error appeared in the
bounded server log.

Screenshots and raw JSON are retained locally under
`.superpowers/sdd/2026-08-03-transaction-capture-foundation/task-12-browser/`:

- `desktop-quick-empty.png`
- `desktop-reviewed-ledger.png`
- `desktop-200-percent-zoom-equivalent.png`
- `mobile-375-reviewed-cards.png`
- `transactions-after-atomic-save.png`
- `acceptance-results.json`

## Findings closed during acceptance

- Direct `updateTransactionDraft` and dismiss operations previously allowed
  terminal or in-flight drafts to return to an editable/dismissed state. RED
  PostgreSQL probes reproduced the issue; owner-and-status predicates now limit
  both operations to `NEEDS_REVIEW` and `READY`, including the mutation itself.
- Browser acceptance exposed missing same-column vertical arrow navigation.
  A RED rendered regression reproduced it; the ledger now moves text-input
  focus by row with `ArrowUp` and `ArrowDown`.
- Next warned that the document's existing smooth scrolling was not declared.
  The root element now carries `data-scroll-behavior="smooth"`, with a rendered
  regression and zero warnings in the final pass.
- An explicit `/favicon.ico` probe reproduced HTTP 404. A cacheable same-origin
  SVG favicon route and metadata now return HTTP 200, covered by a response
  regression.

Registration retries reached the disposable database's intentional rate limit
during harness development. One cleanup command removed all rows from the
disposable `rate_limit_buckets` table; this was broader than the later-preferred
register-only predicate, affected no Production data, and was not repeated. The
final successful browser pass was attempt 4 of the configured 5 registrations
after that cleanup.

## Final clean Node.js 22 gate

All commands ran from a clean `npm ci` under Node.js `v22.23.2` in the required
order:

<!-- markdownlint-disable MD013 -->

| Command | Exact result |
| --- | --- |
| `npm ci` | Passed; 594 packages installed and 595 audited. The development-inclusive audit reports 8 tooling advisories: 3 moderate, 4 high, and 1 critical. |
| `npm run verify` | Passed; lint had zero warnings, typecheck passed, 54 files and 636 unit/rendered tests passed, Prisma schema validated, production audit found 0 vulnerabilities, and the 21-page production build completed. |
| `npm run test:integration` | Passed; 17 files and 119 PostgreSQL tests in 50.16 s. |
| `npm run prisma:deploy` | Passed; five migrations found and no pending migrations. |
| `git diff --check` | Passed with no whitespace errors. |
| `git status --short` | Listed only eleven intended source, test, documentation, and dependency-lock paths before commit. |

<!-- markdownlint-enable MD013 -->

The first production-audit attempt exposed the newly reported
`GHSA-2v37-7h3g-55p8` advisory through `next → postcss → nanoid@3.3.16`. A
lockfile-only non-breaking remediation resolved `nanoid` to `3.3.18`; the clean
install and complete gate were then rerun from the beginning. The successful
build emitted Next's informational workspace-root inference warning because the
main checkout and this worktree both contain lockfiles.

The Node-version wrapper's first verify attempt also leaked its own
`npm_config_call` into the repository's nested `npx prisma validate` command.
Removing only that wrapper variable allowed the unchanged repository command to
run; direct Node 22 Prisma validation had already succeeded. Generated
`next-env.d.ts` and `tsconfig.tsbuildinfo` changes were restored to HEAD after
the final build.

The final deploy check initially reached PostgreSQL but timed out on Prisma's
advisory lock `72707369`. Read-only inspection found no local Prisma/test
process and identified one idle PgBouncer backend holding exactly that lock
after the completed integration suite. Only that idle backend connection was
terminated with a predicate that rechecked its PID, idle state, lock type, key,
and granted state; no data was deleted. The immediate deploy retry passed with
five migrations found and none pending.
