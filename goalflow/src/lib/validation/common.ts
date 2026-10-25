import { z } from "zod";

export const uuid = z.string().uuid();
export const optionalUuid = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .pipe(z.string().uuid().nullable());

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date (YYYY-MM-DD)");
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:30");

/** Form helpers: HTML forms send "" for empty inputs. */
export const optionalNumber = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
  .refine((v) => v === null || Number.isFinite(v), "Must be a number");

export const optionalInt = optionalNumber.refine((v) => v === null || Number.isInteger(v), "Must be a whole number");

export const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.boolean(), z.null()])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

export const trimmed = (max: number) => z.string().trim().max(max);

export type ActionResult<T = unknown> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; conflicts?: { label: string; start: string; end: string }[] };

export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function formToObject(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      out[key] = [...((out[key] as string[] | undefined) ?? []), v];
    } else out[k] = v;
  }
  return out;
}
