"use client";

export default function Button({
  children,
  variant = "primary",
  type = "button",
  onClick,
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`vt-btn vt-btn--${variant}`}
    >
      {children}
    </button>
  );
}