import { Suspense } from "react";
import PricingClient from "./PricingClient";

function PricingLoading() {
  return (
    <main className="vt-pricing vt-pricing--loading">
      <div className="vt-pricing__loader" />
      <p>Loading Ventra pricing...</p>
    </main>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={<PricingLoading />}>
      <PricingClient />
    </Suspense>
  );
}