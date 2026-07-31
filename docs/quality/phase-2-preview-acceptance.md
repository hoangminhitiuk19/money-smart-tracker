# Phase 2 Preview Acceptance

## Result

The protected Vercel Preview is **APPROVED_PREVIEW_BROWSER**. Exhaustive
financial, domain, and mobile follow-up returned:

- **APPROVED_FINANCE_EDGES**
- **APPROVED_DOMAIN_EDGES**
- **APPROVED_MOBILE_STATES**
- **APPROVED_POISON_SANITIZATION**
- **APPROVED_REMOTE_RENEWAL_SANITIZATION**
- **APPROVED_FINAL_GATE_V2**

The application tree at `5714d83` is deployed to the stable protected
[Preview](https://money-smart-tracker-preview-minhs-projects-f5a749c2.vercel.app).
The final redeployment is `Ready`, targets Preview, runs Node.js 22 in `sin1`,
and uses the stable alias for `NEXTAUTH_URL`. The alias was moved to the new
deployment, the old Preview was removed, Deployment Protection remains enabled,
the temporary test bypass was revoked, and exactly one final Preview remains.
Production release remains outside Phase 2 authorization.

- Acceptance date: 2026-07-31
- Browser matrix: desktop Chromium, 375px Chromium, reduced motion
- Runtime review: 500 log entries; zero 5xx, error, fatal, or uniqueness events
- Browser diagnostics: zero console, page, request, or assertion failures

Only the following application environment-variable names are configured for
Preview. No values are recorded here:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`

## Automated and platform evidence

The clean Node.js 22 whole-phase gate at `ccde00e` returned
**APPROVED_FINAL_GATE_V2**. This closes the Phase 2 release gate; it does not
claim that the branch has been merged or integrated.

<!-- markdownlint-disable MD013 -->

| Check | Status | Evidence |
| --- | --- | --- |
| Clean install | Passed | Node.js 22 `npm ci` completed from the audited tree |
| `npm run verify` | Passed | Lint, typecheck, Prisma validation, production dependency audit, and build passed; 44 files and 473 unit/rendered tests passed |
| `npm run test:integration` | Passed | 16 files and 105 PostgreSQL integration tests passed, including two poisoned-relation regressions |
| Prisma migrations | Passed | Four migrations current; none pending; migration-safety scan passed |
| Traceability | Passed | 199/199 rows `Covered`; no `Missing`, `Failing`, or `Ambiguous` rows |
| Production audit and build | Passed | Production dependency audit found 0 vulnerabilities; production build passed |
| Vercel deployment | Passed | Tree `5714d83`; final target Preview; state Ready; Node.js 22; `sin1`; stable alias moved; old Preview removed |
| Deployment inventory | Passed | Exactly one protected Ready Preview and zero Production deployments |
| Authentication | Passed | Stable `NEXTAUTH_URL`; register, login, persistence, logout, protected redirect, and relogin |
| Protection | Passed | Deployment Protection enabled; temporary automation bypass revoked after acceptance |
| Runtime | Passed | Final 500-entry log review found zero 5xx, error, fatal, or uniqueness events |
| Browser reviews | Approved | Preview, finance, domain, mobile, goal sanitization, and remote renewal sanitization reviews approved |
| Final repository state | Passed | Audited worktree was clean at gate completion |

## Exact financial evidence

| Scenario | Observed result |
| --- | --- |
| Representative card ledger | Income `1000`, expense `120`, payment `150`, and refund `20` reconciled to debt `0` and card credit `50` |
| Extended balances | Bank A `829.50`; Bank B `480`; card limit `5,000`, debt `20`, available `4,980`, and card credit `15` |
| Card-credit priority | The initial card expense rendered debt `120` and available credit `4,880`; the linked `70` refund persisted |
| Fee waiver | Target `1,000`, eligible `130`, remaining `870`, and progress `13%`; the 30-day fee boundary passed |
| Goal lifecycle | Normal over-limit contribution was rejected; manual override, withdrawal, and deletion ended at `20.0%` with `800` remaining |
| Project with expense | Income `1000`, effective expense `400`, profit `600`, and ROI `150.0%` |
| Income-only project | Profit `250` and ROI `N/A` |
| Renewal skip | Due date advanced from `2026-07-31` to `2026-08-31`, created zero transactions, and left Upcoming |
| Renewal pause/resume | Pause preserved `2026-07-31` and removed Upcoming; resume restored `ACTIVE`, the date, and Upcoming |
| Renewal cancel/delete | Cancel produced `CANCELLED` and removed Upcoming; delete removed the record |
| Activity | 54 entries exercised pagination; the 91-day retention boundary passed |
| CSV rate limit | Ten exports returned `200`; the next returned `429` with `Retry-After` |

<!-- markdownlint-enable MD013 -->

The normal goal over-limit message was:

> Total contributions to this transaction exceed its amount. Enable manual
> adjustment to override.

The earlier goal state before deletion was `50.0%` with `500` remaining.

## Ownership-hardening evidence

The final whole-branch review found that goal-contribution and renewal reads
could expose poisoned foreign relations and identifiers. RED integration
evidence reproduced both read-side exposures. Commit `f8c3b49` added the shared
owned-relation sanitizer and GREEN PostgreSQL regressions for both paths,
raising the integration total from 103 to 105. Independent review returned
**APPROVED_POISON_SANITIZATION**.

The protected Preview was redeployed and retested:

- Goal-contribution evidence showed poisoned relations as `None` while valid
  owned relation names remained visible.
- Renewal list/detail evidence returned poisoned From `None` and To `None`.
- Renewal edit relations were empty or `None`, with no User B identifiers or
  names in the rendered or serialized output.
- Valid User A renewal relations remained visible.
- The remote renewal run returned
  **APPROVED_REMOTE_RENEWAL_SANITIZATION**, recorded zero diagnostics, and
  cleaned up its test records.

## Specification §29 manual QA

Every item below was exercised against the final protected Preview.

### Authentication

- [x] Register a new user
- [x] Log in and persist the session across reload and navigation
- [x] Log out and redirect protected routes to login
- [x] Log in again successfully

### Transactions — all types

- [x] Create INCOME to an account
- [x] Create EXPENSE from an account with a quality rating
- [x] Create a credit-card EXPENSE with no card credit
- [x] Create a credit-card EXPENSE with card credit and consume credit first
- [x] Create a bank-to-bank TRANSFER
- [x] Create a bank-to-card TRANSFER without increasing income
- [x] Overflow a card payment to debt zero plus card credit
- [x] Create a REFUND to a bank account
- [x] Create a REFUND to a card with debt
- [x] Create a REFUND to a card with zero debt
- [x] Create account ADJUSTMENT INCREASE and DECREASE
- [x] Create card-debt ADJUSTMENT
- [x] Verify category default quality prefill
- [x] Edit and delete a transaction with confirmation
- [x] Filter by type, date, category, quality, and source
- [x] Search by title and note
- [x] Export authenticated-user-only CSV with the exact columns

The verified CSV columns were Date, Type, Title, Amount, Currency, Category,
Quality Rating, From Source, To Source, Project, Description, Count Toward Fee
Waiver, and Created At.

### Categories, accounts, and wallets

- [x] Create a category with a default quality rating
- [x] Edit and delete a category
- [x] Create bank, e-wallet, cash, and credit-card sources
- [x] Verify tracked balances include refunds
- [x] Verify estimated net position and separate card credit
- [x] Cancel and confirm representative destructive actions

### Saving goals

- [x] Create a goal
- [x] Contribute from an income transaction
- [x] Contribute from existing savings without a transaction link
- [x] Block normal over-contribution with the exact safe message
- [x] Allow over-contribution with manual adjustment
- [x] Withdraw and verify reduced progress
- [x] Verify progress and remaining values
- [x] Delete a contribution and goal with confirmation

### Projects

- [x] Create and edit a project
- [x] Link transactions to the project
- [x] Verify profit, effective expense, and ROI
- [x] Verify zero-expense ROI displays `N/A`
- [x] Delete a project with confirmation

### Credit cards

- [x] Verify the 30-day annual-fee reminder boundary
- [x] Verify eligible fee-waiver expense progress
- [x] Verify a linked refund reduces eligible spending
- [x] Verify an excluded transaction does not affect eligible spending
- [x] Verify card credit is separate from credit limit and available credit

### Renewals

- [x] Create a renewal
- [x] Mark it paid and verify the transaction and next due date
- [x] Skip it and verify the date advances with no transaction
- [x] Pause and resume it while preserving the due date
- [x] Cancel it and verify it leaves Upcoming
- [x] Delete it and verify it is absent

### Dashboard, reports, activity, and security

- [x] Reconcile every dashboard summary card with the reference ledger
- [x] Verify dashboard and report period filters
- [x] Verify estimated-net-position labeling
- [x] Render all ten report views and every chart
- [x] Verify major mutations in Activity Log
- [x] Verify 54-entry pagination and the 91-day retention boundary
- [x] Verify User A cannot list, read, reference, mutate, report, or export
  User B data
- [x] Verify direct-object probes settle as safe `404` responses
- [x] Verify CSV includes only the authenticated user's records
- [x] Verify CSV rate limiting returns `429` with `Retry-After`

The following exact headers were present on public, dynamic protected, and API
responses:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()`

### 375px browser acceptance

- [x] Navigate all 17 protected route variants with the mobile menu
- [x] Use forms with the mobile keyboard
- [x] Contain page headers, reports, charts, and wide tables without page-width
  overflow
- [x] Cancel and confirm destructive dialogs with visible keyboard focus
- [x] Verify mobile empty, validation-error, destructive-error, and retry states
- [x] Verify reduced-motion behavior
- [x] Request protected loading-state RSC output

The loading RSC request was observed, but its skeleton frame completed too
quickly to paint in the browser capture. Existing rendered tests and code
inspection verify skeleton-only, reduced-motion-aware loading output; this is
not claimed as a visually observed skeleton frame.

## Specification §30 deployment checks

- [x] Confirm the intended Vercel project before linking
- [x] Use the disposable Preview database, never Production data
- [x] Configure only `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`
- [x] Run `prisma migrate deploy`, never `db push`
- [x] Exclude environment files, local agent state, and build cache
- [x] Configure Node.js 22 and the `sin1` function region
- [x] Obtain the stable protected Preview alias
- [x] Set `NEXTAUTH_URL` to that stable alias and complete the final redeploy
- [x] Confirm the target is Preview and the final state is Ready
- [x] Confirm the production build passes
- [x] Test auth, representative writes, protected routes, dashboard, reports,
  CSV, headers, and two-user isolation remotely
- [x] Confirm README setup, variable names, and migration command
- [x] Revoke the acceptance bypass and retain Deployment Protection
- [x] Remove the failed bootstrap, policy-blocked, and superseded deployments
- [ ] Provision and deploy a Production database and application

The final unchecked item is intentionally outside Phase 2 authorization.

## Findings and remediation

### Resolved — concurrent settings initialization

The first browser run exposed a Prisma uniqueness race during initial settings
creation. Commit `bbb5935` handles the `P2002` race by reading the concurrently
created settings. The Preview retest passed without uniqueness errors.

### Resolved — 375px page-header overflow

The first mobile run exposed uncontained PageHeader actions. Commit `1ba8d31`
allows wrapping and constrains the action region. All 17 protected route
variants passed the 375px retest.

### Resolved — first-deployment classification

Vercel classified the initial Preview-intended attempts as Production. The
unsafe `.env` symlink package was fixed in `d32e65a`, and those attempts were
removed. After explicit authorization, a temporary no-domain Production
bootstrap failed safely and was removed. A Preview blocked by Git-author policy
and a superseded Preview were also removed. The remaining deployment is the
single protected, Ready Preview at the stable alias.

### Resolved — poisoned owned-relation reads

The whole-branch review identified goal-contribution and renewal read paths
that could expose cross-user poisoned foreign relations or identifiers. Strict
RED evidence reproduced both cases. Commit `f8c3b49` sanitized the read models,
added two PostgreSQL regressions, and preserved valid owned relations.
Independent review returned **APPROVED_POISON_SANITIZATION**. The final
protected Preview goal and renewal retests passed with no User B identifiers or
names, zero browser diagnostics, and bounded cleanup.

There are no open Task 17 release blockers.

## Remaining release caveats

- Production database provisioning and deployment remain unauthorized.
- The loading skeleton is supported by rendered tests and code inspection, but
  did not remain onscreen long enough for a painted browser capture.
