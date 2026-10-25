"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, cn } from "@/components/ui";
import { assignLanes } from "@/lib/domain/scheduling";
import { rescheduleAction } from "@/server/actions/tasks";

export type CalItem = {
  id: string;
  title: string;
  date: string;
  /** Minutes from local midnight; null for unscheduled (deadline-only) items. */
  startMin: number | null;
  endMin: number | null;
  timeLabel: string;
  status: string;
  priority: string;
  kind: "task" | "commitment";
  conflict?: boolean;
};

export type CalDay = { date: string; label: string; isToday: boolean; working: boolean };

const PX_PER_MIN = 0.9;
const SLOT = 30;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

type Pending = { id: string; title: string; when: string; error: string; conflicts: { label: string; start: string; end: string }[] };

/**
 * Week grid with drag-and-drop rescheduling. Dropping a task on a half-hour slot moves its start
 * (keeping its duration). Overlaps are refused by the server; the user can then explicitly
 * schedule anyway. Every task also links to its edit page, so nothing depends on dragging.
 */
export function WeekGrid({ days, items, fromHour, toHour }: { days: CalDay[]; items: CalItem[]; fromHour: number; toHour: number }) {
  const [busy, startTransition] = useTransition();
  const [drag, setDrag] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const timed = items.filter((i) => i.startMin !== null);
  const from = Math.min(fromHour, ...timed.map((i) => Math.floor((i.startMin ?? 0) / 60)));
  const to = Math.max(toHour, ...timed.map((i) => Math.ceil((i.endMin ?? 0) / 60)));
  const height = (to - from) * 60 * PX_PER_MIN;
  const slots = Array.from({ length: ((to - from) * 60) / SLOT }, (_, i) => from * 60 + i * SLOT);

  function move(id: string, title: string, when: string, allowOverlap = false) {
    setMessage(null);
    startTransition(async () => {
      const res = await rescheduleAction(id, when, allowOverlap);
      if (res.ok) {
        setPending(null);
        setMessage(`Moved “${title}” to ${when.replace("T", " ")}.`);
      } else {
        setPending({ id, title, when, error: res.error, conflicts: res.conflicts ?? [] });
      }
    });
  }

  function onDrop(date: string, min: number) {
    const id = drag;
    setDrag(null);
    setHover(null);
    if (!id) return;
    const item = items.find((i) => i.id === id);
    if (!item || item.kind !== "task") return;
    move(id, item.title, `${date}T${pad(Math.floor(min / 60))}:${pad(min % 60)}`);
  }

  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {message}
      </p>
      {pending ? (
        <div role="alert" className="mb-3 rounded-lg border border-danger/50 bg-danger-soft/40 p-3 text-sm">
          <p className="font-medium text-danger">{pending.error}</p>
          {pending.conflicts.length ? (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {pending.conflicts.map((c, i) => (
                <li key={i}>
                  {c.label} ({c.start}–{c.end})
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="danger" disabled={busy} onClick={() => move(pending.id, pending.title, pending.when, true)}>
              Schedule anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : message ? (
        <p className="mb-3 text-sm text-ok">{message}</p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="border-b border-border" />
          {days.map((d) => (
            <div key={d.date} className={cn("border-b border-l border-border px-1.5 py-1 text-center text-xs", d.isToday && "bg-accent-soft font-semibold text-accent", !d.working && "bg-surface-2/60")}>
              <Link href={`/today?date=${d.date}`} className="hover:underline">
                {d.label}
              </Link>
            </div>
          ))}

          <div className="border-b border-border px-1 py-1 text-[10px] text-muted">Due</div>
          {days.map((d) => (
            <div
              key={d.date}
              className="min-h-8 space-y-0.5 border-b border-l border-border p-0.5"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(d.date, Math.max(from * 60, 9 * 60))}
            >
              {items
                .filter((i) => i.date === d.date && i.startMin === null)
                .map((i) => (
                  <Chip key={i.id} item={i} onDragStart={() => setDrag(i.id)} onDragEnd={() => setDrag(null)} />
                ))}
            </div>
          ))}

          <div className="relative" style={{ height }}>
            {Array.from({ length: to - from }, (_, h) => (
              <span key={h} className="absolute right-1 -translate-y-1.5 text-[10px] text-muted tabular-nums" style={{ top: h * 60 * PX_PER_MIN }}>
                {pad(from + h)}:00
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d.date} className={cn("relative border-l border-border", !d.working && "bg-surface-2/40")} style={{ height }}>
              {slots.map((m) => {
                const key = `${d.date}@${m}`;
                return (
                  <div
                    key={m}
                    className={cn("absolute inset-x-0", m % 60 === 0 ? "border-t border-border/70" : "border-t border-dashed border-border/30", hover === key && "bg-accent-soft")}
                    style={{ top: (m - from * 60) * PX_PER_MIN, height: SLOT * PX_PER_MIN }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (hover !== key) setHover(key);
                    }}
                    onDragLeave={() => setHover((h) => (h === key ? null : h))}
                    onDrop={() => onDrop(d.date, m)}
                    aria-hidden
                  />
                );
              })}
              {(() => {
                const dayItems = items.filter((i) => i.date === d.date && i.startMin !== null);
                const lanes = assignLanes(dayItems.map((i) => ({ id: i.id, start: i.startMin!, end: i.endMin! })));
                return dayItems.map((i) => {
                  const top = ((i.startMin ?? 0) - from * 60) * PX_PER_MIN;
                  const h = Math.max(18, ((i.endMin ?? 0) - (i.startMin ?? 0)) * PX_PER_MIN - 2);
                  const { lane, lanes: n } = lanes.get(i.id)!;
                  return (
                    <div
                      key={i.id}
                      className={cn("absolute px-0.5", drag === i.id && "opacity-40", drag && drag !== i.id && "pointer-events-none")}
                      style={{ top, height: h, left: `${(lane / n) * 100}%`, width: `${100 / n}%` }}
                    >
                      <Chip item={i} fill onDragStart={() => setDrag(i.id)} onDragEnd={() => setDrag(null)} />
                    </div>
                  );
                });
              })()}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">Drag a task to a new time slot, or into the “Due” row to keep its date. Grey blocks are your fixed commitments.</p>
    </div>
  );
}

function Chip({ item, fill, onDragStart, onDragEnd }: { item: CalItem; fill?: boolean; onDragStart: () => void; onDragEnd: () => void }) {
  const commitment = item.kind === "commitment";
  const cls = cn(
    "block overflow-hidden rounded border px-1 py-0.5 text-[11px] leading-tight",
    fill && "h-full",
    commitment ? "border-border bg-surface-2 text-muted" : "cursor-grab border-accent/40 bg-accent-soft active:cursor-grabbing",
    item.priority === "critical" && !commitment && "border-l-4 border-l-danger",
    item.status === "done" && "line-through opacity-60",
    item.conflict && "border-danger ring-1 ring-danger",
  );
  const body = (
    <>
      <span className="font-medium">{item.title}</span>
      <span className="block opacity-75">
        {item.timeLabel}
        {item.conflict ? " · overlap" : ""}
      </span>
    </>
  );
  if (commitment) return <div className={cls}>{body}</div>;
  return (
    <Link
      href={`/tasks/${item.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cls}
      title={`${item.title} — drag to reschedule`}
    >
      {body}
    </Link>
  );
}
