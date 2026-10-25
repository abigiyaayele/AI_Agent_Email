"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

type Item = { id: string; title: string; body: string; url: string | null; createdAt: string };

const POLL_MS = 60_000;

/**
 * Keeps in-app reminders working while any GoalFlow tab is open: asks the server to fire due
 * reminders, shows new ones as a toast and, if allowed, as a browser notification. Push (when
 * configured) covers closed tabs; this is the always-available fallback.
 */
export function NotificationPoller({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<Item[]>([]);
  const since = useRef(new Date().toISOString());
  const shown = useRef(new Set<string>());
  const unread = useRef(initialUnread);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      if (document.visibilityState === "hidden" && !("Notification" in window && Notification.permission === "granted")) return;
      try {
        const res = await fetch("/api/notifications/poll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ since: since.current }) });
        if (!res.ok) return;
        const data: { now: string; unread: number; items: Item[] } = await res.json();
        since.current = data.now;
        const fresh = data.items.filter((i) => !shown.current.has(i.id));
        fresh.forEach((i) => shown.current.add(i.id));
        if (fresh.length) {
          setToasts((t) => [...fresh, ...t].slice(0, 3));
          if ("Notification" in window && Notification.permission === "granted" && document.visibilityState === "hidden") {
            const reg = await navigator.serviceWorker?.getRegistration();
            for (const i of fresh) {
              // Push subscriptions already show a system notification; avoid a duplicate.
              const pushOn = reg && (await reg.pushManager.getSubscription());
              if (!pushOn) new Notification(i.title, { body: i.body, tag: i.id, icon: "/icons/icon.svg" });
            }
          }
        }
        if (data.unread !== unread.current) {
          unread.current = data.unread;
          router.refresh();
        }
      } catch {
        // Offline: try again next tick.
      }
    }
    poll();
    const t = setInterval(() => !stopped && poll(), POLL_MS);
    const vis = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", vis);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [router]);

  if (!toasts.length) return null;
  return (
    <div className="fixed right-4 bottom-20 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 lg:bottom-4" role="region" aria-label="New notifications" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="rounded-xl border border-border bg-surface p-3 shadow-lg">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.body ? <p className="text-xs text-muted">{t.body}</p> : null}
            </div>
            <button type="button" className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Close" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <X size={14} />
            </button>
          </div>
          {t.url ? (
            <a href={t.url} className="mt-1 inline-block text-xs font-medium text-accent underline">
              Open
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}
