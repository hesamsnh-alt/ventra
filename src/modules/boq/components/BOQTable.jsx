"use client";

import { useMemo } from "react";
import { useBoqStore } from "../store/boqStore";
import { getFilteredBoqRows } from "../store/boqStore";
import BOQRow from "./BOQRow";

export default function BOQTable() {
  const state = useBoqStore();

  const rows = useMemo(
    () => getFilteredBoqRows(state),
    [state]
  );

  const addRow = state.addRow;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden">

      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">

        <h2 className="text-lg font-semibold text-white">
          Bill of Quantities
        </h2>

        <button
          onClick={() => addRow()}
          className="rounded-lg bg-yellow-500 px-4 py-2 font-medium text-black transition hover:bg-yellow-400"
        >
          + Add Row
        </button>

      </div>

      <div className="overflow-x-auto">

        <table className="min-w-full text-sm text-white">

          <thead className="bg-neutral-900">

            <tr>

              <th className="px-3 py-3 text-left">Item</th>

              <th className="px-3 py-3 text-left">
                Description
              </th>

              <th className="px-3 py-3 text-left">
                Section
              </th>

              <th className="px-3 py-3 text-left">
                Unit
              </th>

              <th className="px-3 py-3 text-right">
                Qty
              </th>

              <th className="px-3 py-3 text-right">
                Rate
              </th>

              <th className="px-3 py-3 text-right">
                Amount
              </th>

              <th className="px-3 py-3 text-center">
                Actions
              </th>

            </tr>

          </thead>

          <tbody>

            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="py-12 text-center text-neutral-400"
                >
                  No BOQ items found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <BOQRow
                  key={row.id}
                  row={row}
                />
              ))
            )}

          </tbody>

        </table>

      </div>

    </div>
  );
}