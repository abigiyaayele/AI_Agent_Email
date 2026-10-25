import Link from "next/link";
import { cn } from "@/components/ui";
import { formatInstant } from "@/lib/domain/periods";
import { assignLanes } from "@/lib/domain/scheduling";

export type TimelineItem = {
  id: string;
  label: string;
  start: Date;
  end: Date;
  kind: "task" | "commitment";
  status?: string;
  conflict?: boolean;
  href?: string;
};

/** Vertical day timeline. Items are positioned by time; overlapping items are flagged. */
export function DayTimeline({ items, dayStart, tz, fromHour = 7, toHour = 22 }: { items: TimelineItem[]; dayStart: Date; tz: string; fromHour?: number; toHour?: number }) {
  const hours = items.length
    ? {
        from: Math.min(fromHour, ...items.map((i) => Number(formatInstant(i.start, tz, "H")))),
        to: Math.max(toHour, ...items.map((i) => Math.min(24, Number(formatInstant(i.end, tz, "H")) + 1))),
      }
    : { from: fromHour, to: toHour };
  const span = (hours.to - hours.from) * 60;
  const pxPerMin = 1.1;
  const top = (d: Date) => {
    const local = Number(formatInstant(d, tz, "H")) * 60 + Number(formatInstant(d, tz, "m"));
    return Math.max(0, (local - hours.from * 60) * pxPerMin);
  };
  const lanes = assignLanes(items.map((i) => ({ id: i.id, start: i.start.getTime(), end: i.end.getTime() })));
  const nowTop = Date.now() >= dayStart.getTime() && Date.now() < dayStart.getTime() + 86_400_000 ? top(new Date()) : null;
  return (
    <div className="relative" style={{ height: span * pxPerMin }} aria-label="Day timeline">
      {Array.from({ length: hours.to - hours.from + 1 }, (_, i) => (
        <div key={i} className="absolute inset-x-0 flex items-start border-t border-border/70" style={{ top: i * 60 * pxPerMin }}>
          <span className="-mt-2 w-11 bg-surface pr-1 text-right text-[10px] text-muted tabular-nums">{String(hours.from + i).padStart(2, "0")}:00</span>
        </div>
      ))}
      {nowTop !== null ? <div className="absolute right-0 left-11 z-10 border-t-2 border-danger" style={{ top: nowTop }} aria-label="Now" /> : null}
      <ul>
        {items.map((it) => {
          const { lane, lanes: n } = lanes.get(it.id)!;
          const h = Math.max(22, ((it.end.getTime() - it.start.getTime()) / 60000) * pxPerMin - 2);
          const body = (
            <>
              <span className="font-medium">{it.label}</span>
              <span className="ml-1 text-[11px] opacity-75">
                {formatInstant(it.start, tz, "HH:mm")}–{formatInstant(it.end, tz, "HH:mm")}
              </span>
              {it.conflict ? <span className="ml-1 text-[11px] font-semibold text-danger">overlap</span> : null}
            </>
          );
          return (
            <li
              key={it.id}
              className={cn(
                "absolute overflow-hidden rounded-md border px-2 py-0.5 text-xs",
                it.kind === "commitment" ? "border-border bg-surface-2 text-muted" : "border-accent/40 bg-accent-soft",
                it.status === "done" && "line-through opacity-60",
                it.conflict && "border-danger",
              )}
              style={{ top: top(it.start), height: h, left: `calc(3rem + (100% - 3.25rem) * ${lane / n})`, width: `calc((100% - 3.25rem) / ${n} - 2px)` }}
            >
              {it.href ? (
                <Link href={it.href} className="block hover:underline">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
