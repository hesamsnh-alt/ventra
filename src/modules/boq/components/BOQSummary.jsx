"use client";

import { useBoqStore } from "../store/boqStore";
import { formatCurrency } from "../utils/calculations";

export default function BOQSummary() {
  const subtotal = useBoqStore(
    (state) => state.subtotal
  );

  const vat = useBoqStore(
    (state) => state.vat
  );

  const grandTotal = useBoqStore(
    (state) => state.grandTotal
  );

  return (
    <div className="mt-6 ml-auto w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-950 p-5">

      <div className="flex justify-between py-2">
        <span>Subtotal</span>
        <span>{formatCurrency(subtotal)}</span>
      </div>

      <div className="flex justify-between py-2">
        <span>VAT</span>
        <span>{formatCurrency(vat)}</span>
      </div>

      <div className="mt-3 flex justify-between border-t border-neutral-700 pt-3 text-lg font-bold text-yellow-400">
        <span>Total</span>
        <span>{formatCurrency(grandTotal)}</span>
      </div>

    </div>
  );
}