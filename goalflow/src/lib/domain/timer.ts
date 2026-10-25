/**
 * Timer state lives in the database as timestamps, so elapsed time survives refreshes, closed
 * tabs and device switches. Elapsed = (end or pause or now) - start - accumulated pauses.
 */
export type TimerState = {
  startedAt: Date;
  endedAt: Date | null;
  pausedAt: Date | null;
  pausedMs: number;
};

export function elapsedMs(s: TimerState, now: Date = new Date()): number {
  const end = s.endedAt ?? s.pausedAt ?? now;
  return Math.max(0, end.getTime() - s.startedAt.getTime() - s.pausedMs);
}

export function elapsedMinutes(s: TimerState, now: Date = new Date()): number {
  return Math.round(elapsedMs(s, now) / 60_000);
}

export function isRunning(s: TimerState) {
  return s.endedAt === null && s.pausedAt === null;
}

export class TimerError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TimerError";
  }
}

export function pause(s: TimerState, now: Date = new Date()): Pick<TimerState, "pausedAt"> {
  if (s.endedAt) throw new TimerError("This session has already finished.");
  if (s.pausedAt) throw new TimerError("The timer is already paused.");
  return { pausedAt: now };
}

export function resume(s: TimerState, now: Date = new Date()): Pick<TimerState, "pausedAt" | "pausedMs"> {
  if (s.endedAt) throw new TimerError("This session has already finished.");
  if (!s.pausedAt) throw new TimerError("The timer is not paused.");
  return { pausedAt: null, pausedMs: s.pausedMs + Math.max(0, now.getTime() - s.pausedAt.getTime()) };
}

export function finish(s: TimerState, now: Date = new Date()): Pick<TimerState, "endedAt" | "pausedAt" | "pausedMs"> {
  if (s.endedAt) throw new TimerError("This session has already finished.");
  const pausedMs = s.pausedAt ? s.pausedMs + Math.max(0, now.getTime() - s.pausedAt.getTime()) : s.pausedMs;
  return { endedAt: now, pausedAt: null, pausedMs };
}

/** Pomodoro: given a planned length, how much is left and whether the phase is over. */
export function pomodoroRemainingMs(s: TimerState, plannedMinutes: number, now: Date = new Date()) {
  return plannedMinutes * 60_000 - elapsedMs(s, now);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatMinutes(min: number | null | undefined): string {
  if (!min) return "0m";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Clip a session to a window and return the focus minutes inside it (for timesheets/reviews). */
export function minutesWithin(s: TimerState, from: Date, to: Date, now: Date = new Date()): number {
  const end = s.endedAt ?? s.pausedAt ?? now;
  const a = Math.max(s.startedAt.getTime(), from.getTime());
  const b = Math.min(end.getTime(), to.getTime());
  if (b <= a) return 0;
  const span = end.getTime() - s.startedAt.getTime();
  const ratio = span > 0 ? elapsedMs(s, now) / span : 0;
  return Math.round(((b - a) * ratio) / 60_000);
}
