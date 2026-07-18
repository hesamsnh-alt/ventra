"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import "./Pricing.css";

const features = [
  "7-day free trial",
  "2 users included",
  "Multiple construction projects",
  "AI construction estimation",
  "BOQ generation and editing",
  "Project schedule management",
  "Progress and payment dashboard",
  "UAE construction cost database",
];

export default function PricingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState(null);
  const [checkingUser, setCheckingUser] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const checkoutCanceled = searchParams.get("canceled") === "1";

  useEffect(() => {
    let isMounted = true;

    async function loadUser() {
      try {
        const {
          data: { user: currentUser },
          error,
        } = await supabase.auth.getUser();

        if (error) {
          throw error;
        }

        if (!isMounted) {
          return;
        }

        if (!currentUser) {
          router.replace("/login");
          return;
        }

        setUser(currentUser);
      } catch (error) {
        console.error("Pricing user error:", error);

        if (isMounted) {
          setErrorMessage(
            "We could not verify your account. Please sign in again."
          );
        }
      } finally {
        if (isMounted) {
          setCheckingUser(false);
        }
      }
    }

    loadUser();

    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleStartTrial() {
    setErrorMessage("");
    setCheckoutLoading(true);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session?.access_token) {
        router.push("/login");
        return;
      }

      const response = await fetch(
        "/api/stripe/create-checkout-session",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error ||
            "Stripe Checkout could not be started."
        );
      }

      if (!result?.url) {
        throw new Error(
          "Stripe did not return a checkout URL."
        );
      }

      window.location.href = result.url;
    } catch (error) {
      console.error("Checkout error:", error);

      setErrorMessage(
        error?.message ||
          "Something went wrong. Please try again."
      );

      setCheckoutLoading(false);
    }
  }

  if (checkingUser) {
    return (
      <main className="vt-pricing vt-pricing--loading">
        <div className="vt-pricing__loader" />

        <p>Checking your Ventra account...</p>
      </main>
    );
  }

  return (
    <main className="vt-pricing">
      <header className="vt-pricing__header">
        <Link href="/" className="vt-pricing__logo">
          <span className="vt-pricing__logo-mark">V</span>
          <span>Ventra</span>
        </Link>

        {user && (
          <div className="vt-pricing__account">
            <span>Signed in as</span>
            <strong>{user.email}</strong>
          </div>
        )}
      </header>

      <section className="vt-pricing__hero">
        <span className="vt-pricing__eyebrow">
          Simple pricing
        </span>

        <h1>
          Start free.
          <br />
          Build smarter.
        </h1>

        <p>
          Try every Starter feature free for 7 days. Add your
          payment method today and pay nothing until your trial
          ends.
        </p>
      </section>

      {checkoutCanceled && (
        <div className="vt-pricing__notice vt-pricing__notice--warning">
          Checkout was canceled. Your card has not been charged.
        </div>
      )}

      {errorMessage && (
        <div className="vt-pricing__notice vt-pricing__notice--error">
          {errorMessage}
        </div>
      )}

      <section className="vt-pricing__plans">
        <article className="vt-pricing__plan">
          <div className="vt-pricing__plan-top">
            <div>
              <span className="vt-pricing__plan-label">
                Ventra Starter
              </span>

              <h2>Everything you need to begin.</h2>
            </div>

            <span className="vt-pricing__badge">
              7 days free
            </span>
          </div>

          <div className="vt-pricing__price">
            <span className="vt-pricing__currency">AED</span>

            <strong>1,000</strong>

            <span className="vt-pricing__period">
              / month
            </span>
          </div>

          <p className="vt-pricing__billing-text">
            No charge today. Your paid subscription starts
            automatically after the 7-day trial.
          </p>

          <ul className="vt-pricing__features">
            {features.map((feature) => (
              <li key={feature}>
                <span className="vt-pricing__check">✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="vt-pricing__button"
            onClick={handleStartTrial}
            disabled={checkoutLoading}
          >
            {checkoutLoading
              ? "Opening secure checkout..."
              : "Start 7-Day Free Trial"}
          </button>

          <div className="vt-pricing__payment-note">
            <span>🔒</span>

            <p>
              Secure checkout powered by Stripe. Cancel before
              the trial ends to avoid the first payment.
            </p>
          </div>
        </article>

        <aside className="vt-pricing__summary">
          <span>Today</span>
          <strong>AED 0</strong>
          <p>
            Your card is collected securely, but no subscription
            payment is taken today.
          </p>

          <div className="vt-pricing__summary-divider" />

          <span>After 7 days</span>
          <strong>AED 1,000/month</strong>
          <p>
            Stripe automatically begins monthly billing unless
            the subscription is canceled.
          </p>
        </aside>
      </section>
    </main>
  );
}