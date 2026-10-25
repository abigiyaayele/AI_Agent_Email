"use client";

import { useEffect, useState } from "react";
import { Badge, Button } from "@/components/ui";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushToggle({ vapidKey, pushConfigured }: { vapidKey: string; pushConfigured: boolean }) {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [subscribed, setSubscribed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
    navigator.serviceWorker?.getRegistration().then(async (reg) => {
      const sub = await reg?.pushManager?.getSubscription();
      setSubscribed(Boolean(sub));
    });
  }, []);

  async function enable() {
    setMsg(null);
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p !== "granted") {
      setMsg("Permission was not granted. You can change this in your browser's site settings.");
      return;
    }
    if (!pushConfigured || !vapidKey) {
      setMsg("Browser notifications enabled while GoalFlow is open. Server push is not configured.");
      return;
    }
    try {
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error(await res.text());
      setSubscribed(true);
      setMsg("Push notifications enabled on this device.");
    } catch (err) {
      setMsg(`Could not enable push: ${(err as Error).message}`);
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setSubscribed(false);
    setMsg("Push disabled on this device.");
  }

  if (permission === "unsupported") return <p className="text-sm text-muted">This browser does not support notifications.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Browser permission:</span>
        <Badge tone={permission === "granted" ? "ok" : permission === "denied" ? "danger" : "neutral"}>{permission}</Badge>
        <span>Push on this device:</span>
        <Badge tone={subscribed ? "ok" : "neutral"}>{subscribed ? "on" : "off"}</Badge>
        {!pushConfigured ? <Badge tone="warn">server push not configured</Badge> : null}
      </div>
      <div className="flex gap-2">
        {!subscribed ? (
          <Button variant="primary" size="sm" onClick={enable}>
            Enable notifications
          </Button>
        ) : (
          <Button size="sm" onClick={disable}>
            Disable push on this device
          </Button>
        )}
      </div>
      {msg ? <p role="status" className="text-sm text-muted">{msg}</p> : null}
    </div>
  );
}
