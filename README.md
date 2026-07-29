# Money Smart Tracker

Next.js 15 App Router project with React 19, TypeScript, Tailwind CSS, Prisma, NextAuth v4, React Hook Form, Zod, Recharts, bcryptjs, and Vitest.

## Prerequisites

- Node.js 22

## Environment

Copy the example environment file before running the app:

```bash
cp .env.example .env
```

Fill in the values for:

```bash
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
```

Do not commit `.env` or any file containing real secret values.

## Vercel and Neon release runbook

Use Node.js 22 and a clean dependency install for every local or CI release
check:

```bash
npm ci
npm run verify
```

Configure only these environment variables in each environment:

| Environment | Required variables | Notes |
| --- | --- | --- |
| Local | `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Keep values in the uncommitted `.env` file. |
| Vercel Preview | `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Configure these with Vercel's [Preview environment targeting](https://vercel.com/docs/environment-variables). Use a Preview-only database and secret. |
| Vercel Production | `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Configure these with Vercel's [Production environment targeting](https://vercel.com/docs/environment-variables). Use a separate Production database and secret. |

For application traffic, use Neon’s pooled connection URL: its hostname includes
`-pooler`. See Neon’s [connection-pooling guidance](https://neon.com/docs/connect/connection-pooling).
Never commit database URLs or secret values.

Before deploying, run `npm run verify`. During the release, run migrations with:

```bash
npm run prisma:deploy
```

After the actual Neon region is known, select the matching Vercel Function
Region in project **Settings → Functions**; see Vercel’s [function-region
documentation](https://vercel.com/docs/functions/configuring-functions/region).
Vercel [Hobby](https://vercel.com/docs/plans/hobby) is for personal,
non-commercial use; choose an eligible plan before using it for other work.

After deployment, smoke test registration, login, logout, session persistence,
access to a protected route after logout, a representative write and read, CSV
export, a rate-limited CSV export returning 429, and the response headers.

## Prisma

Run migrations against your PostgreSQL database:

```bash
npm run prisma:migrate
```

This runs:

```bash
npx prisma migrate dev
```

## Development

Install dependencies:

```bash
npm ci
```

Run the dev server:

```bash
npm run dev
```

## Tests

Run the test suite:

```bash
npm run test:run
```
