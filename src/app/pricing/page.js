
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import { Suspense } from "react";
import PricingClient from "./PricingClient";

function PricingLoading() {
  return (
    <LocalizedElement as="main" className="vt-pricing vt-pricing--loading">
      <LocalizedElement as="div" className="vt-pricing__loader" />
      <LocalizedElement as="p">Loading Ventra pricing...</LocalizedElement>
    </LocalizedElement>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={<PricingLoading />}>
      <PricingClient />
    </Suspense>
  );
}