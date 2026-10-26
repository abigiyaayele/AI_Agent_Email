import { z } from "zod";

/**
 * Server-side environment, validated once. Optional integrations (push, email, AI)
 * are allowed to be missing; the app degrades gracefully and reports what is off.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().url().default("http://localhost:3002"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CRON_SECRET: z.string().optional(),
  INPROCESS_SCHEDULER: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  EMAIL_PROVIDER: z.enum(["resend", "console", ""]).optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  AI_PROVIDER: z.enum(["anthropic", "none", ""]).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export class MissingConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`GoalFlow is not configured: ${issues.join("; ")}`);
    this.name = "MissingConfigError";
  }
}

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new MissingConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  cached = parsed.data;
  return cached;
}

export function features() {
  const e = env();
  return {
    push: Boolean(e.NEXT_PUBLIC_VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY),
    email: Boolean(e.EMAIL_PROVIDER === "console" || (e.EMAIL_PROVIDER === "resend" && e.RESEND_API_KEY)),
    ai: e.AI_PROVIDER !== "none" && e.AI_PROVIDER !== "" && Boolean(e.ANTHROPIC_API_KEY),
    cron: Boolean(e.CRON_SECRET),
  };
}
