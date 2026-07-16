import { supabase } from "@/lib/supabase";

export async function fetchProjects() {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Fetch projects error:", error);
  }

  return {
    projects: data || [],
    error,
  };
}

export async function fetchProjectById(projectId) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error) {
    console.error("Fetch project error:", error);
  }

  return {
    project: data || null,
    error,
  };
}

export async function createProject(projectData) {
  const payload = {
    name: projectData.name.trim(),
    client: projectData.client?.trim() || null,
    location: projectData.location?.trim() || null,

    manager: projectData.manager?.trim() || null,
    supervisor: projectData.supervisor?.trim() || null,

    budget: Number(projectData.budget) || 0,
    progress: 0,
    status: "Planning",
    health: 100,

    pending_reports: 0,
    open_issues: 0,

    start_date: projectData.start_date || null,
    deadline: projectData.deadline || null,
  };

  const { data, error } = await supabase
    .from("projects")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("Create project error:", error);
  }

  return {
    project: data || null,
    error,
  };
}

export async function updateProject(projectId, updates) {
  const { data, error } = await supabase
    .from("projects")
    .update(updates)
    .eq("id", projectId)
    .select()
    .single();

  if (error) {
    console.error("Update project error:", error);
  }

  return {
    project: data || null,
    error,
  };
}

export async function deleteProject(projectId) {
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);

  if (error) {
    console.error("Delete project error:", error);
  }

  return { error };
}