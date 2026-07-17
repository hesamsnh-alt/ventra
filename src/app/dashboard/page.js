"use client";

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
          console.error(
            "User loading error:",
            userError.message
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
        status === "in progress"
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
      <main className="vt-db-loading">
        <div className="vt-db-loading__logo">
          <Building2 size={24} />
        </div>

        <div className="vt-db-loading__spinner" />

        <p>Loading your workspace...</p>
      </main>
    );
  }

  return (
    <main className="vt-db-page">
      <button
        type="button"
        className={`vt-db-overlay ${
          sidebarOpen ? "is-visible" : ""
        }`}
        onClick={closeSidebar}
        aria-label="Close sidebar overlay"
      />

      <aside
        className={`vt-db-sidebar ${
          sidebarOpen ? "is-open" : ""
        }`}
      >
        <div className="vt-db-sidebar__top">
          <Link
            href="/"
            className="vt-db-brand"
            onClick={closeSidebar}
          >
            <span className="vt-db-brand__icon">
              <Building2 size={23} />
            </span>

            <span className="vt-db-brand__text">
              Ventra
            </span>
          </Link>

          <button
            type="button"
            className="vt-db-sidebar__close"
            onClick={closeSidebar}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="vt-db-nav">
          <p className="vt-db-nav__label">
            Workspace
          </p>

          <Link
            href="/dashboard"
            className="vt-db-nav__item is-active"
            onClick={closeSidebar}
          >
            <LayoutDashboard size={19} />
            <span>Overview</span>
          </Link>

          <Link
            href="/dashboard#projects"
            className="vt-db-nav__item"
            onClick={closeSidebar}
          >
            <FolderKanban size={19} />
            <span>Projects</span>

            <span className="vt-db-nav__count">
              {projects.length}
            </span>
          </Link>

          <Link
            href="/dashboard"
            className="vt-db-nav__item"
            onClick={closeSidebar}
          >
            <Sparkles size={19} />
            <span>AI Estimation</span>
          </Link>

          <Link
            href="/dashboard"
            className="vt-db-nav__item"
            onClick={closeSidebar}
          >
            <FileBarChart size={19} />
            <span>BOQ</span>
          </Link>

          <Link
            href="/dashboard"
            className="vt-db-nav__item"
            onClick={closeSidebar}
          >
            <FileText size={19} />
            <span>Documents</span>
          </Link>

          <p className="vt-db-nav__label vt-db-nav__label--second">
            Management
          </p>

          <Link
            href="/dashboard"
            className="vt-db-nav__item"
            onClick={closeSidebar}
          >
            <Users size={19} />
            <span>Team</span>
          </Link>

          <Link
            href="/dashboard"
            className="vt-db-nav__item"
            onClick={closeSidebar}
          >
            <Settings size={19} />
            <span>Settings</span>
          </Link>
        </nav>

        <div className="vt-db-sidebar__bottom">
          <div className="vt-db-plan">
            <div className="vt-db-plan__icon">
              <Sparkles size={18} />
            </div>

            <div>
              <strong>Starter plan</strong>
              <span>Upgrade your workspace</span>
            </div>

            <button type="button">
              Upgrade
            </button>
          </div>

          <div className="vt-db-profile">
            <div className="vt-db-profile__avatar">
              {avatarLetter}
            </div>

            <div className="vt-db-profile__details">
              <strong>
                {fullName || firstName}
              </strong>

              <span>{user?.email}</span>
            </div>

            <button
              type="button"
              className="vt-db-profile__logout"
              onClick={handleLogout}
              aria-label="Log out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      <section className="vt-db-main">
        <header className="vt-db-header">
          <div className="vt-db-header__left">
            <button
              type="button"
              className="vt-db-menu-button"
              onClick={() =>
                setSidebarOpen(true)
              }
              aria-label="Open sidebar"
            >
              <Menu size={21} />
            </button>

            <div>
              <h1>Dashboard</h1>
              <p>
                Manage your construction
                workspace.
              </p>
            </div>
          </div>

          <div className="vt-db-header__actions">
            <label className="vt-db-search">
              <Search size={18} />

              <input
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
            </label>

            <button
              type="button"
              className="vt-db-icon-button"
              aria-label="Notifications"
            >
              <Bell size={20} />

              <span className="vt-db-notification-dot" />
            </button>

            <Link
              href="/projects/new"
              className="vt-db-primary-button"
            >
              <Plus size={18} />
              <span>New project</span>
            </Link>
          </div>
        </header>

        <div className="vt-db-body">
          <section className="vt-db-hero">
            <div className="vt-db-hero__content">
              <span className="vt-db-hero__badge">
                <Sparkles size={15} />
                AI construction workspace
              </span>

              <h2>
                Welcome back, {firstName}.
              </h2>

              <p>
                Track projects, prepare estimates
                and manage construction data from
                one connected workspace.
              </p>

              <div className="vt-db-hero__buttons">
                <Link
                  href="/projects/new"
                  className="vt-db-primary-button"
                >
                  <Plus size={18} />
                  Create project
                </Link>

                <Link
                  href="/dashboard"
                  className="vt-db-secondary-button"
                >
                  <Upload size={18} />
                  Upload drawings
                </Link>
              </div>
            </div>

            <div className="vt-db-hero__visual">
              <div className="vt-db-hero__glow" />

              <div className="vt-db-ai-card">
                <span className="vt-db-ai-card__icon">
                  <Sparkles size={20} />
                </span>

                <div>
                  <strong>AI Estimator</strong>

                  <p>
                    Ready to analyze drawings
                  </p>
                </div>
              </div>

              <div className="vt-db-hero__metric">
                <span>Workspace health</span>
                <strong>92%</strong>

                <div className="vt-db-progress">
                  <span
                    style={{
                      width: "92%",
                    }}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="vt-db-stats-grid">
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
          </section>

          <div className="vt-db-layout">
            <div className="vt-db-layout__main">
              <section
                id="projects"
                className="vt-db-panel"
              >
                <div className="vt-db-panel__header">
                  <div>
                    <span className="vt-db-panel__eyebrow">
                      Project workspace
                    </span>

                    <h2>Recent projects</h2>
                  </div>

                  <Link
                    href="/dashboard#projects"
                    className="vt-db-text-link"
                  >
                    View all
                    <ChevronRight size={17} />
                  </Link>
                </div>

                {filteredProjects.length > 0 ? (
                  <div className="vt-db-project-grid">
                    {filteredProjects
                      .slice(0, 6)
                      .map((project) => (
                        <ProjectCard
                          key={project.id}
                          project={project}
                        />
                      ))}
                  </div>
                ) : (
                  <div className="vt-db-empty">
                    <div className="vt-db-empty__icon">
                      <FolderKanban size={28} />
                    </div>

                    <h3>
                      {searchValue
                        ? "No matching projects found"
                        : "No projects yet"}
                    </h3>

                    <p>
                      {searchValue
                        ? "Try another project name, location or status."
                        : "Create your first project to start estimating and managing construction work."}
                    </p>

                    {!searchValue && (
                      <Link
                        href="/projects/new"
                        className="vt-db-primary-button"
                      >
                        <Plus size={18} />
                        Create first project
                      </Link>
                    )}
                  </div>
                )}
              </section>

              <section className="vt-db-panel">
                <div className="vt-db-panel__header">
                  <div>
                    <span className="vt-db-panel__eyebrow">
                      Latest updates
                    </span>

                    <h2>Recent activity</h2>
                  </div>
                </div>

                <div className="vt-db-activity-list">
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
                    title="Team collaboration enabled"
                    description="Invite project managers and site supervisors."
                    time="Team module"
                  />
                </div>
              </section>
            </div>

            <aside className="vt-db-layout__aside">
              <section className="vt-db-panel vt-db-quick-panel">
                <div className="vt-db-panel__header">
                  <div>
                    <span className="vt-db-panel__eyebrow">
                      Shortcuts
                    </span>

                    <h2>Quick actions</h2>
                  </div>
                </div>

                <div className="vt-db-actions-list">
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
                </div>
              </section>

              <section className="vt-db-panel">
                <div className="vt-db-panel__header">
                  <div>
                    <span className="vt-db-panel__eyebrow">
                      This week
                    </span>

                    <h2>Workspace summary</h2>
                  </div>
                </div>

                <div className="vt-db-summary">
                  <SummaryRow
                    label="Project capacity"
                    value={`${projects.length}/10`}
                    progress={Math.min(
                      projects.length * 10,
                      100
                    )}
                  />

                  <SummaryRow
                    label="Storage usage"
                    value="1.4 GB"
                    progress={28}
                  />

                  <SummaryRow
                    label="Team members"
                    value="1/2"
                    progress={50}
                  />
                </div>

                <Link
                  href="/dashboard"
                  className="vt-db-summary__button"
                >
                  Manage workspace
                  <ChevronRight size={17} />
                </Link>
              </section>

              <section className="vt-db-upgrade-card">
                <span className="vt-db-upgrade-card__icon">
                  <Sparkles size={21} />
                </span>

                <h3>
                  Unlock full AI analysis
                </h3>

                <p>
                  Generate detailed quantities,
                  UAE pricing and professional
                  quotations.
                </p>

                <button type="button">
                  Explore plans
                  <ChevronRight size={17} />
                </button>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}

function StatCard({
  icon,
  label,
  value,
  note,
}) {
  return (
    <article className="vt-db-stat-card">
      <div className="vt-db-stat-card__top">
        <span className="vt-db-stat-card__icon">
          {icon}
        </span>

        <button
          type="button"
          aria-label={`More options for ${label}`}
        >
          <MoreHorizontal size={19} />
        </button>
      </div>

      <strong className="vt-db-stat-card__value">
        {value}
      </strong>

      <span className="vt-db-stat-card__label">
        {label}
      </span>

      <p>{note}</p>
    </article>
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
    <Link
      href={`/projects/${project.id}`}
      className="vt-db-project-card"
    >
      <div className="vt-db-project-card__top">
        <span className="vt-db-project-card__folder">
          <FolderKanban size={21} />
        </span>

        <span
          className={`vt-db-status ${getStatusClass(
            projectStatus
          )}`}
        >
          {projectStatus}
        </span>
      </div>

      <h3>{projectName}</h3>
      <p>{projectLocation}</p>

      <div className="vt-db-project-card__meta">
        <span>
          <CalendarDays size={15} />
          {formatDate(project.created_at)}
        </span>

        <span>{progress}%</span>
      </div>

      <div className="vt-db-progress">
        <span
          style={{
            width: `${progress}%`,
          }}
        />
      </div>

      <div className="vt-db-project-card__footer">
        <span>Open workspace</span>
        <ChevronRight size={17} />
      </div>
    </Link>
  );
}

function QuickAction({
  href,
  icon,
  title,
  description,
}) {
  return (
    <Link
      href={href}
      className="vt-db-quick-action"
    >
      <span className="vt-db-quick-action__icon">
        {icon}
      </span>

      <span className="vt-db-quick-action__content">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>

      <ChevronRight size={18} />
    </Link>
  );
}

function ActivityItem({
  icon,
  title,
  description,
  time,
}) {
  return (
    <article className="vt-db-activity">
      <span className="vt-db-activity__icon">
        {icon}
      </span>

      <div className="vt-db-activity__content">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>

      <span className="vt-db-activity__time">
        {time}
      </span>
    </article>
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
    <div className="vt-db-summary__row">
      <div className="vt-db-summary__details">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>

      <div className="vt-db-progress">
        <span
          style={{
            width: `${safeProgress}%`,
          }}
        />
      </div>
    </div>
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