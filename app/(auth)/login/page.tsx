"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters.")
});

type LoginFormValues = z.infer<typeof loginSchema>;
type CredentialsSignInResult = {
  error?: string | null;
};

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

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register
  } = useForm<LoginFormValues>({
    defaultValues: {
      email: "",
      password: ""
    }
  });

  async function onSubmit(values: LoginFormValues) {
    setFormError(null);
    const parsed = loginSchema.safeParse(values);

    if (!parsed.success) {
      setFormError("Enter a valid email and password.");
      return;
    }

    const result = (await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false
    })) as CredentialsSignInResult | undefined;

    if (result?.error) {
      setFormError("Invalid email or password.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <AuthBrand />
      <Card>
        <h1 className="text-2xl font-semibold text-slate-950">Log in</h1>
        {searchParams.get("registered") ? (
          <p className="mt-3 rounded-md border border-income/20 bg-income/10 px-3 py-2 text-sm text-income">
            Account created. Log in to continue.
          </p>
        ) : null}
        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <Input
              className="mt-1"
              type="email"
              autoComplete="email"
              {...register("email")}
            />
            {errors.email ? (
              <span className="mt-1 block text-sm text-expense">
                {errors.email.message}
              </span>
            ) : null}
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <Input
              className="mt-1"
              type="password"
              autoComplete="current-password"
              {...register("password")}
            />
            {errors.password ? (
              <span className="mt-1 block text-sm text-expense">
                {errors.password.message}
              </span>
            ) : null}
          </label>
          {formError ? (
            <p className="text-sm text-expense">{formError}</p>
          ) : null}
          <Button className="w-full" disabled={isSubmitting} loading={isSubmitting} type="submit">
            Log in
          </Button>
        </form>
      </Card>
      <p className="mt-6 text-center text-sm text-slate-600">
        No account yet?{" "}
        <Link className="font-medium text-primary hover:text-indigo-700" href="/register">
          Register
        </Link>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
          <AuthBrand />
          <h1 className="text-center text-2xl font-semibold text-slate-950">Log in</h1>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
