"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Coffee, Pause, Play, Square } from "lucide-react";
import { Button, Input, cn } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { elapsedMs, formatDuration } from "@/lib/domain/timer";
import { finishTimerAction, pauseTimerAction, resumeTimerAction, startTimerAction } from "@/server/actions/timer";

export type ActiveSession = {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  kind: "focus" | "break";
  startedAt: string;
  pausedAt: string | null;
  pausedMs: number;
  plannedMinutes: number | null;
};

/**
 * Live timer. Elapsed time is derived from stored timestamps, corrected by the offset between
 * server and device clocks, so refreshes, sleeping laptops and wrong device clocks don't drift.
 */
export function ActiveTimers({ sessions, serverNow, variant = "bar" }: { sessions: ActiveSession[]; serverNow: string; variant?: "bar" | "card" }) {
  const offset = useRef(new Date(serverNow).getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset.current);
  useEffect(() => {
    offset.current = new Date(serverNow).getTime() - Date.now();
    const t = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => clearInterval(t);
  }, [serverNow]);
  if (!sessions.length) {
    return variant === "card" ? <p className="text-sm text-muted">No timer running. Start one from any task.</p> : null;
  }
  return (
    <div className={variant === "bar" ? "space-y-1" : "space-y-3"}>
      {sessions.map((s) => (
        <TimerRow key={s.id} s={s} now={now} variant={variant} />
      ))}
    </div>
  );
}

function TimerRow({ s, now, variant }: { s: ActiveSession; now: number; variant: "bar" | "card" }) {
  const [pending, start] = useTransition();
  const [finishing, setFinishing] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const notified = useRef(false);
  const st = { startedAt: new Date(s.startedAt), endedAt: null, pausedAt: s.pausedAt ? new Date(s.pausedAt) : null, pausedMs: s.pausedMs };
  const ms = elapsedMs(st, new Date(now));
  const remaining = s.plannedMinutes ? s.plannedMinutes * 60_000 - ms : null;
  const paused = Boolean(s.pausedAt);

  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !notified.current) {
      notified.current = true;
      const title = s.kind === "break" ? "Break is over" : "Pomodoro complete";
      try {
        if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body: s.taskTitle ?? "GoalFlow", tag: s.id });
      } catch {
        /* notifications unavailable */
      }
    }
  }, [remaining, s.id, s.kind, s.taskTitle]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setErr(r.ok ? null : (r.error ?? "Something went wrong"));
    });

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2",
        s.kind === "break" ? "border-info bg-info-soft" : "border-accent bg-accent-soft",
        variant === "card" && "py-3",
      )}
      role="timer"
      aria-live="off"
    >
      <span className={cn("font-mono text-lg font-semibold tabular-nums", paused && "opacity-60")}>
        {remaining !== null ? (remaining > 0 ? formatDuration(remaining) : `+${formatDuration(-remaining)}`) : formatDuration(ms)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        {s.kind === "break" ? "Break" : s.taskId ? <Link href={`/tasks/${s.taskId}`} className="hover:underline">{s.taskTitle}</Link> : "Focus session"}
        {s.plannedMinutes ? <span className="text-muted"> · Pomodoro {s.plannedMinutes}m</span> : null}
        {paused ? <span className="text-muted"> · paused</span> : null}
      </span>
      <div className="flex items-center gap-1">
        {paused ? (
          <Button size="sm" disabled={pending} onClick={() => act(() => resumeTimerAction(s.id))} aria-label="Resume timer">
            <Play size={14} /> Resume
          </Button>
        ) : (
          <Button size="sm" disabled={pending} onClick={() => act(() => pauseTimerAction(s.id))} aria-label="Pause timer">
            <Pause size={14} /> Pause
          </Button>
        )}
        <Button size="sm" variant="primary" disabled={pending} onClick={() => setFinishing(true)} aria-label="Finish timer">
          <Square size={14} /> Finish
        </Button>
      </div>
      {err ? <p className="w-full text-xs text-danger">{err}</p> : null}
      <Dialog open={finishing} onClose={() => setFinishing(false)} title="Finish session">
        <p className="text-sm text-muted">Recorded: {formatDuration(ms)} of {s.kind === "break" ? "break" : "focus"} time.</p>
        <label className="mt-3 block text-sm font-medium" htmlFor={`note-${s.id}`}>
          Session note (optional)
        </label>
        <Input id={`note-${s.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you get done?" />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {s.kind === "focus" ? (
            <Button
              disabled={pending}
              onClick={() =>
                act(async () => {
                  const r = await finishTimerAction(s.id, note);
                  if (r.ok) await startTimerAction(null, { kind: "break", pomodoro: Boolean(s.plannedMinutes) });
                  setFinishing(false);
                  return r;
                })
              }
            >
              <Coffee size={14} /> Finish and take a break
            </Button>
          ) : null}
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              act(async () => {
                const r = await finishTimerAction(s.id, note);
                setFinishing(false);
                return r;
              })
            }
          >
            Save session
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
