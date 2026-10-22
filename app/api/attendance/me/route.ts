import { HttpError, errorResponse, requireProfile } from "@/lib/server/authz";
import { getD1 } from "@/lib/server/cloudflare";
import { calculateSaldoPermanencia, type TimeWindow } from "@/lib/permanencia-math";

export const dynamic = "force-dynamic";

type Session = {
  id: string; course_name: string; session_date: string; scheduled_start_at: string;
  scheduled_end_at: string; actual_end_at: string | null; status: string;
};
type Mark = { session_id: string; status: string; note: string | null };
type Interval = { session_id: string; start_at: string; end_at: string | null };
type Break = { session_id: string; start_at: string; end_at: string | null };

function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date + "T12:00:00Z")) ||
    new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date) {
    throw new HttpError(400, "Fecha inválida.");
  }
}
export async function GET(request: Request) {
  try {
    const actor = await requireProfile(request);
    // Ningún cliente controla la identidad consultada. Siempre actor.id desde Access.
    const date = new URL(request.url).searchParams.get("date") ?? "";
    validDate(date);
    const db = await getD1();
    const sessions = (await db.prepare(
      "SELECT s.id, c.name AS course_name, s.session_date,s.scheduled_start_at,s.scheduled_end_at,s.actual_end_at,s.status " +
      "FROM permanence_sessions s JOIN courses c ON c.id=s.course_id WHERE s.session_date=? AND s.status <> 'cancelled' ORDER BY s.scheduled_start_at"
    ).bind(date).all<Session>()).results ?? [];
    const ids = sessions.map((session) => session.id);
    if (!ids.length) {
      return Response.json({ date, entries: [], summary: { attendedMinutes: 0, balanceMinutes: 0, absentMinutes: 0, requiredMinutes: 0, exitCount: 0, percentage: null, provisional: false } }, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const placeholders = ids.map(() => "?").join(",");
    const [marks, presences, breaks] = await Promise.all([
      db.prepare(
        "SELECT session_id,status,note FROM permanence_attendance WHERE profile_id=? AND session_id IN (" + placeholders + ")"
      ).bind(actor.id, ...ids).all<Mark>(),
      db.prepare(
        "SELECT session_id,start_at,end_at FROM permanence_presence WHERE profile_id=? AND session_id IN (" + placeholders + ")"
      ).bind(actor.id, ...ids).all<Interval>(),
      db.prepare(
        "SELECT session_id,start_at,end_at FROM permanence_breaks WHERE session_id IN (" + placeholders + ")"
      ).bind(...ids).all<Break>(),
    ]);
    const now = new Date().toISOString();
    let attendedMinutes = 0;
    let absentMinutes = 0;
    let requiredMinutes = 0;
    let exitCount = 0;
    const entries = sessions.map((session) => {
      const sessionEnd = Date.parse(session.status === "open" ? session.scheduled_end_at : session.actual_end_at ?? session.scheduled_end_at);
      const cutoff = session.status === "open" ? Math.min(Date.parse(now), sessionEnd) : sessionEnd;
      const mark = (marks.results ?? []).find((item) => item.session_id === session.id);
      if (cutoff <= Date.parse(session.scheduled_start_at)) {
        return { id: session.id, course: session.course_name, status: mark?.status ?? null,
          note: mark?.note ?? null, provisional: true, minutes: null, absentMinutes: null, exits: null, required: null, percentage: null };
      }
      const presence: TimeWindow[] = (presences.results ?? [])
        .filter((p) => p.session_id === session.id)
        .map((p) => ({ startAt: p.start_at, endAt: p.end_at }));
      if (!mark && presence.length === 0) {
        return { id: session.id, course: session.course_name, status: null,
          note: null, provisional: session.status === "open", minutes: null, absentMinutes: null, exits: null, required: null, percentage: null };
      }
      const officialBreaks: TimeWindow[] = (breaks.results ?? [])
        .filter((b) => b.session_id === session.id)
        .map((b) => ({ startAt: b.start_at, endAt: b.end_at }));
      const stats = calculateSaldoPermanencia({
        classStartAt: session.scheduled_start_at,
        classEndAt: new Date(sessionEnd).toISOString(),
        presence, officialBreaks, now,
        closed: session.status !== "open",
        countInitialAbsence: mark?.status !== "present",
      });
      attendedMinutes += stats.remainingMinutes;
      absentMinutes += stats.absentMinutes;
      exitCount += stats.exitCount;
      requiredMinutes += stats.requiredMinutes;
      return { id: session.id, course: session.course_name, status: mark?.status ?? null,
        note: mark?.note ?? null, provisional: session.status === "open",
        minutes: stats.remainingMinutes, absentMinutes: stats.absentMinutes,
        exits: stats.exitCount, required: stats.requiredMinutes, percentage: stats.percentage };
    });
    return Response.json({
      date, entries,
      summary: {
        attendedMinutes: Math.round(attendedMinutes * 10) / 10,
        balanceMinutes: Math.round(attendedMinutes * 10) / 10,
        absentMinutes: Math.round(absentMinutes * 10) / 10,
        exitCount,
        provisional: sessions.some((session) => session.status === "open"),
        requiredMinutes: Math.round(requiredMinutes * 10) / 10,
        percentage: requiredMinutes > 0 ? Math.round(attendedMinutes / requiredMinutes * 1000) / 10 : null,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
