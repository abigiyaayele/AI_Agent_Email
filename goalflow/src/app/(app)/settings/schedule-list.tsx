"use client";

import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/ui/dialog";
import { WEEKDAYS } from "@/lib/format";
import { deleteScheduleAction } from "@/server/actions/settings";

type Item = { id: string; label: string; days: number[]; startTime: string; endTime: string; kind: string };

export function ScheduleList({ items }: { items: Item[] }) {
  if (!items.length) return <p className="text-sm text-muted">No recurring commitments yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{s.label}</p>
            <p className="text-xs text-muted">
              {s.days.map((d) => WEEKDAYS[d - 1]?.short).join(", ")} · {s.startTime}–{s.endTime}
            </p>
          </div>
          <ConfirmButton title={`Remove "${s.label}"?`} confirmLabel="Remove" onConfirm={() => deleteScheduleAction(s.id)}>
            <Trash2 size={14} aria-label="Remove commitment" />
          </ConfirmButton>
        </li>
      ))}
    </ul>
  );
}
