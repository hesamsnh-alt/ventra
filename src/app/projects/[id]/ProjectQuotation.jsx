"use client";

import { useMemo, useState } from "react";
import "./ProjectQuotation.css";

export default function ProjectQuotation() {

  const [cost, setCost] = useState(520000);

  const [profit, setProfit] = useState(18);

  const [vat, setVat] = useState(5);

  const quotation = useMemo(() => {

    const profitValue = cost * (profit / 100);

    const subtotal = cost + profitValue;

    const vatValue = subtotal * (vat / 100);

    return {
      profitValue,
      subtotal,
      vatValue,
      total: subtotal + vatValue,
    };

  }, [cost, profit, vat]);

  function money(value) {
    return new Intl.NumberFormat("en-AE", {
      style: "currency",
      currency: "AED",
      maximumFractionDigits: 0,
    }).format(value);
  }

  return (
    <section className="quotation-panel">

      <div className="quotation-header">

        <div>

          <span>CLIENT OFFER</span>

          <h2>Quotation Builder</h2>

        </div>

      </div>

      <div className="quotation-grid">

        <div className="quotation-card">

          <label>Estimate Cost</label>

          <input
            type="number"
            value={cost}
            onChange={(e)=>setCost(Number(e.target.value))}
          />

        </div>

        <div className="quotation-card">

          <label>Contractor Profit %</label>

          <input
            type="number"
            value={profit}
            onChange={(e)=>setProfit(Number(e.target.value))}
          />

        </div>

        <div className="quotation-card">

          <label>VAT %</label>

          <input
            type="number"
            value={vat}
            onChange={(e)=>setVat(Number(e.target.value))}
          />

        </div>

      </div>

      <div className="quotation-summary">

        <div>

          <span>Estimate</span>

          <strong>{money(cost)}</strong>

        </div>

        <div>

          <span>Profit</span>

          <strong>{money(quotation.profitValue)}</strong>

        </div>

        <div>

          <span>Subtotal</span>

          <strong>{money(quotation.subtotal)}</strong>

        </div>

        <div>

          <span>VAT</span>

          <strong>{money(quotation.vatValue)}</strong>

        </div>

        <div className="quotation-total">

          <span>Final Quotation</span>

          <strong>{money(quotation.total)}</strong>

        </div>

      </div>

      <div className="quotation-actions">

        <button>Generate PDF</button>

        <button>Send to Client</button>

      </div>

    </section>
  );

}