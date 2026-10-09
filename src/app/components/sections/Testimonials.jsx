import LocalizedElement from "@/app/components/i18n/LocalizedElement";

export default function WorkflowBenefits() {
  const cards = [
    {title:"Drawing review", text:"Review extracted quantities against the original drawing."},
    {title:"Commercial review", text:"Edit quantities, unit rates and quotation terms before approval."},
    {title:"Shared project records", text:"Keep tasks, site evidence and reported progress together."},
  ];
  return <LocalizedElement as="section" className="testimonials-section">
    <LocalizedElement as="div" className="testimonials-container">
      <LocalizedElement as="div" className="testimonials-title">
        <LocalizedElement as="span">The Ventra workflow</LocalizedElement>
        <LocalizedElement as="h2">Supported by Your Review.</LocalizedElement>
        <LocalizedElement as="p">Review drawing quantities, build an editable BOQ, refine your costs and prepare a quotation with your company logo. Keep project schedules and reported progress in the same workspace.</LocalizedElement>
      </LocalizedElement>
      <LocalizedElement as="div" className="testimonials-grid">{cards.map(card =>
        <LocalizedElement as="article" className="testimonial-card" key={card.title}>
          <LocalizedElement as="h3">{card.title}</LocalizedElement>
          <LocalizedElement as="p">{card.text}</LocalizedElement>
        </LocalizedElement>
      )}</LocalizedElement>
    </LocalizedElement>
  </LocalizedElement>;
}
