"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CircleUserRound,
  ClipboardList,
  FileText,
  TriangleAlert,
  WalletCards,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  deleteProject,
  fetchProjectById,
} from "@/services/projectService";


import ProjectTimeline from "./ProjectTimeline";
import ProjectTasks from "./ProjectTasks";
import ProjectDailyReports from "./ProjectDailyReports";
import ProjectActivity from "./ProjectActivity";
import ProjectDocuments from "./ProjectDocuments";
import ProjectBOQ from "./ProjectBOQ";
import ProjectEstimate from "./ProjectEstimate";
import ProjectQuotation from "./ProjectQuotation";
import ProjectDrawingCenter from "./ProjectDrawingCenter";

import "./ProjectWorkspace.css";

function formatCurrency(value) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default function ProjectWorkspacePage() {
  const params = useParams();
  const projectId = params?.id;
  const router = useRouter();
const [deleting, setDeleting] = useState(false);

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadProject() {
      if (!projectId) {
        return;
      }

      setLoading(true);
      setErrorMessage("");

      const { project: projectData, error } =
        await fetchProjectById(projectId);

      if (error) {
        console.error("Project loading error:", error);

        setProject(null);
        setErrorMessage(
          error.code === "PGRST116"
            ? "This project could not be found."
            : error.message || "Could not load this project."
        );

        setLoading(false);
        return;
      }

      setProject(projectData);
      setLoading(false);
    }

    loadProject();
  }, [projectId]);

  if (loading) {
    return (
      <main className="project-workspace">
        <div className="project-loading">
          Loading project...
        </div>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="project-workspace">
        <div className="project-not-found">
          <h1>Project not found</h1>

          <p>
            {errorMessage ||
              "This project does not exist or has been removed."}
          </p>

          <Link href="/dashboard">
            Return to Dashboard
          </Link>
        </div>
      </main>
    );
  }
  async function handleDeleteProject() {
  const confirmed = window.confirm(
    `Delete "${project.name}" permanently?`
  );

  if (!confirmed) return;

  setDeleting(true);

  const { error } = await deleteProject(project.id);

  if (error) {
    alert(error.message || "Could not delete project.");
    setDeleting(false);
    return;
  }

  router.push("/dashboard");
  router.refresh();
}

  return (
    <main className="project-workspace">
      <header className="project-header">
        <div className="project-header-main">
          <Link
            href="/dashboard"
            className="project-back"
          >
            <ArrowLeft size={17} />
            Dashboard
          </Link>

          <span className="project-code">
            PROJECT #{project.id}
          </span>

          <h1>{project.name || "Untitled Project"}</h1>

          <p>
            {project.client || "Client not set"}
            {" · "}
            {project.location || "Location not set"}
          </p>
        </div>

        <div className="project-health">
          <span>Project Health</span>
<div className="project-header-actions">
  <Link
    href={`/projects/${project.id}/edit`}
    className="project-edit-button"
  >
    <Pencil size={17} />
    Edit Project
  </Link>

  <button
    type="button"
    className="project-delete-button"
    onClick={handleDeleteProject}
    disabled={deleting}
  >
    <Trash2 size={17} />

    {deleting ? "Deleting..." : "Delete"}
  </button>
</div>
          <strong>{project.health ?? 100}%</strong>
        </div>
      </header>

      <nav className="project-tabs">
        <button
          type="button"
          className="project-tab project-tab-active"
        >
          Overview
        </button>

        <button type="button" className="project-tab">
          Schedule
        </button>

        <button type="button" className="project-tab">
          Drawings
        </button>

        <button type="button" className="project-tab">
          BOQ
        </button>

        <button type="button" className="project-tab">
          Estimate
        </button>

        <button type="button" className="project-tab">
          Daily Reports
        </button>

        <button type="button" className="project-tab">
          Documents
        </button>
      </nav>

      <section className="project-summary-grid">
        <article className="project-summary-card">
          <CalendarDays size={21} />

          <span>Start Date</span>

          <strong>
            {formatDate(project.start_date)}
          </strong>
        </article>

        <article className="project-summary-card">
          <CalendarDays size={21} />

          <span>Deadline</span>

          <strong>
            {formatDate(project.deadline)}
          </strong>
        </article>

        <article className="project-summary-card">
          <ClipboardList size={21} />

          <span>Overall Progress</span>

          <strong>{project.progress ?? 0}%</strong>
        </article>

        <article className="project-summary-card">
          <WalletCards size={21} />

          <span>Project Budget</span>

          <strong>
            {formatCurrency(project.budget)}
          </strong>
        </article>

        <article className="project-summary-card">
          <FileText size={21} />

          <span>Pending Reports</span>

          <strong>
            {project.pending_reports ?? 0}
          </strong>
        </article>

        <article className="project-summary-card project-summary-warning">
          <TriangleAlert size={21} />

          <span>Open Issues</span>

          <strong>{project.open_issues ?? 0}</strong>
        </article>
      </section>

      <section className="project-content-stack">
        <ProjectTimeline projectId={project.id} />

        <ProjectTasks projectId={project.id} />

        <ProjectDailyReports projectId={project.id} />

        <ProjectActivity projectId={project.id} />

        <ProjectDocuments projectId={project.id} />

        <ProjectBOQ projectId={project.id} />

        <ProjectEstimate projectId={project.id} />

        <ProjectQuotation projectId={project.id} />

        <ProjectDrawingCenter projectId={project.id} />
      </section>

      <section className="project-side-grid">
        <article className="project-panel">
          <div className="project-panel-heading">
            <div>
              <span>PROJECT TEAM</span>
              <h2>Assigned Users</h2>
            </div>
          </div>

          <div className="project-user">
            <CircleUserRound size={32} />

            <div>
              <strong>
                {project.manager || "Not assigned"}
              </strong>

              <span>Project Manager</span>
            </div>
          </div>

          <div className="project-user">
            <CircleUserRound size={32} />

            <div>
              <strong>
                {project.supervisor || "Not assigned"}
              </strong>

              <span>Site Supervisor</span>
            </div>
          </div>
        </article>

        <article className="project-panel">
          <div className="project-panel-heading">
            <div>
              <span>PROJECT STATUS</span>
              <h2>Current Information</h2>
            </div>
          </div>

          <ul className="daily-update-list">
            <li>
              Status: {project.status || "Planning"}
            </li>

            <li>
              Progress: {project.progress ?? 0}%
            </li>

            <li>
              Budget: {formatCurrency(project.budget)}
            </li>

            <li>
              Data loaded from Supabase
            </li>
          </ul>

          <button
            type="button"
            className="daily-report-button"
          >
            Add Daily Report
          </button>
        </article>
      </section>
    </main>
  );
}