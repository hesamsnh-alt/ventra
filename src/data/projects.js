export const defaultProjects = [
  {
    id: 1,
    name: "Dubai Villa Renovation",
    client: "Private Client",
    location: "Dubai, UAE",
    progress: 72,
    startDate: "2026-07-12",
    deadline: "2026-11-28",
    manager: "Ahmed Al Mansoori",
    supervisor: "Reza Karimi",
    status: "On Track",
    health: 92,
    pendingReports: 3,
    openIssues: 2,
    budget: 3200000,
  },
  {
    id: 2,
    name: "Sharjah Warehouse Fit-Out",
    client: "Industrial Client",
    location: "Sharjah, UAE",
    progress: 46,
    startDate: "2026-08-02",
    deadline: "2026-12-15",
    manager: "Omar Hassan",
    supervisor: "Hassan Ali",
    status: "Needs Attention",
    health: 74,
    pendingReports: 5,
    openIssues: 4,
    budget: 1800000,
  },
  {
    id: 3,
    name: "Office Interior Project",
    client: "Corporate Client",
    location: "Abu Dhabi, UAE",
    progress: 88,
    startDate: "2026-06-18",
    deadline: "2026-10-05",
    manager: "Sara Ahmed",
    supervisor: "Ali Reza",
    status: "On Track",
    health: 96,
    pendingReports: 1,
    openIssues: 0,
    budget: 950000,
  },
];

const STORAGE_KEY = "ventra-projects";

export function getProjects() {
  if (typeof window === "undefined") {
    return defaultProjects;
  }

  const savedProjects = window.localStorage.getItem(STORAGE_KEY);

  if (!savedProjects) {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(defaultProjects)
    );

    return defaultProjects;
  }

  try {
    return JSON.parse(savedProjects);
  } catch {
    return defaultProjects;
  }
}

export function saveProjects(projects) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(projects)
  );
}

export function addProject(project) {
  const currentProjects = getProjects();
  const updatedProjects = [...currentProjects, project];

  saveProjects(updatedProjects);

  return project;
}

export function getProjectById(id) {
  const projects = getProjects();

  return projects.find(
    (project) => String(project.id) === String(id)
  );
}