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

type RateLimitDependencies = {
  store: RateLimitStore;
  secret: string;
  now?: () => Date;
};

const DAY_MS = 24 * 60 * 60_000;
const CLEANUP_LIMIT = 500;

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

export async function consumeRateLimit(
  policy: RateLimitPolicy,
  identifier: string,
  dependencies: RateLimitDependencies
): Promise<RateLimitDecision> {
  const now = dependencies.now?.() ?? new Date();
  const windowStartMs = Math.floor(now.getTime() / policy.windowMs) * policy.windowMs;
  const windowEndMs = windowStartMs + policy.windowMs;
  const retryAfterSeconds = Math.ceil((windowEndMs - now.getTime()) / 1_000);

  let count: number;
  try {
    count = await dependencies.store.consume({
      scope: policy.scope,
      identifierHash: hashRateLimitIdentifier(
        policy.scope,
        identifier,
        dependencies.secret
      ),
      windowStart: new Date(windowStartMs),
      expiresAt: new Date(windowEndMs + DAY_MS)
    });
  } catch {
    return {
      allowed: false,
      unavailable: true,
      limit: policy.limit,
      remaining: 0,
      retryAfterSeconds
    };
  }

  const decision = {
    allowed: count <= policy.limit,
    unavailable: false,
    limit: policy.limit,
    remaining: Math.max(policy.limit - count, 0),
    retryAfterSeconds
  };

  if (count === 1) {
    try {
      await dependencies.store.cleanupExpired(now, CLEANUP_LIMIT);
    } catch {
      // Cleanup is best-effort and must not change the counter decision.
    }
  }

  return decision;
}
