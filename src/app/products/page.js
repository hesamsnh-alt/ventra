
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import Link from "next/link";
import {
  Brain,
  FileText,
  Calculator,
  CalendarRange,
  LayoutDashboard,
  Database,
  Users,
  FolderOpen,
  ArrowRight,
} from "lucide-react";

import "./Products.css";

const products = [
  {
    icon: Brain,
    title: "AI Estimator",
    text: "Analyze construction drawings and generate fast, structured project estimates.",
  },
  {
    icon: FileText,
    title: "BOQ Generator",
    text: "Create editable Bills of Quantities from project drawings and scope information.",
  },
  {
    icon: Calculator,
    title: "UAE Cost Intelligence",
    text: "Estimate project costs using UAE-focused construction pricing and cost data.",
  },
  {
    icon: CalendarRange,
    title: "Project Scheduling",
    text: "Build project timelines, monitor activities and manage construction progress.",
  },
  {
    icon: LayoutDashboard,
    title: "Project Dashboard",
    text: "Track project health, progress, payments, schedules and key project information.",
  },
  {
    icon: Database,
    title: "Cost Database",
    text: "Access organized construction cost information for materials, labour and activities.",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    text: "Manage project managers, supervisors and team members with separate access levels.",
  },
  {
    icon: FolderOpen,
    title: "Project Documents",
    text: "Keep drawings, quotations, reports and project files inside one connected workspace.",
  },
];

export default function ProductsPage() {
  return (
    <LocalizedElement as="main" className="vt-products">
      <LocalizedElement as="header" className="vt-products__header">
        <LocalizedLink  href="/" className="vt-products__logo">
          <LocalizedElement as="span" className="vt-products__logo-mark">V</LocalizedElement>
          <LocalizedElement as="span">Ventra</LocalizedElement>
        </LocalizedLink>

        <LocalizedElement as="nav" className="vt-products__nav">
          <LocalizedLink  href="/products">Products</LocalizedLink>
          <LocalizedLink  href="/pricing">Pricing</LocalizedLink>
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="section" className="vt-products__hero">
        <LocalizedElement as="span" className="vt-products__eyebrow">
          Ventra Products
        </LocalizedElement>

        <LocalizedElement as="h1">
          One platform.
          <LocalizedElement as="br" />
          Every construction workflow.
        </LocalizedElement>

        <LocalizedElement as="p">
          Ventra brings estimating, BOQ generation, scheduling,
          project management and UAE cost intelligence into one
          connected construction platform.
        </LocalizedElement>

        <LocalizedElement as="div" className="vt-products__actions">
          <LocalizedLink  href="/pricing" className="vt-products__primary">
            Start 7-Day Free Trial
            <ArrowRight size={18} />
          </LocalizedLink>

          <LocalizedLink  href="/dashboard" className="vt-products__secondary">
            Open Dashboard
          </LocalizedLink>
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="section" className="vt-products__grid">
        {products.map((product) => {
          const Icon = product.icon;

          return (
            <LocalizedElement as="article"
              key={product.title}
              className="vt-products__card"
            >
              <LocalizedElement as="div" className="vt-products__icon">
                <Icon size={24} />
              </LocalizedElement>

              <LocalizedElement as="h2">{product.title}</LocalizedElement>

              <LocalizedElement as="p">{product.text}</LocalizedElement>
            </LocalizedElement>
          );
        })}
      </LocalizedElement>

      <LocalizedElement as="section" className="vt-products__cta">
        <LocalizedElement as="div">
          <LocalizedElement as="span">Ready to begin?</LocalizedElement>
          <LocalizedElement as="h2">Try Ventra free for 7 days.</LocalizedElement>
          <LocalizedElement as="p">
            Add your payment method today and pay nothing until
            the trial ends.
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedLink  href="/pricing">
          View Pricing
          <ArrowRight size={18} />
        </LocalizedLink>
      </LocalizedElement>
    </LocalizedElement>
  );
}