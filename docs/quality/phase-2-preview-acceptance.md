# Phase 2 Preview Acceptance

## Status

Local Chromium acceptance against the disposable database is
**APPROVED_LOCAL_BROWSER** after the settings-initialization race fix
(`bbb5935`) and 375px page-header containment fix (`1ba8d31`). The runner
completed the representative MVP journey with zero browser diagnostics.

Vercel Preview acceptance is **BLOCKED**. The intended project is linked and
deployment preparation is complete, but no deployment remains. Production
deployment is not authorized by Phase 2.

- Local acceptance date: 2026-07-31
- Local browser matrix: desktop Chromium, 375px Chromium, reduced motion
- Preview address: **Pending**
- Remote Preview acceptance: **Pending**

Only these environment-variable names are approved. Values remain in the
deployment platform and are not reproduced here:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`

## Automated and review evidence

These recorded Node.js 22 results establish the local release-candidate
baseline. They do not substitute for remote Preview verification.

<!-- markdownlint-disable MD013 -->

| Check | Status | Evidence |
| --- | --- | --- |
| `npm run verify` | Passed | Lint, typecheck, Prisma validation, production dependency audit, and build passed; 44 files and 473 unit/rendered tests passed |
| `npm run test:integration` | Passed | 16 files and 103 PostgreSQL integration tests passed |
| Local browser runner | Passed | Representative desktop, 375px, and reduced-motion journey; zero diagnostics |
| Independent local UX review | Approved | `APPROVED_LOCAL_BROWSER` after `bbb5935` and `1ba8d31` |
| `git diff --check` | Passed | No whitespace errors in the reviewed local candidate |

## Representative local browser evidence

| Area | Observed result |
| --- | --- |
| Authentication | Registration, login, session persistence, logout, protected-route redirect, and relogin passed |
| Reference ledger | Income `1000`, card expense `120`, card payment `150`, and card refund `20` reconciled to debt `0` and card credit `50` |
| Project | The linked ledger displayed effective expense `100` and profit `-100` |
| Goal | A `200` contribution toward a `500` target displayed `40%` progress |
| Renewal | Marking a renewal paid created the expected paid state and transaction |
| Dashboard and reports | Dashboard, period filters, all ten report views, and their charts rendered without errors |
| CSV and activity | CSV used the exact required columns and current-user rows; representative mutations appeared in Activity Log |
| Destructive dialog | Cancel, confirm, keyboard focus, focus restoration, safe failure, and retry behavior passed |
| Isolation | User B records stayed hidden from User A; direct-object probes settled as safe `404` responses |
| Mobile and motion | 375px page headers and report content remained contained; reduced-motion behavior passed |
| Rate limit | Ten CSV requests returned `200`; the next returned `429` with `Retry-After` |

<!-- markdownlint-enable MD013 -->

## Specification §29 manual QA

`[x]` means the behavior was observed locally in the browser. Every checked
item must still be repeated on the final Preview. `[ ]` means it was not
exercised by this representative browser run.

### Confirmed locally

- [x] Register, login, persist the session, logout, redirect a protected route,
  and relogin
- [x] Create account income and a credit-card expense with no existing card
  credit
- [x] Pay a credit card beyond its debt and verify debt zero plus card credit
- [x] Refund a zero-debt credit card and verify card credit increases
- [x] Filter transactions and reports by the available period and domain
  filters
- [x] Export the exact CSV columns with authenticated-user-only rows
- [x] Create the bank and credit-card sources used by the reference ledger
- [x] Create a goal, contribute to it, and verify progress and remaining
- [x] Create a project, link transactions, and verify effective expense and
  profit
- [x] Create a renewal and mark it paid
- [x] Reconcile the dashboard and render all ten reports and their charts
- [x] Observe representative mutations in Activity Log
- [x] Exercise the shared destructive confirmation dialog
- [x] Confirm two-user list/export isolation and safe direct-object denial
- [x] Confirm CSV rate limiting returns `429` with `Retry-After`
- [x] Confirm 375px header/report containment and reduced-motion behavior

### Not yet exercised in a browser

- [ ] Account expense with quality, card-credit-first expense, bank-to-bank
  transfer, bank refund, debt-reducing card refund, and all adjustment variants
- [ ] Category quality prefill, transaction editing, title/note search, and
  representative CRUD deletion for every domain
- [ ] Category create/edit/delete and wallet/cash source creation
- [ ] Goal contribution from existing savings, normal/manual
  over-contribution, withdrawal, and contribution deletion
- [ ] Project ROI and zero-expense `N/A`
- [ ] Annual-fee boundary, fee-waiver inclusion/exclusion/refund, and separate
  card-credit labeling
- [ ] Renewal skip, pause, and cancel
- [ ] Activity pagination and retention behavior
- [ ] Required response security headers
- [ ] Every protected page, mobile-keyboard entry, wide-table scrolling, and
  loading, empty, success, and safe-error states at 375px

## Specification §30 deployment checks

### Completed preparation

- [x] Confirm the intended Vercel project before linking
- [x] Use the disposable Preview-only database, never Production data
- [x] Configure only `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL` for
  Preview
- [x] Run `prisma migrate deploy`, never `db push`
- [x] Exclude environment files, local agent state, and build cache from the
  deployment input
- [x] Configure the function region as `sin1`, colocated with the database
- [x] Confirm the local production build passes
- [x] Confirm README setup, approved variable names, migration command, and
  release runbook

### Pending Preview-only checks

- [ ] Obtain an authorized Preview address
- [ ] Set `NEXTAUTH_URL` to the actual Preview or stable branch address
- [ ] Redeploy after setting the final Preview address
- [ ] Repeat registration, login, logout, and session persistence remotely
- [ ] Repeat representative transaction, goal, and renewal writes remotely
- [ ] Test protected routes after logout remotely
- [ ] Test dashboard and all reports after remote data entry
- [ ] Repeat CSV, rate-limit, response-header, and two-user isolation checks
- [ ] Complete every remaining specification §29 browser item

## Findings

### Blocker — first deployment classified as Production

On 2026-07-31, two attempts intended for Preview were unexpectedly classified
as Production by Vercel's first-deployment behavior:

1. The first attempt failed because the upload followed the worktree's `.env`
   symlink. It was immediately removed, and secure deployment exclusions were
   added in `d32e65a`.
2. The second attempt was again classified as Production and was removed while
   building.

No deployment remains, no Preview address was issued, and no Production
release was retained. The behavior is consistent with a
[Vercel staff confirmation](https://community.vercel.com/t/vercel-cli-ignores-target-preview-and-creates-production-deployment/46384)
that a project's first deployment is automatically Production.

**Severity:** Release blocker. Continuing would cross the explicit
no-Production boundary.

**Decision required:** authorize a controlled one-time first deployment using
only the disposable database, or choose a supported deployment path that
guarantees Preview classification. After that decision, set the final
`NEXTAUTH_URL`, redeploy, and run the complete remote acceptance checklist.
