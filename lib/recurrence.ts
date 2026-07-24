// Recurring-event expansion that is correct across DST boundaries. An event
// scheduled for "Tuesdays 10:00 Europe/London" must fire at 10:00 LOCAL every
// week — which means its UTC instant shifts by an hour when BST begins/ends.
// We get that right by computing each occurrence's UTC instant from its own
// calendar date's timezone offset, never by adding a fixed number of hours.
//
// A focused RFC 5545 subset: FREQ=DAILY|WEEKLY, INTERVAL, and COUNT or UNTIL.
// Enough for the directory's "every week / every day" events; richer RRULEs
// can adopt a full library later without changing callers.

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
}

/** ms the wall clock in `tz` is ahead of UTC at the given instant. */
function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  // Intl formats midnight as hour 24; normalise to 0.
  const hour = g("hour") === 24 ? 0 : g("hour");
  const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), hour, g("minute"), g("second"));
  return asUTC - at.getTime();
}

/** The UTC instant for a wall-clock time in a timezone, DST-correct. */
export function zonedWallTimeToUtc(w: WallTime, tz: string): Date {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const offset1 = tzOffsetMs(tz, new Date(guess));
  let utc = guess - offset1;
  // One correction pass handles the case where the guess landed on the wrong
  // side of a transition.
  const offset2 = tzOffsetMs(tz, new Date(utc));
  if (offset2 !== offset1) utc = guess - offset2;
  return new Date(utc);
}

export interface ParsedRule {
  freq: "DAILY" | "WEEKLY";
  interval: number;
  count?: number;
  until?: Date; // UTC
}

export function parseRule(rrule: string): ParsedRule | null {
  const parts = Object.fromEntries(
    rrule
      .replace(/^RRULE:/i, "")
      .split(";")
      .map((kv) => kv.split("=") as [string, string])
      .filter(([k, v]) => k && v)
      .map(([k, v]) => [k.toUpperCase(), v])
  );
  const freq = parts.FREQ?.toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY") return null;
  const interval = parts.INTERVAL ? Math.max(1, parseInt(parts.INTERVAL, 10)) : 1;
  const count = parts.COUNT ? parseInt(parts.COUNT, 10) : undefined;
  const until = parts.UNTIL ? parseUntil(parts.UNTIL) : undefined;
  return { freq, interval, ...(count ? { count } : {}), ...(until ? { until } : {}) };
}

function parseUntil(raw: string): Date | undefined {
  // Accept 20260401T090000Z or 20260401.
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!m) return undefined;
  const y = m[1]!, mo = m[2]!, d = m[3]!, hh = m[4] ?? "0", mm = m[5] ?? "0", ss = m[6] ?? "0";
  return new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss));
}

export interface Occurrence {
  startsAt: Date; // UTC instant
  endsAt: Date;
}

const MAX_OCCURRENCES = 400; // guardrail against an unbounded UNTIL

/**
 * Expand a recurrence into UTC occurrence instants. `start` is the first
 * occurrence's wall time in `tz`; `durationMinutes` sets each end.
 */
export function expandRecurrence(
  rule: ParsedRule,
  start: WallTime,
  tz: string,
  durationMinutes: number,
  horizonDays = 365
): Occurrence[] {
  const stepDays = rule.freq === "WEEKLY" ? 7 * rule.interval : rule.interval;
  const horizonEnd = Date.now() + horizonDays * 24 * 60 * 60 * 1000;
  const out: Occurrence[] = [];

  // Iterate calendar dates in the tz; recompute the UTC instant each step so
  // the offset is always the one in force on that date.
  const cur: WallTime = { ...start };
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    if (rule.count != null && i >= rule.count) break;
    const startsAt = zonedWallTimeToUtc(cur, tz);
    if (rule.until && startsAt.getTime() > rule.until.getTime()) break;
    if (startsAt.getTime() > horizonEnd) break;
    out.push({ startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000) });

    // Advance the calendar date by stepDays using a UTC date walk (date math
    // only — the time-of-day is re-applied in the tz on the next iteration).
    const d = new Date(Date.UTC(cur.year, cur.month - 1, cur.day + stepDays));
    cur.year = d.getUTCFullYear();
    cur.month = d.getUTCMonth() + 1;
    cur.day = d.getUTCDate();
  }
  return out;
}
