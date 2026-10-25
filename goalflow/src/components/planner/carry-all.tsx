"use client";

import { useState, useTransition } from "react";
import { ArrowRightCircle } from "lucide-react";
import { Button } from "@/components/ui";
import { carryOverAction } from "@/server/actions/tasks";

export function CarryAllButton({ ids, to, label }: { ids: string[]; to: string; label?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {msg ? <span className="text-xs text-ok" role="status">{msg}</span> : null}
      <Button
        size="sm"
        disabled={pending || !ids.length}
        onClick={() =>
          start(async () => {
            const r = await carryOverAction(ids, to);
            setMsg(r.ok ? (r.message ?? null) : r.error);
          })
        }
      >
        <ArrowRightCircle size={14} /> {label ?? `Move unfinished to ${to}`}
      </Button>
    </span>
  );
}
