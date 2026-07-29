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
