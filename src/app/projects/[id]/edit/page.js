"use client";
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";


import { useEffect, useState } from "react";
import Link from "next/link";
import {
  useParams,
  useRouter,
} from "next/navigation";
import {
  ArrowLeft,
  Save,
} from "lucide-react";

import {
  getProjectById,
  updateProject,
} from "@/services/projectService";

import "./EditProject.css";

const initialForm = {
  name: "",
  client_name: "",
  location: "",
  budget: "",
  start_date: "",
  end_date: "",
  status: "planning",
  progress: 0,
};

export default function EditProjectPage() {
  const params = useParams();
  const router = useRouter();

  const projectId = Array.isArray(params?.id)
    ? params.id[0]
    : params?.id;

  const [form, setForm] =
    useState(initialForm);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [
    errorMessage,
    setErrorMessage,
  ] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadProject() {
      if (!projectId) {
        if (isMounted) {
          setLoading(false);
          setErrorMessage(
            "Project ID is missing."
          );
        }

        return;
      }

      try {
        setLoading(true);
        setErrorMessage("");

        const {
          project,
          error,
        } = await getProjectById(
          projectId
        );

        if (!isMounted) {
          return;
        }

        if (error || !project) {
          setErrorMessage(
            error?.code === "PGRST116"
              ? "Project could not be found."
              : error?.message ||
                  "Project could not be found."
          );

          return;
        }

        setForm({
          name: project.name || "",

          client_name:
            project.client_name || "",

          location:
            project.location || "",

          budget:
            project.budget ?? "",

          start_date:
            project.start_date || "",

          end_date:
            project.end_date || "",

          status:
            project.status || "planning",

          progress:
            project.progress ?? 0,
        });
      } catch (error) {
        console.error(
          "Load project error:",
          error
        );

        if (isMounted) {
          setErrorMessage(
            "An unexpected error occurred while loading the project."
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadProject();

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  function updateField(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));

    if (errorMessage) {
      setErrorMessage("");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setErrorMessage("");

    if (!projectId) {
      setErrorMessage(
        "Project ID is missing."
      );

      return;
    }

    if (!form.name.trim()) {
      setErrorMessage(
        "Project name is required."
      );

      return;
    }

    const budgetNumber =
      form.budget === ""
        ? 0
        : Number(form.budget);

    const progressNumber =
      Number(form.progress);

    if (
      Number.isNaN(budgetNumber) ||
      budgetNumber < 0
    ) {
      setErrorMessage(
        "Budget must be a valid positive number."
      );

      return;
    }

    if (
      Number.isNaN(progressNumber) ||
      progressNumber < 0 ||
      progressNumber > 100
    ) {
      setErrorMessage(
        "Progress must be between 0 and 100."
      );

      return;
    }

    if (
      form.start_date &&
      form.end_date &&
      form.end_date < form.start_date
    ) {
      setErrorMessage(
        "End date cannot be earlier than start date."
      );

      return;
    }

    try {
      setSaving(true);

      const updates = {
        name: form.name.trim(),

        client_name:
          form.client_name.trim() ||
          null,

        location:
          form.location.trim() || null,

        budget: budgetNumber,

        start_date:
          form.start_date || null,

        end_date:
          form.end_date || null,

        status: form.status,

        progress: progressNumber,
      };

      const {
        project,
        error,
      } = await updateProject(
        projectId,
        updates
      );

      if (error || !project) {
        setErrorMessage(
          error?.message ||
            "Could not update project."
        );

        return;
      }

      router.push(
        `/projects/${project.id}`
      );

      router.refresh();
    } catch (error) {
      console.error(
        "Update project error:",
        error
      );

      setErrorMessage(
        "An unexpected error occurred while saving the project."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <LocalizedElement as="main" className="vt-edit-page">
        <LocalizedElement as="div" className="vt-edit-loading">
          <LocalizedElement as="div" className="vt-edit-spinner" />

          <LocalizedElement as="p">Loading project...</LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>
    );
  }

  return (
    <LocalizedElement as="main" className="vt-edit-page">
      <LocalizedElement as="section" className="vt-edit-card">
        <LocalizedLink 
          href={`/projects/${projectId}`}
          className="vt-edit-back"
        >
          <ArrowLeft size={18} />
          Back to Project
        </LocalizedLink>

        <LocalizedElement as="header" className="vt-edit-header">
          <LocalizedElement as="span" className="vt-edit-badge">
            Project settings
          </LocalizedElement>

          <LocalizedElement as="h1">Edit Project</LocalizedElement>

          <LocalizedElement as="p">
            Update the project information
            stored in your Ventra workspace.
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="form"
          className="vt-edit-form"
          onSubmit={handleSubmit}
        >
          <LocalizedElement as="div" className="vt-edit-grid">
            <LocalizedElement as="label" className="vt-edit-field">
              <LocalizedElement as="span">Project Name</LocalizedElement>

              <LocalizedElement as="input"
                type="text"
                value={form.name}
                onChange={(event) =>
                  updateField(
                    "name",
                    event.target.value
                  )
                }
                required
              />
            </LocalizedElement>

            <LocalizedElement as="label" className="vt-edit-field">
              <LocalizedElement as="span">Client</LocalizedElement>

              <LocalizedElement as="input"
                type="text"
                value={form.client}
                onChange={(event) =>
                  updateField(
                    "client",
                    event.target.value
                  )
                }
              />
            </LocalizedElement>

            <LocalizedElement as="label" className="vt-edit-field">
              <LocalizedElement as="span">Location</LocalizedElement>

              <LocalizedElement as="input"
                type="text"
                value={form.location}
                onChange={(event) =>
                  updateField(
                    "location",
                    event.target.value
                  )
                }
              />
            </LocalizedElement>

            <LocalizedElement as="label" className="vt-edit-field">
              <LocalizedElement as="span">Budget (AED)</LocalizedElement>

              <LocalizedElement as="input"
                type="number"
                min="0"
                step="0.01"
                value={form.budget}
                onChange={(event) =>
                  updateField(
                    "budget",
                    event.target.value
                  )
                }
              />
            </LocalizedElement>

            <LocalizedElement as="label" className="vt-edit-field">
              <LocalizedElement as="span">Start Date</LocalizedElement>

              <LocalizedElement as="input"
                type="date"
                value={form.start_date}
                onChange={(event) =>
                  updateField(
                    "start_date",
                    event.target.value
                  )
                }
              />
            </LocalizedElement>

            <LocalizedElement as="label" className="vt-edit-field">
              <LocalizedElement as="span">End Date</LocalizedElement>

              <LocalizedElement as="input"
                type="date"
                value={form.end_date}
                onChange={(event) =>
                  updateField(
                    "end_date",
                    event.target.value
                  )
                }
              />
            </LocalizedElement>

            <LocalizedElement as="label" className="vt-edit-field">
              <LocalizedElement as="span">Status</LocalizedElement>

              <LocalizedElement as="select"
                value={form.status}
                onChange={(event) =>
                  updateField(
                    "status",
                    event.target.value
                  )
                }
              >
                <LocalizedElement as="option" value="planning">
                  Planning
                </LocalizedElement>

                <LocalizedElement as="option" value="in_progress">
                  In Progress
                </LocalizedElement>

                <LocalizedElement as="option" value="on_hold">
                  On Hold
                </LocalizedElement>

                <LocalizedElement as="option" value="completed">
                  Completed
                </LocalizedElement>

                <LocalizedElement as="option" value="cancelled">
                  Cancelled
                </LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="label" className="vt-edit-field">
              <LocalizedElement as="span">Progress (%)</LocalizedElement>

              <LocalizedElement as="input"
                type="number"
                min="0"
                max="100"
                step="1"
                value={form.progress}
                onChange={(event) =>
                  updateField(
                    "progress",
                    event.target.value
                  )
                }
              />
            </LocalizedElement>
          </LocalizedElement>

          {errorMessage && (
            <LocalizedElement as="p" className="vt-edit-error">
              {errorMessage}
            </LocalizedElement>
          )}

          <LocalizedElement as="div" className="vt-edit-actions">
            <LocalizedElement as="button"
              type="button"
              className="vt-edit-cancel"
              onClick={() =>
                router.push(
                  `/projects/${projectId}`
                )
              }
              disabled={saving}
            >
              Cancel
            </LocalizedElement>

            <LocalizedElement as="button"
              type="submit"
              className="vt-edit-save"
              disabled={saving}
            >
              <Save size={18} />

              {saving
                ? "Saving Changes..."
                : "Save Changes"}
            </LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
  );
}