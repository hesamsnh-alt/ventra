import "./Progress.css";

export default function Progress({
  value = 0,
  label,
  color = "yellow",
}) {
  return (
    <div className="vt-progress">

      {label && (
        <div className="vt-progress-top">

          <span>{label}</span>

          <span>{value}%</span>

        </div>
      )}

      <div className="vt-progress-track">

        <div
          className={`vt-progress-fill ${color}`}
          style={{
            width: `${value}%`,
          }}
        />

      </div>

    </div>
  );
}