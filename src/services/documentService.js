import { supabase } from "@/lib/supabase";

const BUCKET_NAME = "project-files";

export async function getProjectDocuments(
  projectId
) {
  try {
    if (!projectId) {
      throw new Error("Project ID is required.");
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      throw new Error(
        "You must be logged in."
      );
    }

    const { data, error } = await supabase
      .from("project_documents")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      throw error;
    }

    return {
      documents: data || [],
      error: null,
    };
  } catch (error) {
    console.error(
      "Get project documents error:",
      error
    );

    return {
      documents: [],
      error,
    };
  }
}

export async function uploadProjectDocument({
  projectId,
  file,
  category = "drawing",
}) {
  try {
    if (!projectId) {
      throw new Error("Project ID is required.");
    }

    if (!file) {
      throw new Error(
        "Please select a file."
      );
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      throw new Error(
        "You must be logged in."
      );
    }

    const extension =
      file.name.split(".").pop()?.toLowerCase() ||
      "file";

    const safeFileName = file.name
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .toLowerCase();

    const uniqueFileName = `${Date.now()}-${crypto.randomUUID()}-${safeFileName}.${extension}`;

    const filePath = `${user.id}/${projectId}/${uniqueFileName}`;

    const {
      data: uploadData,
      error: uploadError,
    } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType:
          file.type ||
          "application/octet-stream",
      });

    if (uploadError) {
      throw uploadError;
    }

    const documentPayload = {
      project_id: projectId,
      user_id: user.id,
      file_name: file.name,
      file_path: uploadData.path,
      file_type:
        file.type || extension,
      file_size: file.size,
      category,
      status: "uploaded",
    };

    const {
      data: document,
      error: databaseError,
    } = await supabase
      .from("project_documents")
      .insert(documentPayload)
      .select()
      .single();

    if (databaseError) {
      await supabase.storage
        .from(BUCKET_NAME)
        .remove([uploadData.path]);

      throw databaseError;
    }

    return {
      document,
      error: null,
    };
  } catch (error) {
    console.error(
      "Upload project document error:",
      error
    );

    return {
      document: null,
      error,
    };
  }
}

export async function deleteProjectDocument(
  document
) {
  try {
    if (!document?.id || !document?.file_path) {
      throw new Error(
        "Document information is missing."
      );
    }

    const { error: storageError } =
      await supabase.storage
        .from(BUCKET_NAME)
        .remove([document.file_path]);

    if (storageError) {
      throw storageError;
    }

    const { error: databaseError } =
      await supabase
        .from("project_documents")
        .delete()
        .eq("id", document.id);

    if (databaseError) {
      throw databaseError;
    }

    return {
      success: true,
      error: null,
    };
  } catch (error) {
    console.error(
      "Delete project document error:",
      error
    );

    return {
      success: false,
      error,
    };
  }
}

export async function downloadProjectDocument(
  document
) {
  try {
    if (!document?.file_path) {
      throw new Error(
        "File path is missing."
      );
    }

    const { data, error } =
      await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(
          document.file_path,
          3600
        );

    if (error) {
      throw error;
    }

    return {
      url: data.signedUrl,
      error: null,
    };
  } catch (error) {
    console.error(
      "Download project document error:",
      error
    );

    return {
      url: null,
      error,
    };
  }
}