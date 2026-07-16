import "./Card.css";

export default function Card({
  children,
  title,
  subtitle,
  padding = "md",
}) {
  return (
    <div className={`vt-card vt-card-${padding}`}>
      {title && (
        <div className="vt-card-header">

          <h3>{title}</h3>

          {subtitle && (
            <p>{subtitle}</p>
          )}

        </div>
      )}

      <div className="vt-card-body">
        {children}
      </div>

    </div>
  );
}