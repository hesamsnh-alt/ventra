import {PDF_METRIC_UNITS} from '@/lib/pdfTakeoffEvidence.mjs';
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
// Strict nullable metadata is emitted on every page; the image workflow retains
// its existing top-level summary fields.
takeoffSchema.properties.window_area={type:'number',minimum:0};
takeoffSchema.properties.door_area={type:'number',minimum:0};
takeoffSchema.properties.page_evidence={type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['floor_plan','structural_plan','opening_schedule','quantity_schedule','specification','elevation','detail','other']},scope_id:{type:['string','null']},drawing_id:{type:['string','null']},revision:{type:['string','null']},quantities:{type:'array',items:{type:'object',additionalProperties:false,properties:{key:{type:'string',enum:Object.keys(PDF_METRIC_UNITS)},scope_id:{type:'string'},value:{type:'number',minimum:0},unit:{type:'string',enum:['nr','m','m2','m3','kg']},evidence:{type:'string'}},required:['key','scope_id','value','unit','evidence']}}},required:['kind','scope_id','drawing_id','revision','quantities']};
takeoffSchema.required.push('window_area','door_area','page_evidence');
const meterPoint={type:'object',additionalProperties:false,properties:{x:{type:'number'},y:{type:'number'}},required:['x','y']};
const meterPolygon={type:'array',items:meterPoint};
takeoffSchema.properties.area_geometry={type:['object','null'],additionalProperties:false,properties:{
 coverage:{type:'string',enum:['complete','partial']},
 basis:{type:'string',enum:['wall_centerline_zones','clear_internal','unknown']},
 envelope:meterPolygon,envelope_evidence:{type:'string'},
 spaces:{type:'array',items:{type:'object',additionalProperties:false,properties:{
  tag:{type:'string'},kind:{type:'string',enum:['enclosed','outdoor','void','wall']},finish:{type:'string',enum:['wood','tile','epoxy','outdoor','unknown']},
  polygon:meterPolygon,reported_area:{type:['number','null']},evidence:{type:'string'}},
  required:['tag','kind','finish','polygon','reported_area','evidence']}}
},required:['coverage','basis','envelope','envelope_evidence','spaces']};
takeoffSchema.required.push('area_geometry');
