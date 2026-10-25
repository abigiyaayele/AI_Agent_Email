"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { fieldErrors, formToObject, type ActionResult } from "@/lib/validation/common";
import { LoginSchema, RegisterSchema } from "@/lib/validation/account";
import { rateLimit } from "@/server/auth/rate-limit";
import { createSession, destroySession } from "@/server/auth/session";
import { AccountError, authenticate, registerUser } from "@/server/services/account";

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function registerAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const parsed = RegisterSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  if (!(await rateLimit(`register:${await clientIp()}`, 10, 3600))) {
    return { ok: false, error: "Too many sign-up attempts. Try again later." };
  }
  try {
    const user = await registerUser(parsed.data);
    await createSession(user.id);
  } catch (err) {
    if (err instanceof AccountError) return { ok: false, error: err.message };
    throw err;
  }
  redirect("/settings?welcome=1");
}

export async function loginAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const parsed = LoginSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const ip = await clientIp();
  const allowed =
    (await rateLimit(`login:ip:${ip}`, 30, 900)) && (await rateLimit(`login:email:${parsed.data.email}`, 10, 900));
  if (!allowed) return { ok: false, error: "Too many sign-in attempts. Wait 15 minutes and try again." };
  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) return { ok: false, error: "Email or password is incorrect." };
  await createSession(user.id);
  const next = String(fd.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
