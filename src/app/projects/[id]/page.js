"use client";
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";


import { useEffect, useState } from "react";
import Link from "next/link";
import SignOutButton from "../../components/SignOutButton";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import {
  ArrowLeft,
  CalendarDays,
  CircleUserRound,
  ClipboardList,
  FileText,
  Pencil,
  Trash2,
  TriangleAlert,
  WalletCards,
} from "lucide-react";

import {
  deleteProject,
  getProjectById,
} from "@/services/projectService";

import ProjectControl from "./ProjectControl";
import ProjectProgressEditor from "./ProjectProgressEditor";
import ProjectTimeline from "./ProjectTimeline";
import ProjectTasks from "./ProjectTasks";
import ProjectDailyReports from "./ProjectDailyReports";
import ProjectActivity from "./ProjectActivity";
import ProjectPhotos from "./ProjectPhotos";
import ProjectDocuments from "./ProjectDocuments";
import ProjectBOQ from "./ProjectBOQ";
import ProjectEstimate from "./ProjectEstimate";
import ProjectQuotation from "./ProjectQuotation";
import ProjectDrawingCenter from "./ProjectDrawingCenter";
import Project3DViewer from "./Project3DViewer";

import "./ProjectWorkspace.css";

const PROJECT_TABS = [
  {id:"control",label:"Team & Contract"},
  { id: "overview", label: "Overview" },
  { id: "schedule", label: "Schedule" },
  { id: "drawings", label: "Drawings" },
  { id: "model3d", label: "3D Model" },
  { id: "tasks", label: "Tasks" },
  { id: "boq", label: "BOQ" },
  { id: "estimate", label: "Estimate" },
  { id: "quotation", label: "Quotation" },
  { id: "reports", label: "Daily Reports" },
  { id: "documents", label: "Documents" },
  { id: "photos", label: "Site photos" },
  { id: "activity", label: "Activity" },
];

function formatCurrency(value) {
  const amount = Number(value) || 0;

  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatStatus(value) {
  const statuses = {
    planning: "Planning",
    in_progress: "In Progress",
    on_hold: "On Hold",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  if (!value) {
    return "Planning";
  }

  return (
    statuses[value] ||
    String(value)
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) =>
        letter.toUpperCase()
      )
  );
}

function safePercentage(value) {
  const number = Number(value) || 0;

  return Math.min(Math.max(number, 0), 100);
}

export default function ProjectWorkspacePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const router = useRouter();

  const projectId = Array.isArray(params?.id)
    ? params.id[0]
    : params?.id;

  const [project, setProject] = useState(null);
  const [activeTab, setActiveTab] =
    useState("overview");

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState("");

  useEffect(() => {
    let mounted = true;

    async function loadProject() {
      if (PROJECT_TABS.some((tab) => tab.id === requestedTab)) setActiveTab(requestedTab);
      if (!projectId) {
        if (mounted) {
          setErrorMessage(
            "Project ID is missing."
          );
          setLoading(false);
        }

        return;
      }

      try {
        setLoading(true);
        setErrorMessage("");

        const result =
          await getProjectById(projectId);

        if (!mounted) {
          return;
        }

        /*
          این بخش هر دو مدل خروجی سرویس را پشتیبانی می‌کند:

          1) return project
          2) return { project, error }
        */
        const projectData =
          result?.project ?? result?.data ?? result;

        const projectError =
          result?.error ?? null;

        if (projectError) {
          console.error(
            "Project loading error:",
            projectError
          );

          setProject(null);
          setErrorMessage(
            projectError.message ||
              "Could not load this project."
          );

          return;
        }

        if (!projectData?.id) {
          setProject(null);
          setErrorMessage(
            "This project could not be found."
          );

          return;
        }

        setProject(projectData);
      } catch (error) {
        console.error(
          "Unexpected project loading error:",
          error
        );

        if (mounted) {
          setProject(null);
          setErrorMessage(
            error?.message ||
              "An unexpected error occurred while loading this project."
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadProject();

    return () => {
      mounted = false;
    };
  }, [projectId, requestedTab]);

  async function handleDeleteProject() {
    if (!project?.id || deleting) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${project.name}" permanently? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeleting(true);
      setErrorMessage("");

      const result = await deleteProject(
        project.id
      );

      const success =
        result?.success ?? result === true;

      const deleteError =
        result?.error ?? null;

      if (deleteError || !success) {
        throw new Error(
          deleteError?.message ||
            "Could not delete project."
        );
      }

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      console.error(
        "Delete project error:",
        error
      );

      setErrorMessage(
        error?.message ||
          "Could not delete this project."
      );
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <LocalizedElement as="main" className="project-workspace">
        <LocalizedElement as="div" className="project-loading">
          Loading project...
        </LocalizedElement>
      </LocalizedElement>
    );
  }

  if (!project) {
    return (
      <LocalizedElement as="main" className="project-workspace">
        <LocalizedElement as="div" className="project-not-found">
          <LocalizedElement as="h1">Project not found</LocalizedElement>

          <LocalizedElement as="p">
            {errorMessage ||
              "This project does not exist or you do not have access to it."}
          </LocalizedElement>

          <LocalizedLink  href="/dashboard">
            Return to Dashboard
          </LocalizedLink>
        </LocalizedElement>
      </LocalizedElement>
    );
  }

  const progress = safePercentage(
    project.progress
  );

  const health =
    project.health === null ||
    project.health === undefined
      ? 100
      : safePercentage(project.health);

  const projectCode = String(project.id)
    .slice(0, 8)
    .toUpperCase();

  const pendingReports =
    project.pending_reports ?? 0;

  const openIssues =
    project.open_issues ??
    project.open_issue ??
    0;

  return (
    <LocalizedElement as="main" className="project-workspace">
      <LocalizedElement as="header" className="project-header">
          <SignOutButton />
        <LocalizedElement as="div" className="project-header-main">
          <LocalizedLink 
            href="/dashboard"
            className="project-back"
          >
            <ArrowLeft size={17} />
            Dashboard
          </LocalizedLink>

          <LocalizedElement as="span" className="project-code">
            PROJECT #{projectCode}
          </LocalizedElement>

          <LocalizedElement as="h1">
            <OriginalText>{project.name || "Untitled Project"}</OriginalText>
          </LocalizedElement>

          <LocalizedElement as="p">
            {project.client_name ||
              "Client not set"}
            {" · "}
            {project.location ||
              "Location not set"}
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="div" className="project-health">
          <LocalizedElement as="span">Project Health</LocalizedElement>

          <LocalizedElement as="div" className="project-header-actions">
            <LocalizedLink 
              href={`/projects/${project.id}/edit`}
              className="project-edit-button"
            >
              <Pencil size={17} />
              Edit Project
            </LocalizedLink>

            <LocalizedElement as="button"
              type="button"
              className="project-delete-button"
              onClick={handleDeleteProject}
              disabled={deleting}
            >
              <Trash2 size={17} />

              {deleting
                ? "Deleting..."
                : "Delete"}
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="strong">{health}%</LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>

      {errorMessage && (
        <LocalizedElement as="div" className="project-error-message">
          {errorMessage}
        </LocalizedElement>
      )}

      <LocalizedElement as="nav"
        className="project-tabs"
        aria-label="Project workspace sections"
      >
        {PROJECT_TABS.map((tab) => (
          <LocalizedElement as="button"
            key={tab.id}
            type="button"
            className={`project-tab ${
              activeTab === tab.id
                ? "project-tab-active"
                : ""
            }`}
            onClick={() =>
              setActiveTab(tab.id)
            }
          >
            {tab.label}
          </LocalizedElement>
        ))}
      </LocalizedElement>

      {activeTab === "overview" && (
        <LocalizedElement as="section" className="project-summary-grid">
          <LocalizedElement as="article" className="project-summary-card">
            <CalendarDays size={21} />
            <LocalizedElement as="span">Start Date</LocalizedElement>
            <LocalizedElement as="strong">
              {formatDate(project.start_date)}
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="article" className="project-summary-card">
            <CalendarDays size={21} />
            <LocalizedElement as="span">End Date</LocalizedElement>
            <LocalizedElement as="strong">
              {formatDate(project.end_date)}
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="article" className="project-summary-card">
            <ClipboardList size={21} />
            <LocalizedElement as="span">Overall Progress</LocalizedElement>
            <LocalizedElement as="strong">{progress}%</LocalizedElement>
            <ProjectProgressEditor project={project} onSaved={setProject} />
          </LocalizedElement>

          <LocalizedElement as="article" className="project-summary-card">
            <WalletCards size={21} />
            <LocalizedElement as="span">Project Budget</LocalizedElement>
            <LocalizedElement as="strong">
              {formatCurrency(project.budget)}
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="article" className="project-summary-card">
            <FileText size={21} />
            <LocalizedElement as="span">Pending Reports</LocalizedElement>
            <LocalizedElement as="strong">{pendingReports}</LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="article" className="project-summary-card project-summary-warning">
            <TriangleAlert size={21} />
            <LocalizedElement as="span">Open Issues</LocalizedElement>
            <LocalizedElement as="strong">{openIssues}</LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      )}

      <LocalizedElement as="section" className="project-content-stack">
        {activeTab === "control" && <ProjectControl key={project.id} projectId={project.id} />}
        {activeTab === "overview" && (
          <>
            <ProjectTimeline
              projectId={project.id}
              projectStart={project.start_date}
            />

            <ProjectTasks
              projectId={project.id}
            />

            <ProjectActivity
              projectId={project.id}
            />
          </>
        )}

        {activeTab === "schedule" && (
          <ProjectTimeline
            projectId={project.id}
            projectStart={project.start_date}
          />
        )}

        {activeTab === "drawings" && (
  <ProjectDrawingCenter
    projectId={project.id}
    onOpenBoq={() => setActiveTab("boq")}
  />
)}

        {activeTab === "model3d" && (
          <Project3DViewer
            projectId={project.id}
          />
        )}

        {activeTab === "tasks" && (
          <ProjectTasks
            projectId={project.id}
          />
        )}

      <OriginalText>{activeTab === "boq" && (
  <ProjectBOQ
    projectId={project.id}
    projectName={
      project.name || "Untitled Project"
    }
  />
)}</OriginalText>

{activeTab === "estimate" && (
  <ProjectEstimate
    projectId={project.id}
  />
)}

        {activeTab === "quotation" && (
          <ProjectQuotation
            projectId={project.id}
          />
        )}

        {activeTab === "reports" && (
          <ProjectDailyReports
            projectId={project.id}
          />
        )}

        {activeTab === "photos" && <ProjectPhotos projectId={projectId}/>}
        {activeTab === "documents" && (
          <ProjectDocuments
            projectId={project.id}
          />
        )}

        {activeTab === "activity" && (
          <ProjectActivity
            projectId={project.id}
          />
        )}
      </LocalizedElement>

      {activeTab === "overview" && (
        <LocalizedElement as="section" className="project-side-grid">
          <LocalizedElement as="article" className="project-panel">
            <LocalizedElement as="div" className="project-panel-heading">
              <LocalizedElement as="div">
                <LocalizedElement as="span">PROJECT TEAM</LocalizedElement>
                <LocalizedElement as="h2">Assigned Users</LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="div" className="project-user">
              <CircleUserRound size={32} />

              <LocalizedElement as="div">
                <LocalizedElement as="strong">
                  {project.manager ||
                    "Not assigned"}
                </LocalizedElement>

                <LocalizedElement as="span">Project Manager</LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="div" className="project-user">
              <CircleUserRound size={32} />

              <LocalizedElement as="div">
                <LocalizedElement as="strong">
                  {project.supervisor ||
                    "Not assigned"}
                </LocalizedElement>

                <LocalizedElement as="span">Site Supervisor</LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="article" className="project-panel">
            <LocalizedElement as="div" className="project-panel-heading">
              <LocalizedElement as="div">
                <LocalizedElement as="span">PROJECT STATUS</LocalizedElement>
                <LocalizedElement as="h2">Current Information</LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="ul" className="daily-update-list">
              <LocalizedElement as="li">
                Status:{" "}
                {formatStatus(project.status)}
              </LocalizedElement>

              <LocalizedElement as="li">
                Progress: {progress}%
              </LocalizedElement>

              <LocalizedElement as="li">
                Budget:{" "}
                {formatCurrency(
                  project.budget
                )}
              </LocalizedElement>

              <LocalizedElement as="li">
                Client:{" "}
                {project.client_name ||
                  "Not set"}
              </LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="button"
              type="button"
              className="daily-report-button"
              onClick={() =>
                setActiveTab("reports")
              }
            >
              Add Daily Report
            </LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      )}
    </LocalizedElement>
  );
}
