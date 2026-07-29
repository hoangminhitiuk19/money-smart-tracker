import { getServerEnv } from "@/lib/env";
import {
  consumeRateLimit,
  type RateLimitPolicy
} from "@/lib/security/rate-limit-core";
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

export function checkPolicy(policy: RateLimitPolicy, identifier: string) {
  return consumeRateLimit(policy, identifier, {
    store: prismaRateLimitStore,
    secret: getServerEnv().NEXTAUTH_SECRET
  });
}

export function checkAuthenticatedMutation(userId: string) {
  return checkPolicy(policies.mutationUser, userId);
}

export function checkExport(userId: string) {
  return checkPolicy(policies.exportUser, userId);
}
