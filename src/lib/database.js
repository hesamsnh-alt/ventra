import { supabase } from "./supabase";

export async function getProjects() {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  return {
    data: data || [],
    error,
  };
}

export async function getProjectById(id) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  return {
    data: data || null,
    error,
  };
}

export async function createProject(projectData) {
  const payload = {
    name: projectData.name?.trim(),
    client: projectData.client?.trim() || null,
    location: projectData.location?.trim() || null,
    manager: projectData.manager?.trim() || null,
    supervisor: projectData.supervisor?.trim() || null,
    budget: Number(projectData.budget) || 0,
    progress: Number(projectData.progress) || 0,
    status: projectData.status || "Planning",
    health: Number(projectData.health) || 100,
    pending_reports: Number(projectData.pending_reports) || 0,
    open_issues: Number(projectData.open_issues) || 0,
    start_date: projectData.start_date || null,
    deadline: projectData.deadline || null,
  };

  const { data, error } = await supabase
    .from("projects")
    .insert([payload])
    .select()
    .single();

  return {
    data: data || null,
    error,
  };
}

export async function updateProject(id, updates) {
  const { data, error } = await supabase
    .from("projects")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  return {
    data: data || null,
    error,
  };
}

export async function deleteProject(id) {
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id);

  return { error };
}