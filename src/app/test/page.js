"use client";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";


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
      <LocalizedElement as="main" style={{ padding: "40px" }}>
        <LocalizedElement as="h1">Testing Supabase connection...</LocalizedElement>
      </LocalizedElement>
    );
  }

  return (
    <LocalizedElement as="main" style={{ padding: "40px" }}>
      <LocalizedElement as="h1">Supabase Test</LocalizedElement>

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
    </LocalizedElement>
  );
}