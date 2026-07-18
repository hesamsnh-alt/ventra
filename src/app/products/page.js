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
    <main className="vt-products">
      <header className="vt-products__header">
        <Link href="/" className="vt-products__logo">
          <span className="vt-products__logo-mark">V</span>
          <span>Ventra</span>
        </Link>

        <nav className="vt-products__nav">
          <Link href="/products">Products</Link>
          <Link href="/pricing">Pricing</Link>
        </nav>
      </header>

      <section className="vt-products__hero">
        <span className="vt-products__eyebrow">
          Ventra Products
        </span>

        <h1>
          One platform.
          <br />
          Every construction workflow.
        </h1>

        <p>
          Ventra brings estimating, BOQ generation, scheduling,
          project management and UAE cost intelligence into one
          connected construction platform.
        </p>

        <div className="vt-products__actions">
          <Link href="/pricing" className="vt-products__primary">
            Start 7-Day Free Trial
            <ArrowRight size={18} />
          </Link>

          <Link href="/dashboard" className="vt-products__secondary">
            Open Dashboard
          </Link>
        </div>
      </section>

      <section className="vt-products__grid">
        {products.map((product) => {
          const Icon = product.icon;

          return (
            <article
              key={product.title}
              className="vt-products__card"
            >
              <div className="vt-products__icon">
                <Icon size={24} />
              </div>

              <h2>{product.title}</h2>

              <p>{product.text}</p>
            </article>
          );
        })}
      </section>

      <section className="vt-products__cta">
        <div>
          <span>Ready to begin?</span>
          <h2>Try Ventra free for 7 days.</h2>
          <p>
            Add your payment method today and pay nothing until
            the trial ends.
          </p>
        </div>

        <Link href="/pricing">
          View Pricing
          <ArrowRight size={18} />
        </Link>
      </section>
    </main>
  );
}