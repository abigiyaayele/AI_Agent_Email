import { env } from "@/lib/env";

export type EmailMessage = { to: string; subject: string; text: string };
export interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<void>;
}

/** Logs instead of sending; handy in development. */
const consoleProvider: EmailProvider = {
  name: "console",
  async send(msg) {
    console.info(`[email] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.text}`);
  },
};

/** Resend HTTP API (https://resend.com). Swap this adapter to use another provider. */
function resendProvider(apiKey: string, from: string): EmailProvider {
  return {
    name: "resend",
    async send(msg) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

export function emailProvider(): EmailProvider | null {
  const e = env();
  if (e.EMAIL_PROVIDER === "console") return consoleProvider;
  if (e.EMAIL_PROVIDER === "resend" && e.RESEND_API_KEY) {
    return resendProvider(e.RESEND_API_KEY, e.EMAIL_FROM || "GoalFlow <onboarding@resend.dev>");
  }
  return null;
}
