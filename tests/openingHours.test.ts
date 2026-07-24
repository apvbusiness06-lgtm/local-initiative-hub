// Slice 5: open-now must be computed in the tenant timezone (a UTC server
// must not flip the day around midnight local), and a special-hours entry
// for today must override the regular weekly schedule. Pure function, no DB.
import { describe, expect, it } from "vitest";
import { isOpenNow, sortMondayFirst, formatHoursRange, dayLabel } from "@/lib/openingHours";
import type { OpeningHourRow, SpecialHourRow } from "@/lib/openingHours";

// A standard Mon–Fri 09:00–17:30, Sat 09:00–13:00, closed Sunday.
const WEEK: OpeningHourRow[] = [
  { dayOfWeek: 0, opensAt: "00:00", closesAt: "00:00", isClosed: true },
  { dayOfWeek: 1, opensAt: "09:00", closesAt: "17:30", isClosed: false },
  { dayOfWeek: 2, opensAt: "09:00", closesAt: "17:30", isClosed: false },
  { dayOfWeek: 3, opensAt: "09:00", closesAt: "17:30", isClosed: false },
  { dayOfWeek: 4, opensAt: "09:00", closesAt: "17:30", isClosed: false },
  { dayOfWeek: 5, opensAt: "09:00", closesAt: "17:30", isClosed: false },
  { dayOfWeek: 6, opensAt: "09:00", closesAt: "13:00", isClosed: false },
];

const TZ = "Europe/London";

describe("isOpenNow", () => {
  it("is open during weekday business hours", () => {
    // Wed 2026-01-14 11:00 UTC = 11:00 GMT (winter, no offset)
    expect(isOpenNow(WEEK, [], TZ, new Date("2026-01-14T11:00:00Z"))).toBe(true);
  });

  it("is closed before opening", () => {
    expect(isOpenNow(WEEK, [], TZ, new Date("2026-01-14T08:30:00Z"))).toBe(false);
  });

  it("is closed after closing", () => {
    expect(isOpenNow(WEEK, [], TZ, new Date("2026-01-14T18:00:00Z"))).toBe(false);
  });

  it("is closed all day Sunday", () => {
    expect(isOpenNow(WEEK, [], TZ, new Date("2026-01-18T11:00:00Z"))).toBe(false);
  });

  it("respects the tenant timezone across the midnight boundary", () => {
    // During BST (summer), 23:30 UTC on Wed is already 00:30 Thu local. Both
    // days are within business hours anyway, so pick a time that only differs:
    // 23:30 UTC Fri = 00:30 Sat local (BST). Saturday opens 09:00, so closed —
    // whereas naive UTC handling would still think it's Friday evening (also
    // closed) — use an early Saturday morning instead to prove the day rolled.
    // Sat 2026-07-04 07:00 UTC = 08:00 BST (before Sat 09:00 open) -> closed.
    expect(isOpenNow(WEEK, [], TZ, new Date("2026-07-04T07:00:00Z"))).toBe(false);
    // Sat 2026-07-04 08:30 UTC = 09:30 BST (after Sat 09:00 open) -> open.
    expect(isOpenNow(WEEK, [], TZ, new Date("2026-07-04T08:30:00Z"))).toBe(true);
  });

  it("special hours marked closed override an otherwise-open weekday", () => {
    const special: SpecialHourRow[] = [
      { date: new Date("2026-01-14T00:00:00Z"), opensAt: null, closesAt: null, isClosed: true },
    ];
    expect(isOpenNow(WEEK, special, TZ, new Date("2026-01-14T11:00:00Z"))).toBe(false);
  });

  it("special hours with custom times override the regular schedule", () => {
    // Normally closed Sunday, but this Sunday opens 10:00–14:00.
    const special: SpecialHourRow[] = [
      { date: new Date("2026-01-18T00:00:00Z"), opensAt: "10:00", closesAt: "14:00", isClosed: false },
    ];
    expect(isOpenNow(WEEK, special, TZ, new Date("2026-01-18T11:00:00Z"))).toBe(true);
    expect(isOpenNow(WEEK, special, TZ, new Date("2026-01-18T15:00:00Z"))).toBe(false);
  });

  it("returns false when the day has no hours row at all", () => {
    expect(isOpenNow([{ dayOfWeek: 1, opensAt: "09:00", closesAt: "17:00", isClosed: false }], [], TZ, new Date("2026-01-13T11:00:00Z"))).toBe(false);
  });
});

describe("display helpers", () => {
  it("sorts a Sunday-first week into Monday-first order", () => {
    const ordered = sortMondayFirst(WEEK).map((h) => h.dayOfWeek);
    expect(ordered).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("formats closed and open ranges", () => {
    expect(formatHoursRange({ isClosed: true, opensAt: "09:00", closesAt: "17:00" })).toBe("Closed");
    expect(formatHoursRange({ isClosed: false, opensAt: "09:00", closesAt: "17:00" })).toBe("09:00 – 17:00");
  });

  it("labels days", () => {
    expect(dayLabel(0)).toBe("Sunday");
    expect(dayLabel(1)).toBe("Monday");
    expect(dayLabel(6)).toBe("Saturday");
  });
});
