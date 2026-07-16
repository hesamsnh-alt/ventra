"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function TestPage() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function testConnection() {
      const { data, error } = await supabase
        .from("projects")
        .select("*");

      setResult({ data, error });
      setLoading(false);
    }

    testConnection();
  }, []);

  if (loading) {
    return (
      <main style={{ padding: "40px" }}>
        <h1>Testing Supabase connection...</h1>
      </main>
    );
  }

  return (
    <main style={{ padding: "40px" }}>
      <h1>Supabase Test</h1>

      <pre
        style={{
          marginTop: "20px",
          padding: "20px",
          background: "#111",
          color: "#fff",
          borderRadius: "12px",
          overflowX: "auto",
        }}
      >
        {JSON.stringify(result, null, 2)}
      </pre>
    </main>
  );
}