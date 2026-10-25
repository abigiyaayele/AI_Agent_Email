"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { aiAdviceAction } from "@/server/actions/assistant";
import { applyRebalanceAction } from "@/server/actions/tasks";
import type { AiAdvice } from "@/server/services/assistant";

/** Asks the AI for advice; proposed moves are applied only after the user ticks and approves them. */
export function AiPanel({ enabled }: { enabled: boolean }) {
  const [advice, setAdvice] = useState<AiAdvice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!enabled)
    return (
      <p className="text-sm text-muted">
        AI is not configured on this server (set <code>AI_PROVIDER</code> and <code>ANTHROPIC_API_KEY</code>). Everything else on this page works without it.
      </p>
    );

  return (
    <div className="space-y-3">
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            setMsg(null);
            const r = await aiAdviceAction();
            if ("error" in r) setError(r.error);
            else {
              setAdvice(r);
              setChosen(new Set());
            }
          })
        }
      >
        <Sparkles size={14} /> {pending && !advice ? "Thinking…" : advice ? "Ask again" : "Ask the AI for a plan"}
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {advice ? (
        <div className="space-y-3 text-sm">
          <p className="leading-relaxed">{advice.overview}</p>
          {advice.next ? (
            <p>
              <span className="font-medium">Do next: </span>
              <Link href={`/tasks/${advice.next.id}`} className="underline">
                {advice.next.title}
              </Link>{" "}
              <span className="text-muted">— {advice.next.reason}</span>
            </p>
          ) : null}
          {advice.risks.length ? (
            <ul className="list-disc space-y-1 pl-5 text-muted">
              {advice.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : null}
          {advice.moves.length ? (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 font-medium">Proposed schedule changes</p>
              <ul className="space-y-1.5">
                {advice.moves.map((m) => (
                  <li key={m.taskId}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={chosen.has(m.taskId)}
                        onChange={(e) => {
                          const next = new Set(chosen);
                          if (e.target.checked) next.add(m.taskId);
                          else next.delete(m.taskId);
                          setChosen(next);
                        }}
                      />
                      <span>
                        <span className="font-medium">{m.title}</span>: {m.fromDate ?? "unscheduled"} → {m.toDate}
                        <span className="block text-xs text-muted">{m.reason}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <Button
                className="mt-3"
                size="sm"
                variant="primary"
                disabled={pending || !chosen.size}
                onClick={() =>
                  start(async () => {
                    const moves = advice.moves.filter((m) => chosen.has(m.taskId)).map((m) => ({ taskId: m.taskId, toDate: m.toDate }));
                    const r = await applyRebalanceAction(moves);
                    setMsg(r.ok ? (r.message ?? "Applied.") : r.error);
                    setAdvice({ ...advice, moves: advice.moves.filter((m) => !chosen.has(m.taskId)) });
                    setChosen(new Set());
                  })
                }
              >
                Apply {chosen.size || ""} selected
              </Button>
              <p className="mt-1 text-xs text-muted">Deadlines are never changed; moved tasks keep their history.</p>
            </div>
          ) : (
            <p className="text-xs text-muted">No schedule changes proposed.</p>
          )}
          {msg ? <p className="text-sm text-ok">{msg}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
