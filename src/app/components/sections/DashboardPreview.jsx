
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
export default function DashboardPreview() {
  return (
    <LocalizedElement as="section" className="dashboard-section">
      <LocalizedElement as="div" className="dashboard-container">
        <LocalizedElement as="div" className="dashboard-text">
          <LocalizedElement as="span" className="dashboard-badge">Smart Dashboard</LocalizedElement>

          <LocalizedElement as="h2">Everything you need in one powerful dashboard.</LocalizedElement>

          <LocalizedElement as="p">
            Manage quotations, BOQs, project files, clients, and AI estimations
            from one clean workspace.
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="div" className="dashboard-preview">
          <LocalizedElement as="div" className="dashboard-sidebar">
            <LocalizedElement as="div">Dashboard</LocalizedElement>
            <LocalizedElement as="div">Projects</LocalizedElement>
            <LocalizedElement as="div">Estimations</LocalizedElement>
            <LocalizedElement as="div">Clients</LocalizedElement>
            <LocalizedElement as="div">Reports</LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="div" className="dashboard-content">
            <LocalizedElement as="div" className="dashboard-card">
              <LocalizedElement as="h3">Active Projects</LocalizedElement>
              <LocalizedElement as="span">24</LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="div" className="dashboard-card">
              <LocalizedElement as="h3">Pending Quotes</LocalizedElement>
              <LocalizedElement as="span">8</LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="div" className="dashboard-card">
              <LocalizedElement as="h3">Completed</LocalizedElement>
              <LocalizedElement as="span">132</LocalizedElement>
            </LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
  );
}