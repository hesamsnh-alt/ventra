import "./Button.css";

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  onClick,
  type = "button",
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`vt-btn vt-btn-${variant} vt-btn-${size}`}
    >
      {children}

      {icon && (
        <span className="vt-btn-icon">
          {icon}
        </span>
      )}
    </button>
  );
}