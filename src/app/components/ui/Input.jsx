import "./Input.css";

export default function Input({
  label,
  placeholder,
  type = "text",
  value,
  onChange,
  icon,
}) {
  return (
    <div className="vt-input-group">

      {label && (
        <label className="vt-label">
          {label}
        </label>
      )}

      <div className="vt-input-wrapper">

        {icon && (
          <span className="vt-input-icon">
            {icon}
          </span>
        )}

        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          className="vt-input"
        />

      </div>

    </div>
  );
}