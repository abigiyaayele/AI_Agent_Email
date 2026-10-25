"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { BellOff, Check, Clock, Trash2, X } from "lucide-react";
import { ActionForm, FieldError, SubmitButton } from "@/components/ui/action-form";
import { Badge, Button, Field, Input, Select, cn } from "@/components/ui";
import { CHANNEL_LABEL, CHANNELS, type Channel } from "@/lib/constants";
import {
  createReminderAction,
  deleteReminderAction,
  markNotificationsAction,
  reminderChannelsAction,
  snoozeAction,
  toggleReminderAction,
} from "@/server/actions/reminders";

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  url: string | null;
  when: string;
  read: boolean;
  dismissed: boolean;
  channels: string[];
  errors: Record<string, string> | null;
};

export function NotificationList({ items, empty }: { items: NotificationItem[]; empty: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      {msg ? (
        <p role="status" className="mb-2 text-sm text-ok">
          {msg}
        </p>
      ) : null}
      {!items.length ? <p className="py-4 text-sm text-muted">{empty}</p> : null}
      <ul className="divide-y divide-border">
        {items.map((n) => (
          <li key={n.id} className={cn("flex flex-wrap items-start gap-2 py-3", n.read && "opacity-70")}>
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-accent")} aria-label={n.read ? undefined : "Unread"} />
            <div className="min-w-0 flex-1">
              {n.url ? (
                <Link href={n.url} className="font-medium hover:underline" onClick={() => !n.read && start(() => markNotificationsAction([n.id], "read"))}>
                  {n.title}
                </Link>
              ) : (
                <p className="font-medium">{n.title}</p>
              )}
              {n.body ? <p className="text-sm text-muted">{n.body}</p> : null}
              <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                {n.when}
                {n.channels.map((c) => (
                  <Badge key={c}>{CHANNEL_LABEL[c as Channel] ?? c}</Badge>
                ))}
                {n.dismissed ? <Badge>dismissed</Badge> : null}
                {n.errors
                  ? Object.entries(n.errors).map(([c, e]) => (
                      <Badge key={c} tone="danger">
                        {c} failed: {e}
                      </Badge>
                    ))
                  : null}
              </p>
            </div>
            {!n.dismissed ? (
              <div className="flex items-center gap-1">
                {!n.read ? (
                  <Button size="sm" variant="ghost" disabled={pending} aria-label="Mark as read" onClick={() => start(() => markNotificationsAction([n.id], "read"))}>
                    <Check size={14} />
                  </Button>
                ) : null}
                <Select
                  aria-label="Snooze"
                  className="h-8 w-28 text-xs"
                  value=""
                  disabled={pending}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    if (m) start(async () => {
                      const r = await snoozeAction(n.id, m);
                      setMsg(r.ok ? (r.message ?? "Snoozed.") : r.error);
                    });
                  }}
                >
                  <option value="">Snooze…</option>
                  <option value="10">10 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">1 hour</option>
                  <option value="180">3 hours</option>
                  <option value="1440">Tomorrow</option>
                </Select>
                <Button size="sm" variant="ghost" disabled={pending} aria-label="Dismiss" onClick={() => start(() => markNotificationsAction([n.id], "dismiss"))}>
                  <X size={14} />
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

export function MarkAllRead() {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" disabled={pending} onClick={() => start(() => markNotificationsAction("all", "read"))}>
      <Check size={14} /> Mark all read
    </Button>
  );
}

export type ReminderItem = {
  id: string;
  title: string;
  kind: string;
  schedule: string;
  next: string | null;
  active: boolean;
  channels: Channel[];
  href: string | null;
  system: boolean;
};

export function ReminderList({ items, available }: { items: ReminderItem[]; available: Record<Channel, boolean> }) {
  const [pending, start] = useTransition();
  if (!items.length) return <p className="text-sm text-muted">No reminders.</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((r) => (
        <li key={r.id} className={cn("flex flex-wrap items-center gap-2 py-2.5", !r.active && "opacity-60")}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {r.href ? (
                <Link href={r.href} className="hover:underline">
                  {r.title}
                </Link>
              ) : (
                r.title
              )}
              <Badge className="ml-2">{r.kind.replace("_", " ")}</Badge>
            </p>
            <p className="text-xs text-muted">
              {r.schedule}
              {r.active ? (r.next ? ` · next ${r.next}` : " · finished") : " · paused"}
            </p>
          </div>
          <fieldset className="flex items-center gap-2 text-xs">
            <legend className="sr-only">Channels for {r.title}</legend>
            {CHANNELS.map((c) => (
              <label key={c} className={cn("flex items-center gap-1", !available[c] && "opacity-50")} title={available[c] ? undefined : "Not configured"}>
                <input
                  type="checkbox"
                  checked={r.channels.includes(c) && available[c]}
                  disabled={pending || c === "in_app" || !available[c]}
                  onChange={(e) => {
                    const next = e.target.checked ? [...r.channels, c] : r.channels.filter((x) => x !== c);
                    start(() => reminderChannelsAction(r.id, next));
                  }}
                />
                {CHANNEL_LABEL[c]}
              </label>
            ))}
          </fieldset>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => toggleReminderAction(r.id, !r.active))} aria-label={r.active ? "Pause reminder" : "Resume reminder"}>
            {r.active ? <BellOff size={14} /> : <Clock size={14} />}
            <span className="hidden sm:inline">{r.active ? "Pause" : "Resume"}</span>
          </Button>
          {!r.system ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => deleteReminderAction(r.id))} aria-label="Delete reminder">
              <Trash2 size={14} />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ReminderForm({ today, available }: { today: string; available: Record<Channel, boolean> }) {
  return (
    <ActionForm action={createReminderAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
      <Field label="Title" htmlFor="r-title" className="sm:col-span-2">
        <Input id="r-title" name="title" placeholder="e.g. Drink water, call mum" />
        <FieldError name="title" />
      </Field>
      <Field label="Details (optional)" htmlFor="r-body" className="sm:col-span-2">
        <Input id="r-body" name="body" />
      </Field>
      <Field label="Date" htmlFor="r-date">
        <Input id="r-date" name="date" type="date" defaultValue={today} />
        <FieldError name="date" />
      </Field>
      <Field label="Time" htmlFor="r-time">
        <Input id="r-time" name="time" type="time" defaultValue="09:00" />
        <FieldError name="time" />
      </Field>
      <Field label="Repeat" htmlFor="r-repeat">
        <Select id="r-repeat" name="repeat" defaultValue="none">
          <option value="none">Does not repeat</option>
          <option value="daily">Every day</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekly">Every week on this day</option>
          <option value="monthly">Every month on this date</option>
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Channels</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {CHANNELS.map((c) => (
            <label key={c} className={cn("flex items-center gap-1.5", !available[c] && "opacity-50")}>
              <input type="checkbox" name="channels[]" value={c} defaultChecked={c === "in_app"} disabled={!available[c]} />
              {CHANNEL_LABEL[c]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <SubmitButton>Create reminder</SubmitButton>
      </div>
    </ActionForm>
  );
}
