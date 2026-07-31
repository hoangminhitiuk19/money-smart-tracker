# Phase 2 Preview Acceptance

## Status

This is the acceptance template for Task 17. The backend release gate is
closed, but Vercel Preview has **not been created or deployed**. Browser,
manual, mobile, and Preview security-smoke acceptance are **pending**.
Production deployment is not authorized by Phase 2.

- Local UX implementation base: `42a3282089992560c1c47ddc34ad1aeee6bb9ee4`
- Preview URL: **Pending**
- Preview deployment: **Not run**
- Acceptance date: **Pending**
- Tester: **Pending**
- Browser/device matrix: **Pending**

Preview may use only these environment variable names. Values must stay in the
deployment platform and must never be copied into this report:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`

## Local automated evidence

These results are fresh local Node.js 22 evidence. Passing local automation
does not complete browser acceptance.

| Command | Status | Evidence |
| --- | --- | --- |
| Focused confirmation-dialog rendered tests | Passed | 1 file; 6/6 keyboard and focus tests |
| Focused destructive-action rendered tests | Passed | 1 file; 8/8 success, failure, retry, and pending tests |
| Focused delete form-action result tests | Passed | 5 files; 78/78 tests, including all five result-forwarding contracts |
| Focused loading-state rendered tests | Passed | 1 file; 2/2 tests |
| `npm run verify` | Passed | Lint and typecheck passed; 41/41 files and 465/465 unit/rendered tests; Prisma schema valid; production audit found 0 vulnerabilities; build compiled with 19/19 static pages |
| `npm run test:integration` | Passed | 16/16 files; 103/103 PostgreSQL tests |
| `git diff --check` | Passed | No whitespace errors after confirmation hardening |

The host npm 11 wrapper exports its outer `--call` value as `npm_config_call`,
which conflicts with the verify script’s nested `npx prisma validate`.
The successful Node.js 22 run removed only that inherited wrapper variable and
ran the unchanged `npm run verify` script.

## 375px code preflight

This preflight is code/rendered inspection only, not browser acceptance.

| Surface | Local finding | Browser status |
| --- | --- | --- |
| Navigation | Mobile menu is available below `md`; mobile links and menu control use 44px minimum targets | Pending |
| Forms | Shared input, select, and button primitives use 44px mobile targets; raw checkbox/disclosure blockers were corrected | Pending |
| Tables | Protected-page and report tables are wrapped in horizontal overflow containers | Pending |
| Charts | Every Recharts chart is wrapped in `ResponsiveContainer` | Pending |
| Destructive dialogs | Shared dialog is full-width on mobile, starts on Cancel, traps forward/reverse focus, restores the invoking trigger, closes with Escape only when safe, and blocks duplicate submission | Pending |
| Destructive failures | Returned safe failures and caught unexpected failures stay in the dialog as persistent alerts; controls re-enable for retry and stale errors clear after cancel/reopen | Pending |
| Loading | Settings and Receipt Upload use skeleton-only route loading states with reduced-motion behavior | Pending |
| Reduced motion | Global reduced-motion fallback disables smooth scrolling and shortens animation/transition duration | Pending |

## Specification §29 manual QA

Every item remains pending until exercised against the approved disposable
Preview database in a real browser.

### Authentication

- [ ] Register a new user
- [ ] Log in
- [ ] Persist the session across reload/navigation
- [ ] Log out
- [ ] Confirm a protected route redirects after logout

### Transactions

- [ ] Create INCOME to an account
- [ ] Create EXPENSE from an account with a quality rating
- [ ] Create credit-card EXPENSE with no card credit
- [ ] Create credit-card EXPENSE with card credit and verify credit-first use
- [ ] Create bank-to-bank TRANSFER
- [ ] Create bank-to-card TRANSFER and verify debt decreases without income
- [ ] Create overflow card payment and verify debt zero plus card credit
- [ ] Create REFUND to a bank account
- [ ] Create REFUND to a card with debt
- [ ] Create REFUND to a card with zero debt
- [ ] Create ADJUSTMENT INCREASE
- [ ] Create ADJUSTMENT DECREASE
- [ ] Create card-debt ADJUSTMENT
- [ ] Verify category default quality prefill
- [ ] Edit a transaction
- [ ] Cancel transaction deletion and verify no write
- [ ] Confirm transaction deletion
- [ ] Filter by type, date, category, quality, and source
- [ ] Search by title and note
- [ ] Export the exact CSV columns with current-user-only rows

### Categories, accounts, goals, and projects

- [ ] Create, edit, cancel delete, and confirm delete for a category
- [ ] Create bank, wallet, cash, and credit-card sources
- [ ] Cancel and confirm source deletion
- [ ] Verify tracked balances include refunds
- [ ] Verify estimated net position
- [ ] Create a goal
- [ ] Contribute from an income transaction
- [ ] Contribute from existing savings
- [ ] Verify normal over-contribution is blocked
- [ ] Verify manual over-contribution is allowed
- [ ] Create a withdrawal and verify reduced progress
- [ ] Verify goal progress and remaining
- [ ] Cancel and confirm contribution deletion
- [ ] Cancel and confirm goal deletion
- [ ] Create a project and link transactions
- [ ] Verify project profit/loss and ROI
- [ ] Verify zero-expense ROI displays `N/A`
- [ ] Cancel and confirm project deletion

### Credit cards and renewals

- [ ] Verify the annual-fee reminder boundary
- [ ] Verify fee-waiver eligible expense progress
- [ ] Verify linked refund reduces fee-waiver progress
- [ ] Verify an excluded transaction does not affect fee-waiver progress
- [ ] Verify card credit is separate from credit limit
- [ ] Create a renewal
- [ ] Mark a renewal paid and verify its transaction/date
- [ ] Skip a renewal and verify no transaction
- [ ] Pause a renewal and verify it leaves upcoming results
- [ ] Cancel a renewal and verify it leaves upcoming results

### Dashboard, reports, activity, and security

- [ ] Verify every summary card against the reference ledger
- [ ] Verify dashboard period filtering
- [ ] Verify estimated-net-position labeling
- [ ] Render all ten report views
- [ ] Render every chart without errors
- [ ] Verify major mutations in Activity Log
- [ ] Verify Activity Log pagination and retention behavior
- [ ] Verify User A cannot read, reference, mutate, report, or export User B data
- [ ] Verify CSV contains only the authenticated user’s records
- [ ] Verify rate-limited CSV returns HTTP 429 with `Retry-After`
- [ ] Verify required response security headers

### 375px browser acceptance

- [ ] Navigate every protected page with the mobile menu
- [ ] Operate forms with a mobile keyboard
- [ ] Scroll every wide data table without page-width overflow
- [ ] Render and inspect every chart
- [ ] Cancel and confirm each destructive dialog
- [ ] Verify visible keyboard focus
- [ ] Verify loading, empty, success, and safe error states
- [ ] Verify reduced-motion preference

## Specification §30 deployment checks

- [ ] Confirm the intended Vercel project before linking
- [ ] Confirm the disposable Preview Neon database, never Production
- [ ] Configure only `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`
- [ ] Run `prisma migrate deploy`, never `db push`
- [ ] Deploy once to obtain the Preview address
- [ ] Set `NEXTAUTH_URL` to the actual Preview or stable branch address
- [ ] Redeploy after setting the final Preview URL
- [ ] Confirm the production build passes
- [ ] Test registration, login, logout, and session persistence
- [ ] Test representative transaction and goal writes
- [ ] Test protected routes after logout
- [ ] Test dashboard and reports after data entry
- [ ] Test CSV export and two-user isolation
- [ ] Confirm README setup, environment-variable names, and migration command

## Findings

Record each failure with date, environment, reproduction steps, expected and
actual behavior, severity, regression-test link, fix commit, and retest result.
Financial, security, ownership, or data-integrity failures reopen the backend
gate.

No browser or deployment findings have been recorded yet.
