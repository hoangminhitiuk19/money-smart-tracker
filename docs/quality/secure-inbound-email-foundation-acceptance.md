# Secure inbound-email foundation acceptance evidence

## Status and authority

Evidence date: 2026-08-13 (Asia/Ho_Chi_Minh).

Verified code candidate: `2883819e38e5e4108208c84e5d54f510ce76d0a1`, descended
from clean Task 10 baseline `a564ce99f5e2fa8e5e9cadd40275811158c4786f`.
The candidate includes the separately committed test-only provenance migration
range fix, Stage 1 documentation correction, and serialized PostgreSQL test
harness described below, the three Stage 2 correction commits, and two bounded
transaction-draft timeout corrections found during final verification.

This record applies `money-quality-tracker-spec-v4.md` §§27–30, the prompting
guide's final security/ownership/environment and coordinated-finish rules, the
secure inbound-email design, and Task 10 of its implementation plan. The local
application, migration deployment, security review, and complete serialized
PostgreSQL gates are green. The decisive uncontended database run passed 22/22
files and 165/165 tests. The live Vercel Preview gate remains pending because
no Resend account or usable Preview capability is available. The phase is not
complete until that external acceptance flow is performed.

## Local release evidence

All commands used the repository's `.env` testing configuration without
printing any value. Node ran through the Node 22 wrapper at `v22.23.2`.

| Gate | Result and exact evidence |
| --- | --- |
| Baseline and candidate | Worktree began clean at `a564ce99f5e2fa8e5e9cadd40275811158c4786f`; verified code candidate is `2883819e38e5e4108208c84e5d54f510ce76d0a1`. |
| `npm ci` | Passed in 20.05 s: 599 packages installed and 600 audited. The development-inclusive install reported 8 advisories (3 moderate, 4 high, 1 critical); this is separate from the production audit. |
| `npm run verify` | Passed under Node `v22.23.2` after the final corrections: zero-warning lint, TypeScript check, 66/66 unit/rendered files and 916/916 tests in 6.35 s, valid Prisma schema, production dependency audit with 0 vulnerabilities, and successful production build. |
| Production build | Passed: 23 static-page generation jobs and 25 listed App Router routes (4 static, 21 dynamic; 22 page routes and 3 API routes). Both `/transactions/capture/email` and `/api/webhooks/inbound-email` are present. |
| Historical complete `npm run test:integration` | The pre-Stage-2 candidate passed under Node `v22.23.2`: 22/22 PostgreSQL files and 164/164 tests in 443.05 s with files serialized against the one mutable testing database. This remains historical evidence, not a fresh final-candidate gate. |
| Post-fix complete integration attempt 1 | Passed 19/22 files and 163/165 tests in 575.16 s. A later remote endpoint `P1001` invalidated the run after both failing cases had encountered endpoint/cleanup failures. All four inbound suites passed 28/28 in this exact run. After endpoint recovery, the audit harness and transaction-draft overlap cases passed in focused runs. |
| Post-fix complete integration attempt 2 | Passed 19/22 files and 156 tests; 3 failed and 6 were skipped of 165 in 640.55 s. Different transaction-draft cases returned safe failures, the ownership suite setup received explicit `P1001`, and the inbound privacy query later received explicit `P1001`. After endpoint recovery, the affected focused cases passed. This historical attempt is superseded by the final uncontended GREEN below. |
| Final uncontended `npm run test:integration` | Passed against the same testing database's direct endpoint under Node `v22.23.2`: 22/22 files and 165/165 tests in 507.01 s. Transaction drafts passed 31/31, inbound suites passed 28/28, and every ownership, financial-ledger, reporting, migration, rate-limit, retention, and audit-harness suite passed. No URL or credential was printed or persisted. |
| Stage 2 inbound PostgreSQL evidence | The first exact post-fix run passed all four inbound suites and 28/28 cases: drafts 10/10, webhook 6/6, receipts 3/3, schema 9/9. The second passed drafts 10/10, receipts 3/3, schema 9/9, and the first 5/6 webhook cases before the privacy query received `P1001`; that privacy case then passed 1/1 after recovery. |
| Contention diagnostics | Parallel RED #1 passed 21/22 files and 163/164 tests in 135.75 s; its sole inbound gate test exceeded 5 s, then the full inbound file passed 9/9 in isolation in 45.59 s. Parallel RED #2 passed 20/22 files and 162/164 tests in 166.73 s; two different unrelated cases exceeded 5 s and 30 s by 0.006 s and 0.007 s, then each passed in isolation in 4.757 s and 8.378 s. Moving failures plus isolated GREEN established cross-file remote-database contention. |
| Integration harness | `vitest.integration.config.ts` now sets `fileParallelism: false`, `testTimeout: 30_000`, and `hookTimeout: 30_000`; explicit per-test timeouts remain unchanged. The deterministic harness fix is committed separately as `97e4389` (`test: stabilize PostgreSQL integration gate`). |
| Focused provenance migration replay | RED reproduced the range drift. The test-only fix caps replay at `20260809180000_backfill_transaction_draft_provenance` and asserts the unrelated inbound relation is absent. GREEN passed: 1/1 in 3.77 s (3.39 s test time). The fix is committed separately as `f19f480` (`test: bound provenance migration replay`). |
| `npm run prisma:deploy` | Passed on the final candidate: Prisma found 8 migrations and reported no pending migrations. |
| Stage 1 documentation regression | RED captured the findings: 1 focused file ran 19 tests, with 16 passing and 3 expected failures for the copied optional configuration, all-three enablement guidance, and credential-acquisition runbook. After the smallest `.env.example`/README fix, GREEN passed 1/1 file and 19/19 tests in 4 ms. |
| `git diff --check` | Passed after implementation commits and generated-file restoration; final document check is recorded below. |

The initial diagnostic `npm run verify` invocation through an outer `npx --call` wrapper
also exposed an environment-only runner issue: its npm call configuration was
inherited by the script's nested `npx prisma validate`, causing npm `EUSAGE`
after 66/66 files and 905/905 tests had passed. Diagnostics confirmed that
leakage. Running with the cached Node 22 binary directory first on `PATH`
removed the inherited wrapper configuration and produced the complete passing
release result above. No application code changed for this runner issue.

The first complete integration diagnostic also ran while the remote testing
database was heavily contended: 16/22 files and 150/164 tests passed, with six
unrelated five-second timeouts, two inbound timing failures, and the provenance
range failure. The inbound draft suite then passed 9/9 in isolation, the
provenance defect was reproduced and repaired test-first, and the testing
endpoint briefly returned `P1001`. After endpoint recovery, the focused
provenance test, exact 22-file integration suite, deployment check, and final
release gate all passed as recorded above.

The Stage 1 post-fix parallel integration gate reproduced the same shared
remote-database contention twice, with failures moving among three unrelated
tests at their timeout boundaries. Each failing case passed alone. Because all
22 files mutate one testing database, the integration configuration now runs
files serially with 30-second default test and hook timeouts while retaining
explicit per-test limits. The resulting exact complete run passed 164/164 in
443.05 s. No application behavior or production configuration changed.

After the Stage 2 fixes, two exact serialized runs were invalidated by transient
remote Neon reachability. Later final verification reproduced Prisma `P2028`
at the default five-second interactive-transaction boundary while deliberately
gated or remote-latency-bound draft reassessment was still valid. Commits
`d318c44` and `2883819` apply one shared 60-second bound to edit, paste, and
quick draft reassessment transactions without changing isolation, retries,
ownership, lifecycle guards, or safe errors. Exact unit tests cover every
option. The decisive uncontended run then passed 22/22 files and 165/165 tests
in 507.01 s.

## Security and privacy audit

The required scans were run exactly:

```bash
rg -n "AUTH_SECRET|AUTH_URL" . -g '!node_modules' -g '!.next'
rg -n "console\.(log|error|warn)|subject|rawBody|aliasLocalPart|messageId|sender|from:" lib/inbound-email lib/actions/inbound-email.ts app/api/webhooks/inbound-email
```

The authentication scan returned 89 lines because the requested substring also
matches `NEXTAUTH_SECRET` and `NEXTAUTH_URL`. Every hit was manually reviewed.
A boundary-aware follow-up isolated the real forbidden names: they appear only
in explicit repository prohibitions, environment rejection code, rejection
tests, and historical/specification guidance. No runtime reads either forbidden
variable.

The logging/data-token scan returned 42 lines. Every hit was manually reviewed.
There are exactly three logs in the audited runtime paths. Each emits fixed text
and a validated error-class name only; none logs an exception message, raw
webhook, subject, sender, address, alias, provider identifier, content, header,
API key, signature, or user identifier.

| Requirement | Audited evidence |
| --- | --- |
| Signature before side effects | The bounded route reads the untouched body, then `handleInboundEmailWebhook` calls `provider.verifyNotification` before recipient parsing, Prisma access, alias lookup, rate limiting, retrieval, or cleanup. The Resend adapter invokes `webhooks.verify` before Zod extraction. Invalid signatures return 401. Ordering and raw-body preservation are covered by the webhook and provider tests. |
| Authentication and ownership | Every mailbox action calls `requireAuth()` and accepts no user/mailbox identity parameter. Reads and mutations use the session `user.id`. Destructive draft queries include `userId` and `origin: EMAIL`; lock/update/delete operations include owner constraints. The webhook derives an owner only after a verified active-alias lookup, carries the receipt's user/mailbox pair, and rechecks mailbox ID, owner, active status, and current alias inside the final transaction. Cross-user integration cases are present. |
| Alias entropy and revocation | `generateInboundAliasLocalPart()` uses `randomBytes(20)`, providing 160 random bits, with no user name, ID, or login address. Unique database constraints and three collision retries apply. Rotate, disable, and disconnect serialize on the owned mailbox lock; the draft builder rechecks the current alias and active state. |
| Minimal persistence | `InboundMailbox` stores the random local alias capability, provider enum, safe latest disposition/time, and ownership/lifecycle fields. `InboundEmailReceipt` stores only SHA-256 event/message hashes, safe state/disposition, attempts, ownership, expiry, and lifecycle fields. No model/migration column exists for raw webhook, body, HTML, subject, full generated/forwarding/sender address, headers, provider IDs, or attachments. The complete generated address is derived only for the authenticated setup view. |
| Content and attachment boundary | Webhook request input is limited to 256,000 bytes. Provider response input is streamed and bounded; combined text/HTML is limited to 1,000,000 bytes. Content exists only in local variables and the strict parser ignores HTML. Retrieval makes one message request with `html_format=cid`; attachment metadata is transformed to a count and attachment/raw download URLs are never followed. |
| Safe activity and logs | Lifecycle activity uses a fixed action allowlist. Metadata is limited to deletion count or a known disposition; entity IDs are null. Runtime logs contain only fixed messages plus a sanitized error class. |
| No client `EMAIL` spoofing | Public `transactionDraftInputSchema` accepts only `QUICK` and `PASTE`. Client save actions use that schema. `storedTransactionDraftInputSchema` accepts `EMAIL` only when updating an already-owned persisted draft, and only the server-only verified builder creates a new `EMAIL` draft. |
| Idempotency and retry | Unique provider-event hash, unique mailbox/message hash, explicit receipt claim states with a fixed processing lease, owner-scoped state transitions, and unique draft/receipt relation make provider replays concurrency-safe. Canonical import separately uses the existing owner-scoped idempotency key. PostgreSQL webhook tests passed concurrency, retry, abandoned-processing recovery, rotation, opacity, and privacy cases in the first complete run. |
| Zero financial effect | Receipt processing calls only the internal draft builder. It never calls transaction creation. The expanded 10-case PostgreSQL draft suite snapshots transaction count, balances, card state, dashboard/report values, goal progress, project summary, and relevant financial activity before email draft creation and after edit; they stay equal. It also asserts the persisted `EMAIL` candidate's core fields exactly. Only explicit owned import creates one canonical transaction, and replay returns the same result. Imported/dismissed email candidates are immediately cleared while lifecycle provenance remains. |
| Retention | Unresolved email drafts are eligible after 30 days and receipt hashes/dispositions after 90 days. Cleanup validates a bounded batch of 1–500 and is idempotent. In free Preview it is opportunistic; no wall-clock deletion SLA is claimed. |

The inbound privacy integration test queried only selected
mailbox status fields, receipt hashes/state/disposition, `TransactionDraft.rawRow`,
and safe activity fields. It passed and proved that the synthetic raw webhook,
event/message identifiers, generated address, sender, subject, and message text
were absent from that persisted surface. `rawRow` was null and activity metadata
contained only `TEST_DRAFT_CREATED`.

## Environment and external capability

Only presence booleans were inspected; no environment value was displayed or
recorded.

| Capability | Present |
| --- | --- |
| Local `.env` file | Yes |
| `INBOUND_EMAIL_API_KEY` non-empty | No |
| `INBOUND_EMAIL_WEBHOOK_SECRET` non-empty | No |
| `INBOUND_EMAIL_DOMAIN` non-empty | No |
| Complete inbound group | No |
| Local Vercel project link | No |
| Vercel CLI | No |
| Usable Resend account demonstrated | No; the repository owner previously confirmed no account exists. |
| Usable current Vercel Preview deployment demonstrated | No |

No external email was sent and no live service was changed.

## Preview and accessibility acceptance

Automated rendered coverage passed within the 915-test release suite. The
29-test inbound setup-panel suite covers the testing/privacy disclosure, exact
fixture, all text/icon statuses, address-free live announcements and dialogs,
UUID-only review links, destructive confirmations, cancel/success focus
behavior, blocked repeat submissions, mobile `min-h-11` targets,
reduced-motion classes, and width constraints. Protected page/loading tests
cover authentication, safe serialization, navigation, and the labelled bounded
skeleton.

The owner Preview runbook follows the official
[Resend Receiving flow](https://resend.com/docs/dashboard/receiving/introduction)
and [Vercel Preview environment-variable flow](https://vercel.com/docs/environment-variables/managing-environment-variables).
The provider-side 30-day disclosure is supported by Resend's
[retention guidance](https://resend.com/docs/dashboard/webhooks/how-to-store-webhooks-data).

The following live checks remain pending and were not inferred from automated
tests:

- a Vercel Preview URL with Preview-only inbound configuration;
- creating/copying a live test address and sending the exact synthetic fixture;
- one received status and one reviewable `EMAIL` draft;
- Resend replay duplicate suppression;
- owned-source edit and exactly-one canonical import;
- old-address rejection after rotation, disable/enable, pending deletion, and
  disconnect;
- keyboard and visible-focus inspection on desktop;
- 375px overflow and 44px-target inspection;
- reduced-motion inspection; and
- a fresh minimal production-like privacy metadata query after the live flow.

## Review and unresolved exclusions

Stage 1 specification/design compliance review found two executable-setup
defects. First, copying `.env.example` created present-but-blank optional inbound
variables even though strict runtime validation correctly rejects blank secrets.
The runtime contract remains strict; the three optional templates are now
commented, and the README says copying the example leaves inbound disabled and
requires uncommenting/configuring all three entries together to enable it.
Second, the owner runbook omitted the provider-side acquisition steps. It now
documents creation of a named Full-access Resend testing key, one-time direct
copy to Vercel, why Sending access is insufficient, and retrieval of the
webhook signing secret from the `email.received` webhook details page, with
official Resend links. The no-chat/git/screenshots/evidence rule remains in
force.

Stage 2 security/code-quality review found three bounded gaps. First, a fresh
`PROCESSING` receipt was treated as a terminal duplicate after a failed reclaim;
focused RED proved premature 200 acceptance and GREEN now returns retryable 503
until the exact lease boundary (`8546e60`, `fix: keep processing receipts
retryable`). Second, a stalled request reader had no deadline and inbound-domain
validation admitted invalid DNS labels; focused RED captured the hangs and
invalid hosts, while GREEN adds bounded cancellation, a generic 408 route
response, and per-label DNS validation (`53cbc78`, `fix: harden inbound email
boundaries`). Third, the database evidence lacked a real concurrent authenticated
mailbox creation race and complete goal/project financial invariants; mutation
RED proved the concurrency assertion was effective, and GREEN expanded the
PostgreSQL evidence to 10 draft cases (`5313814`, `test: complete inbound email
database evidence`).

The test-only provenance prerequisite is `f19f480`, the Stage 1 review fix is
`9ae0c07`, and the deterministic PostgreSQL harness is `97e4389`. Stage 2 and
both final timeout corrections passed independent review with no open Critical,
Important, or Minor findings. Local final-candidate evidence is complete; live
Preview acceptance remains pending.

Gmail/Outlook onboarding, institution/bank parsers, real financial email,
custom domains, attachments/OCR/AI, automatic posting, a protected scheduled
deletion SLA with monitoring, and Production configuration/deployment remain
unfinished and unauthorized.
