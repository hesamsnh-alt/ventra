
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
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
    <LocalizedElement as="div" className="vt-input-group">

      {label && (
        <LocalizedElement as="label" className="vt-label">
          {label}
        </LocalizedElement>
      )}

      <LocalizedElement as="div" className="vt-input-wrapper">

        {icon && (
          <LocalizedElement as="span" className="vt-input-icon">
            {icon}
          </LocalizedElement>
        )}

        <LocalizedElement as="input"
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          className="vt-input"
        />

      </LocalizedElement>

    </LocalizedElement>
  );
}