
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import "./Progress.css";

export default function Progress({
  value = 0,
  label,
  color = "yellow",
}) {
  return (
    <LocalizedElement as="div" className="vt-progress">

      {label && (
        <LocalizedElement as="div" className="vt-progress-top">

          <LocalizedElement as="span">{label}</LocalizedElement>

          <LocalizedElement as="span">{value}%</LocalizedElement>

        </LocalizedElement>
      )}

      <LocalizedElement as="div" className="vt-progress-track">

        <LocalizedElement as="div"
          className={`vt-progress-fill ${color}`}
          style={{
            width: `${value}%`,
          }}
        />

      </LocalizedElement>

    </LocalizedElement>
  );
}