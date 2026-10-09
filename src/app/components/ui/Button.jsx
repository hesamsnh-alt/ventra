
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
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
    <LocalizedElement as="button"
      type={type}
      onClick={onClick}
      className={`vt-btn vt-btn-${variant} vt-btn-${size}`}
    >
      {children}

      {icon && (
        <LocalizedElement as="span" className="vt-btn-icon">
          {icon}
        </LocalizedElement>
      )}
    </LocalizedElement>
  );
}