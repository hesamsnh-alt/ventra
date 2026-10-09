"use client";

import { useBoqStore } from "../store/boqStore";

export default function BOQToolbar() {
  const addRow = useBoqStore((state) => state.addRow);
  const deleteSelectedRows = useBoqStore(
    (state) => state.deleteSelectedRows
  );
  const clearBoq = useBoqStore(
    (state) => state.clearBoq
  );

  const searchQuery = useBoqStore(
    (state) => state.searchQuery
  );

  const setSearchQuery = useBoqStore(
    (state) => state.setSearchQuery
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4">

      <div className="flex flex-wrap gap-2">

        <button
          onClick={() => addRow()}
          className="rounded-lg bg-yellow-500 px-4 py-2 font-medium text-black hover:bg-yellow-400"
        >
          + Add Item
        </button>

        <button
          onClick={deleteSelectedRows}
          className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-500"
        >
          Delete Selected
        </button>

        <button
          onClick={clearBoq}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-white hover:bg-neutral-800"
        >
          Clear BOQ
        </button>

      </div>

      <input
        type="text"
        placeholder="Search..."
        value={searchQuery}
        onChange={(e) =>
          setSearchQuery(e.target.value)
        }
        className="w-72 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-yellow-500"
      />

    </div>
  );
}