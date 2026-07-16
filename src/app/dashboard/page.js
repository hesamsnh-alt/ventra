"use client";

import useProjects from "@/hooks/useProjects";
import Link from "next/link";

import {
  CalendarDays,
  CircleUserRound,
  FolderKanban,
  Plus,
  Users,
} from "lucide-react";

import "./Dashboard.css";

export default function DashboardPage() {
const {
  projects,
  loading,
  errorMessage,
} = useProjects();

  const assignedUsers = projects.reduce((total, project) => {
    let count = 0;

    if (project.manager) {
      count += 1;
    }

    if (project.supervisor) {
      count += 1;
    }

    return total + count;
  }, 0);
  const upcomingDeadlines = projects.filter(
    (project) => project.deadline
  ).length;

  return (
    <main className="dashboard-page">
      <section className="dashboard-top">
        <div>
          <span className="dashboard-kicker">
            VENTRA WORKSPACE
          </span>

          <h1>Project Dashboard</h1>

          <p>
            Manage projects, schedules, users and daily progress
            from one workspace.
          </p>
        </div>

        <Link
          href="/projects/new"
          className="dashboard-new-project"
        >
          <Plus size={18} />
          New Project
        </Link>
      </section>

      <section className="dashboard-stats">
        <article className="dashboard-stat-card">
          <FolderKanban size={22} />

          <div>
            <span>Active Projects</span>
            <strong>{projects.length}</strong>
          </div>
        </article>

        <article className="dashboard-stat-card">
          <Users size={22} />

          <div>
            <span>Assigned Users</span>
            <strong>{assignedUsers}</strong>
          </div>
        </article>

        <article className="dashboard-stat-card">
          <CalendarDays size={22} />

          <div>
            <span>Upcoming Deadlines</span>
            <strong>{upcomingDeadlines}</strong>
          </div>
        </article>
      </section>

      <section className="dashboard-projects">
        <div className="dashboard-section-heading">
          <div>
            <span>ACTIVE WORK</span>
            <h2>Your Projects</h2>
          </div>
        </div>

        {loading && (
          <div className="dashboard-message">
            Loading projects...
          </div>
        )}

        {!loading && errorMessage && (
          <div className="dashboard-message dashboard-message-error">
            {errorMessage}
          </div>
        )}

        {!loading &&
          !errorMessage &&
          projects.length === 0 && (
            <div className="dashboard-message">
              No projects found. Create your first project.
            </div>
          )}

        {!loading &&
          !errorMessage &&
          projects.length > 0 && (
            <div className="dashboard-project-grid">
              {projects.map((project) => (
                <article
                  key={project.id}
                  className="project-card"
                >
                  <div className="project-card-top">
                    <div>
                      <span className="project-location">
                        {project.location || "Location not set"}
                      </span>

                      <h3>
                        {project.name ||
                          project.title ||
                          "Untitled Project"}
                      </h3>
                    </div>

                    <span
                      className={`project-status ${
                        project.status === "On Track"
                          ? "project-status-success"
                          : "project-status-warning"
                      }`}
                    >
                      {project.status || "Planning"}
                    </span>
                  </div>

                  <div className="project-progress-head">
                    <span>Project Progress</span>

                    <strong>
                      {project.progress ?? 0}%
                    </strong>
                  </div>

                  <div className="project-progress-track">
                    <div
                      className="project-progress-fill"
                      style={{
                        width: `${project.progress ?? 0}%`,
                      }}
                    />
                  </div>

                  <div className="project-dates">
                    <div>
                      <span>Start Date</span>

                      <strong>
                        {project.start_date ||
                          project.startDate ||
                          "Not set"}
                      </strong>
                    </div>

                    <div>
                      <span>Deadline</span>

                      <strong>
                        {project.deadline || "Not set"}
                      </strong>
                    </div>
                  </div>

                  <div className="project-members">
                    <div className="project-member">
                      <CircleUserRound size={20} />

                      <div>
                        <span>Project Manager</span>

                        <strong>
                          {project.manager ||
                            "Not assigned"}
                        </strong>
                      </div>
                    </div>

                    <div className="project-member">
                      <CircleUserRound size={20} />

                      <div>
                        <span>Site Supervisor</span>

                        <strong>
                          {project.supervisor ||
                            "Not assigned"}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <Link
                    href={`/projects/${project.id}`}
                    className="project-open-button"
                  >
                    Open Project
                  </Link>
                </article>
              ))}
            </div>
          )}
      </section>
    </main>
  );
}