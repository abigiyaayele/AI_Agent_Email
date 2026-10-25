import Link from "next/link";
import { Badge, ProgressBar } from "@/components/ui";
import { GOAL_LEVEL_LABEL, type GoalLevel } from "@/lib/constants";
import { PACE_LABEL, type PaceStatus } from "@/lib/domain/pace";
import { formatDate } from "@/lib/domain/periods";
import { titleCase } from "@/lib/format";
import type { GoalNode, GoalWithProgress } from "@/server/services/goals";

const PACE_TONE: Record<PaceStatus, "neutral" | "ok" | "warn" | "danger" | "accent" | "info"> = {
  not_started: "neutral",
  ahead: "ok",
  on_track: "ok",
  behind: "warn",
  at_risk: "danger",
  overdue: "danger",
  complete: "accent",
};

export function PaceBadge({ pace }: { pace: PaceStatus }) {
  return <Badge tone={PACE_TONE[pace]}>{PACE_LABEL[pace]}</Badge>;
}

export function LevelBadge({ level }: { level: GoalLevel }) {
  return <Badge tone="info">{GOAL_LEVEL_LABEL[level].replace(" milestone", "").replace(" goal", "")}</Badge>;
}

export function GoalSummaryRow({ g, compact }: { g: GoalWithProgress; compact?: boolean }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={`/goals/${g.id}`} className="truncate font-medium hover:underline">
          {g.title}
        </Link>
        {!compact ? <LevelBadge level={g.level} /> : null}
        <PaceBadge pace={g.pace} />
        {g.status !== "active" ? <Badge>{titleCase(g.status)}</Badge> : null}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <ProgressBar value={g.progress.pct} expected={g.expected} label={`${g.title} progress`} />
        <span className="w-12 shrink-0 text-right text-xs tabular-nums">{g.progress.pct}%</span>
      </div>
      {!compact ? (
        <p className="mt-1 text-xs text-muted">
          {titleCase(g.category)} · {formatDate(g.startDate, "d LLL")} – {formatDate(g.targetDate, "d LLL yyyy")}
          {g.metricType === "numeric" && g.targetValue !== null ? ` · ${g.currentValue} / ${g.targetValue} ${g.unit}` : ""}
        </p>
      ) : null}
    </div>
  );
}

export function GoalTree({ nodes, depth = 0 }: { nodes: GoalNode[]; depth?: number }) {
  return (
    <ul className={depth ? "mt-2 space-y-2 border-l border-border pl-3 sm:pl-5" : "space-y-3"}>
      {nodes.map((n) => (
        <li key={n.id}>
          {n.children.length ? (
            <details open={depth < 1}>
              <summary className="flex cursor-pointer list-none items-start gap-2 rounded-lg p-2 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="mt-0.5 text-xs text-muted">
                  ▸
                </span>
                <GoalSummaryRow g={n} />
                <span className="text-xs text-muted">{n.children.length}</span>
              </summary>
              <GoalTree nodes={n.children} depth={depth + 1} />
            </details>
          ) : (
            <div className="flex items-start gap-2 p-2">
              <span aria-hidden className="mt-0.5 w-2 text-xs text-muted">
                ·
              </span>
              <GoalSummaryRow g={n} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
