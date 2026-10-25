export const WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
];

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function pct(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return `${Math.round(v * 10) / 10}%`;
}

export function hours(min: number) {
  return Math.round((min / 60) * 10) / 10;
}
