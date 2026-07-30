# Phase 1 Foundation and Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a supported, reproducible, Vercel-ready foundation with validated configuration, distributed abuse controls, security headers, and automated release gates without changing financial features.

**Architecture:** Upgrade the existing Next.js App Router application in place to the approved maintenance release, then introduce small server-only security modules with explicit interfaces. Neon PostgreSQL stores atomic fixed-window rate-limit buckets so protection works across Vercel function instances; server actions remain responsible for authentication, ownership, safe errors, and business mutations.

**Tech Stack:** Node.js 22, Next.js 15.5.21, React 19.2.8, NextAuth 4.24.15, TypeScript, Prisma 6, Neon PostgreSQL, Zod 4, Vitest 2, ESLint 9, GitHub Actions, Vercel Hobby.

## Global Constraints

- Read `money-quality-tracker-spec-v4.md` §§3, 5, 28–30 and `codex-prompting-guide-v2.md` Phase 0, Phase 2, and Phase 15 before changing this phase.
- Next.js 15.5.21 is the single approved exception to the specification’s Next.js 14 pin. Keep NextAuth on v4.24.15; do not migrate to Auth.js v5 or Next.js 16.
- Use exactly `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`. Reject and never introduce `AUTH_SECRET` or `AUTH_URL`.
- Target Node.js 22 and Vercel Hobby for personal, non-commercial use. Do not add Redis, another managed service, or another application secret.
- Do not change financial calculations, transaction field rules, dashboards, reports, credit-card behavior, or general UX in this phase.
- Obtain authenticated user IDs from `requireAuth()` only. Never accept a client-supplied user ID.
- Never persist raw email addresses, IP addresses, or user IDs in rate-limit storage; persist HMAC-SHA256 identifiers only.
- Rate-limit failures must prevent the protected business operation and return generic errors without stack traces or internal details.
- Use Prisma migrations. Run `prisma migrate deploy` for production-like verification; never use `prisma db push`.
- Follow red-green-refactor for every behavioral change. Configuration and generated lockfile/migration changes are verified by their real commands.
- End every task with focused checks, the full unit suite, `git diff --check`, and a commit. End the phase with fresh full verification and independent review.
- Run commands under Node 22. If the workstation has no version manager and
  `node --version` is not `v22.*`, wrap command groups with
  `npx --yes --package=node@22 --call '<commands>'`.

## File Structure

- `lib/env.ts`: parse and expose validated server environment values.
- `lib/security/rate-limit-core.ts`: pure fixed-window, hashing, header parsing, and decision logic.
- `lib/security/rate-limit-store.ts`: PostgreSQL atomic consume and bounded cleanup.
- `lib/security/rate-limit.ts`: concrete policies and application-facing auth, mutation, and export helpers.
- `tests/rate-limit.test.ts`: deterministic pure/unit behavior.
- `tests/integration/rate-limit.integration.test.ts`: real Neon atomicity and cleanup behavior.
- `vitest.integration.config.ts`: explicit opt-in database integration suite.
- `eslint.config.mjs`: non-interactive Next.js and TypeScript lint configuration.
- `.github/workflows/ci.yml`: Node 22 clean-install verification.
- `prisma/migrations/*_add_rate_limit_buckets/migration.sql`: durable rate-limit schema.

---

### Task 1: Modernize the Runtime Without Changing Behavior

**Files:**
- Create: `.nvmrc`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app/(protected)/layout.tsx`
- Modify: `app/(protected)/dashboard/page.tsx`
- Modify: `app/(protected)/reports/page.tsx`
- Modify: `app/(protected)/transactions/page.tsx`
- Modify: `app/(protected)/renewals/page.tsx`
- Modify: `app/(protected)/activity-log/page.tsx`
- Modify: `app/(protected)/accounts/[id]/page.tsx`
- Modify: `app/(protected)/goals/[id]/page.tsx`
- Modify: `app/(protected)/projects/[id]/page.tsx`
- Modify: `app/(protected)/transactions/[id]/edit/page.tsx`
- Modify: `app/(auth)/register/page.tsx`
- Modify: `components/settings-form.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: Existing App Router page props, server actions, and NextAuth v4 configuration.
- Produces: Node 22 runtime contract; Next.js 15-compatible asynchronous page props; React 19 action-state forms; secure dependency baseline for later tasks.

- [ ] **Step 1: Pin the approved runtime and dependency versions**

Create `.nvmrc`:

```text
22
```

Confirm the task shell uses Node 22:

```bash
node --version
```

Expected: `v22.*`. If it does not, use the documented `npx` Node 22 wrapper
for every install and verification command in this plan.

Set `package.json` to include:

```json
{
  "engines": {
    "node": "22.x"
  },
  "dependencies": {
    "next": "15.5.21",
    "next-auth": "4.24.15",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "eslint": "9.39.5",
    "eslint-config-next": "15.5.21"
  }
}
```

Preserve every unrelated dependency and script. Regenerate the lockfile:

```bash
npm install
```

- [ ] **Step 2: Verify the dependency tree and production audit**

Run:

```bash
npm ls next next-auth react react-dom eslint eslint-config-next
npm audit --omit=dev --audit-level=high
```

Expected: the six requested packages resolve to the pinned lines, and no high
or critical production finding remains. If the audit still reports one, stop
and report the exact advisory rather than forcing another major upgrade.

- [ ] **Step 3: Migrate Next.js request-time APIs**

Change `headers()` in `app/(protected)/layout.tsx` to:

```ts
const headerList = await headers();
```

For dashboard, reports, transactions, renewals, and activity-log pages, change
the page prop to a promise and resolve it once:

```ts
type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function Page({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  return <PageContent searchParams={resolvedSearchParams} />;
}
```

Retain each file’s actual exported component name and current Suspense
structure. For account, goal, project, and transaction-edit detail pages:

```ts
type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <PageContent id={id} />;
}
```

Pass the resolved ID through the file’s existing interface; do not change
not-found or ownership behavior.

- [ ] **Step 4: Migrate React form state**

In registration and settings forms, replace:

```ts
import { useFormState, useFormStatus } from "react-dom";
const [state, formAction] = useFormState(action, initialState);
```

with:

```ts
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
const [state, formAction] = useActionState(action, initialState);
```

Preserve the existing server-action signatures, initial states, submitted form
fields, pending state, and displayed messages.

- [ ] **Step 5: Update the runtime documentation**

Change the README stack line to Next.js 15 and React 19. Add Node.js 22 as a
prerequisite and change clean installation guidance to `npm ci`. Do not add the
deployment procedure yet; Task 8 owns it.

- [ ] **Step 6: Verify the runtime migration**

Run:

```bash
npx tsc --noEmit
npm run test:run
npm run build
git diff --check
```

Expected: typecheck, 141 existing tests, and the production build pass without
runtime migration warnings from synchronous `params`, `searchParams`, or
`headers()`.

- [ ] **Step 7: Commit**

```bash
git add .nvmrc package.json package-lock.json app components/settings-form.tsx README.md
git commit -m "chore: upgrade supported application runtime"
```

---

### Task 2: Validate the Exact Server Environment

**Files:**
- Create: `lib/env.ts`
- Create: `tests/env.test.ts`
- Modify: `lib/auth.ts`
- Modify: `lib/prisma.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `NodeJS.ProcessEnv`.
- Produces: `parseServerEnv(source): ServerEnv` and `getServerEnv(): ServerEnv`.

- [ ] **Step 1: Write failing environment tests**

Create `tests/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/money",
  NEXTAUTH_SECRET: "0123456789abcdef0123456789abcdef",
  NEXTAUTH_URL: "http://localhost:3000"
};

describe("server environment", () => {
  it("accepts exactly the required variables", () => {
    expect(parseServerEnv(valid)).toEqual(valid);
  });

  it.each(["AUTH_SECRET", "AUTH_URL"] as const)(
    "rejects forbidden alias %s even when required variables exist",
    (key) => {
      expect(() => parseServerEnv({ ...valid, [key]: "forbidden" })).toThrow(
        `Remove forbidden environment variable ${key}.`
      );
    }
  );

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      parseServerEnv({ ...valid, DATABASE_URL: "https://example.com" })
    ).toThrow(/DATABASE_URL/);
  });

  it("rejects a short authentication secret", () => {
    expect(() =>
      parseServerEnv({ ...valid, NEXTAUTH_SECRET: "too-short" })
    ).toThrow(/NEXTAUTH_SECRET/);
  });

  it("rejects a relative authentication URL", () => {
    expect(() =>
      parseServerEnv({ ...valid, NEXTAUTH_URL: "/login" })
    ).toThrow(/NEXTAUTH_URL/);
  });
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
npm run test:run -- tests/env.test.ts
```

Expected: FAIL because `@/lib/env` does not exist.

- [ ] **Step 3: Implement environment parsing and caching**

Create `lib/env.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
      message: "DATABASE_URL must be a PostgreSQL URL."
    }),
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.string().url().refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    { message: "NEXTAUTH_URL must be an absolute HTTP(S) URL." }
  )
});

export type ServerEnv = z.infer<typeof schema>;

export function parseServerEnv(source: NodeJS.ProcessEnv): ServerEnv {
  for (const key of ["AUTH_SECRET", "AUTH_URL"] as const) {
    if (source[key] !== undefined) {
      throw new Error(`Remove forbidden environment variable ${key}.`);
    }
  }

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path[0]))];
    throw new Error(`Invalid server environment: ${fields.join(", ")}.`);
  }
  return parsed.data;
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
```

- [ ] **Step 4: Route server consumers through validated values**

In `lib/auth.ts`:

```ts
import { getServerEnv } from "@/lib/env";
```

Replace the current `authOptions.secret` value with:

```ts
secret: getServerEnv().NEXTAUTH_SECRET
```

In `lib/prisma.ts`:

```ts
import { getServerEnv } from "@/lib/env";

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: getServerEnv().DATABASE_URL } }
  });
```

Keep the existing development singleton behavior. Keep `.env.example` limited
to the existing three names and add comments describing the 32-character
secret and absolute URL requirements.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run test:run -- tests/env.test.ts
npm run test:run
npx tsc --noEmit
npx prisma validate
git diff --check
```

Expected: environment tests and the full suite pass; Prisma validates with the
existing `.env`.

- [ ] **Step 6: Commit**

```bash
git add lib/env.ts lib/auth.ts lib/prisma.ts tests/env.test.ts .env.example
git commit -m "feat: validate server environment configuration"
```

---

### Task 3: Add Non-Interactive Quality Gates and HTTP Headers

**Files:**
- Create: `eslint.config.mjs`
- Create: `.github/workflows/ci.yml`
- Create: `tests/next-config.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `next.config.mjs`

**Interfaces:**
- Consumes: Next.js configuration and npm scripts.
- Produces: `npm run lint`, `npm run typecheck`, `npm run verify`, CI checks,
  and deterministic global security headers.

- [ ] **Step 1: Write a failing security-header test**

Create `tests/next-config.test.ts` using a variable module URL so TypeScript
does not attempt to infer declarations from the JavaScript config:

```ts
import { describe, expect, it } from "vitest";

describe("Next.js security headers", () => {
  it("applies the release baseline to every route", async () => {
    const moduleUrl = new URL("../next.config.mjs", import.meta.url).href;
    const { default: nextConfig } = (await import(moduleUrl)) as {
      default: {
        headers?: () => Promise<
          Array<{
            source: string;
            headers: Array<{ key: string; value: string }>;
          }>
        >;
      };
    };
    const rules = await nextConfig.headers?.();
    expect(rules).toHaveLength(1);
    expect(rules?.[0].source).toBe("/(.*)");
    expect(Object.fromEntries(rules?.[0].headers.map(({ key, value }) => [key, value]) ?? []))
      .toEqual({
        "Permissions-Policy":
          "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY"
      });
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
npm run test:run -- tests/next-config.test.ts
```

Expected: FAIL because `nextConfig.headers` is absent.

- [ ] **Step 3: Add the security headers**

Set `next.config.mjs` to:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
```

- [ ] **Step 4: Configure ESLint and scripts**

Install the flat-config compatibility package:

```bash
npm install --save-dev --save-exact @eslint/eslintrc@3.3.1
```

Create `eslint.config.mjs`:

```js
import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: directory });

export default [
  { ignores: [".next/**", "node_modules/**", "coverage/**", ".worktrees/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript")
];
```

Set scripts:

```json
{
  "scripts": {
    "build": "prisma generate && next build",
    "lint": "eslint . --max-warnings=0",
    "typecheck": "tsc --noEmit",
    "verify": "npm run lint && npm run typecheck && npm run test:run && npx prisma validate && npm audit --omit=dev --audit-level=high && npm run build",
    "prisma:deploy": "prisma migrate deploy"
  }
}
```

Preserve the existing scripts not replaced above.

- [ ] **Step 5: Add GitHub Actions**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [master, main]

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      DATABASE_URL: postgresql://ci:ci@localhost:5432/ci
      NEXTAUTH_SECRET: ci-only-secret-0123456789abcdef0123456789
      NEXTAUTH_URL: http://localhost:3000
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx prisma validate
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:run
      - run: npm audit --omit=dev --audit-level=high
      - run: npm run build
```

CI intentionally validates but does not connect to or migrate the dummy URL.

- [ ] **Step 6: Verify GREEN and all quality gates**

Run:

```bash
npm run test:run -- tests/next-config.test.ts
npm run lint
npm run typecheck
npm run test:run
npx prisma validate
npm audit --omit=dev --audit-level=high
npm run build
git diff --check
```

Expected: every command exits zero without interactive prompts or warnings
classified as lint failures.

- [ ] **Step 7: Commit**

```bash
git add eslint.config.mjs .github/workflows/ci.yml tests/next-config.test.ts package.json package-lock.json next.config.mjs
git commit -m "ci: enforce release quality and security gates"
```

---

### Task 4: Implement the Distributed Rate-Limit Store

**Files:**
- Create: `lib/security/rate-limit-core.ts`
- Create: `lib/security/rate-limit-store.ts`
- Create: `lib/security/rate-limit.ts`
- Create: `tests/rate-limit.test.ts`
- Create: `tests/integration/rate-limit.integration.test.ts`
- Create: `vitest.integration.config.ts`
- Create: `prisma/migrations/20260729170000_add_rate_limit_buckets/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `RateLimitPolicy`
  - `RateLimitDecision`
  - `RateLimitStore.consume(bucket): Promise<number>`
  - `RateLimitStore.cleanupExpired(now, maximumRows): Promise<number>`
  - `consumeRateLimit(policy, identifier, dependencies?): Promise<RateLimitDecision>`
  - `RATE_LIMIT_MESSAGE`
  - policy-specific helpers used by Tasks 5–8.

- [ ] **Step 1: Write failing pure rate-limit tests**

Create `tests/rate-limit.test.ts` with literal expectations:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  consumeRateLimit,
  hashRateLimitIdentifier,
  type RateLimitStore
} from "@/lib/security/rate-limit-core";

const policy = { scope: "test", limit: 2, windowMs: 60_000 };
const secret = "0123456789abcdef0123456789abcdef";

function storeReturning(...counts: number[]): RateLimitStore {
  return {
    consume: vi.fn(async () => counts.shift() ?? 1),
    cleanupExpired: vi.fn(async () => 0)
  };
}

describe("rate limiting", () => {
  it("hashes a normalized namespaced identifier without exposing it", () => {
    const first = hashRateLimitIdentifier("login:email", " USER@Example.com ", secret);
    const second = hashRateLimitIdentifier("login:email", "user@example.com", secret);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("user@example.com");
    expect(hashRateLimitIdentifier("register:email", "user@example.com", secret))
      .not.toBe(first);
  });

  it("allows through the limit and denies the next request", async () => {
    const store = storeReturning(1, 2, 3);
    const at = new Date("2026-07-29T00:00:30.000Z");
    await expect(consumeRateLimit(policy, "user", { store, secret, now: () => at }))
      .resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(consumeRateLimit(policy, "user", { store, secret, now: () => at }))
      .resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(consumeRateLimit(policy, "user", { store, secret, now: () => at }))
      .resolves.toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
  });

  it("fails closed when storage is unavailable", async () => {
    const store: RateLimitStore = {
      consume: vi.fn(async () => {
        throw new Error("database detail that must not escape");
      }),
      cleanupExpired: vi.fn(async () => 0)
    };
    await expect(
      consumeRateLimit(policy, "user", {
        store,
        secret,
        now: () => new Date("2026-07-29T00:00:30.000Z")
      })
    ).resolves.toMatchObject({ allowed: false, unavailable: true });
  });

  it("runs bounded cleanup only for a newly created bucket", async () => {
    const store = storeReturning(1, 2);
    const at = new Date("2026-07-29T00:00:30.000Z");
    await consumeRateLimit(policy, "user", { store, secret, now: () => at });
    await consumeRateLimit(policy, "user", { store, secret, now: () => at });
    expect(store.cleanupExpired).toHaveBeenCalledTimes(1);
    expect(store.cleanupExpired).toHaveBeenCalledWith(at, 500);
  });
});
```

- [ ] **Step 2: Run the pure tests to verify RED**

Run:

```bash
npm run test:run -- tests/rate-limit.test.ts
```

Expected: FAIL because the rate-limit modules do not exist.

- [ ] **Step 3: Implement the pure core**

Create `lib/security/rate-limit-core.ts` with these public types and behavior:

```ts
import { createHmac } from "node:crypto";

export type RateLimitPolicy = {
  scope: string;
  limit: number;
  windowMs: number;
};

export type RateLimitBucketInput = {
  scope: string;
  identifierHash: string;
  windowStart: Date;
  expiresAt: Date;
};

export type RateLimitStore = {
  consume(input: RateLimitBucketInput): Promise<number>;
  cleanupExpired(now: Date, maximumRows: number): Promise<number>;
};

export type RateLimitDecision = {
  allowed: boolean;
  unavailable: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export function hashRateLimitIdentifier(
  scope: string,
  identifier: string,
  secret: string
) {
  const normalized = identifier.trim().toLowerCase();
  return createHmac("sha256", secret)
    .update(`${scope}\0${normalized}`)
    .digest("hex");
}
```

`consumeRateLimit` must floor the supplied time to `windowMs`, set expiry to
the window end plus 24 hours, call `store.consume`, clean at most 500 rows only
when count is 1, clamp remaining to zero, and calculate retry seconds with
`Math.ceil`. Catch counter failures and return `allowed: false`,
`unavailable: true`, with no internal error text. Catch cleanup independently
so it never changes the established decision.

- [ ] **Step 4: Verify the core is GREEN**

Run:

```bash
npm run test:run -- tests/rate-limit.test.ts
```

Expected: all four tests pass.

- [ ] **Step 5: Add the Prisma model and generated migration**

Add to `prisma/schema.prisma`:

```prisma
model RateLimitBucket {
  scope          String
  identifierHash String
  windowStart    DateTime
  count          Int      @default(0)
  expiresAt      DateTime
  createdAt      DateTime @default(now())

  @@id([scope, identifierHash, windowStart])
  @@index([expiresAt])
  @@map("rate_limit_buckets")
}
```

Create
`prisma/migrations/20260729170000_add_rate_limit_buckets/migration.sql` with:

```sql
CREATE TABLE "rate_limit_buckets" (
  "scope" TEXT NOT NULL,
  "identifierHash" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_limit_buckets_pkey"
    PRIMARY KEY ("scope", "identifierHash", "windowStart")
);

CREATE INDEX "rate_limit_buckets_expiresAt_idx"
  ON "rate_limit_buckets"("expiresAt");
```

Apply it to the disposable database with `npm run prisma:deploy` before
running the integration test. Do not edit an already-applied migration.

- [ ] **Step 6: Write the real-database integration test and verify RED**

Create `vitest.integration.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { include: ["tests/integration/**/*.test.ts"] }
});
```

Add:

```json
{
  "scripts": {
    "test:integration": "vitest run --config vitest.integration.config.ts"
  }
}
```

Create `tests/integration/rate-limit.integration.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { prismaRateLimitStore } from "@/lib/security/rate-limit-store";

const consumeScope = `integration-consume:${randomUUID()}`;
const cleanupScope = `integration-cleanup:${randomUUID()}`;

afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({
    where: { scope: { in: [consumeScope, cleanupScope] } }
  });
  await prisma.$disconnect();
});

describe("PostgreSQL rate-limit store", () => {
  it("atomically returns every count under concurrency", async () => {
    const bucket = {
      scope: consumeScope,
      identifierHash: "a".repeat(64),
      windowStart: new Date("2026-07-29T00:00:00.000Z"),
      expiresAt: new Date("2026-07-30T00:01:00.000Z")
    };
    const counts = await Promise.all(
      Array.from({ length: 25 }, () => prismaRateLimitStore.consume(bucket))
    );
    expect(counts.sort((left, right) => left - right)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
      14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25
    ]);
  });

  it("deletes no more than the requested number of expired rows", async () => {
    await prisma.rateLimitBucket.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        scope: cleanupScope,
        identifierHash: index.toString(16).padStart(64, "0"),
        windowStart: new Date(0),
        count: 1,
        expiresAt: new Date("2000-01-01T00:00:00.000Z")
      }))
    });
    expect(
      await prismaRateLimitStore.cleanupExpired(
        new Date("2026-07-29T00:00:00.000Z"),
        500
      )
    ).toBe(500);
    expect(
      await prisma.rateLimitBucket.count({ where: { scope: cleanupScope } })
    ).toBe(1);
  });
});
```

Apply the migration and run:

```bash
npm run prisma:deploy
npx prisma generate
npm run test:integration
```

Expected: FAIL because `lib/security/rate-limit-store.ts` does not exist.

- [ ] **Step 7: Implement atomic PostgreSQL storage**

Create `lib/security/rate-limit-store.ts`. Its `consume` method must use a
parameterized Prisma tagged query equivalent to:

```sql
INSERT INTO "rate_limit_buckets"
  ("scope", "identifierHash", "windowStart", "count", "expiresAt", "createdAt")
VALUES
  ($scope, $identifierHash, $windowStart, 1, $expiresAt, CURRENT_TIMESTAMP)
ON CONFLICT ("scope", "identifierHash", "windowStart")
DO UPDATE SET
  "count" = "rate_limit_buckets"."count" + 1,
  "expiresAt" = GREATEST("rate_limit_buckets"."expiresAt", EXCLUDED."expiresAt")
RETURNING "count";
```

Its cleanup method must use a CTE ordered by expiry, limit the candidate rows
to the supplied maximum, delete by all three key columns, and return the
deleted count. Export `prismaRateLimitStore`.

- [ ] **Step 8: Add policies and application-facing helpers**

Create `lib/security/rate-limit.ts`:

```ts
import { getServerEnv } from "@/lib/env";
import { consumeRateLimit } from "@/lib/security/rate-limit-core";
import { prismaRateLimitStore } from "@/lib/security/rate-limit-store";

export const RATE_LIMIT_MESSAGE = "Too many requests. Please try again shortly.";

export const policies = {
  loginIp: { scope: "login:ip", limit: 20, windowMs: 15 * 60_000 },
  loginEmail: { scope: "login:email", limit: 5, windowMs: 15 * 60_000 },
  registerIp: { scope: "register:ip", limit: 5, windowMs: 60 * 60_000 },
  registerEmail: { scope: "register:email", limit: 3, windowMs: 60 * 60_000 },
  mutationUser: { scope: "mutation:user", limit: 60, windowMs: 60_000 },
  exportUser: { scope: "export:user", limit: 10, windowMs: 60_000 }
} as const;
```

Export a `checkPolicy(policy, identifier)` wrapper that injects
`prismaRateLimitStore` and `getServerEnv().NEXTAUTH_SECRET`. Export
`checkAuthenticatedMutation(userId)` and `checkExport(userId)`. Keep auth
two-bucket orchestration for Task 5.

- [ ] **Step 9: Verify the store and policies are GREEN**

```bash
npm run test:run -- tests/rate-limit.test.ts
npm run test:integration
```

Expected: atomic counts are unique and continuous; cleanup is bounded at 500.

- [ ] **Step 10: Run full verification and commit**

Run:

```bash
npx prisma validate
npm run test:run
npm run test:integration
npm run typecheck
git diff --check
```

Then:

```bash
git add lib/security prisma package.json tests/rate-limit.test.ts tests/integration/rate-limit.integration.test.ts vitest.integration.config.ts
git commit -m "feat: add distributed database rate limiting"
```

---

### Task 5: Protect Login and Registration

**Files:**
- Create: `tests/auth.test.ts`
- Create: `tests/auth.actions.test.ts`
- Modify: `lib/security/rate-limit.ts`
- Modify: `lib/auth.ts`
- Modify: `lib/actions/auth.ts`

**Interfaces:**
- Consumes: `checkPolicy`, login/register policies, validated environment.
- Produces: `checkLoginAttempt(headers, email)` and
  `checkRegistrationAttempt(headers, email)` returning `RateLimitDecision`.

- [ ] **Step 1: Write failing auth orchestration tests**

In `tests/auth.test.ts`, mock `checkPolicy` and verify:

```ts
it("stops login after the IP bucket denies without checking email or user", async () => {
  checkPolicy.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
  const result = await authorizeCredentials(
    { email: "user@example.com", password: "password123" },
    { headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.1" } }
  );
  expect(result).toBeNull();
  expect(checkPolicy).toHaveBeenCalledTimes(1);
  expect(prisma.user.findUnique).not.toHaveBeenCalled();
});
```

Also verify the first forwarded IP is used, the normalized email is the second
bucket, denial returns `null`, and allowed requests preserve the existing
generic invalid-credential behavior.

In `tests/auth.actions.test.ts`, verify an exhausted registration IP returns
`{ error: RATE_LIMIT_MESSAGE }` before duplicate lookup, bcrypt, transaction,
or category seeding.

- [ ] **Step 2: Run auth tests to verify RED**

Run:

```bash
npm run test:run -- tests/auth.test.ts tests/auth.actions.test.ts
```

Expected: FAIL because the auth attempt helpers and exported authorization
function do not exist.

- [ ] **Step 3: Implement header parsing and two-bucket checks**

Add to `lib/security/rate-limit.ts`:

```ts
type HeaderSource = Headers | Record<string, string | string[] | undefined>;

export function getClientIp(headers: HeaderSource): string {
  const read = (key: string) =>
    headers instanceof Headers ? headers.get(key) : headers[key];
  const forwarded = read("x-forwarded-for");
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value?.split(",")[0]?.trim()) return value.split(",")[0].trim();
  const real = read("x-real-ip");
  return (Array.isArray(real) ? real[0] : real)?.trim() || "unknown-client";
}
```

`checkLoginAttempt` checks `loginIp` first and returns immediately on denial,
then checks `loginEmail`. `checkRegistrationAttempt` follows the same order
with registration policies. Normalize the email with `trim().toLowerCase()`
before both the bucket and user lookup.

- [ ] **Step 4: Integrate credential authorization**

Extract the existing `authorize` body into an exported
`authorizeCredentials(credentials, request)` function in `lib/auth.ts`.
Validate credentials first, then call `checkLoginAttempt` before user lookup
or bcrypt. Any limiter denial or limiter unavailability returns `null`.
Configure `CredentialsProvider({ authorize: authorizeCredentials })`.

- [ ] **Step 5: Integrate registration**

In `registerUser`, parse and normalize input, then await `headers()` and call
`checkRegistrationAttempt`. Return `{ error: RATE_LIMIT_MESSAGE }` on denial.
Only after allowance may duplicate lookup, hashing, and the transaction run.
Catch Prisma unique-constraint error `P2002` and return the existing duplicate
account message so concurrent registration does not expose an internal error.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run test:run -- tests/auth.test.ts tests/auth.actions.test.ts
npm run test:run
npm run typecheck
npm run build
git diff --check
```

Expected: focused auth tests, full suite, typecheck, and build pass. Login and
registration expose no limiter or database details.

- [ ] **Step 7: Commit**

```bash
git add lib/auth.ts lib/actions/auth.ts lib/security/rate-limit.ts tests/auth.test.ts tests/auth.actions.test.ts
git commit -m "feat: rate limit authentication attempts"
```

---

### Task 6: Protect General Authenticated Mutations

**Files:**
- Modify: `lib/actions/categories.ts`
- Modify: `lib/actions/money-sources.ts`
- Modify: `lib/actions/projects.ts`
- Modify: `lib/actions/goals.ts`
- Modify: `lib/actions/goal-contributions.ts`
- Modify: `tests/categories.actions.test.ts`
- Modify: `tests/money-sources.actions.test.ts`
- Create: `tests/projects.actions.test.ts`
- Create: `tests/goals.actions.test.ts`
- Modify: `tests/goal-contributions.actions.test.ts`

**Interfaces:**
- Consumes: `checkAuthenticatedMutation(userId)` and `RATE_LIMIT_MESSAGE`.
- Produces: generic `{ ok: false, error: RATE_LIMIT_MESSAGE }` denial from the
  underlying action without executing business queries or writes.

- [ ] **Step 1: Add failing denial tests for each domain**

In each affected action test file, mock:

```ts
vi.mock("@/lib/security/rate-limit", () => ({
  checkAuthenticatedMutation: vi.fn(async () => ({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  })),
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly."
}));
```

Add one denial test per domain. Set the mock to `allowed: false`, call a create
or update action, assert the exact generic error, and assert that the domain’s
first Prisma business method was not called. Include an additional
money-source test proving `toggleMoneySourceActiveFormAction` consumes only the
single token in `updateMoneySource`, not a wrapper token.

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```bash
npm run test:run -- tests/categories.actions.test.ts tests/money-sources.actions.test.ts tests/projects.actions.test.ts tests/goals.actions.test.ts tests/goal-contributions.actions.test.ts
```

Expected: new denial expectations fail because actions continue to Prisma.

- [ ] **Step 3: Add the guard to underlying actions**

Immediately after `requireAuth()` in each underlying create, update, and delete
action, add:

```ts
const rateLimit = await checkAuthenticatedMutation(user.id);
if (!rateLimit.allowed) {
  return { ok: false, error: RATE_LIMIT_MESSAGE };
}
```

Apply it to:

- `createCategory`, `updateCategory`, `deleteCategory`
- `createMoneySource`, `updateMoneySource`, `deleteMoneySource`
- `createProject`, `updateProject`, `deleteProject`
- `createGoal`, `updateGoal`, `deleteGoal`
- `createContribution`, `updateContribution`, `deleteContribution`

Do not add guards to form wrappers, list/get loaders, ownership helpers, or
activity-log helpers. The money-source toggle wrapper inherits exactly one
guard through `updateMoneySource`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm run test:run -- tests/categories.actions.test.ts tests/money-sources.actions.test.ts tests/projects.actions.test.ts tests/goals.actions.test.ts tests/goal-contributions.actions.test.ts
npm run test:run
npm run typecheck
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add lib/actions/categories.ts lib/actions/money-sources.ts lib/actions/projects.ts lib/actions/goals.ts lib/actions/goal-contributions.ts tests
git commit -m "feat: rate limit authenticated CRUD mutations"
```

---

### Task 7: Protect Financial and Settings Mutations

**Files:**
- Modify: `lib/actions/transactions.ts`
- Modify: `lib/actions/renewals.ts`
- Modify: `lib/actions/settings.ts`
- Modify: `tests/transactions.actions.test.ts`
- Modify: `tests/renewals.actions.test.ts`
- Create: `tests/settings.actions.test.ts`

**Interfaces:**
- Consumes: `checkAuthenticatedMutation(userId)` and `RATE_LIMIT_MESSAGE`.
- Produces: the same generic denial shapes as existing transaction, renewal,
  and settings actions.

- [ ] **Step 1: Write failing denial tests**

Mock the rate-limit module as in Task 6. Add tests proving:

- `createTransaction` denial prevents referenced-record and transaction writes.
- `markRenewalAsPaid` denial prevents both recurring-payment and transaction
  writes.
- A status action such as `pauseRenewal` consumes one token in the internal
  status helper; its form wrapper consumes none.
- `updateUserSettings` returns `{ error: RATE_LIMIT_MESSAGE }` before user
  lookup, bcrypt, or transaction.

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```bash
npm run test:run -- tests/transactions.actions.test.ts tests/renewals.actions.test.ts tests/settings.actions.test.ts
```

Expected: denial tests fail because business work still runs.

- [ ] **Step 3: Guard transaction mutations**

Add the guard immediately after `requireAuth()` in:

- `createTransaction`
- `updateTransaction`
- `deleteTransaction`

Return the existing `TransactionActionResult` failure shape. Do not guard
transaction loaders or parsing helpers.

- [ ] **Step 4: Guard renewal mutations once per operation**

Add the guard after `requireAuth()` in:

- `createRenewal`
- `updateRenewal`
- `markRenewalAsPaid`
- `skipRenewalCycle`
- internal `updateRenewalStatus`
- `deleteRenewal`

Do not add guards to `pauseRenewal`, `resumeRenewal`, `cancelRenewal`, or form
wrappers because those delegate to the guarded status helper.

- [ ] **Step 5: Guard settings mutation**

After `requireAuth()` in `updateUserSettings`:

```ts
const rateLimit = await checkAuthenticatedMutation(user.id);
if (!rateLimit.allowed) {
  return { error: RATE_LIMIT_MESSAGE };
}
```

Do not guard `getUserSettings`.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run test:run -- tests/transactions.actions.test.ts tests/renewals.actions.test.ts tests/settings.actions.test.ts
npm run test:run
npm run typecheck
git diff --check
```

- [ ] **Step 7: Commit**

```bash
git add lib/actions/transactions.ts lib/actions/renewals.ts lib/actions/settings.ts tests
git commit -m "feat: rate limit financial and settings mutations"
```

---

### Task 8: Protect CSV Export and Document Vercel Release Operations

**Files:**
- Create: `tests/export.route.test.ts`
- Modify: `app/api/export/transactions/route.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `checkExport(userId)`, `RATE_LIMIT_MESSAGE`, and the existing
  authenticated CSV route.
- Produces: HTTP 429 with integer `Retry-After`; complete Neon/Vercel release
  instructions using only the approved environment variables.

- [ ] **Step 1: Write the failing export denial test**

Create `tests/export.route.test.ts`. Mock `requireAuth`, `checkExport`, and
Prisma. With `checkExport` denied:

```ts
const response = await GET(
  new Request("http://localhost/api/export/transactions")
);

expect(response.status).toBe(429);
expect(response.headers.get("Retry-After")).toBe("30");
await expect(response.text()).resolves.toBe(
  "Too many requests. Please try again shortly."
);
expect(prisma.transaction.findMany).not.toHaveBeenCalled();
expect(prisma.activityLog.create).not.toHaveBeenCalled();
```

Retain a test proving unauthenticated requests remain 401 before rate-limit
consumption and an allowed test proving CSV output and activity logging remain
unchanged.

- [ ] **Step 2: Run the route test to verify RED**

Run:

```bash
npm run test:run -- tests/export.route.test.ts
```

Expected: the denied request does not return 429.

- [ ] **Step 3: Integrate export limiting**

After authentication and before parsing/querying:

```ts
const rateLimit = await checkExport(user.id);
if (!rateLimit.allowed) {
  return new NextResponse(RATE_LIMIT_MESSAGE, {
    status: 429,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(rateLimit.retryAfterSeconds)
    }
  });
}
```

Do not consume export tokens for unauthenticated requests.

- [ ] **Step 4: Complete README deployment guidance**

Document:

- Node.js 22 and `npm ci`
- exact `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` setup for local,
  Vercel Preview, and Vercel Production
- separate Preview and Production databases/secrets
- Neon pooled `-pooler` application URL
- `npm run prisma:deploy` as the release migration command
- `npm run verify` before deployment
- Vercel Function Region selected in project settings only after matching the
  actual Neon region
- Vercel Hobby’s personal/non-commercial boundary
- post-deployment smoke checks: register, login, logout, session persistence,
  protected route after logout, representative write/read, CSV export, 429,
  and response headers

Do not add Vercel or Neon credentials to the repository.

- [ ] **Step 5: Verify GREEN and the complete phase locally**

Run:

```bash
npm run test:run -- tests/export.route.test.ts
npm run lint
npm run typecheck
npm run test:run
npm run test:integration
npx prisma validate
npm audit --omit=dev --audit-level=high
npm run build
git diff --check
```

- [ ] **Step 6: Verify the disposable database migration**

Run:

```bash
npm run prisma:deploy
npx prisma migrate status
```

Expected: all migrations are applied and the database is up to date.

- [ ] **Step 7: Commit**

```bash
git add app/api/export/transactions/route.ts tests/export.route.test.ts README.md
git commit -m "feat: protect exports and document Vercel release"
```

---

## Whole-Phase Verification

After every task review is clean, run from a clean install under Node 22:

```bash
npm ci
npx prisma validate
npm run lint
npm run typecheck
npm run test:run
npm run test:integration
npm audit --omit=dev --audit-level=high
npm run build
npm run prisma:deploy
npx prisma migrate status
git diff --check
git status --short
```

Start the production build locally and verify:

```bash
npm run start
curl -I http://localhost:3000/
curl -i http://localhost:3000/api/export/transactions
```

Expected: global security headers are present and unauthenticated export
remains 401.

If Vercel credentials and a linked project are available, deploy the reviewed
branch as Preview and execute the README smoke checklist. If external access
is unavailable, record Preview deployment as unverified; do not represent it
as passing.
