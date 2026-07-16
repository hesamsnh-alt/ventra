"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchProjects } from "@/services/projectService";

export default function useProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    const { projects: projectData, error } =
      await fetchProjects();

    if (error) {
      setProjects([]);
      setErrorMessage(
        error.message || "Could not load projects."
      );
      setLoading(false);
      return;
    }

    setProjects(projectData);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return {
    projects,
    loading,
    errorMessage,
    reloadProjects: loadProjects,
  };
}