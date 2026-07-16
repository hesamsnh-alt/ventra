import Link from "next/link";
import { ArrowUpRight, Play } from "lucide-react";
import "./Hero.css";

export default function Hero() {
  return (
    <section className="hero">
      <div className="hero-overlay" />

      <div className="hero-content">
        <p className="hero-eyebrow">
          AI Construction Intelligence Platform
        </p>

        <h1 className="hero-title">
          From Drawings to
          <span>Construction Intelligence.</span>
        </h1>

        <p className="hero-description">
          Analyze drawings, generate BOQs, estimate UAE construction costs,
          create professional quotations and manage every stage of your project
          from one intelligent workspace.
        </p>

        <div className="hero-actions">
          <Link href="#upload" className="hero-primary-btn">
            Start Free
            <ArrowUpRight size={18} />
          </Link>

          <button type="button" className="hero-secondary-btn">
            <span className="hero-play-icon">
              <Play size={15} fill="currentColor" />
            </span>

            Watch Demo
          </button>
        </div>

        <div className="hero-features">
          <span>Plan analysis</span>
          <span>UAE cost intelligence</span>
          <span>BOQ and quotations</span>
        </div>
      </div>
    </section>
  );
}