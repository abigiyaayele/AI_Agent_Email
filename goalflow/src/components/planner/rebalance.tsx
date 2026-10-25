"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { applyRebalanceAction, workloadAction } from "@/server/actions/tasks";

type Result = Awaited<ReturnType<typeof workloadAction>>;

/** Shows overload and a proposed set of moves. Nothing changes until the user approves. */
export function Rebalance({ from, to }: { from: string; to: string }) {
  const [res, setRes] = useState<Result | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      {!res ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await workloadAction(from, to);
              setRes(r);
              setChosen(new Set(r.proposals.map((p) => p.taskId)));
            })
          }
        >
          {pending ? "Checking…" : "Suggest a revised schedule"}
        </Button>
      ) : (
        <div className="space-y-2 text-sm">
          {res.proposals.length ? (
            <>
              <p className="font-medium">Proposed moves (critical tasks and deadlines are never moved):</p>
              <ul className="space-y-1">
                {res.proposals.map((p) => (
                  <li key={p.taskId} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={chosen.has(p.taskId)}
                      onChange={(e) => {
                        const n = new Set(chosen);
                        if (e.target.checked) n.add(p.taskId);
                        else n.delete(p.taskId);
                        setChosen(n);
                      }}
                      aria-label={`Move ${p.title}`}
                    />
                    <span>
                      <strong>{p.title}</strong> ({p.minutes} min): {p.fromDate} → {p.toDate}
                    </span>
                  </li>
                ))}
              </ul>
              <Button
                variant="primary"
                size="sm"
                disabled={pending || !chosen.size}
                onClick={() =>
                  start(async () => {
                    const r = await applyRebalanceAction(res.proposals.filter((p) => chosen.has(p.taskId)).map((p) => ({ taskId: p.taskId, toDate: p.toDate })));
                    setMsg(r.ok ? (r.message ?? "Done") : r.error);
                    setRes(null);
                  })
                }
              >
                Approve {chosen.size} move{chosen.size === 1 ? "" : "s"}
              </Button>
            </>
          ) : (
            <p>No automatic moves are possible without touching critical work or deadlines.</p>
          )}
          {res.unresolved.length ? (
            <p className="text-danger">
              Still over capacity on {res.unresolved.map((u) => `${u.date} (+${u.overload} min)`).join(", ")}. Consider deferring work, extending a goal date or raising your available hours.
            </p>
          ) : null}
        </div>
      )}
      {msg ? <p role="status" className="mt-2 text-sm text-ok">{msg}</p> : null}
    </div>
  );
}
