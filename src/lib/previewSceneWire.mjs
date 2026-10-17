// Lossless wire encoding only. The persisted scene and its geometry contract stay
// in their original form; no coordinates, objects, or source observations drop.
const aliases = {
  title: 't', confidence: 'c', coordinateMode: 'cm', widthMeters: 'w', depthMeters: 'd',
  footprint: 'fp', rooms: 'r', relationships: 'rel', partitions: 'p', openings: 'o', furniture: 'f',
  id: 'i', name: 'n', type: 't', labelVisible: 'lv', printedWidthMeters: 'pw',
  printedDepthMeters: 'pd', polygon: 'pg', groupId: 'g', roomId: 'r', backLeft: 'bl',
  backRight: 'br', frontCenter: 'fc', embeddedInCounter: 'ec', roomAId: 'a', roomBId: 'b',
  relation: 'r', direction: 'd', start: 's', end: 'e', center: 'p', heightMeters: 'h',
  sillHeightMeters: 'sh', wallIdHint: 'wh', wallAxis: 'ax', hingeSide: 'hs', swingDirection: 'sd',
};

const fail = (code, message) => Object.assign(new Error(message), { code });

export function createPreviewWireCodec(originalSchema) {
  const legend = [];
  function compile(node, path) {
    if (node.type === 'object') {
      const keys = Object.keys(node.properties);
      if (keys.length === 2 && keys.includes('x') && keys.includes('y') &&
          node.properties.x.type === 'number' && node.properties.y.type === 'number') {
        return { schema: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
          decode: value => ({ x: value[0], y: value[1] }) };
      }
      const entries = keys.map(key => ({ key, alias: aliases[key] || key,
        child: compile(node.properties[key], `${path}.${key}`) }));
      if (new Set(entries.map(e => e.alias)).size !== entries.length) throw new Error(`Duplicate preview wire keys at ${path}.`);
      legend.push(`${path}: ${entries.map(e => `${e.alias}=${e.key}`).join(', ')}`);
      return {
        schema: { ...node, required: node.required.map(key => aliases[key] || key),
          properties: Object.fromEntries(entries.map(e => [e.alias, e.child.schema])) },
        decode: value => Object.fromEntries(entries.map(e => [e.key, e.child.decode(value[e.alias])])),
      };
    }
    if (node.type === 'array') {
      const child = compile(node.items, `${path}[]`);
      return { schema: { ...node, items: child.schema }, decode: value => value.map(child.decode) };
    }
    return { schema: { ...node }, decode: value => value };
  }
  const compiled = compile(originalSchema, 'scene');
  return {
    schema: compiled.schema,
    instructions: `WIRE FORMAT (same source observations, shorter JSON): return short keys as listed below. Every point is [x,y], not an object; polygons/footprint remain arrays of points. All preceding geometry rules use the original field names; map them using this legend. Preserve ALL observed objects and coordinate precision; do not omit observations to save tokens. Use concise unique IDs and source room labels. No prose or Markdown.\n${legend.join('\n')}`,
    decode(value) {
      validate(value, compiled.schema, 'scene');
      return compiled.decode(value);
    },
  };
}

function validate(value, schema, path) {
  const invalid = () => { throw fail('PREVIEW_SCHEMA_INVALID', `Preview returned invalid scene data at ${path}. No new scene was saved.`); };
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    if (schema.required.some(key => !Object.hasOwn(value, key)) ||
        Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) invalid();
    for (const [key, child] of Object.entries(schema.properties)) validate(value[key], child, `${path}.${key}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) invalid();
    value.forEach((item, i) => validate(item, schema.items, `${path}[${i}]`));
  } else if (typeof value !== schema.type || (schema.type === 'number' && !Number.isFinite(value))) invalid();
  if (schema.enum && !schema.enum.includes(value)) invalid();
}

// An incomplete response can even contain syntactically valid JSON. Never
// normalize, cache, or save it, and never try to repair/truncate it into success.
export function readCompletedPreview(response, codec) {
  if (response?.status !== 'completed') {
    const reason = response?.incomplete_details?.reason;
    throw fail(reason === 'max_output_tokens' ? 'PREVIEW_OUTPUT_LIMIT' : 'PREVIEW_INCOMPLETE_OUTPUT',
      reason === 'max_output_tokens'
        ? '3D analysis reached its response limit before completing. No new scene was saved and no automatic retry was made.'
        : '3D analysis did not complete. No new scene was saved and no automatic retry was made.');
  }
  if (response.output?.some(item => item.content?.some(part => part.type === 'refusal'))) {
    throw fail('PREVIEW_REFUSED', 'The preview model declined this image. No new scene was saved.');
  }
  const text = String(response.output_text || '').trim();
  if (!text) throw fail('PREVIEW_EMPTY_OUTPUT', 'The preview model returned no scene data. No new scene was saved.');
  let raw;
  try { raw = JSON.parse(text); } catch {
    throw fail('PREVIEW_JSON_PARSE_FAILED', 'The preview model returned invalid JSON. No new scene was saved.');
  }
  return codec.decode(raw);
}
