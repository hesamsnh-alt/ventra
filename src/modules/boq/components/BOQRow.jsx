"use client";

import EditableCell from "./EditableCell";
import { useBoqStore } from "../store/boqStore";

export default function BOQRow({ row }) {
  const updateCell = useBoqStore((state) => state.updateCell);
  const deleteRow = useBoqStore((state) => state.deleteRow);
  const duplicateRow = useBoqStore((state) => state.duplicateRow);

  return (
    <tr className="border-b border-neutral-800 hover:bg-neutral-900 transition-colors">

      <td className="px-3 py-2 w-16">
        <EditableCell
          value={row.itemNo}
          onChange={(value) =>
            updateCell(row.id, "itemNo", value)
          }
        />
      </td>

      <td className="px-3 py-2">
        <EditableCell
          value={row.description}
          placeholder="Description..."
          onChange={(value) =>
            updateCell(row.id, "description", value)
          }
        />
      </td>

      <td className="px-3 py-2 w-28">
        <EditableCell
          value={row.section}
          onChange={(value) =>
            updateCell(row.id, "section", value)
          }
        />
      </td>

      <td className="px-3 py-2 w-20">
        <EditableCell
          value={row.unit}
          onChange={(value) =>
            updateCell(row.id, "unit", value)
          }
        />
      </td>

      <td className="px-3 py-2 w-28">
        <EditableCell
          type="number"
          value={row.quantity}
          onChange={(value) =>
            updateCell(row.id, "quantity", value)
          }
        />
      </td>

      <td className="px-3 py-2 w-32">
        <EditableCell
          type="number"
          value={row.unitRate}
          onChange={(value) =>
            updateCell(row.id, "unitRate", value)
          }
        />
      </td>

      <td className="px-3 py-2 text-right font-semibold w-36">
        {Number(row.total || 0).toLocaleString()}
      </td>

      <td className="px-3 py-2 w-32">
        <div className="flex gap-2">

          <button
            className="rounded bg-yellow-500 px-2 py-1 text-black text-sm hover:bg-yellow-400"
            onClick={() => duplicateRow(row.id)}
          >
            Copy
          </button>

          <button
            className="rounded bg-red-600 px-2 py-1 text-white text-sm hover:bg-red-500"
            onClick={() => deleteRow(row.id)}
          >
            Delete
          </button>

        </div>
      </td>

    </tr>
  );
}