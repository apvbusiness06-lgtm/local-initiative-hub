// Slice 10 acceptance: a weekly recurrence expands correctly across a BST
// boundary — each occurrence stays at the same LOCAL time, so its UTC instant
// shifts by an hour when British Summer Time begins. Pure function, no DB.
import { describe, expect, it } from "vitest";
import { zonedWallTimeToUtc, parseRule, expandRecurrence } from "@/lib/recurrence";

const TZ = "Europe/London";

describe("zonedWallTimeToUtc", () => {
  it("maps a winter (GMT) wall time to the same UTC hour", () => {
    // 14 Jan 2026 10:00 Europe/London = 10:00 UTC (GMT, offset 0).
    const utc = zonedWallTimeToUtc({ year: 2026, month: 1, day: 14, hour: 10, minute: 0 }, TZ);
    expect(utc.toISOString()).toBe("2026-01-14T10:00:00.000Z");
  });

  it("maps a summer (BST) wall time one hour earlier in UTC", () => {
    // 14 Jul 2026 10:00 Europe/London = 09:00 UTC (BST, offset +1).
    const utc = zonedWallTimeToUtc({ year: 2026, month: 7, day: 14, hour: 10, minute: 0 }, TZ);
    expect(utc.toISOString()).toBe("2026-07-14T09:00:00.000Z");
  });
});

describe("expandRecurrence weekly across the BST boundary", () => {
  it("keeps 10:00 local each week while the UTC instant shifts at the DST change", () => {
    // BST 2026 begins Sun 29 Mar. Weekly Tuesday 10:00 from Tue 24 Mar.
    const rule = parseRule("FREQ=WEEKLY;INTERVAL=1;COUNT=3")!;
    const occ = expandRecurrence(rule, { year: 2026, month: 3, day: 24, hour: 10, minute: 0 }, TZ, 60);

    expect(occ).toHaveLength(3);
    // 24 Mar (GMT): 10:00 local = 10:00 UTC
    expect(occ[0]!.startsAt.toISOString()).toBe("2026-03-24T10:00:00.000Z");
    // 31 Mar (BST, after 29 Mar): 10:00 local = 09:00 UTC — the hour shifted
    expect(occ[1]!.startsAt.toISOString()).toBe("2026-03-31T09:00:00.000Z");
    expect(occ[2]!.startsAt.toISOString()).toBe("2026-04-07T09:00:00.000Z");
    // durations preserved
    expect(occ[0]!.endsAt.getTime() - occ[0]!.startsAt.getTime()).toBe(60 * 60 * 1000);
  });

  it("respects COUNT and DAILY frequency", () => {
    const rule = parseRule("FREQ=DAILY;COUNT=4")!;
    const occ = expandRecurrence(rule, { year: 2026, month: 6, day: 1, hour: 9, minute: 30 }, TZ, 30);
    expect(occ).toHaveLength(4);
    // consecutive days
    expect(occ[1]!.startsAt.getTime() - occ[0]!.startsAt.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("stops at UNTIL", () => {
    const rule = parseRule("FREQ=WEEKLY;UNTIL=20260415T000000Z")!;
    const occ = expandRecurrence(rule, { year: 2026, month: 4, day: 1, hour: 12, minute: 0 }, TZ, 60);
    // 1 Apr, 8 Apr, 15 Apr would be past the 15th-midnight UNTIL -> only 1 & 8
    expect(occ.length).toBe(2);
  });

  it("rejects unsupported frequencies", () => {
    expect(parseRule("FREQ=MONTHLY")).toBeNull();
    expect(parseRule("nonsense")).toBeNull();
  });
});
