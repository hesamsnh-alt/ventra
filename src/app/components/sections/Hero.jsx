
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import Link from "next/link";
import { ArrowUpRight, Play } from "lucide-react";
import "./Hero.css";

export default function Hero() {
  return (
    <LocalizedElement as="section" className="hero">
      <LocalizedElement as="div" className="hero-overlay" />

      <LocalizedElement as="div" className="hero-content">
        <LocalizedElement as="p" className="hero-eyebrow">
          Construction estimating & project workspace
        </LocalizedElement>

        <LocalizedElement as="h1" className="hero-title">
          Turn Drawings into
          <LocalizedElement as="span">Client-Ready Quotations.</LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="p" className="hero-description">
          Review drawing quantities, build an editable BOQ, refine your costs and
          prepare a quotation with your company logo. Keep project schedules
          and reported progress in the same workspace.
        </LocalizedElement>

        <LocalizedElement as="div" className="hero-actions">
          <LocalizedLink  href="/pricing" className="hero-primary-btn">
            View Plans
            <ArrowUpRight size={18} />
          </LocalizedLink>

          <LocalizedLink  href="/resources" className="hero-secondary-btn">
            <LocalizedElement as="span" className="hero-play-icon">
              <Play size={15} fill="currentColor" />
            </LocalizedElement>

            See the Workflow
          </LocalizedLink>
        </LocalizedElement>

        <LocalizedElement as="div" className="hero-features">
          <LocalizedElement as="span">Plan analysis</LocalizedElement>
          <LocalizedElement as="span">Editable AED estimates</LocalizedElement>
          <LocalizedElement as="span">BOQ and quotations</LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
  );
}
