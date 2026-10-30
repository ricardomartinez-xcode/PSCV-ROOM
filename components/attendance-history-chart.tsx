"use client";

export type AttendanceChartPoint = {
  id: string;
  date: string;
  label: string;
  percentage: number | null;
  provisional?: boolean;
};

export function AttendanceHistoryChart({ points, title }: { points: AttendanceChartPoint[]; title: string }) {
  return (
    <figure className="attendanceHistoryFigure" aria-label={title}>
      <figcaption><strong>{title}</strong><span>Porcentaje de permanencia por clase y fecha</span></figcaption>
      <div className="attendanceHistoryGraph" role="list" aria-label={title}>
        {points.map((point) => {
          const known = point.percentage !== null && Number.isFinite(point.percentage);
          const value = known ? Math.max(0, Math.min(100, point.percentage!)) : 0;
          const caption = known ? value.toFixed(1) + "%" : "—";
          return (
            <div className="attendanceHistoryGraphItem" role="listitem" key={point.id}
              aria-label={point.date + " " + point.label + ": " + (known ? caption : "sin registro de permanencia")}
              title={point.date + " · " + point.label + " · " + (known ? caption : "Sin registro")}>
              <span className="attendanceHistoryGraphValue">{caption}</span>
              <div className={"attendanceHistoryGraphTrack" + (known ? "" : " noData")}>
                {known && <div className={"attendanceHistoryGraphBar" + (point.provisional ? " provisional" : "")}
                  style={{ height: Math.max(value, value === 0 ? 3 : 0) + "%" }} />}
              </div>
              <strong>{point.date.slice(8, 10)}/{point.date.slice(5, 7)}</strong>
              <small>{point.label}</small>
            </div>
          );
        })}
      </div>
      {!points.some((point) => point.percentage !== null) &&
        <p className="attendanceHint">Aún no hay datos de permanencia para calcular porcentajes. Los registros faltantes no se contabilizan como ausencias.</p>}
    </figure>
  );
}
