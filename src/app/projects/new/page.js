"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createProject } from "@/services/projectService";
import { getCurrentUser } from "@/services/authService";

import "./CreateProject.css";

export default function CreateProjectPage() {
  const router = useRouter();

  const [checkingUser, setCheckingUser] =
    useState(true);

  const [loading, setLoading] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState("");

  const [form, setForm] = useState({
    name: "",
    client: "",
    location: "",
    budget: "",
    start_date: "",
    deadline: "",
  });

  useEffect(() => {
    let isMounted = true;

    async function checkUser() {
      try {
        const {
          user,
          error,
        } = await getCurrentUser();

        if (error) {
          console.error(
            "User checking error:",
            error.message
          );
        }

        if (!user) {
          router.replace("/login");
          return;
        }

        if (isMounted) {
          setCheckingUser(false);
        }
      } catch (error) {
        console.error(
          "Authentication check error:",
          error
        );

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
      setErrorMessage(
        "Project name is required."
      );

      return;
    }

    try {
      setLoading(true);
      setErrorMessage("");

      const {
        project,
        error,
      } = await createProject(form);

      if (error) {
        setErrorMessage(
          error.message ||
            "Could not create project."
        );

        return;
      }

      if (!project?.id) {
        setErrorMessage(
          "Project was created, but no project ID was returned."
        );

        return;
      }

      router.push(
        `/projects/${project.id}`
      );
    } catch (error) {
      console.error(
        "Project creation error:",
        error
      );

      setErrorMessage(
        "An unexpected error occurred while creating the project."
      );
    } finally {
      setLoading(false);
    }
  }

  if (checkingUser) {
    return (
      <main className="create-project-page">
        <p>Checking your account...</p>
      </main>
    );
  }

  return (
    <main className="create-project-page">
      <div className="create-project-container">
        <div className="create-project-header">
          <span className="create-project-eyebrow">
            New workspace
          </span>

          <h1>Create Project</h1>

          <p>
            Add the basic project information.
            You can complete the remaining details
            later.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="create-project-form"
        >
          <label className="create-project-field">
            <span>Project name</span>

            <input
              type="text"
              placeholder="Example: Villa Renovation"
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

          <label className="create-project-field">
            <span>Client</span>

            <input
              type="text"
              placeholder="Client name"
              value={form.client}
              onChange={(event) =>
                updateField(
                  "client",
                  event.target.value
                )
              }
            />
          </label>

          <label className="create-project-field">
            <span>Location</span>

            <input
              type="text"
              placeholder="Example: Dubai, UAE"
              value={form.location}
              onChange={(event) =>
                updateField(
                  "location",
                  event.target.value
                )
              }
            />
          </label>

          <label className="create-project-field">
            <span>Budget</span>

            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Project budget in AED"
              value={form.budget}
              onChange={(event) =>
                updateField(
                  "budget",
                  event.target.value
                )
              }
            />
          </label>

          <div className="create-project-dates">
            <label className="create-project-field">
              <span>Start date</span>

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

            <label className="create-project-field">
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
          </div>

          {errorMessage && (
            <p className="create-form-error">
              {errorMessage}
            </p>
          )}

          <div className="create-project-actions">
            <button
              type="button"
              className="create-project-cancel"
              onClick={() =>
                router.push("/dashboard")
              }
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="create-project-submit"
              disabled={loading}
            >
              {loading
                ? "Creating project..."
                : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}