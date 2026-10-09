export const takeoffSchema = {
  type: "object",
  additionalProperties: false,

  properties: {
    rooms: {
      type: "integer",
      minimum: 0,
    },

    doors: {
      type: "integer",
      minimum: 0,
    },

    windows: {
      type: "integer",
      minimum: 0,
    },

    wall_length: {
      type: "number",
      minimum: 0,
    },

    wall_area: {
      type: "number",
      minimum: 0,
    },

    floor_area: {
      type: "number",
      minimum: 0,
    },

    ceiling_area: {
      type: "number",
      minimum: 0,
    },

    confidence: {
      type: "number",
      minimum: 0,
      maximum: 100,
    },

    notes: {
      type: "string",
    },

    detected_items: {
      type: "array",

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          name: {
            type: "string",
          },

          quantity: {
            type: "number",
          },

          unit: {
            type: "string",
          },

          description: {
            type: "string",
          },
        },

        required: [
          "name",
          "quantity",
          "unit",
          "description",
        ],
      },
    },
  },

  required: [
    "rooms",
    "doors",
    "windows",
    "wall_length",
    "wall_area",
    "floor_area",
    "ceiling_area",
    "confidence",
    "notes",
    "detected_items",
  ],
};