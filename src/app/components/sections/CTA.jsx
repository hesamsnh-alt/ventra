
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import Link from "next/link";
export default function CTA() {
  return (
    <LocalizedElement as="section" className="cta-section">
      <LocalizedElement as="div" className="cta-container">
        <LocalizedElement as="h2">Ready to estimate smarter with Ventra?</LocalizedElement>

        <LocalizedElement as="p">
          Start building faster quotations, cleaner BOQs, and better project
          workflows with one intelligent platform.
        </LocalizedElement>

        <LocalizedElement as="div" className="cta-buttons">
          <LocalizedLink  href="/pricing" className="cta-primary">View Plans</LocalizedLink>
          <LocalizedLink  href="/support" className="cta-secondary">Book Demo</LocalizedLink>
        </LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
  );
}
