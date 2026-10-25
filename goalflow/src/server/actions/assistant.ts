"use server";

import { rateLimit } from "@/server/auth/rate-limit";
import { requireAuth } from "@/server/auth/session";
import { aiAdvice, type AiAdvice } from "@/server/services/assistant";

export async function aiAdviceAction(): Promise<AiAdvice | { error: string }> {
  const { user, prefs } = await requireAuth();
  if (!(await rateLimit(`ai:${user.id}`, 30, 3600))) return { error: "You've asked the AI a lot this hour. Please try again later." };
  return aiAdvice(user.id, prefs);
}
