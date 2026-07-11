export default function DashboardPreview() {
  return (
    <section className="dashboard-section">
      <div className="dashboard-container">
        <div className="dashboard-text">
          <span className="dashboard-badge">Smart Dashboard</span>

          <h2>Everything you need in one powerful dashboard.</h2>

          <p>
            Manage quotations, BOQs, project files, clients, and AI estimations
            from one clean workspace.
          </p>
        </div>

        <div className="dashboard-preview">
          <div className="dashboard-sidebar">
            <div>Dashboard</div>
            <div>Projects</div>
            <div>Estimations</div>
            <div>Clients</div>
            <div>Reports</div>
          </div>

          <div className="dashboard-content">
            <div className="dashboard-card">
              <h3>Active Projects</h3>
              <span>24</span>
            </div>

            <div className="dashboard-card">
              <h3>Pending Quotes</h3>
              <span>8</span>
            </div>

            <div className="dashboard-card">
              <h3>Completed</h3>
              <span>132</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}