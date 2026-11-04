import assert from "node:assert/strict";
import test from "node:test";
import { accountingPresence, accountingWindow } from "../lib/permanencia-session.ts";
import { calculateSaldoPermanencia, type TimeWindow } from "../lib/permanencia-math.ts";

const clock = (local: string) => "2026-11-03T" + local + ":00-06:00";
const breakAt = (start: string, end: string): TimeWindow =>
  ({ startAt: clock(start), endAt: clock(end) });
const first = {
  scheduled_start_at: clock("15:00"), scheduled_end_at: clock("18:00"),
  actual_end_at: "2026-11-03T23:54:58.007Z",
  status: "closed" as const,
};
const second = {
  scheduled_start_at: clock("18:00"), scheduled_end_at: clock("21:00"),
  actual_end_at: "2026-11-04T06:09:39.853Z",
  status: "closed" as const,
};
function evaluated(
  session: typeof first,
  presence: TimeWindow[],
  breaks: TimeWindow[],
  asOf = "2026-11-04T07:00:00.000Z",
  countInitialAbsence = false,
) {
  return calculateSaldoPermanencia({
    classStartAt: accountingWindow(session).startAt,
    classEndAt: accountingWindow(session).endAt,
    presence: accountingPresence(session, presence),
    officialBreaks: breaks, now: asOf, closed: true, countInitialAbsence,
  });
}

test("3 Nov: two scheduled three-hour classes cannot become a 361+ minute attendance day", () => {
  const firstStats = evaluated(first,
    [{ startAt: clock("15:00"), endAt: first.actual_end_at }],
    [breakAt("16:40", "17:00")]);
  const secondStats = evaluated(second,
    [{ startAt: clock("18:00"), endAt: second.actual_end_at }],
    [breakAt("19:30", "20:00")]);
  assert.equal(accountingWindow(first).closedEarly, true);
  assert.equal(accountingWindow(second).closedLate, true);
  assert.equal(firstStats.scheduledMinutes + secondStats.scheduledMinutes, 360);
  assert.equal(firstStats.officialBreakMinutes, 20);
  assert.equal(secondStats.officialBreakMinutes, 30);
  assert.equal(firstStats.requiredMinutes, 160);
  assert.equal(secondStats.requiredMinutes, 150);
  assert.equal(firstStats.requiredMinutes + secondStats.requiredMinutes, 310);
  assert.equal(firstStats.remainingMinutes + secondStats.remainingMinutes, 310);
  assert.equal(firstStats.exitCount + secondStats.exitCount, 0);
});

test("if the second break is corrected to 20 minutes, the total is 320", () => {
  const initial = evaluated(first, [{ startAt: clock("15:00"), endAt: first.actual_end_at }],
    [breakAt("16:40", "17:00")]);
  const next = evaluated(second, [{ startAt: clock("18:00"), endAt: second.actual_end_at }],
    [breakAt("19:30", "19:50")]);
  assert.equal(initial.requiredMinutes + next.requiredMinutes, 320);
});

test("recording a class closure after midnight never increases scheduled hours", () => {
  const stats = evaluated(second, [{ startAt: clock("18:00"), endAt: second.actual_end_at }], []);
  assert.equal(stats.requiredMinutes, 180);
  assert.equal(stats.absentMinutes, 0);
  assert.equal(stats.exitCount, 0);
  assert.equal(stats.percentage, 100);
});

test("early administrative finish certifies active presence through schedule, but preserves explicit exits", () => {
  const present = accountingPresence(first, [
    { startAt: clock("15:00"), endAt: clock("17:30") },
    { startAt: clock("17:45"), endAt: first.actual_end_at },
  ]);
  assert.equal(present[0].endAt, clock("17:30"));
  assert.equal(present[1].endAt, new Date(first.scheduled_end_at).toISOString());
  const stats = evaluated(first, present, [breakAt("16:40", "17:00")]);
  assert.equal(stats.requiredMinutes, 160);
  assert.equal(stats.absentMinutes, 15);
  assert.equal(stats.exitCount, 1);
  assert.equal(stats.remainingMinutes, 145);
});

test("late arrival and a short exit are deducted once, excluding official break", () => {
  const stats = evaluated(second, [
    { startAt: clock("18:10"), endAt: clock("19:20") },
    { startAt: clock("19:40"), endAt: second.actual_end_at },
  ], [breakAt("19:30", "19:50")], "2026-11-04T07:00:00.000Z", true);
  assert.equal(stats.requiredMinutes, 160);
  assert.equal(stats.absentMinutes, 20); // 10 minutes late, 10 outside authorized break
  assert.equal(stats.exitCount, 1);
  assert.equal(stats.remainingMinutes, 140);
});

test("read-only evaluation is stable hours after the register was closed", () => {
  const intervals = [{ startAt: clock("18:00"), endAt: second.actual_end_at }];
  const breaks = [breakAt("19:30", "20:00")];
  const earlier = evaluated(second, intervals, breaks, "2026-11-04T07:00:00.000Z");
  const later = evaluated(second, intervals, breaks, "2026-11-15T12:00:00.000Z");
  assert.deepEqual(earlier, later);
});
