export const boqJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    projectName: { type: "string" },
    currency: {
      type: "string",
      enum: ["AED"],
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          itemNumber: { type: "string" },
          section: { type: "string" },
          description: { type: "string" },
          unit: {
            type: "string",
            enum: [
              "m",
              "m2",
              "m3",
              "nos",
              "kg",
              "ton",
              "lot",
              "point",
              "item",
            ],
          },
          quantity: {
            type: "number",
            minimum: 0,
          },
          rate: {
            type: "number",
            minimum: 0,
          },
          amount: {
            type: "number",
            minimum: 0,
          },
          source: {
            type: "string",
            enum: [
              "quantity_takeoff",
              "calculated",
              "assumption",
              "manual_review_required",
            ],
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 100,
          },
          notes: { type: "string" },
        },
        required: [
          "itemNumber",
          "section",
          "description",
          "unit",
          "quantity",
          "rate",
          "amount",
          "source",
          "confidence",
          "notes",
        ],
      },
    },
    assumptions: {
      type: "array",
      items: { type: "string" },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    summary: {
      type: "object",
      additionalProperties: false,
      properties: {
        totalItems: {
          type: "integer",
          minimum: 0,
        },
        subtotal: {
          type: "number",
          minimum: 0,
        },
        vatPercentage: {
          type: "number",
          minimum: 0,
        },
        vatAmount: {
          type: "number",
          minimum: 0,
        },
        grandTotal: {
          type: "number",
          minimum: 0,
        },
      },
      required: [
        "totalItems",
        "subtotal",
        "vatPercentage",
        "vatAmount",
        "grandTotal",
      ],
    },
  },
  required: [
    "projectName",
    "currency",
    "items",
    "assumptions",
    "warnings",
    "summary",
  ],
};
