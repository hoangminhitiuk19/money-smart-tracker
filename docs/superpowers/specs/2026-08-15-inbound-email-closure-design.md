# Inbound Email Closure Design

**Status:** Approved for planning on 2026-08-15

**Phase boundary:** Close and polish the existing synthetic inbound-email
foundation. Do not add real bank-email parsing or automatic transaction posting.

## Authority and context

This design applies `money-quality-tracker-spec-v4.md` §§27–30, the phase and
verification rules in `codex-prompting-guide-v2.md`, the existing secure
inbound-email design, and the repository instructions in `AGENTS.md`.

The live sandbox proved the core path: a signed Resend event produced one
reviewable `EMAIL` draft, the user imported it into exactly one transaction,
and the draft retained only cleared lifecycle provenance. Reopening the capture
URL then appeared empty because imported draft values had correctly been
deleted. The behavior is safe but confusing.

The public `money-smart-tracker.vercel.app` deployment is explicitly a
**test-only sandbox**. Vercel labels its target as Production, but it uses a
testing database and accepts only synthetic or redacted data. This decision
does not authorize real financial email, real users, or a customer Production
release.

## Goals

1. Make terminal capture URLs explain what happened instead of showing cleared
   rows as an empty workspace.
2. Complete the remaining live lifecycle, replay, privacy, mobile, keyboard,
   and reduced-motion acceptance checks.
3. Align README, `AGENTS.md`, and acceptance evidence with the actual sandbox.
4. Preserve the existing security, ownership, idempotency, zero-financial-
   effect-before-import, and data-minimization guarantees.

## Non-goals

- Gmail or Outlook account access, forwarding automation, or inbox browsing.
- Institution-specific parsers or real bank-email support.
- OCR, attachments, AI extraction, or automatic transaction posting.
- A new capture-session model, schema migration, or scheduled retention SLA.
- Authorization of a real Production launch.

## Capture state architecture

The owner-scoped server loader will derive two separate views from existing
`TransactionDraft`, `TransactionImportBatch`, and transaction relationships:

- **Editable drafts:** only `NEEDS_REVIEW` and `READY` records.
- **Capture outcome:** active, imported, dismissed, or unavailable.

The query must begin with `requireAuth()` and scope every lookup by the session
user and validated capture UUID. For an imported capture, it may follow only
owner-scoped `importedTransactionId` relationships and return safe navigation
metadata. It must never reconstruct cleared draft fields.

No schema migration is needed. Unknown, expired, invalid, and cross-user keys
must produce the same generic unavailable outcome so the response cannot reveal
whether another user's capture exists. Database failures return a safe temporary
failure without logging capture keys, transaction identifiers, or financial
data.

Mixed batches remain supported. If imported and editable rows share a capture,
the loader returns the editable rows plus an imported count. An imported-only
capture returns no editable rows and a terminal outcome. Dismissed-only captures
return a dismissed outcome.

## UI behavior

A focused `CaptureCompletionCard` keeps terminal-state presentation outside the
already-large editable workspace.

| Server state | UI behavior |
| --- | --- |
| Active drafts | Existing capture workspace and review ledger |
| Imported only, one transaction | “Transaction imported,” **View transaction**, and **Start another capture** |
| Imported only, multiple transactions | Imported count, **View transactions**, and **Start another capture** |
| Imported plus active drafts | Compact success notice above remaining editable rows |
| Dismissed only | “Draft dismissed” and **Start another capture** |
| Missing, expired, invalid, or unauthorized | Generic “Capture unavailable” state |
| Temporary loader failure | Safe retry guidance without sensitive detail |

The completion state explains that the original candidate fields were removed
after import for privacy. It does not display the prior amount, merchant, raw
row, email content, address, capture key, or provider identifiers.

Actions use semantic links, visible focus, mobile-safe wrapping, reduced-motion
classes, and targets at least 44px high. Status meaning must use text in addition
to color or icons. At 375px, the page must not introduce document-level
horizontal overflow.

## Security and privacy invariants

- Authentication and user scoping precede capture and transaction lookup.
- A foreign capture key is indistinguishable from a missing one.
- Imported and dismissed draft values remain cleared.
- Email receipt processing never changes financial totals; only explicit import
  creates a transaction.
- Replay remains idempotent across receipt creation, draft creation, and
  canonical import.
- Runtime logs and acceptance evidence exclude raw content, email addresses,
  aliases, signatures, API keys, provider IDs, capture keys, user IDs, and
  transaction IDs.
- Continue using `NEXTAUTH_SECRET` and `NEXTAUTH_URL`; never introduce
  `AUTH_SECRET` or `AUTH_URL`.

## Automated verification

Tests will be added before or alongside implementation for:

- owner-scoped outcome derivation for active, imported, mixed, dismissed,
  missing, expired, and cross-user captures;
- filtering terminal rows out of the editable ledger;
- single- and multi-transaction completion destinations;
- safe behavior for invalid keys and loader failures;
- preservation of cleared imported/dismissed values;
- completion, mixed, dismissed, and unavailable rendered states;
- accessible headings and link names, visible-focus classes, 44px targets,
  reduced-motion behavior, and mobile-safe layout; and
- PostgreSQL evidence for exactly-one import, replay idempotency, and cross-user
  non-disclosure.

The final automated gate includes Node 22, clean dependencies, zero-warning
lint, TypeScript, the full unit/rendered suite, the complete serialized
PostgreSQL suite, Prisma validation, production dependency audit, production
build, migration status, and a clean worktree.

## Live sandbox acceptance

Use only disposable synthetic records and never copy secrets or identifiers
into logs, chat, screenshots, or evidence.

1. Send the exact supported synthetic fixture to a current active test address.
2. Confirm one signed `email.received` delivery, one reviewable `EMAIL` draft,
   zero financial effect before import, and one canonical transaction after an
   explicit owned-source import.
3. Reopen the capture URL and confirm the completion card and owner-protected
   destination link.
4. Replay the same Resend event and confirm no second receipt, draft, or
   transaction effect.
5. Rotate the address and confirm the old address cannot create a draft while
   the new address can.
6. Verify disable blocks processing, enable restores it, pending-data deletion
   removes disposable candidates, and disconnect disables the mailbox and
   removes pending email drafts.
7. Repeat the user-facing flow by keyboard, at 375px, and with reduced motion.
8. Run a minimal owner-scoped privacy metadata query confirming persisted data
   contains only permitted lifecycle state and hashes, with no raw message or
   address material.

## Documentation and environment policy

Update README, `AGENTS.md`, and the inbound acceptance record together:

- identify the stable Vercel deployment as a test-only sandbox even though the
  environment target is labeled Production;
- require the testing database and synthetic/redacted messages;
- document the all-or-none inbound group without printing values;
- keep `NEXTAUTH_URL` equal to the stable sandbox origin and preserve the exact
  `NEXTAUTH_*` names;
- replace pending live-acceptance claims with dated, sanitized evidence only
  after each check is actually performed; and
- state prominently that real bank-email parsing and real Production use remain
  unsupported and unauthorized.

## Definition of done

The closure phase is complete only when the approved UX is implemented with
tests, all automated gates pass, every live sandbox acceptance item passes,
documentation matches the deployed reality, and no unresolved security,
privacy, ownership, accessibility, or data-minimization finding remains. Any
skipped or unavailable check keeps the phase open.
