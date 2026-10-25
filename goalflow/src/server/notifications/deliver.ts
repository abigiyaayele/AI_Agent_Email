import { eq } from "drizzle-orm";
import webpush from "web-push";
import type { Channel } from "@/lib/constants";
import { env, features } from "@/lib/env";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { emailProvider } from "./email";

let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return true;
  const e = env();
  if (!e.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(e.VAPID_SUBJECT || "mailto:admin@example.com", e.NEXT_PUBLIC_VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY);
  vapidReady = true;
  return true;
}

/**
 * Deliver a stored notification to external channels. In-app delivery is the stored row itself.
 * Failures are recorded on the notification (visible in history) and never thrown.
 */
export async function deliverNotification(n: s.Notification, channels: Channel[]) {
  const delivered = new Set<Channel>(n.deliveredChannels);
  const errors: Record<string, string> = {};
  const url = new URL(n.url ?? "/notifications", env().APP_URL).toString();

  if (channels.includes("push") && features().push && ensureVapid()) {
    const subs = await db().select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.userId, n.userId));
    const payload = JSON.stringify({ title: n.title, body: n.body, url, tag: n.id });
    let sent = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600 });
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await db().delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.id, sub.id));
        } else {
          errors.push = String((err as Error).message ?? err).slice(0, 200);
        }
      }
    }
    if (sent > 0) delivered.add("push");
    else if (!subs.length) errors.push = "No devices subscribed to push";
  }

  if (channels.includes("email")) {
    const provider = emailProvider();
    if (!provider) {
      errors.email = "Email delivery is not configured";
    } else {
      const [prefs] = await db().select().from(s.userPreferences).where(eq(s.userPreferences.userId, n.userId));
      if (prefs?.emailReminders) {
        const [user] = await db().select({ email: s.users.email }).from(s.users).where(eq(s.users.id, n.userId));
        try {
          await provider.send({
            to: user!.email,
            subject: n.title,
            text: `${n.body}\n\nOpen GoalFlow: ${url}`,
          });
          delivered.add("email");
        } catch (err) {
          errors.email = String((err as Error).message ?? err).slice(0, 200);
        }
      } else {
        errors.email = "Email reminders are turned off in settings";
      }
    }
  }

  await db()
    .update(s.notifications)
    .set({ deliveredChannels: [...delivered], deliveryErrors: Object.keys(errors).length ? errors : null })
    .where(eq(s.notifications.id, n.id));
}
