// Shared empty/loading state. Three variants:
//   tone="muted"   — default neutral grey
//   tone="loading" — pulsing dot to signal in-flight
//   tone="error"   — red, for surfaced errors
// Caller provides the headline and an optional one-line hint. The icon is
// rendered with a hairline circular frame so it reads as deliberate, not
// "ASCII placeholder".

export default function EmptyState({ icon = "·", title, hint, tone = "muted", size = "md" }) {
  const classes = ["empty-state", `empty-state--${tone}`, size === "sm" ? "empty-state--sm" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role={tone === "error" ? "alert" : "status"}>
      {tone === "loading" ? (
        <span className="empty-state__pulse" aria-hidden />
      ) : (
        <span className="empty-state__icon" aria-hidden>
          {icon}
        </span>
      )}
      <div className="empty-state__body">
        <div className="empty-state__title">{title}</div>
        {hint && <div className="empty-state__hint">{hint}</div>}
      </div>
    </div>
  );
}
