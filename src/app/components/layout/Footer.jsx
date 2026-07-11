export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-brand">
          <h2>Ventra</h2>
          <p>
            AI-powered estimation and quotation platform for engineers,
            contractors, and construction teams.
          </p>
        </div>

        <div className="footer-links">
          <div>
            <h4>Product</h4>
            <a>Features</a>
            <a>Dashboard</a>
            <a>Pricing</a>
    
          
            <h4>Company</h4>
            <a>About</a>
            <a>Contact</a>
            <a>Support</a>
          </div>
<div className="footer-contact">
  <a
    href="https://wa.me/971509508266"
    target="_blank"
    rel="noopener noreferrer"
    className="whatsapp-btn"
  >
    WhatsApp
  </a>
</div>
          <div>
            <h4>Legal</h4>
            <a>Privacy Policy</a>
            <a>Terms</a>
            <a>Security</a>
          </div>
        </div>
      </div>
      <div ></div>
      <div className="footer-bottom">
        © 2026 Ventra. All rights reserved.
      </div>
    </footer>
  );
}