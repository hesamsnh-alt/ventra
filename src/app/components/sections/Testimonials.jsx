export default function Testimonials() {
  const reviews = [
    {
      name: "niusha sadoughi",
      role: "Senior Estimator",
      text: "Ventra reduced our quotation preparation time by more than 60%."
    },
    {
      name: "ehsan sadoughi",
      role: "Project Manager",
      text: "The AI estimation tools are incredibly accurate and easy to use."
    },
    {
      name: "hamid sadoughi",
      role: "Contractor",
      text: "Managing BOQs and quotations has never been this simple."
    }
  ];

  return (
    <section className="testimonials-section">
      <div className="testimonials-container">
        <div className="testimonials-title">
          <span>Testimonials</span>

          <h2>Trusted by engineering professionals.</h2>

          <p>
            Thousands of engineers and contractors rely on Ventra to prepare
            smarter quotations every day.
          </p>
        </div>

        <div className="testimonials-grid">
          {reviews.map((review, index) => (
            <div className="testimonial-card" key={index}>
              <p>"{review.text}"</p>

              <h3>{review.name}</h3>

              <span>{review.role}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}