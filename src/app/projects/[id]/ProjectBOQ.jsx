"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import "./ProjectBOQ.css";

const initialItems = [
  {
    id: 1,
    description: "Reinforced concrete works",
    unit: "m³",
    quantity: 120,
    rate: 420,
  },
  {
    id: 2,
    description: "Reinforcement steel",
    unit: "ton",
    quantity: 18,
    rate: 3250,
  },
  {
    id: 3,
    description: "Blockwork",
    unit: "m²",
    quantity: 640,
    rate: 95,
  },
];

function formatCurrency(value) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function ProjectBOQ() {
  const [items, setItems] = useState(initialItems);

  const total = useMemo(() => {
    return items.reduce((sum, item) => {
      return sum + Number(item.quantity) * Number(item.rate);
    }, 0);
  }, [items]);

  function updateItem(id, field, value) {
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]:
                field === "quantity" || field === "rate"
                  ? Number(value)
                  : value,
            }
          : item
      )
    );
  }

  function addItem() {
    setItems((currentItems) => [
      ...currentItems,
      {
        id: Date.now(),
        description: "New BOQ item",
        unit: "item",
        quantity: 1,
        rate: 0,
      },
    ]);
  }

  function removeItem(id) {
    setItems((currentItems) =>
      currentItems.filter((item) => item.id !== id)
    );
  }

  return (
    <section className="boq-panel">
      <div className="boq-header">
        <div>
          <span>QUANTITY TAKEOFF</span>
          <h2>Bill of Quantities</h2>
        </div>

        <button type="button" onClick={addItem}>
          <Plus size={17} />
          Add Item
        </button>
      </div>

      <div className="boq-table-wrap">
        <table className="boq-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Unit</th>
              <th>Quantity</th>
              <th>Rate</th>
              <th>Amount</th>
              <th />
            </tr>
          </thead>

          <tbody>
            {items.map((item) => {
              const amount =
                Number(item.quantity) * Number(item.rate);

              return (
                <tr key={item.id}>
                  <td>
                    <input
                      value={item.description}
                      onChange={(event) =>
                        updateItem(
                          item.id,
                          "description",
                          event.target.value
                        )
                      }
                    />
                  </td>

                  <td>
                    <input
                      value={item.unit}
                      onChange={(event) =>
                        updateItem(
                          item.id,
                          "unit",
                          event.target.value
                        )
                      }
                    />
                  </td>

                  <td>
                    <input
                      type="number"
                      min="0"
                      value={item.quantity}
                      onChange={(event) =>
                        updateItem(
                          item.id,
                          "quantity",
                          event.target.value
                        )
                      }
                    />
                  </td>

                  <td>
                    <input
                      type="number"
                      min="0"
                      value={item.rate}
                      onChange={(event) =>
                        updateItem(
                          item.id,
                          "rate",
                          event.target.value
                        )
                      }
                    />
                  </td>

                  <td>
                    <strong>{formatCurrency(amount)}</strong>
                  </td>

                  <td>
                    <button
                      type="button"
                      className="boq-delete"
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remove ${item.description}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="boq-total">
        <span>Total Estimated Cost</span>
        <strong>{formatCurrency(total)}</strong>
      </div>
    </section>
  );
}