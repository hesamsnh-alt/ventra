"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Save,
  UserRound,
} from "lucide-react";

import { getCurrentUser } from "@/services/authService";
import { supabase } from "@/lib/supabase";

import "./Profile.css";

export default function ProfilePage() {
  const router = useRouter();

  const [user, setUser] = useState(null);

  const [form, setForm] = useState({
    full_name: "",
    company_name: "",
    phone: "",
    country: "United Arab Emirates",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      try {
        setLoading(true);
        setErrorMessage("");

        const result = await getCurrentUser();

        const currentUser =
          result?.user ||
          result?.data?.user ||
          result ||
          null;

        if (!currentUser) {
          router.replace("/login");
          return;
        }

        if (!mounted) {
          return;
        }

        setUser(currentUser);

        const { data, error } = await supabase
          .from("profiles")
          .select(
            "id, full_name, company_name, phone, country, created_at"
          )
          .eq("id", currentUser.id)
          .maybeSingle();

        if (error) {
          throw error;
        }

        const defaultName =
          currentUser.user_metadata?.full_name ||
          currentUser.user_metadata?.name ||
          currentUser.email?.split("@")[0] ||
          "";

        if (!mounted) {
          return;
        }

        setForm({
          full_name: data?.full_name || defaultName,
          company_name: data?.company_name || "",
          phone: data?.phone || "",
          country:
            data?.country ||
            "United Arab Emirates",
        });
      } catch (error) {
        console.error("Load profile error:", error);

        if (mounted) {
          setErrorMessage(
            error?.message ||
              "Could not load your profile."
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      mounted = false;
    };
  }, [router]);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));

    setErrorMessage("");
    setSuccessMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!user) {
      setErrorMessage("User account was not found.");
      return;
    }

    if (!form.full_name.trim()) {
      setErrorMessage("Full name is required.");
      return;
    }

    try {
      setSaving(true);
      setErrorMessage("");
      setSuccessMessage("");

      const profileData = {
        id: user.id,
        full_name: form.full_name.trim(),
        company_name:
          form.company_name.trim() || null,
        phone: form.phone.trim() || null,
        country:
          form.country ||
          "United Arab Emirates",
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("profiles")
        .upsert(profileData, {
          onConflict: "id",
        });

      if (error) {
        throw error;
      }

      const { error: userUpdateError } =
        await supabase.auth.updateUser({
          data: {
            full_name: form.full_name.trim(),
          },
        });

      if (userUpdateError) {
        console.error(
          "User metadata update error:",
          userUpdateError
        );
      }

      setSuccessMessage(
        "Your profile has been updated successfully."
      );

      router.refresh();
    } catch (error) {
      console.error("Save profile error:", error);

      setErrorMessage(
        error?.message ||
          "Could not save your profile."
      );
    } finally {
      setSaving(false);
    }
  }

  const userInitial =
    form.full_name.trim().charAt(0).toUpperCase() ||
    user?.email?.charAt(0).toUpperCase() ||
    "U";

  if (loading) {
    return (
      <main className="vt-profile-page">
        <div className="vt-profile-loading">
          <LoaderCircle
            size={34}
            className="vt-profile-spinner"
          />

          <p>Loading your profile...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="vt-profile-page">
      <div className="vt-profile-container">
        <Link
          href="/dashboard"
          className="vt-profile-back"
        >
          <ArrowLeft size={18} />
          Back to Dashboard
        </Link>

        <section className="vt-profile-card">
          <header className="vt-profile-header">
            <div className="vt-profile-avatar">
              {userInitial}
            </div>

            <div>
              <span className="vt-profile-label">
                Ventra Account
              </span>

              <h1>My Profile</h1>

              <p>
                Manage your personal and company information.
              </p>
            </div>
          </header>

          <form
            className="vt-profile-form"
            onSubmit={handleSubmit}
          >
            <section className="vt-profile-section">
              <div className="vt-profile-section-heading">
                <UserRound size={20} />

                <div>
                  <h2>Personal Information</h2>

                  <p>
                    Information connected to your Ventra
                    account.
                  </p>
                </div>
              </div>

              <div className="vt-profile-grid">
                <label className="vt-profile-field">
                  <span>
                    <UserRound size={16} />
                    Full Name
                  </span>

                  <input
                    type="text"
                    name="full_name"
                    value={form.full_name}
                    onChange={handleChange}
                    placeholder="Enter your full name"
                    required
                  />
                </label>

                <label className="vt-profile-field">
                  <span>
                    <Mail size={16} />
                    Email Address
                  </span>

                  <input
                    type="email"
                    value={user?.email || ""}
                    disabled
                    readOnly
                  />

                  <small>
                    Your login email cannot be changed here.
                  </small>
                </label>

                <label className="vt-profile-field">
                  <span>
                    <Phone size={16} />
                    Phone Number
                  </span>

                  <input
                    type="tel"
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="+971 50 000 0000"
                  />
                </label>

                <label className="vt-profile-field">
                  <span>
                    <MapPin size={16} />
                    Country
                  </span>

                  <select
                    name="country"
                    value={form.country}
                    onChange={handleChange}
                  >
                    <option value="United Arab Emirates">
                      United Arab Emirates
                    </option>

                    <option value="Iran">
                      Iran
                    </option>

                    <option value="Saudi Arabia">
                      Saudi Arabia
                    </option>

                    <option value="Qatar">
                      Qatar
                    </option>

                    <option value="Oman">
                      Oman
                    </option>

                    <option value="Kuwait">
                      Kuwait
                    </option>

                    <option value="Bahrain">
                      Bahrain
                    </option>

                    <option value="Other">
                      Other
                    </option>
                  </select>
                </label>
              </div>
            </section>

            <section className="vt-profile-section">
              <div className="vt-profile-section-heading">
                <Building2 size={20} />

                <div>
                  <h2>Company Information</h2>

                  <p>
                    Information about your company or
                    organization.
                  </p>
                </div>
              </div>

              <div className="vt-profile-grid">
                <label className="vt-profile-field vt-profile-field--full">
                  <span>
                    <Building2 size={16} />
                    Company Name
                  </span>

                  <input
                    type="text"
                    name="company_name"
                    value={form.company_name}
                    onChange={handleChange}
                    placeholder="Enter your company name"
                  />
                </label>
              </div>
            </section>

            {errorMessage && (
              <div className="vt-profile-message vt-profile-message--error">
                {errorMessage}
              </div>
            )}

            {successMessage && (
              <div className="vt-profile-message vt-profile-message--success">
                <CheckCircle2 size={18} />
                {successMessage}
              </div>
            )}

            <div className="vt-profile-actions">
              <button
                type="submit"
                className="vt-profile-save"
                disabled={saving}
              >
                {saving ? (
                  <LoaderCircle
                    size={18}
                    className="vt-profile-spinner"
                  />
                ) : (
                  <Save size={18} />
                )}

                {saving
                  ? "Saving Changes..."
                  : "Save Changes"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}