"use client";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInUser } from "@/services/authService";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");

    if (!email.trim() || !password) {
      setErrorMessage("Please enter your email and password.");
      return;
    }

    setLoading(true);

    const { user, error } = await signInUser(
      email,
      password
    );

    setLoading(false);

    if (error || !user) {
      setErrorMessage(
        error?.message || "Login failed."
      );
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <LocalizedElement as="main"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0b0b0b",
        padding: "24px",
      }}
    >
      <LocalizedElement as="form"
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "#151515",
          padding: "32px",
          borderRadius: "18px",
          border: "1px solid #2b2b2b",
        }}
      >
        <LocalizedElement as="h1"
          style={{
            color: "#ffffff",
            marginBottom: "8px",
          }}
        >
          Ventra Login
        </LocalizedElement>

        <LocalizedElement as="p"
          style={{
            color: "#999999",
            marginBottom: "24px",
          }}
        >
          Sign in to your account
        </LocalizedElement>

        <LocalizedElement as="label"
          htmlFor="email"
          style={{
            display: "block",
            color: "#ffffff",
            marginBottom: "8px",
          }}
        >
          Email
        </LocalizedElement>

        <LocalizedElement as="input"
          id="email"
          type="email"
          autoComplete="email"
          placeholder="name@company.com"
          value={email}
          onChange={(event) =>
            setEmail(event.target.value)
          }
          style={{
            width: "100%",
            padding: "13px",
            marginBottom: "18px",
            borderRadius: "10px",
            border: "1px solid #333333",
            background: "#0e0e0e",
            color: "#ffffff",
          }}
        />

        <LocalizedElement as="label"
          htmlFor="password"
          style={{
            display: "block",
            color: "#ffffff",
            marginBottom: "8px",
          }}
        >
          Password
        </LocalizedElement>

        <LocalizedElement as="input"
          id="password"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(event) =>
            setPassword(event.target.value)
          }
          style={{
            width: "100%",
            padding: "13px",
            marginBottom: "18px",
            borderRadius: "10px",
            border: "1px solid #333333",
            background: "#0e0e0e",
            color: "#ffffff",
          }}
        />

        {errorMessage && (
          <LocalizedElement as="p"
            style={{
              color: "#ff6b6b",
              marginBottom: "16px",
            }}
          >
            {errorMessage}
          </LocalizedElement>
        )}

        <LocalizedElement as="button"
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "14px",
            border: "none",
            borderRadius: "10px",
            background: "#ffd400",
            color: "#000000",
            fontWeight: "700",
            cursor: "pointer",
          }}
        >
          {loading ? "Signing in..." : "Sign in"}
        </LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
  );
}