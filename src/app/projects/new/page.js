"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProject } from "@/services/projectService";
import "./CreateProject.css";

export default function CreateProjectPage() {
  const router = useRouter();
const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    name: "",
    client: "",
    location: "",
    budget: "",
    start_date: "",
    deadline: "",
  });

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

  setLoading(true);
  setErrorMessage("");

  const { project, error } = await createProject(form);

  if (error) {
    setErrorMessage(
      error.message || "Could not create project."
    );
    setLoading(false);
    return;
  }

  router.push(`/projects/${project.id}`);
}

  return (
    <main className="create-project-page">

      <h1>Create Project</h1>

      <form onSubmit={handleSubmit} className="create-project-form">

        <input
          placeholder="Project Name"
          value={form.name}
          onChange={(e)=>updateField("name",e.target.value)}
          required
        />

        <input
          placeholder="Client"
          value={form.client}
          onChange={(e)=>updateField("client",e.target.value)}
        />

        <input
          placeholder="Location"
          value={form.location}
          onChange={(e)=>updateField("location",e.target.value)}
        />

        <input
          type="number"
          placeholder="Budget"
          value={form.budget}
          onChange={(e)=>updateField("budget",e.target.value)}
        />

        <input
          type="date"
          value={form.start_date}
          onChange={(e)=>updateField("start_date",e.target.value)}
        />

        <input
          type="date"
          value={form.deadline}
          onChange={(e)=>updateField("deadline",e.target.value)}
        />
{errorMessage && (
  <p className="create-form-error">
    {errorMessage}
  </p>
)}
        <button type="submit" disabled={loading}>

          {loading ? "Saving..." : "Create Project"}

        </button>

      </form>

    </main>
  );
}