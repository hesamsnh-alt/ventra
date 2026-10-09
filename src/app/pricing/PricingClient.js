"use client";
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

export const dynamic = "force-dynamic";
import { useEffect, useState } from "react";
import Link from "next/link";
import SignOutButton from "../components/SignOutButton";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import "./Pricing.css";
import { needsSubscriptionManagement, isExistingSubscriptionConflict, pricingIdentity } from "@/lib/billingState.mjs";

const features = [
  "7-day free trial",
  "2 users included",
  "Multiple construction projects",
  "30 AI analysis submissions per calendar month (5 during trial)",
  "AI-assisted construction estimation",
  "BOQ generation and editing",
  "Project schedule management",
  "Progress and payment dashboard",
  "UAE construction cost database",
];

export default function PricingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [planPrice,setPlanPrice]=useState(null);
  useEffect(()=>{let alive=true;fetch('/api/stripe/price').then(r=>r.ok?r.json():null).then(value=>{if(alive)setPlanPrice(value);}).catch(()=>{});return ()=>{alive=false;};},[]);
  const [billingStatus, setBillingStatus] = useState(null);
  const [user, setUser] = useState(null);
  const [checkingUser, setCheckingUser] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const checkoutCanceled = searchParams.get("canceled") === "1";

  useEffect(() => {
    let isMounted = true;

    async function loadUser() {
      try {
        const identity = await pricingIdentity(supabase.auth);
        if (!isMounted) return;
        if (!identity) {
          setUser(null);
          setBillingStatus("none");
          return;
        }
        setUser(identity.user);
        const response = await fetch("/api/stripe/status", {
          headers: { Authorization: `Bearer ${identity.token}` },
          cache: "no-store",
        });
        const billing = await response.json();
        if (!response.ok) throw new Error(billing.error || "Could not check subscription status.");
        if (isMounted) setBillingStatus(billing.status);
      } catch (error) {
        console.error("Pricing user error:", error);

        if (isMounted) {
          setErrorMessage(
            error?.message || "We could not verify your account. Please sign in again."
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
  if (!user) {
    router.push("/login");
    return;
  }
  if (needsSubscriptionManagement(billingStatus)) {
    router.push("/billing");
    return;
  }
  if (billingStatus === null) return;
  setErrorMessage("");
  setCheckoutLoading(true);

  try {
    const {
      data: refreshedData,
      error: refreshError,
    } = await supabase.auth.refreshSession();

    if (refreshError) {
      throw refreshError;
    }

    let session = refreshedData?.session;

    if (!session?.access_token) {
      const {
        data: sessionData,
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      session = sessionData?.session;
    }

    if (!session?.access_token) {
      await supabase.auth.signOut();

      router.replace("/login");

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

        cache: "no-store",
      }
    );

    const result = await response.json();

    if (isExistingSubscriptionConflict(response.status, result)) {
      setCheckoutLoading(false);
      router.push("/billing");
      return;
    }
    if (!response.ok) {
      if (response.status === 401) {
        await supabase.auth.signOut();

        throw new Error(
          "Your session expired. Please sign in again."
        );
      }

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

    window.location.assign(result.url);
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
      <LocalizedElement as="main" className="vt-pricing vt-pricing--loading">
        <LocalizedElement as="div" className="vt-pricing__loader" />

        <LocalizedElement as="p">Checking your Ventra account...</LocalizedElement>
      </LocalizedElement>
    );
  }

  return (
    <LocalizedElement as="main" className="vt-pricing">
      <LocalizedElement as="header" className="vt-pricing__header">
        <LocalizedLink  href="/" className="vt-pricing__logo">
          <LocalizedElement as="span" className="vt-pricing__logo-mark">V</LocalizedElement>
          <LocalizedElement as="span">Ventra</LocalizedElement>
        </LocalizedLink>

        {user && (
          <LocalizedElement as="div" className="vt-pricing__account">
            <LocalizedElement as="span">Signed in as</LocalizedElement>
            <LocalizedElement as="strong">{user.email}</LocalizedElement>
          <SignOutButton />
          </LocalizedElement>
        )}
      </LocalizedElement>

      <LocalizedElement as="section" className="vt-pricing__hero">
        <LocalizedElement as="span" className="vt-pricing__eyebrow">
          Simple pricing
        </LocalizedElement>

        <LocalizedElement as="h1">
          {needsSubscriptionManagement(billingStatus) ? "Your subscription." : "Plan your workspace."}
          <LocalizedElement as="br" />
          Build smarter.
        </LocalizedElement>

        <LocalizedElement as="p">
          Review your subscription and billing details. Eligible new subscriptions include a 7-day trial; Stripe confirms eligibility before checkout.
        </LocalizedElement>
      </LocalizedElement>

      {checkoutCanceled && (
        <LocalizedElement as="div" className="vt-pricing__notice vt-pricing__notice--warning">
          Checkout was canceled. Your card has not been charged.
        </LocalizedElement>
      )}

      {errorMessage && (
        <LocalizedElement as="div" className="vt-pricing__notice vt-pricing__notice--error">
          {errorMessage}
        </LocalizedElement>
      )}

      <LocalizedElement as="section" className="vt-pricing__plans">
        <LocalizedElement as="article" className="vt-pricing__plan">
          <LocalizedElement as="div" className="vt-pricing__plan-top">
            <LocalizedElement as="div">
              <LocalizedElement as="span" className="vt-pricing__plan-label">
                Ventra Starter
              </LocalizedElement>

              <LocalizedElement as="h2">Everything you need to begin.</LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="span" className="vt-pricing__badge">
              {needsSubscriptionManagement(billingStatus) ? billingStatus : "Trial for eligible accounts"}
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="div" className="vt-pricing__price">
            <LocalizedElement as="span" className="vt-pricing__currency">{planPrice?.currency?.toUpperCase()||""}</LocalizedElement>

            <LocalizedElement as="strong">{planPrice?new Intl.NumberFormat("en-AE",{maximumFractionDigits:2}).format(planPrice.amount/(10**new Intl.NumberFormat("en",{style:"currency",currency:planPrice.currency}).resolvedOptions().maximumFractionDigits)):"View price at checkout"}</LocalizedElement>

            <LocalizedElement as="span" className="vt-pricing__period">
              {planPrice?`/ ${planPrice.intervalCount>1?planPrice.intervalCount+" ":""}${planPrice.interval}`:""}
            </LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="p" className="vt-pricing__billing-text">
            {needsSubscriptionManagement(billingStatus)
              ? `Your subscription status is ${billingStatus}. Manage payments and subscription details in Billing.`
              : "Stripe shows your price and any eligible trial before confirmation."}
          </LocalizedElement>

          <LocalizedElement as="ul" className="vt-pricing__features">
            {features.map((feature) => (
              <LocalizedElement as="li" key={feature}>
                <LocalizedElement as="span" className="vt-pricing__check">✓</LocalizedElement>
                <LocalizedElement as="span">{feature}</LocalizedElement>
              </LocalizedElement>
            ))}
          </LocalizedElement>

          <LocalizedElement as="button"
            type="button"
            className="vt-pricing__button"
            onClick={handleStartTrial}
            disabled={checkoutLoading || billingStatus === null}
          >
            {checkoutLoading
              ? "Opening secure checkout..."
              : !user ? "Sign in to subscribe"
              : needsSubscriptionManagement(billingStatus)
                ? "Manage subscription"
                : billingStatus === null ? "Subscription status unavailable" : "Open subscription checkout"}
          </LocalizedElement>

          <LocalizedElement as="div" className="vt-pricing__payment-note">
            <LocalizedElement as="span">🔒</LocalizedElement>

            <LocalizedElement as="p">
              Secure billing powered by Stripe. View invoices, payment methods and cancellation options in Billing.
            </LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="aside" className="vt-pricing__summary">
          <LocalizedElement as="span">Billing details</LocalizedElement>
          <LocalizedElement as="p">{needsSubscriptionManagement(billingStatus)
            ? "Your subscription already exists. View your current invoices, payment method and renewal information in Billing."
            : "Stripe confirms the amount due, any trial and the renewal date before you subscribe."}</LocalizedElement>
          <LocalizedLink  href="/billing">Open Billing</LocalizedLink>
        </LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
  );
}