import "./ProjectTimeline.css";

const activities = [
  {
    id: 1,
    name: "Site Preparation",
    start: "12 Jul",
    end: "18 Jul",
    left: 0,
    width: 14,
    progress: 100,
  },
  {
    id: 2,
    name: "Structural Works",
    start: "19 Jul",
    end: "28 Aug",
    left: 12,
    width: 32,
    progress: 78,
  },
  {
    id: 3,
    name: "MEP First Fix",
    start: "29 Aug",
    end: "20 Sep",
    left: 40,
    width: 25,
    progress: 42,
  },
  {
    id: 4,
    name: "Finishing Works",
    start: "21 Sep",
    end: "18 Nov",
    left: 62,
    width: 34,
    progress: 10,
  },
];

const months = ["July", "August", "September", "October", "November"];

export default function ProjectTimeline() {
  return (
    <section className="timeline-panel">
      <div className="timeline-heading">
        <div>
          <span>PROJECT SCHEDULE</span>
          <h2>Project Timeline</h2>
        </div>

        <button type="button">Edit Timeline</button>
      </div>

      <div className="timeline-table">
        <div className="timeline-month-row">
          <div className="timeline-name-header">Activity</div>

          <div className="timeline-months">
            {months.map((month) => (
              <span key={month}>{month}</span>
            ))}
          </div>
        </div>

        {activities.map((activity) => (
          <div className="timeline-row" key={activity.id}>
            <div className="timeline-activity">
              <strong>{activity.name}</strong>

              <span>
                {activity.start} - {activity.end}
              </span>
            </div>

            <div className="timeline-track">
              <div
                className="timeline-bar"
                style={{
                  left: `${activity.left}%`,
                  width: `${activity.width}%`,
                }}
              >
                <div
                  className="timeline-bar-progress"
                  style={{
                    width: `${activity.progress}%`,
                  }}
                />

                <span>{activity.progress}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}