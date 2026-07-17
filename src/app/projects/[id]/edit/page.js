"use client";

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
  fetchProjectById,
  updateProject,
} from "@/services/projectService";

import "./EditProject.css";

export default function EditProjectPage() {
  const params = useParams();
  const router = useRouter();

  const projectId = params?.id;

  const [form, setForm] = useState({
    name: "",
    client: "",
    location: "",
    budget: "",
    start_date: "",
    deadline: "",
    status: "Planning",
    progress: 0,
  });

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadProject() {
      if (!projectId) {
        return;
      }

      try {
        setLoading(true);
        setErrorMessage("");

        const {
          project,
          error,
        } = await fetchProjectById(
          projectId
        );

        if (!isMounted) {
          return;
        }

        if (error || !project) {
          setErrorMessage(
            error?.message ||
              "Project could not be found."
          );

          return;
        }

        setForm({
          name: project.name || "",
          client: project.client || "",
          location:
            project.location || "",
          budget:
            project.budget ?? "",
          start_date:
            project.start_date || "",
          deadline:
            project.deadline || "",
          status:
            project.status || "Planning",
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
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.name.trim()) {
      setErrorMessage(
        "Project name is required."
      );

      return;
    }

    try {
      setSaving(true);
      setErrorMessage("");

      const updates = {
        name: form.name.trim(),

        client:
          form.client.trim() || null,

        location:
          form.location.trim() || null,

        budget:
          Number(form.budget) || 0,

        start_date:
          form.start_date || null,

        deadline:
          form.deadline || null,

        status: form.status,

        progress: Math.min(
          100,
          Math.max(
            0,
            Number(form.progress) || 0
          )
        ),
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
      <main className="vt-edit-page">
        <div className="vt-edit-loading">
          <div className="vt-edit-spinner" />

          <p>Loading project...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="vt-edit-page">
      <section className="vt-edit-card">
        <Link
          href={`/projects/${projectId}`}
          className="vt-edit-back"
        >
          <ArrowLeft size={18} />
          Back to Project
        </Link>

        <header className="vt-edit-header">
          <span className="vt-edit-badge">
            Project settings
          </span>

          <h1>Edit Project</h1>

          <p>
            Update the project information
            stored in your Ventra workspace.
          </p>
        </header>

        <form
          className="vt-edit-form"
          onSubmit={handleSubmit}
        >
          <div className="vt-edit-grid">
            <label className="vt-edit-field">
              <span>Project Name</span>

              <input
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
            </label>

            <label className="vt-edit-field">
              <span>Client</span>

              <input
                type="text"
                value={form.client}
                onChange={(event) =>
                  updateField(
                    "client",
                    event.target.value
                  )
                }
              />
            </label>

            <label className="vt-edit-field">
              <span>Location</span>

              <input
                type="text"
                value={form.location}
                onChange={(event) =>
                  updateField(
                    "location",
                    event.target.value
                  )
                }
              />
            </label>

            <label className="vt-edit-field">
              <span>Budget (AED)</span>

              <input
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
            </label>

            <label className="vt-edit-field">
              <span>Start Date</span>

              <input
                type="date"
                value={form.start_date}
                onChange={(event) =>
                  updateField(
                    "start_date",
                    event.target.value
                  )
                }
              />
            </label>

            <label className="vt-edit-field">
              <span>Deadline</span>

              <input
                type="date"
                value={form.deadline}
                onChange={(event) =>
                  updateField(
                    "deadline",
                    event.target.value
                  )
                }
              />
            </label>

            <label className="vt-edit-field">
              <span>Status</span>

              <select
                value={form.status}
                onChange={(event) =>
                  updateField(
                    "status",
                    event.target.value
                  )
                }
              >
                <option value="Planning">
                  Planning
                </option>

                <option value="On Track">
                  On Track
                </option>

                <option value="At Risk">
                  At Risk
                </option>

                <option value="Delayed">
                  Delayed
                </option>

                <option value="Completed">
                  Completed
                </option>
              </select>
            </label>

            <label className="vt-edit-field">
              <span>Progress (%)</span>

              <input
                type="number"
                min="0"
                max="100"
                value={form.progress}
                onChange={(event) =>
                  updateField(
                    "progress",
                    event.target.value
                  )
                }
              />
            </label>
          </div>

          {errorMessage && (
            <p className="vt-edit-error">
              {errorMessage}
            </p>
          )}

          <div className="vt-edit-actions">
            <button
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
            </button>

            <button
              type="submit"
              className="vt-edit-save"
              disabled={saving}
            >
              <Save size={18} />

              {saving
                ? "Saving Changes..."
                : "Save Changes"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}