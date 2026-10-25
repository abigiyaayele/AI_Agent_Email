"use client";

import { useState, useTransition } from "react";
import { Play, Timer } from "lucide-react";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { startTimerAction } from "@/server/actions/timer";

export function StartTimerButton({ taskId, withLabel }: { taskId: string | null; withLabel?: boolean }) {
  const [pending, start] = useTransition();
  const [conflict, setConflict] = useState<{ pomodoro: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = (pomodoro: boolean, switchFromActive = false) =>
    start(async () => {
      const r = await startTimerAction(taskId, { pomodoro, switchFromActive });
      if (!r.ok) {
        if (/already running/.test(r.error)) setConflict({ pomodoro });
        else setErr(r.error);
      } else {
        setConflict(null);
        setErr(null);
      }
    });
  return (
    <>
      <Button size="sm" variant={withLabel ? "primary" : "ghost"} disabled={pending} onClick={() => go(false)} title="Start focus timer" aria-label="Start focus timer">
        <Play size={14} /> {withLabel ? "Start timer" : null}
      </Button>
      {withLabel ? (
        <Button size="sm" disabled={pending} onClick={() => go(true)} title="Start a Pomodoro">
          <Timer size={14} /> Pomodoro
        </Button>
      ) : null}
      {err ? <span className="text-xs text-danger">{err}</span> : null}
      <Dialog open={conflict !== null} onClose={() => setConflict(null)} title="A timer is already running">
        <p className="text-sm text-muted">
          GoalFlow prevents overlapping timers so recorded time stays accurate. Finish the running session and start this one, or keep the current timer.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setConflict(null)}>Keep current timer</Button>
          <Button variant="primary" disabled={pending} onClick={() => go(conflict?.pomodoro ?? false, true)}>
            Finish it and switch
          </Button>
        </div>
      </Dialog>
    </>
  );
}
