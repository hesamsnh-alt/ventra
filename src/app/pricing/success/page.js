
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import { Suspense } from "react";
import PricingSuccessClient from "./PricingSuccessClient";

function SuccessLoading() {
  return (
    <LocalizedElement as="main" className="vt-pricing vt-pricing--loading">
      <LocalizedElement as="div" className="vt-pricing__loader" />
      <LocalizedElement as="p">Confirming your trial...</LocalizedElement>
    </LocalizedElement>
  );
}

export default function PricingSuccessPage() {
  return (
    <Suspense fallback={<SuccessLoading />}>
      <PricingSuccessClient />
    </Suspense>
  );
}