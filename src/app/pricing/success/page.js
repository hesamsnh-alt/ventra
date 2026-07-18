import { Suspense } from "react";
import PricingSuccessClient from "./PricingSuccessClient";

function SuccessLoading() {
  return (
    <main className="vt-pricing vt-pricing--loading">
      <div className="vt-pricing__loader" />
      <p>Confirming your trial...</p>
    </main>
  );
}

export default function PricingSuccessPage() {
  return (
    <Suspense fallback={<SuccessLoading />}>
      <PricingSuccessClient />
    </Suspense>
  );
}