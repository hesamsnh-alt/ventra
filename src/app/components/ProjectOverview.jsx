
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import "./ProjectOverview.css";

const chartData = [
  { month: "Jan", value: 45 },
  { month: "Feb", value: 61 },
  { month: "Mar", value: 47 },
  { month: "Apr", value: 66 },
  { month: "May", value: 82 },
  { month: "Jun", value: 94 },
];

export default function ProjectOverview() {
  return (
    <LocalizedElement as="section" className="project-overview" id="dashboard">
      <LocalizedElement as="div" className="project-overview__glow" />
      <LocalizedElement as="div" className="project-overview__grid" />

      <LocalizedElement as="div" className="project-overview__heading">
        <LocalizedElement as="span">AI Project Intelligence</LocalizedElement>

        <LocalizedElement as="h2">
          Control every stage of your
          <LocalizedElement as="strong"> construction project.</LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="p">
          Track project progress, estimated costs, BOQs, payments and delay
          risks from one intelligent workspace.
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="div" className="project-overview__stage">
        <LocalizedElement as="article" className="overview-float overview-float--boq">
          <LocalizedElement as="div" className="overview-float__icon overview-float__icon--yellow">
            AI
          </LocalizedElement>

          <LocalizedElement as="div">
            <LocalizedElement as="span">BOQ Generated</LocalizedElement>
            <LocalizedElement as="strong">1,248 Items</LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="div" className="overview-dashboard">
          <LocalizedElement as="div" className="overview-dashboard__header">
            <LocalizedElement as="div">
              <LocalizedElement as="span" className="overview-dashboard__eyebrow">
                Sample Workspace Preview
              </LocalizedElement>

              <LocalizedElement as="h3">AL SIRATCONTRACTING</LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="div" className="overview-dashboard__status">
              <LocalizedElement as="span" />
              Active
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="div" className="overview-dashboard__stats">
            <LocalizedElement as="div" className="overview-stat">
              <LocalizedElement as="span">Project Progress</LocalizedElement>
              <LocalizedElement as="strong">68%</LocalizedElement>

              <LocalizedElement as="div" className="overview-stat__progress">
                <LocalizedElement as="div" />
              </LocalizedElement>

              <LocalizedElement as="small">+12% vs last month</LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="div" className="overview-stat">
              <LocalizedElement as="span">Estimated Cost</LocalizedElement>
              <LocalizedElement as="strong">AED 4.2M</LocalizedElement>

              <LocalizedElement as="div" className="overview-stat__updated">
                <LocalizedElement as="span" />
                Updated today
              </LocalizedElement>
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="div" className="overview-performance">
            <LocalizedElement as="div" className="overview-performance__header">
              <LocalizedElement as="div">
                <LocalizedElement as="strong">Project Performance</LocalizedElement>
                <LocalizedElement as="span">Planned progress</LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="span">Sample: Jan - Jun</LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="div" className="overview-chart">
              <LocalizedElement as="div" className="overview-chart__levels">
                <LocalizedElement as="span">100%</LocalizedElement>
                <LocalizedElement as="span">50%</LocalizedElement>
                <LocalizedElement as="span">0%</LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="div" className="overview-chart__content">
                <LocalizedElement as="div" className="overview-chart__lines">
                  <LocalizedElement as="span" />
                  <LocalizedElement as="span" />
                  <LocalizedElement as="span" />
                </LocalizedElement>

                <LocalizedElement as="div" className="overview-chart__columns">
                  {chartData.map((item) => (
                    <LocalizedElement as="div"
                      className="overview-chart__column"
                      key={item.month}
                    >
                      <LocalizedElement as="div"
                        className="overview-chart__bar"
                        style={{ height: `${item.value}%` }}
                      />

                      <LocalizedElement as="span">{item.month}</LocalizedElement>
                    </LocalizedElement>
                  ))}
                </LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="article" className="overview-float overview-float--payment">
          <LocalizedElement as="div" className="overview-float__icon overview-float__icon--green">
            AED
          </LocalizedElement>

          <LocalizedElement as="div">
            <LocalizedElement as="span">Payment Due</LocalizedElement>
            <LocalizedElement as="strong">AED 186,500</LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="article" className="overview-float overview-float--delay">
          <LocalizedElement as="div" className="overview-float__icon overview-float__icon--red">
            !
          </LocalizedElement>

          <LocalizedElement as="div">
            <LocalizedElement as="span">Delay Risk</LocalizedElement>
            <LocalizedElement as="strong">2 Activities</LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
  );
}
