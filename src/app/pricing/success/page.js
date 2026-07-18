"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import "../Pricing.css";

export default function PricingSuccessPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");

  return (
    <main className="vt-pricing vt-pricing--loading">
      <div
        style={{
          width: "100%",
          maxWidth: "620px",
          padding: "48px 30px",
          textAlign: "center",
          background: "#111111",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "24px",
          boxShadow: "0 30px 90px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            margin: "0 auto 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#080808",
            background: "#ffd400",
            borderRadius: "50%",
            fontSize: "30px",
            fontWeight: "900",
          }}
        >
          ✓
        </div>

        <span
          style={{
            color: "#ffd400",
            fontSize: "12px",
            fontWeight: "850",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Trial activated
        </span>

        <h1
          style={{
            margin: "15px 0",
            color: "#ffffff",
            fontSize: "clamp(38px, 7vw, 62px)",
            lineHeight: "0.95",
            letterSpacing: "-0.05em",
          }}
        >
          Welcome to Ventra.
        </h1>

        <p
          style={{
            maxWidth: "470px",
            margin: "0 auto",
            color: "#929292",
            fontSize: "15px",
            lineHeight: "1.7",
          }}
        >
          Your 7-day free trial has started. Your payment method
          has been saved securely and your first payment will be
          attempted after the trial ends.
        </p>

        {sessionId && (
          <p
            style={{
              marginTop: "19px",
              color: "#555555",
              fontSize: "11px",
              wordBreak: "break-all",
            }}
          >
            Checkout reference: {sessionId}
          </p>
        )}

        <Link
          href="/dashboard"
          style={{
            minHeight: "56px",
            marginTop: "30px",
            padding: "0 25px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#080808",
            background: "#ffd400",
            borderRadius: "14px",
            textDecoration: "none",
            fontSize: "14px",
            fontWeight: "900",
          }}
        >
          Open Dashboard
        </Link>
      </div>
    </main>
  );
}