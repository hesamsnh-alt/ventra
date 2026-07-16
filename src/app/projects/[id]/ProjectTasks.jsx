import "./ProjectTasks.css";

const tasks = [
  {
    id: 1,
    title: "Approve Structural Drawings",
    assignee: "Ahmed",
    priority: "High",
    status: "In Progress",
  },
  {
    id: 2,
    title: "Order Reinforcement Steel",
    assignee: "Reza",
    priority: "Medium",
    status: "Pending",
  },
  {
    id: 3,
    title: "Upload Site Photos",
    assignee: "Reza",
    priority: "Low",
    status: "Completed",
  },
];

export default function ProjectTasks() {
  return (
    <section className="tasks-panel">
      <div className="tasks-header">
        <div>
          <span>PROJECT TASKS</span>
          <h2>Task Management</h2>
        </div>

        <button>+ New Task</button>
      </div>

      <table className="tasks-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Assigned To</th>
            <th>Priority</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td>{task.title}</td>

              <td>{task.assignee}</td>

              <td>
                <span className={`priority ${task.priority.toLowerCase()}`}>
                  {task.priority}
                </span>
              </td>

              <td>
                <span className={`status ${task.status.replace(" ","").toLowerCase()}`}>
                  {task.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}