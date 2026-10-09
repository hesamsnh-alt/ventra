"use client";

import { useCallback, useEffect, useState } from "react";
import { getProjects } from "@/services/projectService";

export default function useProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    const { projects: projectData, error } =
      await getProjects();

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
    let cancelled = false;

    getProjects().then(({ projects: projectData, error }) => {
      if (cancelled) {
        return;
      }

      if (error) {
        setProjects([]);
        setErrorMessage(
          error.message || "Could not load projects."
        );
      } else {
        setProjects(projectData);
      }

      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    projects,
    loading,
    errorMessage,
    reloadProjects: loadProjects,
  };
}
