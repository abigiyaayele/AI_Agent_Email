import Link from "next/link";
import { Card, CardHeader, PageHeader, cn } from "@/components/ui";
import { MarkAllRead, NotificationList, ReminderForm, ReminderList, type NotificationItem, type ReminderItem } from "@/components/notifications/inbox";
import type { Channel } from "@/lib/constants";
import { features } from "@/lib/env";
import { formatInstant, todayIn } from "@/lib/domain/periods";
import { describeRule } from "@/lib/domain/recurrence";
import { requireAuth } from "@/server/auth/session";
import { listNotifications, listReminders } from "@/server/services/reminders";

export const metadata = { title: "Notifications" };

const TABS = [
  ["inbox", "Inbox"],
  ["reminders", "Reminders"],
  ["history", "History"],
] as const;

const SYSTEM_SCHEDULE: Record<string, string> = {
  daily_plan: "Every day at your planning time",
  daily_review: "Every day at your review time",
  weekly_review: "Weekly, on your review day",
  monthly_review: "Last day of each month",
  quarterly_review: "Last day of each quarter",
  half_review: "End of June and December",
  yearly_review: "31 December",
};

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user, prefs } = await requireAuth();
  const tz = prefs.timezone;
  const sp = await searchParams;
  const tab = TABS.some(([t]) => t === sp.tab) ? sp.tab! : "inbox";
  const f = features();
  const available: Record<Channel, boolean> = { in_app: true, push: f.push, email: f.email && prefs.emailReminders };

  const toItem = (n: Awaited<ReturnType<typeof listNotifications>>[number]): NotificationItem => ({
    id: n.id,
    title: n.title,
    body: n.body,
    url: n.url,
    when: formatInstant(n.createdAt, tz, "EEE d LLL, HH:mm"),
    read: Boolean(n.readAt),
    dismissed: Boolean(n.dismissedAt),
    channels: n.deliveredChannels,
    errors: n.deliveryErrors && Object.keys(n.deliveryErrors).length ? n.deliveryErrors : null,
  });

  let body: React.ReactNode;
  if (tab === "reminders") {
    const rows = await listReminders(user.id);
    const items: ReminderItem[] = rows.map(({ reminder: r, rule, taskTitle }) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      schedule: rule
        ? `${describeRule(rule)} at ${rule.startLocal.slice(11, 16)}`
        : r.kind === "task_start" || r.kind === "deadline"
          ? `${r.offsetMinutes ?? 0} min before ${r.kind === "deadline" ? "deadline" : "start"}${taskTitle ? ` of “${taskTitle}”` : ""}`
          : (SYSTEM_SCHEDULE[r.kind] ?? "One-off"),
      next: r.nextFireAt ? formatInstant(r.nextFireAt, tz, "EEE d LLL, HH:mm") : null,
      active: r.active,
      channels: r.channels,
      href: r.taskId ? `/tasks/${r.taskId}` : null,
      system: r.kind !== "custom" && !r.taskId,
    }));
    body = (
      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Your reminders" subtitle="Planning and review reminders follow the times in Settings." />
          <ReminderList items={items} available={available} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="New reminder" />
          <ReminderForm today={todayIn(tz)} available={available} />
        </Card>
      </div>
    );
  } else {
    const all = await listNotifications(user.id, tab === "history" ? 300 : 100);
    const items = (tab === "history" ? all : all.filter((n) => !n.dismissedAt)).map(toItem);
    body = (
      <Card>
        <CardHeader
          title={tab === "history" ? "Notification history" : "Inbox"}
          subtitle={tab === "history" ? "Everything GoalFlow has sent you, including dismissed items and delivery problems." : undefined}
          action={tab === "inbox" && items.some((i) => !i.read) ? <MarkAllRead /> : null}
        />
        <NotificationList items={items} empty={tab === "history" ? "Nothing has been sent yet." : "You're all caught up."} />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Notifications" subtitle="In-app notifications always work while GoalFlow is open. Push and email depend on your device and server setup." />
      <div className="flex gap-1.5 text-sm" role="tablist" aria-label="Notification sections">
        {TABS.map(([t, l]) => (
          <Link key={t} role="tab" aria-selected={tab === t} href={`/notifications?tab=${t}`} className={cn("rounded-lg border px-3 py-1", tab === t ? "border-accent bg-accent-soft text-accent" : "border-border")}>
            {l}
          </Link>
        ))}
      </div>
      {body}
      <p className="text-xs text-muted">
        Browsers can delay or drop notifications when the device sleeps or the tab is closed, so GoalFlow keeps every notification here and never relies on a
        browser alarm alone. Turn on push for this device in <Link className="underline" href="/settings">Settings</Link>.
      </p>
    </div>
  );
}
