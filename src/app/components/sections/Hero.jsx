import "./Hero.css";

export default function Hero() {
  return (
    <section className="hero" id="home">
      <div className="hero-overlay" />

      <div className="hero-container">
        <div className="hero-content">
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            AI Construction Intelligence Platform
          </div>

          <h1 className="hero-title">
  From Drawings to
  <span>Construction Intelligence.</span>
</h1>

          <p className="hero-description">
            Analyze drawings, generate BOQs, estimate UAE construction costs,
            create professional quotations and intelligently manage every stage
            of your project.
          </p>

          <div className="hero-actions">
            <a href="#project-overview" className="hero-button primary-button">
              Start Free
              <span className="button-arrow">→</span>
            </a>

            <button type="button" className="hero-button secondary-button">
              <span className="play-icon">▶</span>
              Watch Demo
            </button>
          </div>

          <div className="hero-benefits">
            <div>
              <span>✓</span>
              No installation
            </div>

            <div>
              <span>✓</span>
              UAE cost intelligence
            </div>

            <div>
              <span>✓</span>
              Built for construction teams
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}