import { supabase } from "@/lib/supabase";

/**
 * Create a new project
 */
export async function createProject(projectData) {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error("Get user error:", userError);

      return {
        project: null,
        error: userError,
      };
    }

    if (!user) {
      return {
        project: null,
        error: new Error(
          "You must be logged in to create a project."
        ),
      };
    }

    const budget =
      projectData.budget === "" ||
      projectData.budget == null
        ? null
        : Number(projectData.budget);

    if (
      budget !== null &&
      (Number.isNaN(budget) || budget < 0)
    ) {
      return {
        project: null,
        error: new Error(
          "Budget must be a valid positive number."
        ),
      };
    }

    const payload = {
      user_id: user.id,
      name: projectData.name?.trim(),
      client:
        projectData.client?.trim() || null,
      location:
        projectData.location?.trim() || null,
      budget,
      start_date:
        projectData.start_date || null,
      end_date:
        projectData.end_date || null,
      status: "planning",
      progress: 0,
    };

    console.log("Project payload:", payload);

    const { data, error } = await supabase
      .from("projects")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error(
        "Create project Supabase error:",
        {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        }
      );

      return {
        project: null,
        error,
      };
    }

    return {
      project: data,
      error: null,
    };
  } catch (error) {
    console.error(
      "Unexpected create project error:",
      error
    );

    return {
      project: null,
      error,
    };
  }
}

/**
 * Get all projects for the current user
 */
export async function getProjects() {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error(
        "Get projects database error:",
        error
      );

      return {
        projects: [],
        error,
      };
    }

    return {
      projects: data || [],
      error: null,
    };
  } catch (error) {
    console.error(
      "Unexpected get projects error:",
      error
    );

    return {
      projects: [],
      error,
    };
  }
}

/**
 * Get one project by ID
 */
export async function getProjectById(projectId) {
  try {
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
      .single();

    if (error) {
      console.error(
        "Get project database error:",
        error
      );

      return {
        project: null,
        error,
      };
    }

    return {
      project: data,
      error: null,
    };
  } catch (error) {
    console.error(
      "Unexpected get project error:",
      error
    );

    return {
      project: null,
      error,
    };
  }
}

/**
 * Update an existing project
 */
export async function updateProject(
  projectId,
  projectData
) {
  try {
    if (!projectId) {
      return {
        project: null,
        error: new Error(
          "Project ID is required."
        ),
      };
    }

    const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError||!user)return {project:null,error:authError||new Error("Please sign in to update this project.")};
    const updateData = {};

    if (projectData.name !== undefined) {
      updateData.name =
        projectData.name?.trim();
    }

    if (projectData.client !== undefined) {
      updateData.client =
        projectData.client?.trim() || null;
    }

    if (
      projectData.location !== undefined
    ) {
      updateData.location =
        projectData.location?.trim() ||
        null;
    }

    if (
      projectData.project_type !==
      undefined
    ) {
      updateData.project_type =
        projectData.project_type || null;
    }

    if (
      projectData.description !==
      undefined
    ) {
      updateData.description =
        projectData.description?.trim() ||
        null;
    }

    if (projectData.budget !== undefined) {
      updateData.budget =
        projectData.budget === "" ||
        projectData.budget == null
          ? null
          : Number(projectData.budget);
    }

    if (
      projectData.start_date !== undefined
    ) {
      updateData.start_date =
        projectData.start_date || null;
    }

    if (
      projectData.end_date !== undefined
    ) {
      updateData.end_date =
        projectData.end_date || null;
    }

    if (projectData.status !== undefined) {
      updateData.status =
        projectData.status;
    }

    if (
      projectData.progress !== undefined
    ) {
      updateData.progress = Number(
        projectData.progress
      );
    }

    if (
      updateData.budget !== undefined &&
      updateData.budget !== null &&
      (Number.isNaN(updateData.budget) ||
        updateData.budget < 0)
    ) {
      return {
        project: null,
        error: new Error(
          "Budget must be a valid positive number."
        ),
      };
    }

    if (
      updateData.progress !== undefined &&
      (!Number.isFinite(
        updateData.progress
      ) ||
        updateData.progress < 0 ||
        updateData.progress > 100)
    ) {
      return {
        project: null,
        error: new Error(
          "Progress must be between 0 and 100."
        ),
      };
    }

    if (
      updateData.start_date &&
      updateData.end_date &&
      updateData.end_date <
        updateData.start_date
    ) {
      return {
        project: null,
        error: new Error(
          "The deadline cannot be earlier than the start date."
        ),
      };
    }

    const { data, error } = await supabase
      .from("projects")
      .update(updateData)
      .eq("id", projectId)
      .eq("user_id",user.id)
      .select("*")
      .single();

    if (error) {
      console.error(
        "Update project database error:",
        {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        }
      );

      return {
        project: null,
        error,
      };
    }

    return {
      project: data,
      error: null,
    };
  } catch (error) {
    console.error(
      "Unexpected update project error:",
      error
    );

    return {
      project: null,
      error,
    };
  }
}

/**
 * Delete a project
 */
export async function deleteProject(
  projectId
) {
  try {
    if (!projectId) {
      return {
        success: false,
        error: new Error(
          "Project ID is required."
        ),
      };
    }

    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", projectId);

    if (error) {
      console.error(
        "Delete project database error:",
        error
      );

      return {
        success: false,
        error,
      };
    }

    return {
      success: true,
      error: null,
    };
  } catch (error) {
    console.error(
      "Unexpected delete project error:",
      error
    );

    return {
      success: false,
      error,
    };
  }
}