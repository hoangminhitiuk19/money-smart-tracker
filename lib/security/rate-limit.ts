import { getServerEnv } from "@/lib/env";
import {
  consumeRateLimit,
  type RateLimitDecision,
  type RateLimitPolicy
} from "@/lib/security/rate-limit-core";
import { prismaRateLimitStore } from "@/lib/security/rate-limit-store";

export const RATE_LIMIT_MESSAGE = "Too many requests. Please try again shortly.";

export type HeaderSource =
  | Headers
  | Record<string, string | string[] | undefined>;

export const policies = {
  loginIp: { scope: "login:ip", limit: 20, windowMs: 15 * 60_000 },
  loginEmail: { scope: "login:email", limit: 5, windowMs: 15 * 60_000 },
  registerIp: { scope: "register:ip", limit: 5, windowMs: 60 * 60_000 },
  registerEmail: { scope: "register:email", limit: 3, windowMs: 60 * 60_000 },
  mutationUser: { scope: "mutation:user", limit: 60, windowMs: 60_000 },
  exportUser: { scope: "export:user", limit: 10, windowMs: 60_000 }
} as const;

export function checkPolicy(policy: RateLimitPolicy, identifier: string) {
  return consumeRateLimit(policy, identifier, {
    store: prismaRateLimitStore,
    secret: getServerEnv().NEXTAUTH_SECRET
  });
}

export function getClientIp(headers: HeaderSource): string {
  const read = (key: string) =>
    headers instanceof Headers ? headers.get(key) : headers[key];
  const forwarded = read("x-forwarded-for");
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstForwarded = value?.split(",")[0]?.trim();

  if (firstForwarded) {
    return firstForwarded;
  }

  const real = read("x-real-ip");
  return (Array.isArray(real) ? real[0] : real)?.trim() || "unknown-client";
}

async function checkAuthAttempt(
  headers: HeaderSource,
  email: string,
  ipPolicy: RateLimitPolicy,
  emailPolicy: RateLimitPolicy,
  policyChecker: typeof checkPolicy
): Promise<RateLimitDecision> {
  const ipDecision = await policyChecker(ipPolicy, getClientIp(headers));

  if (!ipDecision.allowed) {
    return ipDecision;
  }

  return policyChecker(emailPolicy, email.trim().toLowerCase());
}

export function checkLoginAttempt(
  headers: HeaderSource,
  email: string,
  policyChecker = checkPolicy
) {
  return checkAuthAttempt(
    headers,
    email,
    policies.loginIp,
    policies.loginEmail,
    policyChecker
  );
}

export function checkRegistrationAttempt(
  headers: HeaderSource,
  email: string,
  policyChecker = checkPolicy
) {
  return checkAuthAttempt(
    headers,
    email,
    policies.registerIp,
    policies.registerEmail,
    policyChecker
  );
}

export function checkAuthenticatedMutation(userId: string) {
  return checkPolicy(policies.mutationUser, userId);
}

export function checkExport(userId: string) {
  return checkPolicy(policies.exportUser, userId);
}
