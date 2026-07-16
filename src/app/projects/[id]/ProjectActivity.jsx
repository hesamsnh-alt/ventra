import {
  CalendarClock,
  CircleUserRound,
  FileEdit,
  Image,
  CheckCircle2,
} from "lucide-react";

import "./ProjectActivity.css";

const activities = [
  {
    id: 1,
    user: "Ahmed Al Mansoori",
    action: "Approved today's daily report",
    time: "10 minutes ago",
    icon: CheckCircle2,
  },
  {
    id: 2,
    user: "Reza Karimi",
    action: "Uploaded 6 site photos",
    time: "45 minutes ago",
    icon: Image,
  },
  {
    id: 3,
    user: "Ahmed Al Mansoori",
    action: "Updated project schedule",
    time: "1 hour ago",
    icon: CalendarClock,
  },
  {
    id: 4,
    user: "Reza Karimi",
    action: "Edited concrete quantity",
    time: "Yesterday",
    icon: FileEdit,
  },
];

export default function ProjectActivity() {
  return (
    <section className="activity-panel">

      <div className="activity-header">

        <div>

          <span>ACTIVITY LOG</span>

          <h2>Recent Activity</h2>

        </div>

      </div>

      <div className="activity-list">

        {activities.map((activity) => {

          const Icon = activity.icon;

          return (

            <div
              className="activity-item"
              key={activity.id}
            >

              <div className="activity-icon">

                <Icon size={18} />

              </div>

              <div className="activity-content">

                <strong>{activity.user}</strong>

                <p>{activity.action}</p>

                <span>{activity.time}</span>

              </div>

            </div>

          );

        })}

      </div>

    </section>
  );
}