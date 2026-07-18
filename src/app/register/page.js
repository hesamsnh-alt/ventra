"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import "./Register.css";

export default function RegisterPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    fullName: "",
    companyName: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previousForm) => ({
      ...previousForm,
      [name]: value,
    }));

    setMessage("");
    setMessageType("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setMessage("");
    setMessageType("");

    const fullName = form.fullName.trim();
    const companyName = form.companyName.trim();
    const phone = form.phone.trim();
    const email = form.email.trim().toLowerCase();
    const password = form.password;
    const confirmPassword = form.confirmPassword;

    if (!fullName || !email || !password || !confirmPassword) {
      setMessage("Please complete all required fields.");
      setMessageType("error");
      return;
    }

    if (password.length < 8) {
      setMessage("Password must contain at least 8 characters.");
      setMessageType("error");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      setMessageType("error");
      return;
    }

    if (!acceptedTerms) {
      setMessage("Please accept the Terms and Privacy Policy.");
      setMessageType("error");
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase.auth.signUp({
        email,
        password,

        options: {
          emailRedirectTo: `${window.location.origin}/pricing`,

          data: {
            full_name: fullName,
            company_name: companyName || null,
            phone: phone || null,
          },
        },
      });

      if (error) {
        throw error;
      }

      if (data?.session) {
        router.push("/pricing");
        router.refresh();
        return;
      }

      setMessage(
        "Account created successfully. Please check your email and confirm your account."
      );
      setMessageType("success");

      setForm({
        fullName: "",
        companyName: "",
        phone: "",
        email: "",
        password: "",
        confirmPassword: "",
      });

      setAcceptedTerms(false);
    } catch (error) {
      console.error("Registration error:", error);

      setMessage(
        error?.message || "Registration failed. Please try again."
      );
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="vt-register">
      <section className="vt-register__card">
        <Link href="/" className="vt-register__logo">
          <span className="vt-register__logo-icon">V</span>
          <span>Ventra</span>
        </Link>

        <div className="vt-register__heading">
          <span>Create your account</span>
          <h1>Start building smarter</h1>

          <p>
            Register your Ventra account and continue to select your
            subscription plan.
          </p>
        </div>

        <form className="vt-register__form" onSubmit={handleSubmit}>
          <div className="vt-register__row">
            <label className="vt-register__field">
              <span>Full name *</span>

              <input
                type="text"
                name="fullName"
                value={form.fullName}
                onChange={handleChange}
                placeholder="Your full name"
                autoComplete="name"
              />
            </label>

            <label className="vt-register__field">
              <span>Company name</span>

              <input
                type="text"
                name="companyName"
                value={form.companyName}
                onChange={handleChange}
                placeholder="Your company"
                autoComplete="organization"
              />
            </label>
          </div>

          <div className="vt-register__row">
            <label className="vt-register__field">
              <span>Phone number</span>

              <input
                type="tel"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="+971 50 000 0000"
                autoComplete="tel"
              />
            </label>

            <label className="vt-register__field">
              <span>Email address *</span>

              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="name@company.com"
                autoComplete="email"
              />
            </label>
          </div>

          <div className="vt-register__row">
            <label className="vt-register__field">
              <span>Password *</span>

              <div className="vt-register__password">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            <label className="vt-register__field">
              <span>Confirm password *</span>

              <input
                type={showPassword ? "text" : "password"}
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={handleChange}
                placeholder="Repeat password"
                autoComplete="new-password"
              />
            </label>
          </div>

          <label className="vt-register__terms">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
            />

            <span>
              I agree to the Terms of Service and Privacy Policy.
            </span>
          </label>

          {message && (
            <div
              className={`vt-register__message vt-register__message--${messageType}`}
            >
              {message}
            </div>
          )}

          <button
            type="submit"
            className="vt-register__submit"
            disabled={loading}
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="vt-register__signin">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}