
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import Link from "next/link";export default function Pricing(){return <LocalizedElement as="section" className="pricing-section"><LocalizedElement as="div" className="pricing-container"><LocalizedElement as="h2">Plans & billing</LocalizedElement><LocalizedElement as="p">Review the current plan and Stripe checkout details before subscribing.</LocalizedElement><LocalizedLink  href="/pricing">View pricing</LocalizedLink> · <LocalizedLink  href="/billing">Manage subscription</LocalizedLink> · <LocalizedLink  href="/support">Contact sales</LocalizedLink></LocalizedElement></LocalizedElement>}
