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
