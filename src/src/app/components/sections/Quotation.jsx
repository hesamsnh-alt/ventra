export default function Quotation() {
  return (
    <section className="bg-[#070B14] py-24 text-white">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-400">
            Manual Quotation
          </p>

          <h2 className="mt-4 text-4xl font-bold">
            Turn BOQ into a professional quotation
          </h2>

          <p className="mt-5 max-w-2xl text-slate-400">
            Add your own unit prices, labour cost, profit and VAT. Ventra will calculate totals and prepare a clean quotation.
          </p>
        </div>
      </div>
    </section>
  );
}