import { z } from "zod";

const databaseUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
    message: "DATABASE_URL must be a PostgreSQL URL."
  });

const nextAuthUrlSchema = z.string().url().refine(
  (value) => value.startsWith("http://") || value.startsWith("https://"),
  { message: "NEXTAUTH_URL must be an absolute HTTP(S) URL." }
);

const inboundKeys = [
  "INBOUND_EMAIL_API_KEY",
  "INBOUND_EMAIL_WEBHOOK_SECRET",
  "INBOUND_EMAIL_DOMAIN"
] as const;

const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .refine(
    (value) =>
      !value.includes("/") &&
      !value.includes("@") &&
      !value.includes(":") &&
      value.split(".").every(
        (label) =>
          label.length >= 1 &&
          label.length <= 63 &&
          /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
      ),
    { message: "INBOUND_EMAIL_DOMAIN must be a hostname." }
  );

const schema = z.object({
  DATABASE_URL: databaseUrlSchema,
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: nextAuthUrlSchema,
  INBOUND_EMAIL_API_KEY: z.string().trim().min(1).optional(),
  INBOUND_EMAIL_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
  INBOUND_EMAIL_DOMAIN: hostnameSchema.optional()
}).superRefine((value, context) => {
  const present = inboundKeys.filter((key) => value[key] !== undefined);
  if (present.length !== 0 && present.length !== inboundKeys.length) {
    for (const key of inboundKeys) {
      context.addIssue({
        code: "custom",
        path: [key],
        message: `${inboundKeys.join(", ")} must be configured together.`
      });
    }
  }
});

export type ServerEnv = z.infer<typeof schema>;

export type InboundEmailConfig = {
  apiKey: string;
  webhookSecret: string;
  domain: string;
};

export function parseServerEnv(source: NodeJS.ProcessEnv): ServerEnv {
  for (const key of ["AUTH_SECRET", "AUTH_URL"] as const) {
    if (source[key] !== undefined) {
      throw new Error(`Remove forbidden environment variable ${key}.`);
    }
  }

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = Array.from(new Set(parsed.error.issues.map((issue) => issue.path[0])));
    throw new Error(`Invalid server environment: ${fields.join(", ")}.`);
  }
  return parsed.data;
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export function getInboundEmailConfig(
  env: ServerEnv = getServerEnv()
): InboundEmailConfig | null {
  if (
    !env.INBOUND_EMAIL_API_KEY ||
    !env.INBOUND_EMAIL_WEBHOOK_SECRET ||
    !env.INBOUND_EMAIL_DOMAIN
  ) {
    return null;
  }
  return {
    apiKey: env.INBOUND_EMAIL_API_KEY,
    webhookSecret: env.INBOUND_EMAIL_WEBHOOK_SECRET,
    domain: env.INBOUND_EMAIL_DOMAIN
  };
}
