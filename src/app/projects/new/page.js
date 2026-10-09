"use client";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";


import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createProject } from "@/services/projectService";
import { getCurrentUser } from "@/services/authService";

import "./CreateProject.css";

export default function CreateProjectPage() {
  const router = useRouter();

  const [checkingUser, setCheckingUser] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [form, setForm] = useState({
    name: "",
    client: "",
    location: "",
    budget: "",
    start_date: "",
    end_date: "",
  });

  useEffect(() => {
    let isMounted = true;

    async function checkUser() {
      try {
        const { user, error } = await getCurrentUser();

        if (error) {
          console.error("User checking error:", error.message);
        }

        if (!user) {
          router.replace("/login");
          return;
        }

        if (isMounted) {
          setCheckingUser(false);
        }
      } catch (error) {
        console.error("Authentication check error:", error);
        router.replace("/login");
      }
    }

    checkUser();

    return () => {
      isMounted = false;
    };
  }, [router]);

  function updateField(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.name.trim()) {
      setErrorMessage("Project name is required.");
      return;
    }

    if (
      form.start_date &&
      form.end_date &&
      form.end_date < form.start_date
    ) {
      setErrorMessage(
        "The deadline cannot be earlier than the start date."
      );
      return;
    }

    try {
      setLoading(true);
      setErrorMessage("");

      const projectData = {
        name: form.name.trim(),
        client: form.client.trim() || null,
        location: form.location.trim() || null,
        budget: form.budget === "" ? null : Number(form.budget),
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      };

      const result = await createProject(projectData);

      /*
       * Supports both possible service formats:
       *
       * 1. { project, error }
       * 2. Direct project object
       */
      const project = result?.project ?? result;
      const error = result?.error ?? null;

      if (error) {
        console.error("Create project service error:", error);

        setErrorMessage(
          error.message || "Could not create project."
        );

        return;
      }

      if (!project?.id) {
        console.error(
          "Create project returned no project ID:",
          result
        );

        setErrorMessage(
          "Project could not be created because no project ID was returned."
        );

        return;
      }

      router.push(`/projects/${project.id}`);
    } catch (error) {
      console.error("Project creation error:", error);

      setErrorMessage(
        error?.message ||
          "An unexpected error occurred while creating the project."
      );
    } finally {
      setLoading(false);
    }
  }

  if (checkingUser) {
    return (
      <LocalizedElement as="main" className="create-project-page">
        <LocalizedElement as="p">Checking your account...</LocalizedElement>
      </LocalizedElement>
    );
  }

  return (
    <LocalizedElement as="main" className="create-project-page">
      <LocalizedElement as="div" className="create-project-container">
        <LocalizedElement as="div" className="create-project-header">
          <LocalizedElement as="span" className="create-project-eyebrow">
            New workspace
          </LocalizedElement>

          <LocalizedElement as="h1">Create Project</LocalizedElement>

          <LocalizedElement as="p">
            Add the basic project information. You can complete
            the remaining details later.
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="form"
          onSubmit={handleSubmit}
          className="create-project-form"
        >
          <LocalizedElement as="label" className="create-project-field">
            <LocalizedElement as="span">Project name</LocalizedElement>

            <LocalizedElement as="input"
              type="text"
              placeholder="Example: Villa Renovation"
              value={form.name ?? ""}
              onChange={(event) =>
                updateField("name", event.target.value)
              }
              required
              disabled={loading}
            />
          </LocalizedElement>

          <LocalizedElement as="label" className="create-project-field">
            <LocalizedElement as="span">Client</LocalizedElement>

            <LocalizedElement as="input"
              type="text"
              placeholder="Client"
              value={form.client ?? ""}
              onChange={(event) =>
                updateField("client", event.target.value)
              }
              disabled={loading}
            />
          </LocalizedElement>

          <LocalizedElement as="label" className="create-project-field">
            <LocalizedElement as="span">Location</LocalizedElement>

            <LocalizedElement as="input"
              type="text"
              placeholder="Example: Dubai, UAE"
              value={form.location ?? ""}
              onChange={(event) =>
                updateField("location", event.target.value)
              }
              disabled={loading}
            />
          </LocalizedElement>

          <LocalizedElement as="label" className="create-project-field">
            <LocalizedElement as="span">Budget</LocalizedElement>

            <LocalizedElement as="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="Project budget in AED"
              value={form.budget ?? ""}
              onChange={(event) =>
                updateField("budget", event.target.value)
              }
              disabled={loading}
            />
          </LocalizedElement>

          <LocalizedElement as="div" className="create-project-dates">
            <LocalizedElement as="label" className="create-project-field">
              <LocalizedElement as="span">Start date</LocalizedElement>

              <LocalizedElement as="input"
                type="date"
                value={form.start_date ?? ""}
                onChange={(event) =>
                  updateField(
                    "start_date",
                    event.target.value
                  )
                }
                disabled={loading}
              />
            </LocalizedElement>

            <LocalizedElement as="label" className="create-project-field">
              <LocalizedElement as="span">Deadline</LocalizedElement>

              <LocalizedElement as="input"
                type="date"
                value={form.end_date ?? ""}
                min={form.start_date || undefined}
                onChange={(event) =>
                  updateField(
                    "end_date",
                    event.target.value
                  )
                }
                disabled={loading}
              />
            </LocalizedElement>
          </LocalizedElement>

          {errorMessage && (
            <LocalizedElement as="p" className="create-form-error" role="alert">
              {errorMessage}
            </LocalizedElement>
          )}

          <LocalizedElement as="div" className="create-project-actions">
            <LocalizedElement as="button"
              type="button"
              className="create-project-cancel"
              onClick={() => router.push("/dashboard")}
              disabled={loading}
            >
              Cancel
            </LocalizedElement>

            <LocalizedElement as="button"
              type="submit"
              className="create-project-submit"
              disabled={loading}
            >
              {loading
                ? "Creating project..."
                : "Create Project"}
            </LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
  );
}