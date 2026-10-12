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
    <section className="project-overview" id="dashboard">
      <div className="project-overview__glow" />
      <div className="project-overview__grid" />

      <div className="project-overview__heading">
        <span>AI Project Intelligence</span>

        <h2>
          Control every stage of your
          <strong> construction project.</strong>
        </h2>

        <p>
          Track project progress, estimated costs, BOQs, payments and delay
          risks from one intelligent workspace.
        </p>
      </div>

      <div className="project-overview__stage">
        <article className="overview-float overview-float--boq">
          <div className="overview-float__icon overview-float__icon--yellow">
            AI
          </div>

          <div>
            <span>BOQ Generated</span>
            <strong>1,248 Items</strong>
          </div>
        </article>

        <div className="overview-dashboard">
          <div className="overview-dashboard__header">
            <div>
              <span className="overview-dashboard__eyebrow">
                Project Overview
              </span>

              <h3>AL SIRATCONTRACTING</h3>
            </div>

            <div className="overview-dashboard__status">
              <span />
              Active
            </div>
          </div>

          <div className="overview-dashboard__stats">
            <div className="overview-stat">
              <span>Project Progress</span>
              <strong>68%</strong>

              <div className="overview-stat__progress">
                <div />
              </div>

              <small>+12% vs last month</small>
            </div>

            <div className="overview-stat">
              <span>Estimated Cost</span>
              <strong>AED 4.2M</strong>

              <div className="overview-stat__updated">
                <span />
                Updated today
              </div>
            </div>
          </div>

          <div className="overview-performance">
            <div className="overview-performance__header">
              <div>
                <strong>Project Performance</strong>
                <span>Planned progress</span>
              </div>

              <button type="button">Last 6 months⌄</button>
            </div>

            <div className="overview-chart">
              <div className="overview-chart__levels">
                <span>100%</span>
                <span>50%</span>
                <span>0%</span>
              </div>

              <div className="overview-chart__content">
                <div className="overview-chart__lines">
                  <span />
                  <span />
                  <span />
                </div>

                <div className="overview-chart__columns">
                  {chartData.map((item) => (
                    <div
                      className="overview-chart__column"
                      key={item.month}
                    >
                      <div
                        className="overview-chart__bar"
                        style={{ height: `${item.value}%` }}
                      />

                      <span>{item.month}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <article className="overview-float overview-float--payment">
          <div className="overview-float__icon overview-float__icon--green">
            AED
          </div>

          <div>
            <span>Payment Due</span>
            <strong>AED 186,500</strong>
          </div>
        </article>

        <article className="overview-float overview-float--delay">
          <div className="overview-float__icon overview-float__icon--red">
            !
          </div>

          <div>
            <span>Delay Risk</span>
            <strong>2 Activities</strong>
          </div>
        </article>
      </div>
    </section>
  );
}