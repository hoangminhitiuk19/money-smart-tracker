# Secure Inbound-Email Foundation Design

## Context and authority

The transaction-capture foundation is merged and verified. This phase is the
second subphase in `2026-08-03-transaction-capture-program-design.md`: it builds
the secure inbound-email boundary before Gmail onboarding or institution
parsers. It extends the original MVP while preserving the product specification
rules in §§5–6, 20, 27–30 and the prompting guide's phased workflow, security,
testing, and release gates.

Development and Preview use a free Resend-managed `*.resend.app` receiving
domain. Only synthetic or redacted messages are permitted. A custom domain,
real financial messages, and a privacy review remain Production prerequisites.

## Goals

- Receive explicitly sent or forwarded test email without mailbox OAuth.
- Give each user one rotatable, unguessable inbound address.
- Authenticate and deduplicate provider webhooks before processing content.
- Process message text in memory and retain only bounded operational metadata.
- Prove the internal `EMAIL` draft boundary with a deterministic synthetic
  message, without claiming support for a real institution.
- Reuse the existing review and canonical transaction-import boundary; email
  receipt alone must never affect financial state.
- Provide understandable testing, privacy, rotation, disablement, deletion,
  and failure states.

## Non-goals

This phase does not add Gmail or Outlook filter onboarding, VCB/OCB/HSBC or
other bank parsers, mailbox OAuth, attachments, OCR, AI classification,
automatic transaction posting, a custom domain, or Production release. It does
not accept real financial email during the test phase.

## Chosen approach

Use Resend behind a provider-neutral adapter, with mocked adapters in automated
tests. Resend supplies a wildcard managed receiving domain, signed at-least-once
webhooks, and an API for temporarily retrieving message content. Provider types
must stop at the adapter boundary so another provider can replace Resend later.

Alternative approaches were rejected for this phase: an internal-only simulator
would not prove forwarding and webhook behavior on Vercel, while Postmark's
single generated mailbox is less suitable for per-user aliases without a custom
domain.

## Architecture and interfaces

The feature is split into focused units:

1. **Provider adapter** verifies a raw webhook and retrieves a bounded message.
2. **Mailbox service** owns alias creation, lookup, rotation, disablement, and
   authenticated user controls.
3. **Receipt service** owns durable state, retries, deduplication, dispositions,
   and retention.
4. **Synthetic parser** recognizes only the documented test fixture.
5. **Email candidate boundary** creates one `EMAIL` draft from one verified
   receipt. It cannot create a canonical transaction.
6. **Email setup page** exposes testing instructions and privacy controls.

The provider-neutral contracts are conceptually:

```ts
type InboundNotification = {
  eventId: string;
  messageId: string;
  recipients: string[];
  occurredAt: Date;
};

type InboundMessage = {
  text: string | null;
  html: string | null;
  attachmentCount: number;
};

interface InboundEmailProvider {
  verifyNotification(rawBody: string, headers: Headers): InboundNotification;
  retrieveMessage(messageId: string, signal: AbortSignal): Promise<InboundMessage>;
}
```

The implementation may return typed errors, but provider response objects and
Resend-specific field names must not cross this interface.

## Persistence model

Add an `InboundMailbox` with one row per user:

- owner `userId` with a unique constraint;
- provider identifier, initially `RESEND`;
- unique random `aliasLocalPart` and `ACTIVE` or `DISABLED` status;
- safe latest disposition and `lastReceivedAt` for the testing UI;
- created and updated timestamps.

Aliases use at least 128 bits of cryptographic randomness and contain no user
identifier, name, or login email. The local part is stored because the user must
be able to copy the address again. It is a revocable delivery capability, not an
authentication credential: possession can create only a reviewable candidate,
never a transaction. Alias values must never enter logs or activity metadata.

Add an `InboundEmailReceipt` owned through its mailbox and user:

- SHA-256 provider event and message identifier hashes;
- `RECEIVED`, `PROCESSING`, `PROCESSED`, `IGNORED`, `RETRYABLE_FAILED`, or
  `TERMINAL_FAILED` state;
- a bounded disposition code such as `TEST_DRAFT_CREATED`, `DUPLICATE`,
  `UNSUPPORTED`, `OVERSIZED`, or `RATE_LIMITED`;
- attempt count, optional resulting draft relation, expiry, and timestamps;
- a unique event hash and a unique `(mailboxId, messageHash)` pair.

No provider message ID, subject, body, HTML, attachment, full header set, or raw
webhook is retained. Unknown and disabled aliases create no user-linked record.
The outer forwarder's address and unrecognized sender addresses are not retained
in this foundation. A later parser phase may retain only an approved
institutional sender needed for an explicitly confirmed forwarding filter.

Add an optional unique receipt relation to `TransactionDraft`. Only an internal
server-only builder may set `origin: EMAIL`; existing Quick/Paste client schemas
must continue rejecting `EMAIL` input. This unique relation guarantees at most
one draft per receipt even if processing is replayed after a partial failure.

## Webhook data flow

The Node-runtime route is `/api/webhooks/inbound-email`.

1. Reject a declared body over 256 KB and use a bounded reader when no valid
   `Content-Length` is present.
2. Read the untouched body and verify Resend's signature and timestamp before
   JSON parsing, Prisma access, alias lookup, or provider API calls.
3. Accept only `email.received`; safely acknowledge other signed event types.
4. Normalize and require exactly one application recipient.
5. Resolve an active alias without revealing whether it exists.
6. Insert or claim a durable receipt. Unique constraints handle concurrent
   delivery, provider retry, and manual replay.
7. Retrieve text/HTML through the adapter with a timeout. Do not request
   attachments. Reject combined content above 1 MB.
8. Normalize text in memory. The synthetic parser either returns a bounded
   candidate or the `UNSUPPORTED` disposition.
9. In one transaction, create at most one `EMAIL` draft, update the receipt and
   mailbox status, and write safe activity metadata.
10. Release all message content references before responding.

Successful, ignored, and duplicate deliveries return a generic success.
Retryable database or provider failures return `503` so Resend can retry.
Invalid signatures return `401`, malformed signed requests return `400`, and
oversized webhook bodies return `413`. Responses never reveal users or aliases.

If a user rotates or disables an alias while a message is in flight, draft
creation rechecks the mailbox state and current alias in the database transaction.
The old address becomes ineffective immediately.

## Synthetic test candidate

The only accepted runtime fixture in this phase is:

```text
MONEY SMART TRACKER TEST
Amount: 125000
Currency: VND
Date: 2026-08-10
Merchant: Demo Cafe
```

Whitespace around values may be normalized, but the marker and four field names
must match exactly. Amount remains exact decimal text, currency is uppercase,
date is ISO `YYYY-MM-DD`, and merchant is bounded to the existing title limit.
The result is an `EXPENSE` draft marked as test data and `NEEDS_REVIEW` because
the user must choose an owned source and any other required fields. Other
content is `UNSUPPORTED`; it is not guessed or persisted.

The draft can be edited, dismissed, or imported through existing owned actions.
Only explicit import calls the shared canonical transaction creation service.
Receiving or parsing never changes balances, debt, goals, projects, reports,
renewals, fee-waiver progress, exports, or activity totals.

## Security, abuse, and privacy controls

- Every mailbox page and server action calls `requireAuth()` and scopes all
  queries and mutations by session `userId`.
- Webhook authenticity is established before any untrusted payload is parsed.
- Alias and provider-message deduplication is database-backed and concurrency
  safe; in-memory checks are insufficient.
- Existing durable rate-limit infrastructure limits active-alias processing.
  Rate-limited messages are not retrieved or parsed.
- Attachments are never requested, downloaded, or stored.
- Logs exclude raw webhook data, subject, body, HTML, headers, sender and
  forwarding addresses, alias tokens, message IDs, API keys, and signatures.
- `ActivityLog` records only safe actions: connection, rotation, disablement,
  disconnection, safe receipt disposition, draft creation, and deletion counts.
- Unknown and disabled aliases receive indistinguishable generic responses.
- Parser exceptions store a bounded safe error code, not exception input.
- The UI states that the application receives only mail sent to the generated
  address and cannot browse the mailbox.
- The UI discloses Resend's separate provider-side retention of up to 30 days.

The alias-at-rest trade-off is explicit: the database stores the random local
part for repeat copying. A database disclosure could permit unwanted test
drafts, but could not authenticate as the user or post transactions. Rotation,
disablement, rate limiting, mandatory review, and no raw-content persistence
bound that risk. Encrypting aliases requires a separately managed encryption
key and is deferred to a Production security design.

## Retention and deletion

- Unresolved `EMAIL` drafts expire after 30 days.
- Import or dismissal immediately clears email-derived candidate fields while
  retaining only lifecycle identifiers needed for idempotency and audit.
- Receipt hashes and dispositions expire after 90 days.
- Rotation replaces the alias; disablement prevents receipt processing.
- Disconnect disables the mailbox and deletes all pending email drafts in one
  owned operation.
- Cleanup uses bounded, idempotent database batches and also removes orphan-safe
  receipt relations.

During free testing, cleanup is triggered opportunistically by authenticated
mailbox access and verified inbound activity. Therefore 30 and 90 days are
eligibility thresholds, not a guaranteed wall-clock deletion SLA in an idle
Preview environment. A protected daily scheduler and deletion monitoring are
mandatory in the Production release phase and require separate approval.

## Configuration

Add these provider-neutral server variables:

```text
INBOUND_EMAIL_API_KEY
INBOUND_EMAIL_WEBHOOK_SECRET
INBOUND_EMAIL_DOMAIN
```

They form an all-or-none optional group so ordinary local builds remain valid
before a Resend account is connected. When absent, inbound email is disabled and
the page shows a configuration-safe unavailable state. The API key and webhook
secret must be non-empty secrets; the domain must be a hostname without scheme,
path, or user information.

Update `.env.example`, `lib/env.ts`, tests, deployment documentation, and
`AGENTS.md` consistently. Authentication continues to use exactly
`NEXTAUTH_SECRET` and `NEXTAUTH_URL`. `AUTH_SECRET` and `AUTH_URL` remain
forbidden and fail validation.

## User experience

Create `/transactions/capture/email` rather than enlarging the existing capture
workspace component. Link it from the protected capture navigation.

The page presents:

1. a prominent **Testing only** disclosure;
2. an explanation that no mailbox access is granted;
3. a create/copy private test-address action;
4. the exact synthetic fixture with copyable instructions;
5. waiting, received, duplicate, rejected, unsupported, and delayed states;
6. a link to review the resulting draft in the existing capture experience;
7. rotate, disable, delete-pending-data, and disconnect controls with explicit
   confirmation and focus restoration.

The page must work by keyboard, expose status without relying on color, keep
visible focus, use 44-pixel mobile targets, reflow at 375 pixels without document
overflow, and honor reduced motion. Gmail/Outlook filter steps and institution
selection are deliberately absent.

## Failure handling

- Invalid signature: reject before parsing or persistence.
- Unknown/disabled alias: generic success with no user-linked record.
- Duplicate: generic success and no second draft.
- Temporary provider or database failure: retain/resume safe receipt state and
  return a retryable response.
- Unsupported or oversized content: do not create a draft; update only safe
  disposition metadata where the alias is active.
- Parser exception: clear content references, record a safe terminal code, and
  do not log input.
- Draft import failure: preserve the reviewable draft and rely on the existing
  atomic/idempotent import boundary.
- Missing configuration: no provider calls; authenticated UI explains that the
  test service is not connected without exposing which secret is missing.

## Verification strategy

Implementation follows test-driven development. Automated tests use mocked
provider contracts and never require Resend network access.

Focused coverage must prove:

- signature validity, timestamp checks, untouched-body verification, malformed
  events, and verification-before-side-effects ordering;
- alias entropy, uniqueness, ownership, rotation, disablement, disconnect, and
  two-user isolation;
- event/message replay, provider retry, and concurrent delivery yield at most
  one receipt and one draft;
- unknown aliases, limits, rate limiting, timeouts, and attachment non-retrieval;
- strict synthetic parsing and exact decimal preservation;
- public client schemas cannot spoof `EMAIL`, while the internal boundary can;
- email receipt alone has zero effect on every financial projection;
- 30-day draft and 90-day receipt cleanup, immediate candidate clearing, and
  bounded idempotent deletion;
- privacy copy, status states, destructive confirmations, keyboard behavior,
  reduced motion, and mobile reflow;
- the inbound environment group and continued rejection of `AUTH_SECRET` and
  `AUTH_URL`.

The final gate is Node 22 `npm run verify`, the complete PostgreSQL integration
suite, Prisma validation, migration deploy against the disposable testing
database, `git diff --check`, security review, and Vercel Preview acceptance.
Manual acceptance sends one synthetic message through Resend and proves draft
creation, duplicate suppression, rotation, disconnect, and absence of raw email
in application database fields and logs.

## Definition of done

This phase is complete only when:

- the approved provider-neutral architecture and database migration are present;
- all actions and queries are authenticated, owned, bounded, and safely logged;
- signature, retry, replay, concurrency, retention, and cross-user tests pass;
- the synthetic message creates one reviewable `EMAIL` draft and no transaction;
- all automated and Preview acceptance gates pass with exact recorded evidence;
- configuration and privacy documentation match behavior; and
- Gmail onboarding, real institution parsers, real financial email, auto-posting,
  custom-domain setup, scheduled deletion SLA, and Production release remain
  explicitly documented as future phases.
