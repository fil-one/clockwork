function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
export interface TermBarProps {
  label: string;
  start: Date;
  end: Date;
  noticeDate?: Date;
  now: Date;
}
export function TermBar({ label, start, end, noticeDate, now }: TermBarProps) {
  const duration = Math.max(1, end.getTime() - start.getTime());
  const elapsed = clamp(((now.getTime() - start.getTime()) / duration) * 100);
  const notice = noticeDate
    ? clamp(((noticeDate.getTime() - start.getTime()) / duration) * 100)
    : undefined;
  return (
    <div
      className="cw-term"
      aria-label={`${label}: ${Math.round(elapsed)}% elapsed`}
    >
      <div className="cw-term__labels">
        <strong>{label}</strong>
        <span>
          {end.toLocaleDateString("en-US", {
            dateStyle: "medium",
            timeZone: "UTC",
          })}
        </span>
      </div>
      <div className="cw-term__track">
        <div className="cw-term__elapsed" style={{ width: `${elapsed}%` }} />
        {notice === undefined ? null : (
          <div
            className="cw-term__notice"
            style={{ left: `${notice}%` }}
            title="Notice window"
          />
        )}
      </div>
    </div>
  );
}
