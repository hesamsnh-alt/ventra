export default function Pricing() {
  return (
    <section className="pricing-section">
      <div className="pricing-container">
        <div className="pricing-title">
          <span>Pricing</span>
          <h2>Simple plans for every engineering team.</h2>
          <p>
            Start small, then scale Ventra as your quotation and estimation workflow grows.
          </p>
        </div>

        <div className="pricing-grid">
          <div className="price-card">
            <h3>Starter</h3>
            <h4>19AED<span>/mo</span></h4>
            <p>For freelancers and small estimators.</p>
            <ul>
              <li>5 projects</li>
              <li>Basic quotations</li>
              <li>File upload</li>
            </ul>
            <button>Get Started</button>
          </div>

          <div className="price-card featured">
            <div className="popular">Most Popular</div>
            <h3>Pro</h3>
            <h4>49AED<span>/mo</span></h4>
            <p>For contractors and growing teams.</p>
            <ul>
              <li>Unlimited projects</li>
              <li>AI estimation tools</li>
              <li>BOQ generator</li>
              <li>Dashboard reports</li>
            </ul>
            <button>Start Pro</button>
          </div>

          <div className="price-card">
            <h3>Enterprise</h3>
            <h4>Custom</h4>
            <p>For companies with advanced needs.</p>
            <ul>
              <li>Team access</li>
              <li>Custom branding</li>
              <li>Priority support</li>
            </ul>
            <button>Contact Sales</button>
          </div>
        </div>
      </div>
    </section>
  );
}