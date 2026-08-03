# Transaction Capture Program Design

## Context

The Phase 2 release candidate is merged and its financial, ownership, mobile,
and Preview acceptance gates passed. The current transaction entry remains a
conventional multi-section form, however, and the receipt placeholder still
ends in manual entry. User feedback identifies this as repetitive work rather
than a lightweight daily habit.

This program deliberately extends the original MVP. Specification §19 defines
receipt input as manual and §31 lists direct bank integration and real OCR as
limitations. Specification §27 still requires easy manual input with sensible
defaults. The new work preserves every financial rule in §§6–17 while adding
two new input paths: spreadsheet-style bulk capture and selective forwarding of
transaction-alert email.

The Production URL is public but currently uses configuration shared with
Preview and a testing database. It must not receive real financial data until
the final Production phase in this design passes.

## Goals

- Make repeated entry fast through paste, fill-down, keyboard navigation, and
  batch confirmation.
- Receive only messages users explicitly forward, without mailbox OAuth or
  access to unrelated email.
- Convert manual, pasted, and forwarded inputs into one reviewable transaction
  draft model.
- Preserve exact decimal handling, type-specific field rules, ownership,
  activity logging, and every downstream financial calculation.
- Let users configure one source first and add other banks progressively.
- Give every automated decision a visible origin, confidence, and reversible
  user action.
- Retain the existing manual form for uncommon or advanced cases.

## Non-Goals

The first release does not read an entire mailbox, use Gmail or Outlook OAuth,
scan receipts, import directly from banks, train an AI model, infer exchange
rates, or silently post email-derived transactions. It does not guarantee that
every purchase generates an email. It does not redesign unrelated dashboard,
report, goal, project, or renewal screens.

## Program Decomposition

This design contains independent subsystems and must be implemented one phase
at a time:

1. **Capture foundation and spreadsheet workspace** — transaction drafts,
   paste parsing, mapping, validation, review, batch creation, and the new
   capture visual system.
2. **Secure inbound-email foundation** — provider adapter, signed webhook,
   private aliases, data minimization, deduplication receipts, retention, and
   privacy controls.
3. **Gmail and initial-bank onboarding** — Gmail verification/filter guidance,
   progressive source mapping, and redacted VCB, OCB, and HSBC parser fixtures.
4. **Outlook onboarding and parser expansion** — conditional forwarding or
   redirect guidance and additional institution adapters based on evidence.
5. **Production isolation and release** — separate Production database,
   secrets, migration, deployment, monitoring, and full acceptance.

Each phase requires its own implementation plan and approval. Later phases may
use only the reviewed interfaces produced by earlier phases.

## Unified Draft Model

All new capture paths normalize into a user-owned `TransactionDraft`. A draft
stores origin, status, confidence, canonical candidate fields, user mappings,
and validation findings. It never affects balances, debt, goals, projects,
reports, renewals, fee-waiver progress, or exports.

Approved origins are `QUICK`, `PASTE`, and `EMAIL`. Approved states are:

- `NEEDS_REVIEW` — missing, ambiguous, or type-invalid fields;
- `READY` — server validation can create the transaction;
- `IMPORTING` — a bounded batch is being committed idempotently;
- `IMPORTED` — the canonical transaction was created; and
- `DISMISSED` — the user rejected the candidate.

Draft money remains text until canonical validation so pasted decimal values
are never converted through JavaScript binary numbers. Canonical creation must
call the same validation, ownership, and transactional activity boundary as
ordinary transaction creation. Shared helpers may be extracted from the
existing action, but no alternate financial write path is allowed.

Every draft query and mutation obtains `userId` through `requireAuth()` and
scopes both the root draft and all referenced category, source, project, and
transaction IDs. Draft IDs from another user resolve as safe not-found results.

## Spreadsheet Capture

The capture workspace accepts clipboard text, TSV, CSV, and copied spreadsheet
rows. The first release limits one batch to 200 rows and one megabyte of text.
Parsing happens client-side for immediate feedback; the server repeats all
limits, normalization, and validation.

The parser detects common headers and presents a mapping screen when any column
is ambiguous. The compact grid shows status, date, type, title, amount, source,
category, and quality. Type-specific fields such as destination source,
adjustment target, related refund, project, description, and fee-waiver choice
live in an expandable row inspector rather than making the grid permanently
wide.

Keyboard interactions include arrow and Tab navigation, Enter to edit, Escape
to cancel an edit, multi-row selection, paste into a selected cell, and
fill-down for repeated values. Defaults come from user settings, category
defaults, the previous row, and explicit fill operations; a guess never
overwrites a user-touched value.

Before import, the workspace displays row-level findings and a summary of ready,
review, duplicate, and selected rows. Import validates the complete selected
set and commits it in one Prisma transaction with an idempotency key. Either all
selected rows and their activity entries commit or none do. Invalid unselected
rows remain drafts for correction.

## Email Forwarding and Progressive Onboarding

Each user receives a rotatable, unguessable inbound alias. The application
states plainly that it can receive only messages sent to that alias and cannot
browse the mailbox. Webhook authentication is verified before the payload is
parsed or a user alias is resolved.

Onboarding asks for the email provider, not a complete bank inventory:

1. Copy the private forwarding address.
2. Follow provider-specific instructions to add and verify it.
3. Manually forward one recent transaction alert as a test.
4. Recognize the institution, masked account identifier, and candidate fields.
5. Suggest a matching existing `MoneySource`, with explicit confirmation.
6. Generate a conservative forwarding filter for the recognized sender.
7. Repeat later only when another institution first appears.

Existing `MoneySource.providerName`, display identifiers, card last four digits,
and names provide suggestions; they are not proof of a match. If multiple
sources remain plausible, the candidate stays `NEEDS_REVIEW`.

Gmail onboarding follows its forwarding-address verification and filtered
forwarding flow. Outlook onboarding uses conditional forwarding or redirect
rules; redirect is preferred when available because it retains the original
sender. Instructions are maintained in the application with copy buttons,
completion checks, a test-message status, and troubleshooting. They link to the
official Gmail and Outlook documentation:

- <https://support.google.com/mail/answer/10957>
- <https://support.microsoft.com/en-us/outlook/mail/use-rules-to-automatically-forward-messages>

## Email Classification and Safety

Initial institution adapters are deterministic, versioned parsers backed by
redacted real-message fixtures. A parser may extract only the fields supported
by its fixture evidence: transaction type, exact amount text, currency, event
time, merchant or counterparty, masked source identifier, bank reference, and
status.

Pending, declined, OTP, login, marketing, and balance-only notices do not create
transaction drafts. Unknown formats, transfers, refunds, reversals, conflicting
fields, and uncertain source mappings require review. Parser confidence is an
explanation, not a decorative score: the interface lists which fields were
recognized and which need confirmation.

Deduplication uses the provider message identifier hash, normalized bank
reference when present, source mapping, exact amount, event time, and event
kind. A duplicate remains visible as a non-importable finding. Same-amount
events are not treated as duplicates without additional matching evidence.

The initial release never auto-posts email drafts. An institution cannot become
eligible for later opt-in auto-posting until it has a reviewed fixture suite,
measured production accuracy, explicit user approval, and a separate approved
design change.

## Privacy, Retention, and Abuse Controls

- Do not store mailbox OAuth tokens because mailbox OAuth is not used.
- Verify the inbound provider signature and enforce payload and rate limits.
- Resolve users through opaque aliases; never place a user ID or email address
  in the inbound address.
- Process raw message bodies in memory and do not persist bodies or attachments
  in the first release.
- Store only extracted candidate fields, normalized sender metadata, parser
  version, confidence reasons, and non-reversible message/reference hashes.
- Delete unresolved drafts after 30 days. Importing or dismissing deletes the
  candidate fields immediately.
- Retain only deduplication hashes, disposition, timestamps, and an optional
  resulting transaction ID for 90 days, then delete them in bounded batches.
- Let users rotate or disable the alias, block a sender, disconnect ingestion,
  and delete all pending email drafts.
- Record setup, rotation, disconnect, batch import, and candidate disposition in
  `ActivityLog` without raw email, subject text, or secrets.

The email phase adds only approved, provider-neutral configuration names:
`INBOUND_EMAIL_API_KEY`, `INBOUND_EMAIL_WEBHOOK_SECRET`, and
`INBOUND_EMAIL_DOMAIN`. Existing authentication continues to use
`NEXTAUTH_SECRET` and `NEXTAUTH_URL`; `AUTH_SECRET` and `AUTH_URL` remain
forbidden. Provider choice and provider-specific configuration require approval
in the secure inbound-email subphase before implementation.

Production use requires published privacy, retention, deletion, and consent
copy that matches actual behavior.

## Visual and Interaction Direction

The capture workspace is a **living ledger** for ordinary people, not an
accounting console. Its single job is moving messy inputs into trustworthy
transactions.

The compact token system is:

- canvas `#F5F7FB`;
- ledger ink `#172033`;
- primary action `#4338CA`;
- confirmed `#087F5B`;
- needs review `#C97912`; and
- error or expense `#C92A5B`.

Space Grotesk is used sparingly for workspace headings, Be Vietnam Pro for UI
copy, and IBM Plex Mono for amounts and compact ledger metadata. Fonts must be
loaded through `next/font` with only required weights and Vietnamese support
where available.

The signature element is a narrow status rail paired with an origin stamp:
`QUICK`, `PASTE`, or `EMAIL`. These encode provenance and readiness rather than
decorate the row. Surrounding UI remains quiet, with restrained borders and no
unrelated gradients, glass effects, or ambient animation.

Desktop uses a sticky capture toolbar, editable ledger grid, row inspector, and
sticky import summary. Mobile converts rows into editable cards with the same
field order and a bottom review bar. Motion is limited to one purposeful event:
newly parsed rows settle into the ledger and their status rail resolves. Reduced
motion removes this transition.

Interface copy names user actions directly: `Paste rows`, `Review 2 issues`,
`Save 12 transactions`, `Dismiss draft`, `Copy forwarding address`, and
`Disconnect email`. Empty and error states explain the next corrective action.

The design's deliberate risk is treating provenance as a primary visual axis.
This is specific to a product combining manual and automated financial inputs;
it is not a generic dashboard accent. The self-critique removed a proposed
decorative receipt-paper motif because it added personality without helping
users judge data trustworthiness.

## Accessibility and Responsive Behavior

- All spreadsheet functions have keyboard and pointer equivalents.
- The grid exposes appropriate row, column, selection, edit, and error semantics
  to assistive technology.
- Error summaries link to the affected row and field.
- Status always includes text or an icon plus accessible text; color is never
  the only signal.
- Focus remains visible during cell editing, row expansion, dialogs, and sticky
  controls.
- Mobile targets remain at least 44 pixels high and never require document-level
  horizontal scrolling.
- Paste review remains usable at 375 pixels through cards and a field inspector.
- Reduced motion, zoom to 200 percent, and high-contrast checks are release
  acceptance items.

## Failure Handling

Client parsing failures preserve the pasted text until the user clears it.
Server validation replaces optimistic readiness with exact field findings. A
failed atomic import creates no transactions or activity rows and leaves drafts
editable under the same idempotency key.

Inbound webhooks acknowledge only authenticated, durably recorded receipts.
Retries are idempotent. Unknown aliases, invalid signatures, oversized payloads,
and disabled mailboxes receive safe responses without exposing user existence.
Parser failures create a bounded operational event and, when enough safe data
exists, a `NEEDS_REVIEW` candidate; raw email is never written to application
logs.

If forwarding stops, the onboarding screen reports the last received time and
offers provider-specific checks. It does not claim that an absence of messages
means there were no transactions.

## Verification Strategy

Every implementation phase uses test-driven development and adds focused tests
alongside production code.

The capture phase must cover:

- CSV, TSV, headerless, reordered, quoted, Unicode, and malformed input;
- exact `Decimal(18,2)` preservation and batch limits;
- all five transaction type matrices and ownership of every referenced ID;
- defaults, fill-down, user-touched precedence, duplicates, and idempotency;
- atomic activity logging and rollback;
- two-user draft isolation;
- keyboard grid behavior, screen-reader findings, 375-pixel cards, and reduced
  motion; and
- reconciliation of imported transactions through balances, cards, dashboard,
  reports, activity, and CSV export.

The email phases must additionally cover:

- valid and invalid webhook signatures, replay, payload limits, and alias
  rotation;
- redacted VCB, OCB, and HSBC fixtures with parser-version expectations;
- pending, declined, OTP, marketing, refund, reversal, transfer, unknown, and
  duplicate messages;
- ambiguous and exact money-source mapping;
- raw-body non-persistence, retention cleanup, disconnect, and deletion;
- Gmail and Outlook instruction rendering and test-message state; and
- cross-user and direct-object probes for every email-derived record.

Each phase ends with Node.js 22 lint, typecheck, unit/render tests, relevant real
PostgreSQL integration tests, Prisma validation and migration checks, production
dependency audit, production build, focused mobile/browser QA, and an
independent whole-phase review.

## Production Release Gate

After all approved capture phases pass Preview acceptance:

- provision a Production PostgreSQL database separate from Preview;
- create a Production-only `NEXTAUTH_SECRET` and set `NEXTAUTH_URL` to the
  canonical Production origin;
- configure separate Preview and Production inbound-provider credentials,
  domains, and webhook secrets;
- run `prisma migrate deploy`, never `prisma db push`;
- verify webhook endpoints, alias isolation, retention jobs, and operational
  logs without real personal messages;
- repeat authentication, financial reconciliation, two-user isolation, CSV,
  headers, rate limits, mobile, and transaction-capture acceptance; and
- remove or protect obsolete deployments before admitting real users.

## Definition of Done

The program is complete only when every phase is separately approved, its tests
and migrations pass, the shared draft path cannot bypass canonical transaction
rules, forwarded email remains selective and data-minimized, bulk and email
flows are usable on desktop and mobile, privacy controls match documentation,
and the isolated Production release passes the complete acceptance gate.
