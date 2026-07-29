"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { registerUser } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

function AuthBrand() {
  return (
    <Link className="mb-8 flex items-center justify-center gap-2.5" href="/">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
        M
      </span>
      <span className="text-[15px] font-semibold text-slate-950">
        Money Quality Tracker
      </span>
    </Link>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button className="w-full" disabled={pending} loading={pending} type="submit">
      Create account
    </Button>
  );
}

export default function RegisterPage() {
  const [state, formAction] = useActionState(registerUser, {});

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <AuthBrand />
      <Card>
        <h1 className="text-2xl font-semibold text-slate-950">Register</h1>
        <form className="mt-6 space-y-4" action={formAction}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <Input
              className="mt-1"
              name="name"
              type="text"
              autoComplete="name"
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <Input
              className="mt-1"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <Input
              className="mt-1"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          {state.error ? (
            <p className="text-sm text-expense">{state.error}</p>
          ) : null}
          <SubmitButton />
        </form>
      </Card>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link className="font-medium text-primary hover:text-indigo-700" href="/login">
          Log in
        </Link>
      </p>
    </main>
  );
}
