// Open-now must be evaluated in the tenant's timezone, not the server's —
// a UK directory running on a UTC server would otherwise report the wrong
// day around midnight during BST. Special hours override the regular
// weekly schedule for their specific date.

export interface OpeningHourRow {
  dayOfWeek: number; // 0=Sunday
  opensAt: string; // "HH:MM"
  closesAt: string; // "HH:MM"
  isClosed: boolean;
}

export interface SpecialHourRow {
  date: Date;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function partsInTimezone(timezone: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    dayOfWeek: WEEKDAY_INDEX[get("weekday")] ?? 0,
    time: `${get("hour")}:${get("minute")}`,
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/**
 * Special hours are stored as a bare date (no timezone). Prisma returns them
 * as a Date at UTC midnight for that calendar day — read the UTC fields
 * directly rather than formatting in the tenant timezone, which could shift
 * the date by a day.
 */
function specialHourDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Note: does not support hours spanning midnight (e.g. 22:00–02:00). */
export function isOpenNow(
  openingHours: OpeningHourRow[],
  specialHours: SpecialHourRow[],
  timezone: string,
  at: Date = new Date()
): boolean {
  const now = partsInTimezone(timezone, at);

  const special = specialHours.find((s) => specialHourDateKey(s.date) === now.date);
  if (special) {
    if (special.isClosed || !special.opensAt || !special.closesAt) return false;
    return now.time >= special.opensAt && now.time < special.closesAt;
  }

  const today = openingHours.find((h) => h.dayOfWeek === now.dayOfWeek);
  if (!today || today.isClosed) return false;
  return now.time >= today.opensAt && now.time < today.closesAt;
}

export function dayLabel(dayOfWeek: number): string {
  return DAY_LABELS[dayOfWeek] ?? "";
}

export function formatHoursRange(h: Pick<OpeningHourRow, "isClosed" | "opensAt" | "closesAt">): string {
  return h.isClosed ? "Closed" : `${h.opensAt} – ${h.closesAt}`;
}

/** Sunday-first input sorted into a Monday-first display week. */
export function sortMondayFirst<T extends { dayOfWeek: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7));
}
