"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";

import {
  fetchProjectById,
  updateProject,
} from "@/services/projectService";

import "../../new/CreateProject.css";

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

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadProject() {
      if (!projectId) return;

      setLoading(true);
      setErrorMessage("");

      const { project, error } =
        await fetchProjectById(projectId);

      if (error || !project) {
        setErrorMessage(
          error?.message || "Project could not be found."
        );

        setLoading(false);
        return;
      }

      setForm({
        name: project.name || "",
        client: project.client || "",
        location: project.location || "",
        budget: project.budget ?? "",
        start_date: project.start_date || "",
        deadline: project.deadline || "",
        status: project.status || "Planning",
        progress: project.progress ?? 0,
      });

      setLoading(false);
    }

    loadProject();
  }, [projectId]);

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.name.trim()) {
      setErrorMessage("Project name is required.");
      return;
    }

    setSaving(true);
    setErrorMessage("");

    const updates = {
      name: form.name.trim(),
      client: form.client.trim() || null,
      location: form.location.trim() || null,
      budget: Number(form.budget) || 0,
      start_date: form.start_date || null,
      deadline: form.deadline || null,
      status: form.status,
      progress: Math.min(
        100,
        Math.max(0, Number(form.progress) || 0)
      ),
    };

    const { project, error } = await updateProject(
      projectId,
      updates
    );

    setSaving(false);

    if (error || !project) {
      setErrorMessage(
        error?.message || "Could not update project."
      );
      return;
    }

    router.push(`/projects/${project.id}`);
    router.refresh();
  }

  if (loading) {
    return (
      <main className="create-project">
        <section className="create-card">
          <p>Loading project...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="create-project">
      <section className="create-card">
        <Link
          href={`/projects/${projectId}`}
          className="create-back-link"
        >
          <ArrowLeft size={17} />
          Back to Project
        </Link>

        <span className="create-badge">
          PROJECT SETTINGS
        </span>

        <h1>Edit Project</h1>

        <p>
          Update the project information stored in Supabase.
        </p>

        <form
          className="project-form"
          onSubmit={handleSubmit}
        >
          <div className="form-grid">
            <div className="form-group">
              <label>Project Name</label>

              <input
                value={form.name}
                onChange={(event) =>
                  updateField("name", event.target.value)
                }
                required
              />
            </div>

            <div className="form-group">
              <label>Client</label>

              <input
                value={form.client}
                onChange={(event) =>
                  updateField("client", event.target.value)
                }
              />
            </div>

            <div className="form-group">
              <label>Location</label>

              <input
                value={form.location}
                onChange={(event) =>
                  updateField("location", event.target.value)
                }
              />
            </div>

            <div className="form-group">
              <label>Budget (AED)</label>

              <input
                type="number"
                min="0"
                value={form.budget}
                onChange={(event) =>
                  updateField("budget", event.target.value)
                }
              />
            </div>

            <div className="form-group">
              <label>Start Date</label>

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
            </div>

            <div className="form-group">
              <label>Deadline</label>

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
            </div>

            <div className="form-group">
              <label>Status</label>

              <select
                value={form.status}
                onChange={(event) =>
                  updateField("status", event.target.value)
                }
              >
                <option value="Planning">Planning</option>
                <option value="On Track">On Track</option>
                <option value="At Risk">At Risk</option>
                <option value="Delayed">Delayed</option>
                <option value="Completed">Completed</option>
              </select>
            </div>

            <div className="form-group">
              <label>Progress (%)</label>

              <input
                type="number"
                min="0"
                max="100"
                value={form.progress}
                onChange={(event) =>
                  updateField("progress", event.target.value)
                }
              />
            </div>
          </div>

          {errorMessage && (
            <p className="create-form-error">
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            className="create-submit-button"
            disabled={saving}
          >
            <Save size={18} />

            {saving ? "Saving Changes..." : "Save Changes"}
          </button>
        </form>
      </section>
    </main>
  );
}