import { supabase } from "@/lib/supabase";

async function getAuthenticatedUser() {
  const {
    data,
    error,
  } = await supabase.auth.getUser();

  if (error) {
    console.error(
      "Get authenticated user error:",
      error.message
    );

    return {
      user: null,
      error,
    };
  }

  if (!data?.user) {
    return {
      user: null,
      error: new Error(
        "You must be signed in to continue."
      ),
    };
  }

  return {
    user: data.user,
    error: null,
  };
}

export async function fetchProjects() {
  const {
    user,
    error: userError,
  } = await getAuthenticatedUser();

  if (userError || !user) {
    return {
      projects: [],
      error: userError,
    };
  }

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error(
      "Fetch projects error:",
      error.message
    );
  }

  return {
    projects: data || [],
    error,
  };
}

export async function fetchProjectById(
  projectId
) {
  const {
    user,
    error: userError,
  } = await getAuthenticatedUser();

  if (userError || !user) {
    return {
      project: null,
      error: userError,
    };
  }

  if (!projectId) {
    return {
      project: null,
      error: new Error(
        "Project ID is required."
      ),
    };
  }

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();

  if (error) {
    console.error(
      "Fetch project error:",
      error.message
    );
  }

  return {
    project: data || null,
    error,
  };
}

export async function createProject(
  projectData
) {
  const {
    user,
    error: userError,
  } = await getAuthenticatedUser();

  if (userError || !user) {
    return {
      project: null,
      error: userError,
    };
  }

  const projectName =
    projectData?.name?.trim();

  if (!projectName) {
    return {
      project: null,
      error: new Error(
        "Project name is required."
      ),
    };
  }

  const payload = {
    user_id: user.id,

    name: projectName,

    client:
      projectData.client?.trim() || null,

    location:
      projectData.location?.trim() || null,

    manager:
      projectData.manager?.trim() || null,

    supervisor:
      projectData.supervisor?.trim() ||
      null,

    budget:
      Number(projectData.budget) || 0,

    progress: 0,
    status: "Planning",
    health: 100,

    pending_reports: 0,
    open_issues: 0,

    start_date:
      projectData.start_date || null,

    deadline:
      projectData.deadline || null,
  };

  const { data, error } = await supabase
    .from("projects")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error(
      "Create project error:",
      error.message
    );
  }

  return {
    project: data || null,
    error,
  };
}

export async function updateProject(
  projectId,
  updates
) {
  const {
    user,
    error: userError,
  } = await getAuthenticatedUser();

  if (userError || !user) {
    return {
      project: null,
      error: userError,
    };
  }

  if (!projectId) {
    return {
      project: null,
      error: new Error(
        "Project ID is required."
      ),
    };
  }

  const safeUpdates = {
    ...updates,
  };

  delete safeUpdates.id;
  delete safeUpdates.user_id;
  delete safeUpdates.created_at;

  const { data, error } = await supabase
    .from("projects")
    .update(safeUpdates)
    .eq("id", projectId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    console.error(
      "Update project error:",
      error.message
    );
  }

  return {
    project: data || null,
    error,
  };
}

export async function deleteProject(
  projectId
) {
  const {
    user,
    error: userError,
  } = await getAuthenticatedUser();

  if (userError || !user) {
    return {
      error: userError,
    };
  }

  if (!projectId) {
    return {
      error: new Error(
        "Project ID is required."
      ),
    };
  }

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", user.id);

  if (error) {
    console.error(
      "Delete project error:",
      error.message
    );
  }

  return {
    error,
  };
}