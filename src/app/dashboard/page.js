"use client";
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import {meanProjectProgress} from "@/lib/projectProgress.mjs";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Bell,
  Building2,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileBarChart,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import {
  getCurrentUser,
  signOutUser,
} from "@/services/authService";

import "./Dashboard.css";

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function initializeDashboard() {
      try {
        setLoading(true);

        const {
          user: currentUser,
          error: userError,
        } = await getCurrentUser();

        if (userError) {
         console.warn(
  "User loading warning:",
  userError
);
        }

        if (!currentUser) {
          router.replace("/login");
          return;
        }

        if (isMounted) {
          setUser(currentUser);
        }

        const { data, error } = await supabase
          .from("projects")
          .select("*")
          .eq("user_id", currentUser.id)
          .order("created_at", {
            ascending: false,
          });

        if (error) {
          console.error(
            "Project loading error:",
            error.message
          );

          if (isMounted) {
            setProjects([]);
          }

          return;
        }

        if (isMounted) {
          setProjects(data || []);
        }
      } catch (error) {
        console.error(
          "Dashboard initialization error:",
          error
        );

        if (isMounted) {
          setProjects([]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    initializeDashboard();

    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleLogout() {
    try {
      const { error } = await signOutUser();

      if (error) {
        console.error(
          "Logout error:",
          error.message
        );

        return;
      }

      router.replace("/login");
      router.refresh();
    } catch (error) {
      console.error("Logout error:", error);
    }
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  const filteredProjects = useMemo(() => {
    const keyword = searchValue
      .trim()
      .toLowerCase();

    if (!keyword) {
      return projects;
    }

    return projects.filter((project) => {
      const projectName =
        project.name?.toLowerCase() || "";

      const projectLocation =
        project.location?.toLowerCase() || "";

      const projectStatus =
        project.status?.toLowerCase() || "";

      return (
        projectName.includes(keyword) ||
        projectLocation.includes(keyword) ||
        projectStatus.includes(keyword)
      );
    });
  }, [projects, searchValue]);

  const activeProjects = useMemo(() => {
    return projects.filter((project) => {
      const status =
        project.status?.toLowerCase();

      return (
        status === "active" ||
        status === "in progress" || status === "in_progress"
      );
    }).length;
  }, [projects]);

  const completedProjects = useMemo(() => {
    return projects.filter((project) => {
      return (
        project.status?.toLowerCase() ===
        "completed"
      );
    }).length;
  }, [projects]);

  const totalBudget = useMemo(() => {
    return projects.reduce(
      (total, project) => {
        const projectBudget =
          Number(project.budget) || 0;

        return total + projectBudget;
      },
      0
    );
  }, [projects]);

  const fullName =
    user?.user_metadata?.full_name || "";

  const firstName =
    fullName.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "there";

  const avatarLetter =
    firstName.charAt(0).toUpperCase() || "V";

  if (loading) {
    return (
      <LocalizedElement as="main" className="vt-db-loading">
        <LocalizedElement as="div" className="vt-db-loading__logo">
          <Building2 size={24} />
        </LocalizedElement>

        <LocalizedElement as="div" className="vt-db-loading__spinner" />

        <LocalizedElement as="p">Loading your workspace...</LocalizedElement>
      </LocalizedElement>
    );
  }

  return (
    <LocalizedElement as="main" className="vt-db-page">
      <LocalizedElement as="button"
        type="button"
        className={`vt-db-overlay ${
          sidebarOpen ? "is-visible" : ""
        }`}
        onClick={closeSidebar}
        aria-label="Close sidebar overlay"
      />

      <LocalizedElement as="aside"
        className={`vt-db-sidebar ${
          sidebarOpen ? "is-open" : ""
        }`}
      >
        <LocalizedElement as="div" className="vt-db-sidebar__top">
          <LocalizedLink 
            href="/"
            className="vt-db-brand"
            onClick={closeSidebar}
          >
            <LocalizedElement as="span" className="vt-db-brand__icon">
              <Building2 size={23} />
            </LocalizedElement>

            <LocalizedElement as="span" className="vt-db-brand__text">
              Ventra
            </LocalizedElement>
          </LocalizedLink>

          <LocalizedElement as="button"
            type="button"
            className="vt-db-sidebar__close"
            onClick={closeSidebar}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="nav" className="vt-db-nav">
          <LocalizedElement as="p" className="vt-db-nav__label">
            Workspace
          </LocalizedElement>

          <LocalizedLink 
            href="/dashboard"
            className="vt-db-nav__item is-active"
            onClick={closeSidebar}
          >
            <LayoutDashboard size={19} />
            <LocalizedElement as="span">Overview</LocalizedElement>
          </LocalizedLink>

          <LocalizedLink 
            href="/dashboard#projects"
            className="vt-db-nav__item"
            onClick={closeSidebar}
          >
            <FolderKanban size={19} />
            <LocalizedElement as="span">Projects</LocalizedElement>

            <LocalizedElement as="span" className="vt-db-nav__count">
              {projects.length}
            </LocalizedElement>
          </LocalizedLink>

          <LocalizedLink 
            href="/tools/estimate"
            className="vt-db-nav__item"
            onClick={closeSidebar}
          >
            <Sparkles size={19} />
            <LocalizedElement as="span">AI Estimation</LocalizedElement>
          </LocalizedLink>

          <LocalizedLink 
            href="/tools/boq"
            className="vt-db-nav__item"
            onClick={closeSidebar}
          >
            <FileBarChart size={19} />
            <LocalizedElement as="span">BOQ</LocalizedElement>
          </LocalizedLink>

          <LocalizedLink 
            href="/tools/documents"
            className="vt-db-nav__item"
            onClick={closeSidebar}
          >
            <FileText size={19} />
            <LocalizedElement as="span">Documents</LocalizedElement>
          </LocalizedLink>

          <LocalizedElement as="p" className="vt-db-nav__label vt-db-nav__label--second">
            Management
          </LocalizedElement>

          <LocalizedLink 
            href="/profile"
            className="vt-db-nav__item"
            onClick={closeSidebar}
          >
            <Users size={19} />
            <LocalizedElement as="span">My account</LocalizedElement>
          </LocalizedLink>

          <LocalizedLink 
            href="/profile"
            className="vt-db-nav__item"
            onClick={closeSidebar}
          >
            <Settings size={19} />
            <LocalizedElement as="span">Settings</LocalizedElement>
          </LocalizedLink>
        </LocalizedElement>

        <LocalizedElement as="div" className="vt-db-sidebar__bottom">
          <LocalizedElement as="div" className="vt-db-plan">
            <LocalizedElement as="div" className="vt-db-plan__icon">
              <Sparkles size={18} />
            </LocalizedElement>

            <LocalizedElement as="div">
              <LocalizedElement as="strong">Billing & subscription</LocalizedElement>
              <LocalizedElement as="span">Upgrade your workspace</LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="button" type="button" onClick={() => router.push("/billing")}>
              Upgrade
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="div" className="vt-db-profile">
            <LocalizedElement as="div" className="vt-db-profile__avatar">
              {avatarLetter}
            </LocalizedElement>

            <LocalizedElement as="div" className="vt-db-profile__details">
              <LocalizedElement as="strong">
                {fullName || firstName}
              </LocalizedElement>

              <LocalizedElement as="span">{user?.email}</LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="button"
              type="button"
              className="vt-db-profile__logout"
              onClick={handleLogout}
              aria-label="Log out"
            >
              <LogOut size={18} />
            </LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="section" className="vt-db-main">
        <LocalizedElement as="header" className="vt-db-header">
          <LocalizedElement as="div" className="vt-db-header__left">
            <LocalizedElement as="button"
              type="button"
              className="vt-db-menu-button"
              onClick={() =>
                setSidebarOpen(true)
              }
              aria-label="Open sidebar"
            >
              <Menu size={21} />
            </LocalizedElement>

            <LocalizedElement as="div">
              <LocalizedElement as="h1">Dashboard</LocalizedElement>
              <LocalizedElement as="p">
                Manage your construction
                workspace.
              </LocalizedElement>
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="div" className="vt-db-header__actions">
            <LocalizedElement as="label" className="vt-db-search">
              <Search size={18} />

              <LocalizedElement as="input"
                type="search"
                value={searchValue}
                onChange={(event) =>
                  setSearchValue(
                    event.target.value
                  )
                }
                placeholder="Search projects..."
                aria-label="Search projects"
              />
            </LocalizedElement>

            <LocalizedElement as="button"
              type="button"
              className="vt-db-icon-button"
              aria-label="Notifications"
              onClick={() => router.push("/notifications")}
            >
              <Bell size={20} />

              
            </LocalizedElement>

            <LocalizedLink 
              href="/projects/new"
              className="vt-db-primary-button"
            >
              <Plus size={18} />
              <LocalizedElement as="span">New project</LocalizedElement>
            </LocalizedLink>
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="div" className="vt-db-body">
          <LocalizedElement as="section" className="vt-db-hero">
            <LocalizedElement as="div" className="vt-db-hero__content">
              <LocalizedElement as="span" className="vt-db-hero__badge">
                <Sparkles size={15} />
                AI construction workspace
              </LocalizedElement>

              <LocalizedElement as="h2">
                Welcome back, {firstName}.
              </LocalizedElement>

              <LocalizedElement as="p">
                Track projects, prepare estimates
                and manage construction data from
                one connected workspace.
              </LocalizedElement>

              <LocalizedElement as="div" className="vt-db-hero__buttons">
                <LocalizedLink 
                  href="/projects/new"
                  className="vt-db-primary-button"
                >
                  <Plus size={18} />
                  Create project
                </LocalizedLink>

                <LocalizedLink 
                  href="/tools/drawings"
                  className="vt-db-secondary-button"
                >
                  <Upload size={18} />
                  Upload drawings
                </LocalizedLink>
              </LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="div" className="vt-db-hero__visual">
              <LocalizedElement as="div" className="vt-db-hero__glow" />

              <LocalizedElement as="div" className="vt-db-ai-card">
                <LocalizedElement as="span" className="vt-db-ai-card__icon">
                  <Sparkles size={20} />
                </LocalizedElement>

                <LocalizedElement as="div">
                  <LocalizedElement as="strong">AI Estimator</LocalizedElement>

                  <LocalizedElement as="p">
                    Ready to analyze drawings
                  </LocalizedElement>
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="div" className="vt-db-hero__metric">
                <LocalizedElement as="span">Average project progress</LocalizedElement>
                <LocalizedElement as="strong">{meanProjectProgress(projects)===null?"Not recorded":`${meanProjectProgress(projects)}%`}</LocalizedElement>

                <LocalizedElement as="div" className="vt-db-progress">
                  <LocalizedElement as="span"
                    style={{
                      width: `${meanProjectProgress(projects)??0}%`,
                    }}
                  />
                </LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="section" className="vt-db-stats-grid">
            <StatCard
              icon={
                <FolderKanban size={21} />
              }
              label="Total projects"
              value={projects.length}
              note="All workspace projects"
            />

            <StatCard
              icon={<Clock3 size={21} />}
              label="Active projects"
              value={activeProjects}
              note="Currently in progress"
            />

            <StatCard
              icon={
                <CircleDollarSign size={21} />
              }
              label="Total budget"
              value={formatCurrency(
                totalBudget
              )}
              note="Combined project value"
            />

            <StatCard
              icon={
                <FileBarChart size={21} />
              }
              label="Completed"
              value={completedProjects}
              note="Successfully delivered"
            />
          </LocalizedElement>

          <LocalizedElement as="div" className="vt-db-layout">
            <LocalizedElement as="div" className="vt-db-layout__main">
              <LocalizedElement as="section"
                id="projects"
                className="vt-db-panel"
              >
                <LocalizedElement as="div" className="vt-db-panel__header">
                  <LocalizedElement as="div">
                    <LocalizedElement as="span" className="vt-db-panel__eyebrow">
                      Project workspace
                    </LocalizedElement>

                    <LocalizedElement as="h2">Recent projects</LocalizedElement>
                  </LocalizedElement>

                  <LocalizedLink 
                    href="/dashboard#projects"
                    className="vt-db-text-link"
                  >
                    View all
                    <ChevronRight size={17} />
                  </LocalizedLink>
                </LocalizedElement>

                {filteredProjects.length > 0 ? (
                  <LocalizedElement as="div" className="vt-db-project-grid">
                    {filteredProjects
                      .slice(0, 6)
                      .map((project) => (
                        <ProjectCard
                          key={project.id}
                          project={project}
                        />
                      ))}
                  </LocalizedElement>
                ) : (
                  <LocalizedElement as="div" className="vt-db-empty">
                    <LocalizedElement as="div" className="vt-db-empty__icon">
                      <FolderKanban size={28} />
                    </LocalizedElement>

                    <LocalizedElement as="h3">
                      {searchValue
                        ? "No matching projects found"
                        : "No projects yet"}
                    </LocalizedElement>

                    <LocalizedElement as="p">
                      {searchValue
                        ? "Try another project name, location or status."
                        : "Create your first project to start estimating and managing construction work."}
                    </LocalizedElement>

                    {!searchValue && (
                      <LocalizedLink 
                        href="/projects/new"
                        className="vt-db-primary-button"
                      >
                        <Plus size={18} />
                        Create first project
                      </LocalizedLink>
                    )}
                  </LocalizedElement>
                )}
              </LocalizedElement>

              <LocalizedElement as="section" className="vt-db-panel">
                <LocalizedElement as="div" className="vt-db-panel__header">
                  <LocalizedElement as="div">
                    <LocalizedElement as="span" className="vt-db-panel__eyebrow">
                      Latest updates
                    </LocalizedElement>

                    <LocalizedElement as="h2">Recent activity</LocalizedElement>
                  </LocalizedElement>
                </LocalizedElement>

                <LocalizedElement as="div" className="vt-db-activity-list">
                  <ActivityItem
                    icon={<Upload size={18} />}
                    title="Drawing upload available"
                    description="Upload PDF, DWG, IFC or image files for analysis."
                    time="Workspace tool"
                  />

                  <ActivityItem
                    icon={
                      <Sparkles size={18} />
                    }
                    title="AI estimation workspace ready"
                    description="Generate quantities and preliminary estimates from drawings."
                    time="AI module"
                  />

                  <ActivityItem
                    icon={<Users size={18} />}
                    title="Account settings"
                    description="Update your profile and review account details."
                    time="Account"
                  />
                </LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="aside" className="vt-db-layout__aside">
              <LocalizedElement as="section" className="vt-db-panel vt-db-quick-panel">
                <LocalizedElement as="div" className="vt-db-panel__header">
                  <LocalizedElement as="div">
                    <LocalizedElement as="span" className="vt-db-panel__eyebrow">
                      Shortcuts
                    </LocalizedElement>

                    <LocalizedElement as="h2">Quick actions</LocalizedElement>
                  </LocalizedElement>
                </LocalizedElement>

                <LocalizedElement as="div" className="vt-db-actions-list">
                  <QuickAction
                    href="/projects/new"
                    icon={<Plus size={20} />}
                    title="Create project"
                    description="Start a new workspace"
                  />

                  <QuickAction
                    href="/dashboard"
                    icon={<Upload size={20} />}
                    title="Upload drawings"
                    description="PDF, DWG, IFC or images"
                  />

                  <QuickAction
                    href="/dashboard"
                    icon={
                      <Sparkles size={20} />
                    }
                    title="AI estimation"
                    description="Analyze project quantities"
                  />

                  <QuickAction
                    href="/dashboard"
                    icon={
                      <FileBarChart size={20} />
                    }
                    title="Create BOQ"
                    description="Prepare editable quantities"
                  />
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="section" className="vt-db-panel">
                <LocalizedElement as="div" className="vt-db-panel__header">
                  <LocalizedElement as="div">
                    <LocalizedElement as="span" className="vt-db-panel__eyebrow">
                      This week
                    </LocalizedElement>

                    <LocalizedElement as="h2">Workspace summary</LocalizedElement>
                  </LocalizedElement>
                </LocalizedElement>

                <LocalizedElement as="div" className="vt-db-summary">
                  <SummaryRow
                    label="Projects"
                    value={`${projects.length}`}
                    progress={Math.min(
                      projects.length * 10,
                      100
                    )}
                  />

                  <SummaryRow
                    label="Storage usage"
                    value="Not measured"
                    progress={0}
                  />

                  <SummaryRow
                    label="Account"
                    value="Your account"
                    progress={0}
                  />
                </LocalizedElement>

                <LocalizedLink 
                  href="/profile"
                  className="vt-db-summary__button"
                >
                  Manage workspace
                  <ChevronRight size={17} />
                </LocalizedLink>
              </LocalizedElement>

              <LocalizedElement as="section" className="vt-db-upgrade-card">
                <LocalizedElement as="span" className="vt-db-upgrade-card__icon">
                  <Sparkles size={21} />
                </LocalizedElement>

                <LocalizedElement as="h3">
                  Unlock full AI analysis
                </LocalizedElement>

                <LocalizedElement as="p">
                  Generate detailed quantities,
                  UAE pricing and professional
                  quotations.
                </LocalizedElement>

                <LocalizedElement as="button" type="button" onClick={() => router.push("/pricing")}>
                  Explore plans
                  <ChevronRight size={17} />
                </LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
  );
}

function StatCard({
  icon,
  label,
  value,
  note,
}) {
  return (
    <LocalizedElement as="article" className="vt-db-stat-card">
      <LocalizedElement as="div" className="vt-db-stat-card__top">
        <LocalizedElement as="span" className="vt-db-stat-card__icon">
          {icon}
        </LocalizedElement>

        <LocalizedElement as="button"
          type="button"
          aria-label={`More options for ${label}`}
        >
          <MoreHorizontal size={19} />
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="strong" className="vt-db-stat-card__value">
        {value}
      </LocalizedElement>

      <LocalizedElement as="span" className="vt-db-stat-card__label">
        {label}
      </LocalizedElement>

      <LocalizedElement as="p">{note}</LocalizedElement>
    </LocalizedElement>
  );
}

function ProjectCard({ project }) {
  const progress = Math.min(
    Math.max(Number(project.progress) || 0, 0),
    100
  );

  const projectStatus =
    project.status || "Planning";

  const projectName =
    project.name || "Untitled project";

  const projectLocation =
    project.location ||
    "Location not added";

  return (
    <LocalizedLink 
      href={`/projects/${project.id}`}
      className="vt-db-project-card"
    >
      <LocalizedElement as="div" className="vt-db-project-card__top">
        <LocalizedElement as="span" className="vt-db-project-card__folder">
          <FolderKanban size={21} />
        </LocalizedElement>

        <LocalizedElement as="span"
          className={`vt-db-status ${getStatusClass(
            projectStatus
          )}`}
        >
          {projectStatus}
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="h3"><OriginalText>{projectName}</OriginalText></LocalizedElement>
      <LocalizedElement as="p">{projectLocation}</LocalizedElement>

      <LocalizedElement as="div" className="vt-db-project-card__meta">
        <LocalizedElement as="span">
          <CalendarDays size={15} />
          {formatDate(project.created_at)}
        </LocalizedElement>

        <LocalizedElement as="span">{progress}%</LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="div" className="vt-db-progress">
        <LocalizedElement as="span"
          style={{
            width: `${progress}%`,
          }}
        />
      </LocalizedElement>

      <LocalizedElement as="div" className="vt-db-project-card__footer">
        <LocalizedElement as="span">Open workspace</LocalizedElement>
        <ChevronRight size={17} />
      </LocalizedElement>
    </LocalizedLink>
  );
}

function QuickAction({
  href,
  icon,
  title,
  description,
}) {
  return (
    <LocalizedLink 
      href={href}
      className="vt-db-quick-action"
    >
      <LocalizedElement as="span" className="vt-db-quick-action__icon">
        {icon}
      </LocalizedElement>

      <LocalizedElement as="span" className="vt-db-quick-action__content">
        <LocalizedElement as="strong">{title}</LocalizedElement>
        <LocalizedElement as="small">{description}</LocalizedElement>
      </LocalizedElement>

      <ChevronRight size={18} />
    </LocalizedLink>
  );
}

function ActivityItem({
  icon,
  title,
  description,
  time,
}) {
  return (
    <LocalizedElement as="article" className="vt-db-activity">
      <LocalizedElement as="span" className="vt-db-activity__icon">
        {icon}
      </LocalizedElement>

      <LocalizedElement as="div" className="vt-db-activity__content">
        <LocalizedElement as="strong">{title}</LocalizedElement>
        <LocalizedElement as="p">{description}</LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="span" className="vt-db-activity__time">
        {time}
      </LocalizedElement>
    </LocalizedElement>
  );
}

function SummaryRow({
  label,
  value,
  progress,
}) {
  const safeProgress = Math.min(
    Math.max(Number(progress) || 0, 0),
    100
  );

  return (
    <LocalizedElement as="div" className="vt-db-summary__row">
      <LocalizedElement as="div" className="vt-db-summary__details">
        <LocalizedElement as="span">{label}</LocalizedElement>
        <LocalizedElement as="strong">{value}</LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="div" className="vt-db-progress">
        <LocalizedElement as="span"
          style={{
            width: `${safeProgress}%`,
          }}
        />
      </LocalizedElement>
    </LocalizedElement>
  );
}

function formatCurrency(value) {
  const numericValue = Number(value) || 0;

  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(numericValue);
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "Recently created";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "Recently created";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getStatusClass(status) {
  const normalizedStatus = String(status)
    .trim()
    .toLowerCase();

  if (
    normalizedStatus === "active" ||
    normalizedStatus === "in progress"
  ) {
    return "is-active";
  }

  if (normalizedStatus === "completed") {
    return "is-completed";
  }

  if (
    normalizedStatus === "on hold" ||
    normalizedStatus === "paused"
  ) {
    return "is-paused";
  }

  return "is-planning";
}
