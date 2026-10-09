
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import "./Card.css";

export default function Card({
  children,
  title,
  subtitle,
  padding = "md",
}) {
  return (
    <LocalizedElement as="div" className={`vt-card vt-card-${padding}`}>
      {title && (
        <LocalizedElement as="div" className="vt-card-header">

          <LocalizedElement as="h3">{title}</LocalizedElement>

          {subtitle && (
            <LocalizedElement as="p">{subtitle}</LocalizedElement>
          )}

        </LocalizedElement>
      )}

      <LocalizedElement as="div" className="vt-card-body">
        {children}
      </LocalizedElement>

    </LocalizedElement>
  );
}