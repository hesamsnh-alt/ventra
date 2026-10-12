// src/lib/printedDimensionAlignment.mjs
var bounds = (poly) => ({ minX: Math.min(...poly.map((p) => p.x)), maxX: Math.max(...poly.map((p) => p.x)), minY: Math.min(...poly.map((p) => p.y)), maxY: Math.max(...poly.map((p) => p.y)) });
var area = (poly) => Math.abs(poly.reduce((s, p, i) => {
  const q = poly[(i + 1) % poly.length];
  return s + p.x * q.y - q.x * p.y;
}, 0)) / 2;
var orthogonal = (poly) => poly.every((p, i) => {
  const q = poly[(i + 1) % poly.length];
  return Math.abs(p.x - q.x) < 0.01 || Math.abs(p.y - q.y) < 0.01;
});
function solveAxis(rooms, axis, extent) {
  const entries = rooms.filter((r) => r.polygon?.length >= 4).map((room) => ({ room, b: bounds(room.polygon) }));
  const key0 = axis === "x" ? "minX" : "minY", key1 = axis === "x" ? "maxX" : "maxY";
  const values = [0, extent, ...entries.flatMap((e) => [e.b[key0], e.b[key1]])].sort((a, b) => a - b);
  const groups = [];
  for (const n of values) {
    const last = groups.at(-1);
    if (last && n - last[0] <= 0.025) last.push(n);
    else groups.push([n]);
  }
  const nodes = groups.map((g) => ({ initial: g.reduce((a, b) => a + b, 0) / g.length }));
  nodes[0].initial = 0;
  nodes.at(-1).initial = extent;
  const nearest = (v) => nodes.reduce((best, n, i) => Math.abs(n.initial - v) < Math.abs(nodes[best].initial - v) ? i : best, 0);
  const adjacency = nodes.map(() => []), constraints = [];
  for (const { room, b } of entries) {
    if (Math.abs(area(room.polygon) - (b.maxX - b.minX) * (b.maxY - b.minY)) > 0.02) continue;
    const target = Number(axis === "x" ? room.printedWidthMeters : room.printedDepthMeters);
    if (!(target > 0)) continue;
    const current = b[key1] - b[key0], i = nearest(b[key0]), j = nearest(b[key1]);
    if (i === j || target > extent + 5e-3 || Math.abs(current - target) > Math.max(0.08, current * 0.05)) return { applied: false, reason: "printed_dimension_outside_refinement_range", roomId: room.id };
    constraints.push({ roomId: room.id, i, j, target });
    adjacency[i].push([j, target]);
    adjacency[j].push([i, -target]);
  }
  if (!constraints.length) return { applied: false, reason: "no_printed_dimensions" };
  const positions = new Array(nodes.length), visited = /* @__PURE__ */ new Set();
  for (let seed = 0; seed < nodes.length; seed++) {
    if (visited.has(seed)) continue;
    const relative = /* @__PURE__ */ new Map([[seed, 0]]), queue = [seed];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      visited.add(i);
      for (const [j, delta] of adjacency[i]) {
        const proposed = relative.get(i) + delta;
        if (relative.has(j)) {
          if (Math.abs(relative.get(j) - proposed) > 5e-3) return { applied: false, reason: "conflicting_printed_dimensions" };
        } else {
          relative.set(j, proposed);
          queue.push(j);
        }
      }
    }
    const anchors = queue.filter((i) => i === 0 || i === nodes.length - 1).map((i) => nodes[i].initial - relative.get(i));
    if (anchors.length > 1 && Math.abs(anchors[0] - anchors[1]) > 5e-3) return { applied: false, reason: "printed_dimensions_conflict_with_extent" };
    const origin = anchors.length ? anchors[0] : queue.reduce((sum, i) => sum + nodes[i].initial - relative.get(i), 0) / queue.length;
    for (const i of queue) positions[i] = origin + relative.get(i);
  }
  const maxShift = Math.max(...positions.map((n, i) => Math.abs(n - nodes[i].initial)));
  if (maxShift > Math.min(0.25, extent * 0.02)) return { applied: false, reason: "excessive_dimension_adjustment", maxShift };
  for (let i = 1; i < positions.length; i++) if (positions[i] - positions[i - 1] < 0.025) return { applied: false, reason: "dimension_grid_order_conflict" };
  const maxError = Math.max(...constraints.map((c) => Math.abs(positions[c.j] - positions[c.i] - c.target)));
  return { applied: true, reason: "consistent_printed_dimension_grid", nodes: nodes.map((n, i) => ({ ...n, value: positions[i] })), constraintCount: constraints.length, maxShift, maxError };
}
function createPrintedDimensionAlignment(rooms, width, depth, footprint = []) {
  if (![footprint, ...rooms.map((r) => r.polygon || [])].every(orthogonal)) return { applied: false, reason: "non_orthogonal_source_preserved" };
  const x = solveAxis(rooms, "x", width), y = solveAxis(rooms, "y", depth);
  return { version: "printed_dimension_alignment_v54", applied: x.applied || y.applied, x, y };
}
function mapPrintedDimensionPoint(point2, alignment) {
  const axis = (value, solution) => {
    if (!solution?.applied || !Number.isFinite(value)) return value;
    const nodes = solution.nodes;
    for (let i = 1; i < nodes.length; i++) if (value <= nodes[i].initial) {
      const a = nodes[i - 1], b = nodes[i], t = (value - a.initial) / (b.initial - a.initial);
      return a.value + t * (b.value - a.value);
    }
    return value + (nodes.at(-1).value - nodes.at(-1).initial);
  };
  return { x: axis(point2.x, alignment?.x), y: axis(point2.y, alignment?.y) };
}

// src/lib/sourceOpeningWalls.mjs
var EPS = 5e-3;
var vector = (edge) => {
  const dx = edge.end.x - edge.start.x, dy = edge.end.y - edge.start.y, length = Math.hypot(dx, dy);
  return length > EPS ? { x: edge.start.x, y: edge.start.y, ux: dx / length, uy: dy / length, length } : null;
};
var along = (g, p) => (p.x - g.x) * g.ux + (p.y - g.y) * g.uy;
var separation = (g, p) => Math.abs((p.x - g.x) * g.uy - (p.y - g.y) * g.ux);
var at = (g, t) => ({ x: g.x + g.ux * t, y: g.y + g.uy * t });
var axisMatches = (g, axis) => axis === "horizontal" ? Math.abs(g.uy) <= 0.2 : axis === "vertical" ? Math.abs(g.ux) <= 0.2 : axis === "diagonal" ? Math.abs(g.ux) > 0.2 && Math.abs(g.uy) > 0.2 : true;
var edges = (room) => (room.polygon || []).map((start, i, poly) => ({ start, end: poly[(i + 1) % poly.length] }));
function prepareObservedOpeningWalls(walls, rooms, observations, relationships = [], { distanceTolerance = 0.12 } = {}) {
  const output = [...walls], added = [];
  for (const observation of observations) {
    if (observation.type !== "door") continue;
    const center = observation.center, width = Number(observation.widthMeters);
    if (!Number.isFinite(center?.x) || !Number.isFinite(center?.y) || !(width > 0)) continue;
    const fits = (edge) => {
      const g = vector(edge);
      if (!g || !axisMatches(g, observation.wallAxis) || separation(g, center) > distanceTolerance) return false;
      const t = along(g, center);
      return t - width / 2 >= -EPS && t + width / 2 <= g.length + EPS;
    };
    if (output.some(fits)) continue;
    let best = null;
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const relation = relationships.find((r) => r.roomAId === a.id && r.roomBId === b.id || r.roomAId === b.id && r.roomBId === a.id);
      if (relation && ["open", "separate"].includes(relation.relation) && relation.confidence >= 0.6) continue;
      for (const ea of edges(a)) {
        const g = vector(ea);
        if (!g || !axisMatches(g, observation.wallAxis) || separation(g, center) > distanceTolerance) continue;
        for (const eb of edges(b)) {
          const h = vector(eb), faceTolerance = Math.min(0.12, distanceTolerance);
          if (!h || Math.abs(g.ux * h.uy - g.uy * h.ux) > 0.02 || separation(g, eb.start) > faceTolerance || separation(g, eb.end) > faceTolerance) continue;
          const lo = Math.max(0, Math.min(along(g, eb.start), along(g, eb.end))), hi = Math.min(g.length, Math.max(along(g, eb.start), along(g, eb.end)));
          const t = along(g, center);
          if (t - width / 2 < lo - EPS || t + width / 2 > hi + EPS) continue;
          const distance2 = separation(g, center);
          if (!best || distance2 < best.distance) best = { start: at(g, lo), end: at(g, hi), distance: distance2, roomIds: [a.id, b.id] };
        }
      }
    }
    if (best) {
      const wall = { id: `opening_support_${observation.id}`.slice(0, 100), type: "internal", provenance: "observed_opening_shared_boundary", start: best.start, end: best.end };
      output.push(wall);
      added.push({ wallId: wall.id, openingId: observation.id, roomIds: best.roomIds, sourceDistance: best.distance });
    }
  }
  return { walls: output, added };
}

// src/lib/roomSemantics.mjs
function canonicalRoomType(room) {
  const selected = room?.semanticType || room?.type;
  if (room?.roomUseSource === "user_confirmed" && ["bathroom", "bedroom", "kitchen", "kitchen_dining", "living", "dining", "balcony", "laundry", "storage", "office", "circulation", "room", "unknown"].includes(selected)) return selected === "unknown" ? "room" : selected;
  const name = String(room?.name || "").normalize("NFKC").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/ي/g, "\u06CC").replace(/ك/g, "\u06A9").toLowerCase();
  const text = `${name} ${room?.type || ""} ${room?.semanticType || ""}`.toLowerCase();
  if (/(balcony|terrace|patio|تراس|بالکن|ایوان|شرفة|شرفه|بلكونة|بلکونة)/.test(text)) return "balcony";
  if (/(laundry|washing room|رخت.?شوی|لباس.?شوی|غرفة\s*غسیل|غرفه\s*غسیل)/.test(text)) return "laundry";
  if (/(bath|toilet|\bwc\b|\bb\s*[/.-]\s*r\b|shower|washroom|powder|سرویس|حمام|توالت|دستشویی|دستشوئی|دورة\s*المیاه|مرحاض)/.test(text)) return "bathroom";
  if (/(store|storage|closet|utility|pantry|انبار|مخزن)/.test(text)) return "storage";
  const kitchen = /(kitchen|آشپزخانه|اشپزخانه|مطبخ)/.test(text);
  const dining = /(dining|dinning|ناهار|غذاخوری|طعام)/.test(text);
  if (kitchen && dining) return "kitchen_dining";
  if (kitchen) return "kitchen";
  if (/(living|lounge|family|majlis|پذیرایی|پذیرائی|نشیمن|مجلس|معیشة|معیشه)/.test(text)) return "living";
  if (dining) return "dining";
  if (/(bed|bedroom|master|guest room|kids room|children|خواب|غرفة\s*نوم|غرفه\s*نوم)/.test(text)) return "bedroom";
  if (/(office|study|work|دفتر|مطالعه|مکتب)/.test(text)) return "office";
  if (/(circulation|corridor|hallway|\bhall\b|راهرو|ممر)/.test(text)) return "circulation";
  return "room";
}

// src/lib/schematicBoundaries.mjs
var lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
var project = (p, a, b) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
function edgeIntervals(wall, room) {
  const a = wall.start, b = wall.end, len = Math.hypot(b.x - a.x, b.y - a.y), ranges = [];
  if (len < 0.01) return ranges;
  const tolerance = 0.12;
  const distance2 = (p) => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len;
  const poly = room.polygon || [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    if (distance2(p) > tolerance || distance2(q) > tolerance) continue;
    const low = Math.max(0, Math.min(project(p, a, b), project(q, a, b)));
    const high = Math.min(1, Math.max(project(p, a, b), project(q, a, b)));
    if ((high - low) * len > 0.05) ranges.push([low, high]);
  }
  return ranges;
}
function outdoorBoundaries(walls, rooms, openings) {
  const output = [], mapped = [];
  for (const wall of walls) {
    if (wall.type !== "external") {
      output.push(wall);
      mapped.push(...openings.filter((o) => o.wallId === wall.id));
      continue;
    }
    const outdoor = rooms.filter((r) => canonicalRoomType(r) === "balcony").flatMap((r) => edgeIntervals(wall, r));
    const indoor = rooms.filter((r) => canonicalRoomType(r) !== "balcony").flatMap((r) => edgeIntervals(wall, r));
    if (!outdoor.length) {
      output.push(wall);
      mapped.push(...openings.filter((o) => o.wallId === wall.id));
      continue;
    }
    const cuts = [.../* @__PURE__ */ new Set([0, 1, ...outdoor.flat(), ...indoor.flat()])].sort((a, b) => a - b);
    const pieces = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const lo = cuts[i], hi = cuts[i + 1], mid = (lo + hi) / 2;
      if (hi - lo < 1e-6) continue;
      const railing = outdoor.some(([a, b]) => mid >= a && mid <= b) && !indoor.some(([a, b]) => mid >= a && mid <= b);
      const prior = pieces.at(-1);
      if (prior && prior.railing === railing) prior.hi = hi;
      else pieces.push({ lo, hi, railing });
    }
    for (const [i, p] of pieces.entries()) output.push({ ...wall, id: pieces.length === 1 ? wall.id : `${wall.id}_outdoor_${i}`, start: lerp(wall.start, wall.end, p.lo), end: lerp(wall.start, wall.end, p.hi), ...p.railing ? { type: "railing", height: 1.1, heightSource: "visual_default_not_measured" } : {} });
    for (const opening of openings.filter((o) => o.wallId === wall.id)) {
      const t = Number(opening.offset), i = pieces.findIndex((p2) => t >= p2.lo - 1e-6 && t <= p2.hi + 1e-6);
      if (i < 0) continue;
      const p = pieces[i];
      mapped.push({ ...opening, wallId: pieces.length === 1 ? wall.id : `${wall.id}_outdoor_${i}`, offset: (t - p.lo) / (p.hi - p.lo) });
    }
  }
  return { walls: output, openings: mapped };
}
function observedDoorOrientation(opening, wall) {
  const side = String(opening.hingeSide || "unknown").toLowerCase();
  const a = wall.start, b = wall.end;
  const first = side === "left" ? a.x <= b.x : side === "right" ? a.x >= b.x : side === "top" ? a.y >= b.y : side === "bottom" ? a.y <= b.y : null;
  const direction = String(opening.swingDirection || "unknown").toLowerCase();
  const swing = direction === "clockwise" ? "counterclockwise" : direction === "counterclockwise" ? "clockwise" : "unknown";
  return { hinge: first === null ? "unknown" : first ? "start" : "end", swing, orientationSource: "source_image_y_down", openAngleDegrees: first === null || swing === "unknown" ? 0 : 90 };
}

// src/lib/operatorAllowance.mjs
function isOperator(owner, env) {
  return !!env.VENTRA_FREE_USER_ID && owner === env.VENTRA_FREE_USER_ID;
}
function operatorAllowance(owner, baseLimit, env) {
  return isOperator(owner, env) ? 2147483647 : baseLimit;
}

// src/lib/serverCommercial.js
import { createHash } from "node:crypto";
import { createClient as createClient2 } from "@supabase/supabase-js";

// src/lib/serverBilling.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
function billingError(message, status) {
  return Object.assign(new Error(message), { status });
}
function provider() {
  if (!process.env.STRIPE_SECRET_KEY) throw billingError("Billing has not been configured by the site operator.", 503);
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
async function account(request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw billingError("Please sign in to manage billing.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key2 = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key2) throw billingError("Account authentication is not configured.", 503);
  const db = createClient(url, key2, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw billingError("Please sign in again.", 401);
  return data.user;
}
async function customerFor(stripe, user, create = false) {
  if (!/^[a-f0-9-]{36}$/i.test(user.id)) throw billingError("Invalid account identifier.", 400);
  const result = await stripe.customers.search({ query: `metadata['supabase_user_id']:'${user.id}'`, limit: 10 });
  if (result.has_more || result.data.length > 1) throw billingError("Multiple billing profiles found. Contact support.", 409);
  let customer = result.data[0];
  if (!customer && user.email) {
    const legacy = await stripe.customers.list({ email: user.email, limit: 100 });
    if (legacy.has_more) throw billingError("Billing profile needs support review.", 409);
    for (const candidate of legacy.data) {
      const subscriptions = await stripe.subscriptions.list({ customer: candidate.id, status: "all", limit: 100 });
      if (subscriptions.data.some((row) => row.metadata?.supabase_user_id === user.id)) {
        if (customer) throw billingError("Multiple billing profiles found. Contact support.", 409);
        customer = await stripe.customers.update(candidate.id, { metadata: { supabase_user_id: user.id } });
      }
    }
  }
  if (!customer && create) customer = await stripe.customers.create({ email: user.email, metadata: { supabase_user_id: user.id } }, { idempotencyKey: `ventra-customer-${user.id}` });
  return customer;
}
async function subscriptionFor(stripe, customer) {
  if (!customer) return null;
  const rows = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 100 });
  return rows.data.sort((a, b) => Number(["active", "trialing", "past_due", "unpaid", "incomplete"].includes(b.status)) - Number(["active", "trialing", "past_due", "unpaid", "incomplete"].includes(a.status)) || b.created - a.created)[0] || null;
}

// src/lib/commercialAccess.mjs
var COMMERCIAL_LIMITS = { active: 30, trialing: 5 };
function subscriptionAccess(subscription, priceId) {
  if (!priceId) throw Object.assign(new Error("The operator must configure the subscription price."), { status: 503 });
  const eligible = subscription && Object.hasOwn(COMMERCIAL_LIMITS, subscription.status) && subscription.items?.data?.some((item) => item.price?.id === priceId);
  if (!eligible) throw Object.assign(new Error("An active Ventra subscription or trial is required. Open Billing."), { status: 402, code: "SUBSCRIPTION_REQUIRED" });
  return { status: subscription.status, limit: COMMERCIAL_LIMITS[subscription.status] };
}
function validProjectId(id) {
  return typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
}

// src/lib/serverCommercial.js
var fail = (message, status = 503, code = "COMMERCIAL_UNAVAILABLE") => Object.assign(new Error(message), { status, code });
function commercialAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key2 = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key2) throw fail("Commercial services are not configured. Contact support.");
  return createClient2(url, key2, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function commercialContext(request, projectId, verifiedUser = null) {
  const user = verifiedUser || await account(request);
  if (!validProjectId(projectId)) throw fail("A valid project ID is required.", 400, "PROJECT_REQUIRED");
  const db = commercialAdmin();
  const { data: project2, error } = await db.from("projects").select("user_id").eq("id", projectId).maybeSingle();
  if (error) throw fail("Could not verify project access.");
  if (!project2) throw fail("Project unavailable.", 403, "PROJECT_ACCESS_DENIED");
  if (project2.user_id !== user.id) {
    const member = await db.from("ventra_project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
    if (member.error || !["manager", "supervisor"].includes(member.data?.role)) throw fail("You cannot run analysis for this project.", 403, "PROJECT_ACCESS_DENIED");
  }
  if (isOperator(project2.user_id, process.env)) return { user, db, owner: project2.user_id, status: "operator", limit: operatorAllowance(project2.user_id, 0, process.env) };
  const stripe = provider(), customer = await customerFor(stripe, { id: project2.user_id, email: project2.user_id === user.id ? user.email : void 0 });
  const subscription = await subscriptionFor(stripe, customer);
  const access = subscriptionAccess(subscription, process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID);
  return { user, db, owner: project2.user_id, ...access, limit: operatorAllowance(project2.user_id, access.limit, process.env) };
}
function commercialError(error) {
  return Response.json({ success: false, error: error.status ? error.message : "Commercial service unavailable. Try later.", code: error.code || "COMMERCIAL_UNAVAILABLE" }, { status: error.status || 503 });
}
var running = /* @__PURE__ */ new Map();
var done = /* @__PURE__ */ new Map();
async function commercialRun(request, action, handler2) {
  try {
    const user = await account(request);
    const raw = await request.clone().text();
    if (raw.length > 12 * 1024 * 1024) throw fail("Analysis request exceeds 12 MB.", 413, "REQUEST_TOO_LARGE");
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw fail("Invalid JSON request.", 400, "BAD_REQUEST");
    }
    const context = await commercialContext(request, body.projectId, user);
    const digest = createHash("sha256").update(raw).digest("hex");
    const suppliedId = String(request.headers.get("x-ventra-request-id") || body.requestId || digest).slice(0, 180);
    const key2 = `${user.id}:${action}:${suppliedId}:${digest}`;
    for (const [id, row] of done) if (row.until < Date.now()) done.delete(id);
    if (done.has(key2)) return done.get(key2).response.clone();
    if (running.has(key2)) return (await running.get(key2)).clone();
    const task = (async () => {
      let reserved = false;
      async function release() {
        if (!reserved) return;
        reserved = false;
        try {
          const { error } = await context.db.rpc("ventra_release_analysis", { p_owner: context.owner, p_actor: user.id, p_project: body.projectId, p_action: action, p_request: suppliedId, p_hash: digest });
          if (error) throw error;
        } catch {
          console.error("[VENTRA USAGE RELEASE] Failed to release unsuccessful analysis; operator reconciliation required.", { projectId: body.projectId, action, requestId: suppliedId });
        }
      }
      if (action !== "boq") {
        if (!process.env.OPENAI_API_KEY) throw fail("AI analysis is not configured. Contact support.");
        if (!isOperator(context.owner, process.env)) {
          const { data, error } = await context.db.rpc("ventra_consume_analysis", { p_owner: context.owner, p_actor: user.id, p_project: body.projectId, p_action: action, p_request: suppliedId, p_hash: digest, p_limit: context.limit });
          if (error) throw fail("Usage tracking is unavailable. Contact support.");
          if (!data?.accepted) throw fail(data?.duplicate ? "This analysis was already submitted. Check the project result before retrying." : "Monthly analysis allowance reached. Open Billing.", data?.duplicate ? 409 : 429, data?.duplicate ? "ANALYSIS_ALREADY_SUBMITTED" : "ANALYSIS_LIMIT_REACHED");
        }
      }
      reserved = action !== "boq" && !isOperator(context.owner, process.env);
      try {
        body.requestId = key2;
        const headers = new Headers(request.headers);
        headers.set("x-ventra-request-id", key2);
        headers.delete("content-length");
        const scoped = new Request(request.url, { method: "POST", headers, body: JSON.stringify(body), signal: request.signal });
        let response;
        response = await handler2(scoped);
        if (!response.ok) await release();
        if (response.ok) {
          if (done.size >= 50) done.delete(done.keys().next().value);
          done.set(key2, { response: response.clone(), until: Date.now() + 3e5 });
        }
        return response;
      } catch (error) {
        await release();
        throw error;
      }
    })();
    running.set(key2, task);
    try {
      return await task;
    } finally {
      if (running.get(key2) === task) running.delete(key2);
    }
  } catch (error) {
    return commercialError(error);
  }
}

// src/lib/interiorPresentation.mjs
var xy = (a, s) => ({ x: Number.isFinite(a.xMeters) ? a.xMeters : Number(a.x ?? 0.5) * s.width, y: Number.isFinite(a.yMeters) ? a.yMeters : Number(a.y ?? 0.5) * s.depth });
var shape = (a, s, pad = 0) => {
  const p = xy(a, s), t = (Number(a.rotation) || 0) * Math.PI / 180;
  return { ...p, u: { x: Math.cos(t), y: Math.sin(t) }, v: { x: -Math.sin(t), y: Math.cos(t) }, hx: (Number(a.width) || 0.8) / 2 + pad, hy: (Number(a.depth) || 0.8) / 2 + pad };
};
var dot = (a, b) => a.x * b.x + a.y * b.y;
function furnitureOverlaps(a, b, s, gap = 0) {
  const x = shape(a, s, gap / 2), y = shape(b, s, gap / 2), d = { x: y.x - x.x, y: y.y - x.y };
  return [x.u, x.v, y.u, y.v].every((n) => Math.abs(dot(d, n)) < x.hx * Math.abs(dot(x.u, n)) + x.hy * Math.abs(dot(x.v, n)) + y.hx * Math.abs(dot(y.u, n)) + y.hy * Math.abs(dot(y.v, n)) - 1e-6);
}

// src/lib/sourceFurniture.mjs
var inside = (p, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};
var heights = { sofa: 0.82, bed: 0.82, armchair: 0.85, chair: 0.88, dining_table: 0.76, coffee_table: 0.42, rug: 0.018, kitchen_counter: 0.88, sink: 0.86, stove: 0.9, refrigerator: 1.82, wardrobe: 2.05, tv_unit: 0.58, toilet: 0.78, shower: 2.05, washing_machine: 0.88, desk: 0.76, nightstand: 0.5, cabinet: 1.4, plant: 0.9 };
function tuckedChairPair(a, b) {
  const chair = a.type === "chair" ? a : b.type === "chair" ? b : null;
  const table2 = a.type === "dining_table" ? a : b.type === "dining_table" ? b : null;
  if (!chair || !table2 || chair.roomId !== table2.roomId) return false;
  const r = chair.rotation * Math.PI / 180, fx = -Math.sin(r), fy = Math.cos(r);
  const tx = table2.xMeters - chair.xMeters, ty = table2.yMeters - chair.yMeters;
  if (tx * fx + ty * fy <= 0) return false;
  const cut = Math.min(0.18, chair.depth * 0.45);
  const rear = { ...chair, depth: chair.depth - cut, xMeters: chair.xMeters - fx * cut / 2, yMeters: chair.yMeters - fy * cut / 2 };
  return !furnitureOverlaps(rear, table2, { width: 0, depth: 0 }, 0);
}
function compileSourceFurniture(observations, footprint, rooms, walls = []) {
  const assets = [], rejected = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [index, o] of (observations || []).entries()) {
    const reject = (reason) => rejected.push({ id: o.id || String(index), reason });
    const room = rooms.find((r) => r.id === o.roomId);
    if (!(o.type in heights) || !room) {
      reject("unknown_type_or_room");
      continue;
    }
    if (o.id && seen.has(o.id)) {
      reject("duplicate_observation_id");
      continue;
    }
    if (o.id) seen.add(o.id);
    let a = o.backLeft, b = o.backRight;
    const f = o.frontCenter;
    if (![a, b, f].every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) || !Number.isFinite(o.confidence) || o.confidence < 0.65) {
      reject("uncertain_observation");
      continue;
    }
    let dx = b.x - a.x, dy = b.y - a.y;
    const width = Math.hypot(dx, dy);
    if (width < 0.12 || width > 6) {
      reject("invalid_width");
      continue;
    }
    let nx = -dy / width, ny = dx / width;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let depth = (f.x - mx) * nx + (f.y - my) * ny;
    if (depth < 0) {
      [a, b] = [b, a];
      dx = -dx;
      dy = -dy;
      nx = -nx;
      ny = -ny;
      depth = -depth;
    }
    if (depth < 0.1 || depth > 4 || Math.abs((f.x - mx) * dx / width + (f.y - my) * dy / width) > 0.15) {
      reject("invalid_front_axis");
      continue;
    }
    let rearInset = 0;
    if (["kitchen_counter", "cabinet", "wardrobe", "tv_unit"].includes(o.type)) for (const w of walls) {
      const wx = w.end.x - w.start.x, wy = w.end.y - w.start.y, wl = Math.hypot(wx, wy);
      if (!wl || Math.abs((wx * dy - wy * dx) / (wl * width)) > 0.01) continue;
      const distance2 = (p) => Math.abs((p.x - w.start.x) * wy - (p.y - w.start.y) * wx) / wl;
      const along2 = (p) => ((p.x - w.start.x) * wx + (p.y - w.start.y) * wy) / wl;
      if (distance2(a) > 0.015 || distance2(b) > 0.015 || Math.min(along2(a), along2(b)) < -0.01 || Math.max(along2(a), along2(b)) > wl + 0.01) continue;
      const thickness = Number(w.thickness) || 0.12;
      if (thickness <= 0 || thickness > 0.3) continue;
      rearInset = Math.max(rearInset, thickness / 2 + 5e-3);
    }
    if (rearInset) {
      if (depth - rearInset < 0.1) {
        reject("insufficient_depth_at_wall");
        continue;
      }
      a = { x: a.x + nx * rearInset, y: a.y + ny * rearInset };
      b = { x: b.x + nx * rearInset, y: b.y + ny * rearInset };
      depth -= rearInset;
    }
    const corners = [a, b, { x: b.x + nx * depth, y: b.y + ny * depth }, { x: a.x + nx * depth, y: a.y + ny * depth }];
    const center = { x: mx + nx * (rearInset + depth / 2), y: my + ny * (rearInset + depth / 2) };
    if (!corners.map((p) => ({ x: p.x * 0.98 + center.x * 0.02, y: p.y * 0.98 + center.y * 0.02 })).every((p) => inside(p, footprint))) {
      reject("outside_footprint");
      continue;
    }
    if (room.polygon?.length >= 3 && !corners.map((p) => ({ x: p.x * 0.98 + center.x * 0.02, y: p.y * 0.98 + center.y * 0.02 })).every((p) => inside(p, room.polygon))) {
      reject("outside_assigned_room");
      continue;
    }
    const forwardPositive = ["sofa", "bed", "armchair", "chair"].includes(o.type);
    const asset = { id: o.id, groupId: o.groupId, roomId: o.roomId, type: o.type, xMeters: center.x, yMeters: center.y, width, depth, height: heights[o.type], rotation: Math.atan2(dy, dx) * 180 / Math.PI + (forwardPositive ? 0 : 180), placementSource: "source_image_observation_v1", sourceConfidence: o.confidence, embeddedInCounter: !!o.embeddedInCounter };
    if (rearInset) asset.sourceAdjustment = { reason: "rear_face_wall_contact", rearInsetMeters: rearInset, frontPreserved: true };
    const embeddedPair = (a2, b2) => a2.embeddedInCounter && b2.type === "kitchen_counter" || b2.embeddedInCounter && a2.type === "kitchen_counter";
    if (o.type !== "rug" && assets.some((a2) => a2.type !== "rug" && !embeddedPair(a2, asset) && !tuckedChairPair(a2, asset) && furnitureOverlaps(a2, asset, { width: 0, depth: 0 }, -0.03))) {
      reject("overlapping_furniture");
      continue;
    }
    if (o.type !== "rug" && walls.some((w) => {
      const dx2 = w.end.x - w.start.x, dy2 = w.end.y - w.start.y;
      const wall = { xMeters: (w.start.x + w.end.x) / 2, yMeters: (w.start.y + w.end.y) / 2, width: Math.hypot(dx2, dy2), depth: Number(w.thickness) || 0.12, rotation: Math.atan2(dy2, dx2) * 180 / Math.PI };
      return furnitureOverlaps(asset, wall, { width: 0, depth: 0 }, -0.04);
    })) {
      reject("intersects_wall");
      continue;
    }
    assets.push(asset);
  }
  return { assets, rejected };
}

// src/lib/fixedFurnitureRepair.mjs
function repairFixedFurniture(scene, boxes) {
  const review = scene?.furnishingReview, p = scene?.geometryValidation?.sourceProjection, b = p?.sourceBounds;
  if (review?.observationCoordinateMode !== "scene_meters_y_up" || !b || !(b.maxX > b.minX) || !(b.maxY > b.minY)) throw new Error("This scene has no source alignment for furniture repair.");
  const original = review.observations || [], rejected = new Set((review.rejected || []).map((x) => x.id));
  const map = (q) => ({ x: (q.x - b.minX) / (b.maxX - b.minX) * scene.width, y: (b.maxY - q.y) / (b.maxY - b.minY) * scene.depth });
  const replacements = /* @__PURE__ */ new Map();
  for (const box of boxes || []) {
    const old = original.find((o) => o.id === box.id);
    if (!old || !rejected.has(box.id) || replacements.has(box.id)) continue;
    const { left: l, right: r, top: t, bottom: d, front } = box;
    if (![l, r, t, d, box.confidence].every(Number.isFinite) || l < 0 || t < 0 || r > 1 || d > 1 || l >= r || t >= d || box.confidence < 0.65 || !["left", "right", "top", "bottom"].includes(front)) continue;
    let a, c, f;
    if (front === "right") {
      a = { x: l, y: t };
      c = { x: l, y: d };
      f = { x: r, y: (t + d) / 2 };
    }
    if (front === "left") {
      a = { x: r, y: t };
      c = { x: r, y: d };
      f = { x: l, y: (t + d) / 2 };
    }
    if (front === "bottom") {
      a = { x: l, y: t };
      c = { x: r, y: t };
      f = { x: (l + r) / 2, y: d };
    }
    if (front === "top") {
      a = { x: l, y: d };
      c = { x: r, y: d };
      f = { x: (l + r) / 2, y: t };
    }
    replacements.set(box.id, { ...old, backLeft: map(a), backRight: map(c), frontCenter: map(f), confidence: box.confidence });
  }
  const ordered = [...original.filter((o) => !rejected.has(o.id)), ...original.filter((o) => rejected.has(o.id)).map((o) => replacements.get(o.id) || o)];
  const result = compileSourceFurniture(ordered, scene.footprint, scene.rooms, scene.walls);
  const preserved = (scene.assets || []).filter((a) => !rejected.has(a.id));
  const restored = result.assets.filter((a) => rejected.has(a.id)).filter((a) => !preserved.some((b2) => a.type !== "rug" && b2.type !== "rug" && !(a.embeddedInCounter && b2.type === "kitchen_counter") && !(b2.embeddedInCounter && a.type === "kitchen_counter") && furnitureOverlaps(a, b2, scene, -0.03)));
  result.assets = [...preserved, ...restored];
  const restoredIds = new Set(restored.map((a) => a.id));
  result.rejected = [...result.rejected.filter((a) => rejected.has(a.id)), ...Array.from(rejected).filter((id) => !restoredIds.has(id) && !result.rejected.some((r) => r.id === id)).map((id) => ({ id, reason: "repair_not_validated" }))];
  const repairedIds = result.assets.filter((a) => rejected.has(a.id)).map((a) => a.id);
  return { ...scene, assets: result.assets, furnishingReview: { ...review, observations: ordered, acceptedCount: result.assets.length, rejected: result.rejected, requiresReview: result.rejected.length > 0, repair: { mode: "fixed_geometry", repairedIds } }, geometryValidation: { ...scene.geometryValidation, furnishing: { ...scene.geometryValidation.furnishing, assetCount: result.assets.length, byType: result.assets.reduce((counts, a) => (counts[a.type] = (counts[a.type] || 0) + 1, counts), {}), byRoom: scene.rooms.map((r) => ({ roomId: r.id, type: r.type, assetCount: result.assets.filter((a) => a.roomId === r.id).length, assetTypes: result.assets.filter((a) => a.roomId === r.id).map((a) => a.type) })) } } };
}

// src/lib/sourceFurnitureReview.mjs
function applySourceFurnitureReview(scene, observations) {
  const bounds2 = scene.geometryValidation?.sourceProjection?.sourceBounds;
  if (!bounds2 || !(bounds2.maxX > bounds2.minX) || !(bounds2.maxY > bounds2.minY) || !Array.isArray(observations)) throw new Error("Furniture review has no valid source alignment.");
  const point2 = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? mapPrintedDimensionPoint({ x: (p.x - bounds2.minX) / (bounds2.maxX - bounds2.minX) * scene.width, y: (bounds2.maxY - p.y) / (bounds2.maxY - bounds2.minY) * scene.depth }, scene.geometryValidation?.dimensionAlignment) : { x: NaN, y: NaN };
  const mapped = observations.map((o) => ({ ...o, backLeft: point2(o.backLeft), backRight: point2(o.backRight), frontCenter: point2(o.frontCenter) }));
  const result = compileSourceFurniture(mapped, scene.footprint, scene.rooms, scene.walls);
  const missing = [];
  for (const room of scene.rooms) {
    if (canonicalRoomType(room) === "laundry" && !result.assets.some((a) => a.roomId === room.id && a.type === "washing_machine")) missing.push({ roomId: room.id, type: "washing_machine", reason: "laundry_appliance_not_confirmed" });
  }
  const furnishing = { ...scene.geometryValidation.furnishing, version: "source_fidelity_v49", assetCount: result.assets.length, rejectedCount: result.rejected.length, completedEssentialCount: 0, doorClearanceAware: false, byType: result.assets.reduce((c, a) => (c[a.type] = (c[a.type] || 0) + 1, c), {}), byRoom: scene.rooms.map((r) => ({ roomId: r.id, type: canonicalRoomType(r), assetCount: result.assets.filter((a) => a.roomId === r.id).length, assetTypes: result.assets.filter((a) => a.roomId === r.id).map((a) => a.type) })) };
  return { ...scene, assets: result.assets, furnishingMode: "source_observed", furnishingReview: { ...scene.furnishingReview, observedCount: mapped.length, acceptedCount: result.assets.length, observations: mapped, observationCoordinateMode: "scene_meters_y_up", rejected: result.rejected, added: [], missing, requiresReview: !!(result.rejected.length || missing.length || !result.assets.length), coverageReview: { status: "completed", mode: "furniture_only_fixed_architecture" } }, geometryValidation: { ...scene.geometryValidation, furnishing } };
}

// src/lib/serverPreviewAnalysis.js
import { NextResponse } from "next/server.js";
import sharp2 from "sharp";

// src/lib/wallOverlapRepair.mjs
var EPS2 = 1e-6;
var point = (p) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y));
var geometry = (wall) => {
  if (!point(wall?.start) || !point(wall?.end)) return null;
  const dx = Number(wall.end.x) - Number(wall.start.x);
  const dy = Number(wall.end.y) - Number(wall.start.y);
  const length = Math.hypot(dx, dy);
  return length > EPS2 ? { x: Number(wall.start.x), y: Number(wall.start.y), ux: dx / length, uy: dy / length, length } : null;
};
var at2 = (g, t) => ({ x: g.x + g.ux * t, y: g.y + g.uy * t });
var projection = (g, p) => (Number(p.x) - g.x) * g.ux + (Number(p.y) - g.y) * g.uy;
var separation2 = (g, p) => Math.abs((Number(p.x) - g.x) * g.uy - (Number(p.y) - g.y) * g.ux);
var rank = (wall, openings) => (openings.some((o) => String(o?.wallId) === String(wall?.id)) ? 8 : 0) + (wall?.type === "external" ? 4 : 0) + (wall?.provenance === "observed" ? 2 : 0) + (wall?.provenance === "room_boundary" || String(wall?.id || "").startsWith("room_edge_") ? 0 : 1);
function repairOverlappingWalls(walls = [], openings = [], { distanceTolerance = 0.04, angleToleranceDegrees = 1 } = {}) {
  if (!Array.isArray(walls) || walls.length < 2) return { walls, openings, changed: false };
  const ordered = walls.map((wall, index) => ({ wall, index, g: geometry(wall) })).sort((a, b) => rank(b.wall, openings) - rank(a.wall, openings) || a.index - b.index);
  const accepted = [];
  const output = /* @__PURE__ */ new Map();
  let changed = false;
  const angleLimit = Math.sin(angleToleranceDegrees * Math.PI / 180);
  for (const entry of ordered) {
    const { wall, g } = entry;
    if (!g) {
      output.set(entry.index, [wall]);
      continue;
    }
    let spans = [[0, g.length]];
    for (const higher of accepted) {
      const h = higher.g;
      if (Math.abs(g.ux * h.uy - g.uy * h.ux) > angleLimit || separation2(g, higher.wall.start) > distanceTolerance || separation2(g, higher.wall.end) > distanceTolerance) continue;
      const lo = Math.max(0, Math.min(projection(g, higher.wall.start), projection(g, higher.wall.end)));
      const hi = Math.min(g.length, Math.max(projection(g, higher.wall.start), projection(g, higher.wall.end)));
      if (hi <= lo + EPS2) continue;
      spans = spans.flatMap(([a, b]) => {
        if (hi <= a + EPS2 || lo >= b - EPS2) return [[a, b]];
        const pieces2 = [];
        if (lo > a + EPS2) pieces2.push([a, lo]);
        if (hi < b - EPS2) pieces2.push([hi, b]);
        return pieces2;
      });
      if (!spans.length) break;
    }
    const pieces = spans.map(([a, b], i) => a < EPS2 && b > g.length - EPS2 ? wall : { ...wall, id: `${wall.id || `wall_${entry.index}`}__residual_${i + 1}`, start: at2(g, a), end: at2(g, b) });
    if (pieces.length !== 1 || pieces[0] !== wall) changed = true;
    output.set(entry.index, pieces);
    for (const piece of pieces) accepted.push({ wall: piece, g: geometry(piece) });
  }
  if (!changed) return { walls, openings, changed: false };
  const repairedWalls = walls.flatMap((_, index) => output.get(index));
  let unsafe = false;
  const remappedOpenings = openings.map((opening) => {
    const original = walls.find((w) => String(w?.id) === String(opening?.wallId));
    const g = geometry(original);
    if (!g || !Number.isFinite(Number(opening?.offset))) return opening;
    const center = at2(g, Number(opening.offset) * g.length);
    const candidates = repairedWalls.map((w) => ({ wall: w, g: geometry(w) })).filter(({ wall, g: candidate }) => candidate && separation2(candidate, center) <= distanceTolerance && Math.abs(g.ux * candidate.uy - g.uy * candidate.ux) <= angleLimit && projection(candidate, center) >= -EPS2 && projection(candidate, center) <= candidate.length + EPS2);
    const width = Math.max(0, Number(opening.width) || 0);
    const supporting = candidates.find(({ wall, g: candidate }) => wall.id === opening.wallId && projection(candidate, center) >= width / 2 - EPS2 && candidate.length - projection(candidate, center) >= width / 2 - EPS2) || candidates.find(({ g: candidate }) => projection(candidate, center) >= width / 2 - EPS2 && candidate.length - projection(candidate, center) >= width / 2 - EPS2);
    if (!supporting) {
      if (!repairedWalls.includes(original)) unsafe = true;
      return opening;
    }
    const offset = projection(supporting.g, center) / supporting.g.length;
    if (supporting.wall.id === opening.wallId && Math.abs(offset - Number(opening.offset)) <= EPS2) return opening;
    const reversed = g.ux * supporting.g.ux + g.uy * supporting.g.uy < 0;
    return {
      ...opening,
      wallId: supporting.wall.id,
      offset,
      ...reversed && opening.hinge ? { hinge: opening.hinge === "start" ? "end" : opening.hinge === "end" ? "start" : opening.hinge } : {},
      ...reversed && opening.swing ? { swing: opening.swing === "clockwise" ? "counterclockwise" : opening.swing === "counterclockwise" ? "clockwise" : opening.swing } : {}
    };
  });
  if (unsafe) return { walls, openings, changed: false };
  return { walls: repairedWalls, openings: remappedOpenings, changed: true };
}

// src/lib/openPlanPartitions.mjs
var key = (a, b) => [String(a), String(b)].sort().join("|");
var inside2 = (p, polygon = []) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};
var distance = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
var semanticOpen = (a, b) => {
  const types = [a.semanticType || a.type, b.semanticType || b.type];
  return types.includes("living") && types.some((t) => t === "kitchen_dining" || t === "dining");
};
function filterOpenPlanPartitions(partitions = [], rooms = [], relationships = [], openings = []) {
  const relations = new Map(relationships.map((r) => [key(r.roomAId, r.roomBId), r]));
  const removedIds = [];
  const replacements = /* @__PURE__ */ new Map();
  const filtered = partitions.filter((wall) => {
    if (wall.type === "external" || !String(wall.id || "").startsWith("room_edge_") || wall.provenance === "observed") return true;
    if (!wall.start || !wall.end) return true;
    if (openings.some((o) => o.wallId === wall.id || o.wallIdHint === wall.id || o.type !== "window" && o.center && distance(o.center, wall.start, wall.end) <= 0.18)) return true;
    const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y, length = Math.hypot(dx, dy);
    if (length < 0.2) return true;
    const offset = 0.12;
    const samples = [0.15, 0.325, 0.5, 0.675, 0.85].map((t) => {
      const p = { x: wall.start.x + t * dx, y: wall.start.y + t * dy };
      return [
        rooms.filter((r) => inside2({ x: p.x - dy / length * offset, y: p.y + dx / length * offset }, r.polygon)),
        rooms.filter((r) => inside2({ x: p.x + dy / length * offset, y: p.y - dx / length * offset }, r.polygon))
      ];
    });
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j], relation = relations.get(key(a.id, b.id));
      if (relation && relation.relation !== "open") continue;
      if (!(relation?.relation === "open" && relation.confidence >= 0.45) && !(!relation && semanticOpen(a, b))) continue;
      const matches = samples.every(([left, right]) => {
        if ([...left, ...right].some((r) => r !== a && r !== b)) return false;
        return left.includes(a) && right.includes(b) || left.includes(b) && right.includes(a);
      });
      if (matches) {
        removedIds.push(wall.id);
        return false;
      }
    }
    const partialOffset = Math.max(offset, Math.min(0.3, Number(wall.thickness || wall.width) || 0.3));
    const cuts = [0, 1];
    for (const room of rooms) for (let i = 0; i < (room.polygon || []).length; i++) {
      const a = room.polygon[i], b = room.polygon[(i + 1) % room.polygon.length];
      const ex = b.x - a.x, ey = b.y - a.y, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-10) continue;
      for (const side of [-1, 1]) {
        const origin = { x: wall.start.x - side * dy / length * partialOffset, y: wall.start.y + side * dx / length * partialOffset };
        const ax = a.x - origin.x, ay = a.y - origin.y;
        const t = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
      }
    }
    const sorted = [...new Set(cuts.map((t) => Number(t.toFixed(9))))].sort((a, b) => a - b), kept = [];
    let changed = false;
    for (let i = 1; i < sorted.length; i++) {
      const start = sorted[i - 1], end = sorted[i], t = (start + end) / 2;
      const p = { x: wall.start.x + t * dx, y: wall.start.y + t * dy };
      const left = rooms.filter((r) => inside2({ x: p.x - dy / length * partialOffset, y: p.y + dx / length * partialOffset }, r.polygon));
      const right = rooms.filter((r) => inside2({ x: p.x + dy / length * partialOffset, y: p.y - dx / length * partialOffset }, r.polygon));
      const open = relationships.some((r) => r.relation === "open" && r.confidence >= 0.45 && [...left, ...right].every((room) => room.id === r.roomAId || room.id === r.roomBId) && (left.some((a) => a.id === r.roomAId) && right.some((b) => b.id === r.roomBId) || left.some((a) => a.id === r.roomBId) && right.some((b) => b.id === r.roomAId)));
      if (open && (end - start) * length >= 0.15) {
        changed = true;
        continue;
      }
      const last = kept.at(-1);
      if (last && Math.abs(last[1] - start) < 1e-8) last[1] = end;
      else kept.push([start, end]);
    }
    if (changed) {
      removedIds.push(wall.id);
      replacements.set(wall.id, kept.filter(([a, b]) => (b - a) * length > 1e-8).map(([a, b], i) => ({ ...wall, id: `${wall.id}__open_trim_${i + 1}`, start: { x: wall.start.x + a * dx, y: wall.start.y + a * dy }, end: { x: wall.start.x + b * dx, y: wall.start.y + b * dy } })));
    }
    return true;
  });
  return { partitions: filtered.flatMap((w) => replacements.get(w.id) || [w]), removed: removedIds.length, removedIds };
}

// src/lib/serverPreviewAnalysis.js
import { createHash as createHash2 } from "node:crypto";

// src/services/openaiClient.js
import OpenAI from "openai";
var openaiClient = null;
function getOpenAIClient() {
  if (openaiClient) {
    return openaiClient;
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is missing from .env.local."
    );
  }
  openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  return openaiClient;
}
async function createResponse(payload) {
  const openai = getOpenAIClient();
  return openai.responses.create(payload);
}

// src/lib/rasterImageEvidence.mjs
import sharp from "sharp";
function exteriorBackground(mask, width, height) {
  const stride = width + 1, integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      sum += mask[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
    }
  }
  const radius = Math.max(8, Math.round(Math.min(width, height) * 0.012));
  const broad = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
    const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
    const dark = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
    broad[y * width + x] = dark / ((x1 - x0) * (y1 - y0)) >= 0.93 ? 1 : 0;
  }
  const visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  let head = 0, tail = 0;
  const add = (i) => {
    if (broad[i] && !visited[i]) {
      visited[i] = 1;
      queue[tail++] = i;
    }
  };
  const seedEdge = (indices) => {
    let start = -1;
    for (let j = 0; j <= indices.length; j++) {
      if (j < indices.length && broad[indices[j]]) {
        if (start < 0) start = j;
      } else if (start >= 0) {
        if (j - start >= indices.length * 0.5) for (let k = start; k < j; k++) add(indices[k]);
        start = -1;
      }
    }
  };
  seedEdge(Array.from({ length: width }, (_, x) => x));
  seedEdge(Array.from({ length: width }, (_, x) => (height - 1) * width + x));
  seedEdge(Array.from({ length: height }, (_, y) => y * width));
  seedEdge(Array.from({ length: height }, (_, y) => y * width + width - 1));
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    if (x) add(i - 1);
    if (x + 1 < width) add(i + 1);
    if (y) add(i - width);
    if (y + 1 < height) add(i + width);
  }
  const distance2 = new Uint16Array(mask.length);
  head = 0;
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    if (distance2[i] >= radius) continue;
    for (const j of [x ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y ? i - width : -1, y + 1 < height ? i + width : -1]) {
      if (j >= 0 && mask[j] && !visited[j]) {
        visited[j] = 1;
        distance2[j] = distance2[i] + 1;
        queue[tail++] = j;
      }
    }
  }
  return visited;
}
function strokeGuides(mask, width, height, horizontal) {
  const major = horizontal ? width : height, minor = horizontal ? height : width;
  const minLength = Math.max(12, Math.round(Math.min(width, height) * 0.018));
  const maxThickness = Math.max(10, Math.round(Math.min(width, height) * 0.035));
  const groups = [], active = /* @__PURE__ */ new Map();
  for (let row = 0; row < minor; row++) {
    const runs = [];
    let begin = -1;
    for (let col = 0; col <= major; col++) {
      const dark = col < major && mask[horizontal ? row * width + col : col * width + row];
      if (dark && begin < 0) begin = col;
      if (!dark && begin >= 0) {
        if (col - begin >= minLength) runs.push([begin, col - 1]);
        begin = -1;
      }
    }
    const next = /* @__PURE__ */ new Map();
    for (const [start, end] of runs) {
      let previous = null;
      for (const g of active.values()) {
        if (Math.abs(g.start - start) <= 2 && Math.abs(g.end - end) <= 2) {
          previous = g;
          break;
        }
      }
      if (previous) {
        previous.last = row;
        previous.start = Math.max(previous.start, start);
        previous.end = Math.min(previous.end, end);
        next.set(previous, previous);
      } else {
        const group = { start, end, first: row, last: row };
        groups.push(group);
        next.set(group, group);
      }
    }
    active.clear();
    for (const [key2, g] of next) active.set(key2, g);
  }
  return groups.filter((g) => g.last - g.first >= 2 && g.last - g.first + 1 <= maxThickness && g.end - g.start >= minLength).map((g) => {
    const center = (g.first + g.last) / 2;
    return {
      start: horizontal ? { x: g.start, y: center } : { x: center, y: g.start },
      end: horizontal ? { x: g.end, y: center } : { x: center, y: g.end },
      thicknessPixels: g.last - g.first + 1
    };
  });
}
async function prepareRasterImageEvidence(buffer) {
  const { data, info } = await sharp(buffer).flatten({ background: "#ffffff" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const mask = Uint8Array.from(data, (v) => v < 170 ? 1 : 0);
  const background = exteriorBackground(mask, width, height);
  for (let i = 0; i < mask.length; i++) if (background[i]) mask[i] = 0;
  const guides = [...strokeGuides(mask, width, height, true), ...strokeGuides(mask, width, height, false)].sort((a, b) => Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) - Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y)).slice(0, 100).map((g, i) => ({ id: `pixel-stroke-${i + 1}`, ...g }));
  return { width, height, mask, guides };
}
function rasterEvidencePrompt(evidence) {
  if (!evidence.guides.length) return "No long dark wall-stroke guides could be isolated. Trace only clearly visible structural lines; unreadable geometry must remain rejected.";
  return `Observed dark pixel strokes in the exact image frame (these are partial ink segments, NOT a completed plan or a wall classification):
${JSON.stringify(evidence.guides)}
Use the original image to classify wall strokes versus text/furniture. Match visible wall centerlines to these coordinates where relevant. Connect strokes only through visible wall junctions or real door/window gaps. The guide list may be incomplete and is never permission to infer a rectangle, extend a wall into white space, or fill a recess.`;
}

// src/lib/serverPreviewAnalysis.js
var VERSION = "room-design-defaults-v64-20261011";
var MODEL = process.env.OPENAI_3D_PREVIEW_MODEL || "gpt-5.6-sol";
var requestedReasoning = process.env.OPENAI_3D_PREVIEW_REASONING || "medium";
var REASONING_EFFORT = ["low", "medium", "high"].includes(requestedReasoning) ? requestedReasoning : "medium";
var MAX_OUTPUT_TOKENS = Math.max(3500, Math.min(8e3, Number(process.env.VENTRA_3D_PREVIEW_MAX_OUTPUT_TOKENS || 8e3)));
var TIMEOUT_MS = Math.max(45e3, Math.min(18e4, Number(process.env.VENTRA_3D_PREVIEW_TIMEOUT_MS || 12e4)));
var pointSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: { x: { type: "number" }, y: { type: "number" } }
};
var sceneSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "confidence", "widthMeters", "depthMeters", "coordinateMode", "footprint", "rooms", "relationships", "partitions", "openings", "furniture"],
  properties: {
    title: { type: "string" },
    confidence: { type: "number" },
    coordinateMode: { type: "string", enum: ["image_normalized"] },
    widthMeters: { type: "number" },
    depthMeters: { type: "number" },
    footprint: { type: "array", minItems: 4, maxItems: 48, items: pointSchema },
    rooms: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "type", "labelVisible", "printedWidthMeters", "printedDepthMeters", "polygon"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          labelVisible: { type: "boolean" },
          printedWidthMeters: { type: "number" },
          printedDepthMeters: { type: "number" },
          polygon: { type: "array", minItems: 3, maxItems: 24, items: pointSchema }
        }
      }
    },
    furniture: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "groupId", "roomId", "type", "backLeft", "backRight", "frontCenter", "confidence", "embeddedInCounter"],
        properties: {
          id: { type: "string" },
          groupId: { type: "string" },
          roomId: { type: "string" },
          type: { type: "string", enum: ["sofa", "bed", "armchair", "chair", "dining_table", "coffee_table", "rug", "kitchen_counter", "sink", "stove", "refrigerator", "wardrobe", "tv_unit", "toilet", "shower", "washing_machine", "desk", "nightstand", "cabinet", "plant"] },
          backLeft: pointSchema,
          backRight: pointSchema,
          frontCenter: pointSchema,
          confidence: { type: "number" },
          embeddedInCounter: { type: "boolean" }
        }
      }
    },
    relationships: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomAId", "roomBId", "relation", "direction", "confidence"],
        properties: {
          roomAId: { type: "string" },
          roomBId: { type: "string" },
          relation: { type: "string", enum: ["wall", "open", "door", "separate"] },
          direction: { type: "string", enum: ["left", "right", "above", "below", "overlap"] },
          confidence: { type: "number" }
        }
      }
    },
    partitions: {
      type: "array",
      maxItems: 96,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "start", "end"],
        properties: { id: { type: "string" }, start: pointSchema, end: pointSchema }
      }
    },
    openings: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "center", "widthMeters", "heightMeters", "sillHeightMeters", "wallIdHint", "wallAxis", "hingeSide", "swingDirection"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["door", "window"] },
          center: pointSchema,
          widthMeters: { type: "number" },
          heightMeters: { type: "number" },
          sillHeightMeters: { type: "number" },
          wallIdHint: { type: "string" },
          wallAxis: { type: "string", enum: ["horizontal", "vertical", "diagonal", "unknown"] },
          hingeSide: { type: "string" },
          swingDirection: { type: "string" }
        }
      }
    }
  }
};
function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function openingVerticalDimensions(opening, type) {
  const supplied = (value) => value !== null && value !== void 0 && value !== "" && Number.isFinite(Number(value));
  const rawHeight = Number(opening?.heightMeters);
  const hasHeight = supplied(opening?.heightMeters) && rawHeight > 0;
  const height = hasHeight ? Math.min(2.8, rawHeight) : type === "window" ? 1.25 : 2.1;
  const rawSill = Number(opening?.sillHeightMeters);
  const hasSill = type === "window" && supplied(opening?.sillHeightMeters) && rawSill >= 0 && (hasHeight || rawSill > 0);
  const sillHeight = type === "window" ? hasSill ? Math.min(rawSill, Math.max(0, 2.8 - height)) : Math.min(0.9, 2.8 - height) : 0;
  return {
    height,
    sillHeight,
    heightSource: hasHeight ? "source_dimension" : "visual_default_not_measured",
    sillHeightSource: type === "door" ? "door_floor_level" : hasSill ? "source_dimension" : "visual_default_not_measured"
  };
}
function dist(a, b) {
  return Math.hypot(Number(a?.x || 0) - Number(b?.x || 0), Number(a?.y || 0) - Number(b?.y || 0));
}
function polygonArea(points = []) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
  }
  return Math.abs(sum / 2);
}
function cleanPolygon(points = []) {
  const out = [];
  for (const point2 of points) {
    if (!Number.isFinite(Number(point2?.x)) || !Number.isFinite(Number(point2?.y))) continue;
    const p = { x: Number(point2.x), y: Number(point2.y) };
    if (!out.length || dist(out[out.length - 1], p) > 0.025) out.push(p);
  }
  if (out.length > 2 && dist(out[0], out[out.length - 1]) < 0.025) out.pop();
  return out;
}
function pointInPolygon(point2, polygon = []) {
  let inside3 = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const hit = a.y > point2.y !== b.y > point2.y && point2.x < (b.x - a.x) * (point2.y - a.y) / (b.y - a.y || 1e-9) + a.x;
    if (hit) inside3 = !inside3;
  }
  return inside3;
}
function projectToSegment(point2, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const raw = len2 ? ((point2.x - a.x) * dx + (point2.y - a.y) * dy) / len2 : 0;
  const t = Math.max(0, Math.min(1, raw));
  const q = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, point: q, distance: dist(point2, q), length: Math.sqrt(len2) };
}
function normalizedPointBounds(points = []) {
  const valid = (Array.isArray(points) ? points : []).filter(
    (p) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y))
  );
  if (!valid.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return {
    minX: Math.min(...valid.map((p) => Number(p.x))),
    minY: Math.min(...valid.map((p) => Number(p.y))),
    maxX: Math.max(...valid.map((p) => Number(p.x))),
    maxY: Math.max(...valid.map((p) => Number(p.y)))
  };
}
function roomNormalizedBounds(room) {
  return normalizedPointBounds(Array.isArray(room?.polygon) ? room.polygon : []);
}
function mean(values = []) {
  const nums = values.filter((v) => Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}
function axisScaleQuality(input, axis, meterPerPixel, imageWidth, imageHeight) {
  if (!(meterPerPixel > 0)) return { meanRelativeError: null, count: 0 };
  const errors = [];
  for (const room of Array.isArray(input?.rooms) ? input.rooms : []) {
    if (room?.labelVisible === false) continue;
    const b = roomNormalizedBounds(room);
    const normalizedSpan = axis === "x" ? b.maxX - b.minX : b.maxY - b.minY;
    const pixels = normalizedSpan * (axis === "x" ? imageWidth : imageHeight);
    const printed = Number(axis === "x" ? room?.printedWidthMeters : room?.printedDepthMeters);
    if (!(pixels > 4 && printed > 0.25)) continue;
    const predicted = pixels * meterPerPixel;
    errors.push(Math.abs(predicted - printed) / Math.max(printed, 0.25));
  }
  return { meanRelativeError: mean(errors), count: errors.length };
}
function projectImageNormalizedSceneToMeters(input, imageMeta = {}) {
  if (input?.coordinateMode !== "image_normalized") {
    return { raw: input, diagnostics: { applied: false, reason: "legacy_metric_input" } };
  }
  const imageWidth = clamp(imageMeta?.width, 64, 2e4, 1e3);
  const imageHeight = clamp(imageMeta?.height, 64, 2e4, 1e3);
  const statedWidth = clamp(input?.widthMeters, 2, 80, 10);
  const statedDepth = clamp(input?.depthMeters, 2, 80, 8);
  const footprint = Array.isArray(input?.footprint) ? input.footprint : [];
  const bounds2 = normalizedPointBounds(footprint);
  const spanX = bounds2.maxX - bounds2.minX;
  const spanY = bounds2.maxY - bounds2.minY;
  if (!(spanX > 0.05 && spanY > 0.05)) {
    throw Object.assign(
      new Error("The preview returned an unusable normalized building outline."),
      { code: "PREVIEW_BAD_NORMALIZED_BOUNDS" }
    );
  }
  const pixelSpanX = spanX * imageWidth;
  const pixelSpanY = spanY * imageHeight;
  const scaleFromX = statedWidth / Math.max(pixelSpanX, 1e-6);
  const scaleFromY = statedDepth / Math.max(pixelSpanY, 1e-6);
  const xQuality = axisScaleQuality(input, "x", scaleFromX, imageWidth, imageHeight);
  const yQuality = axisScaleQuality(input, "y", scaleFromY, imageWidth, imageHeight);
  const hasWidth = Number.isFinite(Number(input?.widthMeters)) && Number(input.widthMeters) > 0.5;
  const hasDepth = Number.isFinite(Number(input?.depthMeters)) && Number(input.depthMeters) > 0.5;
  let meterPerPixelX = scaleFromX;
  let meterPerPixelY = scaleFromY;
  let calibrationMode = "two_axis_global_affine";
  if (hasWidth && !hasDepth) {
    meterPerPixelY = meterPerPixelX;
    calibrationMode = "uniform_from_x_only";
  } else if (!hasWidth && hasDepth) {
    meterPerPixelX = meterPerPixelY;
    calibrationMode = "uniform_from_y_only";
  }
  const width = pixelSpanX * meterPerPixelX;
  const depth = pixelSpanY * meterPerPixelY;
  const mapPoint = (point2) => {
    const nx = clamp(point2?.x, 0, 1, bounds2.minX);
    const ny = clamp(point2?.y, 0, 1, bounds2.minY);
    return {
      x: (nx - bounds2.minX) * imageWidth * meterPerPixelX,
      y: (ny - bounds2.minY) * imageHeight * meterPerPixelY
    };
  };
  const raw = {
    ...input,
    widthMeters: width,
    depthMeters: depth,
    coordinateMode: "meters_from_image_normalized_global_affine_v15",
    footprint: footprint.map(mapPoint),
    rooms: (Array.isArray(input?.rooms) ? input.rooms : []).map((room) => ({
      ...room,
      polygon: (Array.isArray(room?.polygon) ? room.polygon : []).map(mapPoint)
    })),
    partitions: (Array.isArray(input?.partitions) ? input.partitions : []).map((wall) => ({
      ...wall,
      start: mapPoint(wall?.start),
      end: mapPoint(wall?.end)
    })),
    furniture: (input.furniture || []).map((item) => ({ ...item, backLeft: mapPoint(item.backLeft), backRight: mapPoint(item.backRight), frontCenter: mapPoint(item.frontCenter) })),
    openings: (Array.isArray(input?.openings) ? input.openings : []).map((opening) => ({
      ...opening,
      center: mapPoint(opening?.center)
    }))
  };
  const anisotropyRatio = meterPerPixelX > 0 && meterPerPixelY > 0 ? Math.max(meterPerPixelX, meterPerPixelY) / Math.min(meterPerPixelX, meterPerPixelY) : 1;
  return {
    raw,
    diagnostics: {
      applied: true,
      reason: "single_global_two_axis_affine_transform_v15",
      calibrationMode,
      imageWidth,
      imageHeight,
      sourceBounds: {
        minX: Number(bounds2.minX.toFixed(4)),
        minY: Number(bounds2.minY.toFixed(4)),
        maxX: Number(bounds2.maxX.toFixed(4)),
        maxY: Number(bounds2.maxY.toFixed(4))
      },
      pixelSpanX: Number(pixelSpanX.toFixed(2)),
      pixelSpanY: Number(pixelSpanY.toFixed(2)),
      statedWidthMeters: Number(statedWidth.toFixed(3)),
      statedDepthMeters: Number(statedDepth.toFixed(3)),
      projectedWidthMeters: Number(width.toFixed(3)),
      projectedDepthMeters: Number(depth.toFixed(3)),
      meterPerPixelX: Number(meterPerPixelX.toFixed(6)),
      meterPerPixelY: Number(meterPerPixelY.toFixed(6)),
      anisotropyRatio: Number(anisotropyRatio.toFixed(4)),
      xValidationMeanRelativeError: Number.isFinite(xQuality.meanRelativeError) ? Number(xQuality.meanRelativeError.toFixed(4)) : null,
      yValidationMeanRelativeError: Number.isFinite(yQuality.meanRelativeError) ? Number(yQuality.meanRelativeError.toFixed(4)) : null,
      xValidationCount: xQuality.count,
      yValidationCount: yQuality.count
    }
  };
}
function sourcePoint(point2, width, depth) {
  const x = clamp(point2?.x, 0, width, 0);
  const yDown = clamp(point2?.y, 0, depth, 0);
  return { x, y: depth - yDown };
}
function snapAxisWall(wall) {
  const a = { ...wall.start };
  const b = { ...wall.end };
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx > dy * 5) {
    const y = (a.y + b.y) / 2;
    a.y = y;
    b.y = y;
  } else if (dy > dx * 5) {
    const x = (a.x + b.x) / 2;
    a.x = x;
    b.x = x;
  }
  return { ...wall, start: a, end: b };
}
function wallKey(wall) {
  const a = `${wall.start.x.toFixed(3)},${wall.start.y.toFixed(3)}`;
  const b = `${wall.end.x.toFixed(3)},${wall.end.y.toFixed(3)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function roomBounds(room) {
  const xs = room.polygon.map((p) => p.x);
  const ys = room.polygon.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function pointToSegmentDistance(point2, a, b) {
  return projectToSegment(point2, a, b).distance;
}
function rectFromRoom(room) {
  if (!room?.polygon || room.polygon.length !== 4) return null;
  const xs = [...new Set(room.polygon.map((p) => Number(p.x.toFixed(3))))].sort((a, b) => a - b);
  const ys = [...new Set(room.polygon.map((p) => Number(p.y.toFixed(3))))].sort((a, b) => a - b);
  if (xs.length !== 2 || ys.length !== 2) return null;
  const [minX, maxX] = xs;
  const [minY, maxY] = ys;
  if (maxX - minX < 0.2 || maxY - minY < 0.2) return null;
  return { minX, maxX, minY, maxY };
}
function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const y = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  return x * y;
}
function roomCenter(room) {
  const b = roomBounds(room);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}
function pairKey(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}
function normalizeRelationships(rawRelationships, roomIds) {
  const valid = new Set(roomIds.map(String));
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rel of Array.isArray(rawRelationships) ? rawRelationships : []) {
    const a = String(rel?.roomAId || "");
    const b = String(rel?.roomBId || "");
    if (!a || !b || a === b || !valid.has(a) || !valid.has(b)) continue;
    const relation = ["wall", "open", "door", "separate"].includes(rel?.relation) ? rel.relation : "separate";
    const key2 = `${pairKey(a, b)}:${relation}`;
    if (seen.has(key2)) continue;
    seen.add(key2);
    out.push({
      roomAId: a,
      roomBId: b,
      relation,
      direction: ["left", "right", "above", "below", "overlap"].includes(rel?.direction) ? rel.direction : "overlap",
      confidence: clamp(rel?.confidence, 0, 1, 0.5)
    });
  }
  return out;
}
function inferRoomPairGeometry(roomA, roomB) {
  const a = rectFromRoom(roomA);
  const b = rectFromRoom(roomB);
  if (!a || !b) return null;
  const ca = roomCenter(roomA), cb = roomCenter(roomB);
  const overlapX = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const overlapY = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  if (Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y)) {
    if (ca.x <= cb.x) return { axis: "x", first: roomA, second: roomB, gap: b.minX - a.maxX, overlap: overlapY };
    return { axis: "x", first: roomB, second: roomA, gap: a.minX - b.maxX, overlap: overlapY };
  }
  if (ca.y <= cb.y) return { axis: "y", first: roomA, second: roomB, gap: b.minY - a.maxY, overlap: overlapX };
  return { axis: "y", first: roomB, second: roomA, gap: a.minY - b.maxY, overlap: overlapX };
}
function roomAtOffsetPoint(point2, rooms) {
  return rooms.find((room) => pointInPolygon(point2, room.polygon))?.id || null;
}
function sharedBoundaryForRelationship(roomA, roomB) {
  const a = rectFromRoom(roomA), b = rectFromRoom(roomB);
  if (!a || !b) return null;
  const g = inferRoomPairGeometry(roomA, roomB);
  if (!g) return null;
  if (g.axis === "x") {
    const y0 = Math.max(a.minY, b.minY), y1 = Math.min(a.maxY, b.maxY);
    if (y1 - y0 < 0.35 || Math.abs(g.gap) > 0.18) return null;
    const x = ((g.first === roomA ? a.maxX : b.maxX) + (g.second === roomB ? b.minX : a.minX)) / 2;
    return { start: { x, y: y0 }, end: { x, y: y1 } };
  }
  const x0 = Math.max(a.minX, b.minX), x1 = Math.min(a.maxX, b.maxX);
  if (x1 - x0 < 0.35 || Math.abs(g.gap) > 0.18) return null;
  const y = ((g.first === roomA ? a.maxY : b.maxY) + (g.second === roomB ? b.minY : a.minY)) / 2;
  return { start: { x: x0, y }, end: { x: x1, y } };
}
function ensureRelationshipWalls(partitions, rooms, relationships) {
  const roomById = new Map(rooms.map((r) => [String(r.id), r]));
  const out = [...partitions];
  let added = 0;
  for (const rel of relationships) {
    if (!(rel.relation === "wall" || rel.relation === "door") || rel.confidence < 0.6) continue;
    const a = roomById.get(String(rel.roomAId)), b = roomById.get(String(rel.roomBId));
    if (!a || !b) continue;
    const candidate = sharedBoundaryForRelationship(a, b);
    if (!candidate) continue;
    const duplicate = out.some((wall) => {
      const m = { x: (candidate.start.x + candidate.end.x) / 2, y: (candidate.start.y + candidate.end.y) / 2 };
      return pointToSegmentDistance(m, wall.start, wall.end) < 0.14;
    });
    if (!duplicate) {
      out.push({ id: `rel_${a.id}_${b.id}`.slice(0, 64), type: "internal", ...candidate });
      added += 1;
    }
  }
  return { partitions: out, added };
}
function getRelationshipForPair(relationships, aId, bId) {
  const key2 = pairKey(aId, bId);
  return (Array.isArray(relationships) ? relationships : []).find(
    (rel) => pairKey(rel.roomAId, rel.roomBId) === key2
  ) || null;
}
function roomsAcrossWallDetailed(wall, rooms) {
  const length = dist(wall.start, wall.end);
  if (length < 0.2) return { a: null, b: null, ids: [] };
  const mx = (wall.start.x + wall.end.x) / 2;
  const my = (wall.start.y + wall.end.y) / 2;
  const dx = (wall.end.x - wall.start.x) / length;
  const dy = (wall.end.y - wall.start.y) / length;
  const nx = -dy, ny = dx;
  for (const offset of [0.1, 0.16, 0.22, 0.28, 0.34]) {
    const a = roomAtOffsetPoint({ x: mx + nx * offset, y: my + ny * offset }, rooms);
    const b = roomAtOffsetPoint({ x: mx - nx * offset, y: my - ny * offset }, rooms);
    const ids = [...new Set([a, b].filter(Boolean))];
    if (a || b) return { a, b, ids };
  }
  return { a: null, b: null, ids: [] };
}
function openingPlacementScore(type, wall, projection2, rooms, relationships) {
  if (!wall || !projection2 || projection2.length < 0.35) return Number.POSITIVE_INFINITY;
  let score = Number(projection2.distance || 0);
  const side = roomsAcrossWallDetailed(wall, rooms);
  const ids = side.ids;
  const rel = ids.length === 2 ? getRelationshipForPair(relationships, ids[0], ids[1]) : null;
  const isExternal = String(wall?.type || "") === "external";
  if (type === "window") {
    score += isExternal ? -0.3 : 1.35;
    if (ids.length === 0) score += 0.25;
    return score;
  }
  if (isExternal) {
    score += ids.length === 1 ? -0.1 : 1.1;
    return score;
  }
  if (ids.length === 2) {
    if (rel?.relation === "door") score -= 0.4;
    else if (rel?.relation === "wall") score -= 0.02;
    else if (rel?.relation === "open") score += 1.2;
    else score += 0.22;
  } else if (ids.length === 1) {
    score += 0.12;
  } else {
    score += 1.3;
  }
  return score;
}
function chooseBestWallForOpening(center, type, walls, rooms, relationships, wallIdHint = null, wallAxis = "unknown", openingWidth = 0.9) {
  let candidateWalls = Array.isArray(walls) ? walls : [];
  if (wallIdHint) {
    const hinted = candidateWalls.find((wall) => String(wall.id) === String(wallIdHint));
    if (hinted) candidateWalls = [hinted, ...candidateWalls.filter((wall) => wall !== hinted)];
  }
  let best = null;
  for (const wall of candidateWalls) {
    const dx = Math.abs(wall.end.x - wall.start.x);
    const dy = Math.abs(wall.end.y - wall.start.y);
    if (wallAxis === "horizontal" && dy > dx * 0.2) continue;
    if (wallAxis === "vertical" && dx > dy * 0.2) continue;
    if (wallAxis === "diagonal" && (dx < dy * 0.2 || dy < dx * 0.2)) continue;
    const projection2 = projectToSegment(center, wall.start, wall.end);
    const measuredWidth = Number(openingWidth);
    const halfWidth = measuredWidth > 0 ? measuredWidth / 2 : 0.45;
    const endClearance = Math.min(projection2.t, 1 - projection2.t) * projection2.length;
    if (projection2.distance > 0.18 || endClearance < halfWidth - 5e-3) continue;
    const endpointPenalty = Math.max(0, halfWidth - endClearance) * 2;
    const hintBonus = String(wall.id) === String(wallIdHint) && projection2.distance < 0.35 ? -0.2 : 0;
    const ux = (wall.end.x - wall.start.x) / projection2.length;
    const uy = (wall.end.y - wall.start.y) / projection2.length;
    const localWall = {
      ...wall,
      start: { x: projection2.point.x - ux * 0.2, y: projection2.point.y - uy * 0.2 },
      end: { x: projection2.point.x + ux * 0.2, y: projection2.point.y + uy * 0.2 }
    };
    const score = endpointPenalty + hintBonus + openingPlacementScore(type, localWall, projection2, rooms, relationships);
    if (!Number.isFinite(score)) continue;
    if (!best || score < best.score) best = { wall, projection: projection2, score };
  }
  return best;
}
function closeAlignedWallGaps(walls, tolerance = 0.18) {
  const out = (Array.isArray(walls) ? walls : []).map((wall) => ({
    ...wall,
    start: { ...wall.start },
    end: { ...wall.end }
  }));
  for (let i = 0; i < out.length; i += 1) {
    for (let j = i + 1; j < out.length; j += 1) {
      const a = out[i], b = out[j];
      const av = Math.abs(a.start.x - a.end.x) < 0.05;
      const bv = Math.abs(b.start.x - b.end.x) < 0.05;
      const ah = Math.abs(a.start.y - a.end.y) < 0.05;
      const bh = Math.abs(b.start.y - b.end.y) < 0.05;
      if (av && bv && Math.abs(a.start.x - b.start.x) < 0.12) {
        if (dist(a.end, b.start) < tolerance) a.end = { x: a.start.x, y: b.start.y };
        if (dist(a.start, b.end) < tolerance) a.start = { x: a.start.x, y: b.end.y };
      }
      if (ah && bh && Math.abs(a.start.y - b.start.y) < 0.12) {
        if (dist(a.end, b.start) < tolerance) a.end = { x: b.start.x, y: a.start.y };
        if (dist(a.start, b.end) < tolerance) a.start = { x: b.end.x, y: a.start.y };
      }
    }
  }
  return out;
}
function cleanupWallStubs(walls, minKeep = 0.22) {
  return (Array.isArray(walls) ? walls : []).filter((wall) => dist(wall.start, wall.end) >= minKeep);
}
function dedupeOpenings(openings) {
  const out = [], seen = /* @__PURE__ */ new Set();
  for (const opening of Array.isArray(openings) ? openings : []) {
    const key2 = [opening.type, opening.wallId, Number(opening.offset || 0).toFixed(2), Number(opening.width || 0).toFixed(2)].join("|");
    if (seen.has(key2)) continue;
    seen.add(key2);
    out.push(opening);
  }
  return out;
}
function ensureRequiredDoors(openings) {
  return { openings: dedupeOpenings(openings), added: 0 };
}
function wallMidpoint(wall) {
  return {
    x: (Number(wall.start?.x || 0) + Number(wall.end?.x || 0)) / 2,
    y: (Number(wall.start?.y || 0) + Number(wall.end?.y || 0)) / 2
  };
}
function wallAngle(wall) {
  return Math.atan2(
    Number(wall.end?.y || 0) - Number(wall.start?.y || 0),
    Number(wall.end?.x || 0) - Number(wall.start?.x || 0)
  );
}
function angleDeltaModuloPi(a, b) {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}
function segmentNearExistingWall(candidate, walls, distanceTolerance = 0.14, angleTolerance = 0.18) {
  const mid = wallMidpoint(candidate);
  const angle = wallAngle(candidate);
  return (Array.isArray(walls) ? walls : []).some((wall) => {
    const d = pointToSegmentDistance(mid, wall.start, wall.end);
    if (d > distanceTolerance) return false;
    return angleDeltaModuloPi(angle, wallAngle(wall)) <= angleTolerance;
  });
}
function edgeLiesOnExterior(edge, externalWalls) {
  const length = dist(edge.start, edge.end);
  if (length < 0.25) return true;
  const mid = wallMidpoint(edge);
  const angle = wallAngle(edge);
  return (Array.isArray(externalWalls) ? externalWalls : []).some((wall) => {
    if (pointToSegmentDistance(mid, wall.start, wall.end) > 0.18) return false;
    if (angleDeltaModuloPi(angle, wallAngle(wall)) > 0.18) return false;
    return true;
  });
}
function synthesizeRoomBoundaryPartitions(partitions, rooms, externalWalls) {
  const out = [...Array.isArray(partitions) ? partitions : []];
  let added = 0;
  for (const room of Array.isArray(rooms) ? rooms : []) {
    if (!isEnclosedAccessRoom(room)) continue;
    const poly = Array.isArray(room?.polygon) ? room.polygon : [];
    if (poly.length < 3) continue;
    for (let i = 0; i < poly.length; i += 1) {
      const edge = {
        id: `room_edge_${room.id}_${i + 1}`.slice(0, 64),
        provenance: "room_boundary",
        type: "internal",
        start: { ...poly[i] },
        end: { ...poly[(i + 1) % poly.length] }
      };
      if (dist(edge.start, edge.end) < 0.42) continue;
      if (edgeLiesOnExterior(edge, externalWalls)) continue;
      if (segmentNearExistingWall(edge, out, 0.13, 0.16)) continue;
      out.push(edge);
      added += 1;
    }
  }
  return { partitions: out, added };
}
function isEnclosedAccessRoom(room) {
  const type = canonicalRoomType(room);
  return ["bedroom", "bathroom", "storage", "office", "kitchen"].includes(type);
}
function normalizeEnclosedRoomDoors(openings) {
  return { openings: dedupeOpenings(openings), removedExtraDoors: 0, synthesizedDoors: 0 };
}
function clusterAxisValues(values, tolerance = 0.2) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const clusters = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(value - last.mean) > tolerance) {
      clusters.push({ values: [value], mean: value });
    } else {
      last.values.push(value);
      last.mean = last.values.reduce((sum, n) => sum + n, 0) / last.values.length;
    }
  }
  return clusters.map((c, index) => ({ id: index, initial: c.mean, value: c.mean }));
}
function nearestNodeIndex(nodes, value) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const d = Math.abs(nodes[i].initial - value);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}
function solveDimensionAxis(rooms, axis, extent) {
  const rects = rooms.map((room) => ({ room, rect: rectFromRoom(room) })).filter((entry) => entry.rect);
  const values = [0, extent];
  for (const { rect } of rects) {
    if (axis === "x") values.push(rect.minX, rect.maxX);
    else values.push(rect.minY, rect.maxY);
  }
  const nodes = clusterAxisValues(values, Math.max(0.12, Math.min(0.28, extent * 0.018)));
  if (nodes.length < 2) return { nodes, constraints: [], applied: false };
  const minNode = nearestNodeIndex(nodes, 0);
  const maxNode = nearestNodeIndex(nodes, extent);
  nodes[minNode].fixed = true;
  nodes[minNode].value = 0;
  nodes[maxNode].fixed = true;
  nodes[maxNode].value = extent;
  const constraints = [];
  for (const { room, rect } of rects) {
    const target = axis === "x" ? Number(room.printedWidthMeters || 0) : Number(room.printedDepthMeters || 0);
    if (!(target > 0.35 && target <= extent)) continue;
    const lo = axis === "x" ? rect.minX : rect.minY;
    const hi = axis === "x" ? rect.maxX : rect.maxY;
    const i = nearestNodeIndex(nodes, lo);
    const j = nearestNodeIndex(nodes, hi);
    if (i === j) continue;
    const current = Math.abs(nodes[j].initial - nodes[i].initial);
    const ratio = target / Math.max(1e-3, current);
    if (ratio < 0.55 || ratio > 1.8) continue;
    const confidence = ratio >= 0.72 && ratio <= 1.38 ? 1 : 0.35;
    constraints.push({ roomId: room.id, i: Math.min(i, j), j: Math.max(i, j), target, confidence, current });
  }
  if (!constraints.length) return { nodes, constraints, applied: false };
  for (let iter = 0; iter < 180; iter += 1) {
    for (const node of nodes) {
      if (node.fixed) continue;
      node.value += (node.initial - node.value) * 0.035;
    }
    for (const c of constraints) {
      const a = nodes[c.i];
      const b = nodes[c.j];
      const error = c.target - (b.value - a.value);
      const gain = 0.46 * c.confidence;
      if (!a.fixed && !b.fixed) {
        a.value -= error * gain * 0.5;
        b.value += error * gain * 0.5;
      } else if (!a.fixed) {
        a.value -= error * gain;
      } else if (!b.fixed) {
        b.value += error * gain;
      }
    }
    for (let i = 1; i < nodes.length; i += 1) {
      const minGap = 0.06;
      if (nodes[i].value < nodes[i - 1].value + minGap) {
        if (!nodes[i].fixed) nodes[i].value = nodes[i - 1].value + minGap;
        else if (!nodes[i - 1].fixed) nodes[i - 1].value = nodes[i].value - minGap;
      }
    }
    nodes[minNode].value = 0;
    nodes[maxNode].value = extent;
  }
  const residuals = constraints.map((c) => {
    const actual = nodes[c.j].value - nodes[c.i].value;
    return { ...c, actual, relativeError: Math.abs(actual - c.target) / Math.max(1e-3, c.target) };
  });
  const strong = residuals.filter((r) => r.confidence >= 0.9);
  const meanError = (strong.length ? strong : residuals).reduce((s, r) => s + r.relativeError, 0) / Math.max(1, (strong.length ? strong : residuals).length);
  return { nodes, constraints: residuals, meanError, applied: meanError <= 0.14 };
}
function dimensionLockRooms(inputRooms, width, depth) {
  const original = inputRooms.map((room) => ({ ...room, polygon: room.polygon.map((p) => ({ ...p })) }));
  const sx = solveDimensionAxis(original, "x", width);
  const sy = solveDimensionAxis(original, "y", depth);
  if (!sx.applied && !sy.applied) return { rooms: inputRooms, applied: false, reason: "no_stable_axis_solution", x: sx, y: sy };
  const mapped = original.map((room) => {
    const rect = rectFromRoom(room);
    if (!rect) return room;
    const ix0 = nearestNodeIndex(sx.nodes, rect.minX);
    const ix1 = nearestNodeIndex(sx.nodes, rect.maxX);
    const iy0 = nearestNodeIndex(sy.nodes, rect.minY);
    const iy1 = nearestNodeIndex(sy.nodes, rect.maxY);
    const minX = sx.applied ? Math.min(sx.nodes[ix0].value, sx.nodes[ix1].value) : rect.minX;
    const maxX = sx.applied ? Math.max(sx.nodes[ix0].value, sx.nodes[ix1].value) : rect.maxX;
    const minY = sy.applied ? Math.min(sy.nodes[iy0].value, sy.nodes[iy1].value) : rect.minY;
    const maxY = sy.applied ? Math.max(sy.nodes[iy0].value, sy.nodes[iy1].value) : rect.maxY;
    if (maxX - minX < 0.25 || maxY - minY < 0.25) return room;
    return { ...room, polygon: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ] };
  });
  for (let i = 0; i < mapped.length; i += 1) {
    const a0 = rectFromRoom(original[i]);
    const a1 = rectFromRoom(mapped[i]);
    if (!a0 || !a1) continue;
    const center0 = { x: (a0.minX + a0.maxX) / 2, y: (a0.minY + a0.maxY) / 2 };
    const center1 = { x: (a1.minX + a1.maxX) / 2, y: (a1.minY + a1.maxY) / 2 };
    if (dist(center0, center1) > Math.max(1.25, Math.min(width, depth) * 0.13)) {
      return { rooms: inputRooms, applied: false, reason: "excessive_room_displacement", x: sx, y: sy };
    }
    for (let j = i + 1; j < mapped.length; j += 1) {
      const b0 = rectFromRoom(original[j]);
      const b1 = rectFromRoom(mapped[j]);
      if (!b0 || !b1) continue;
      const before = overlapArea(a0, b0);
      const after = overlapArea(a1, b1);
      if (after > Math.max(0.18, before + 0.12)) {
        return { rooms: inputRooms, applied: false, reason: "room_overlap_guard", x: sx, y: sy };
      }
    }
  }
  return { rooms: mapped, applied: true, reason: sx.applied && sy.applied ? "printed_dimension_grid_lock_xy" : sx.applied ? "printed_dimension_grid_lock_x_only" : "printed_dimension_grid_lock_y_only", x: sx, y: sy };
}
function roomBoundaryGrid(rooms) {
  const xs = [];
  const ys = [];
  for (const room of rooms) {
    const r = rectFromRoom(room);
    if (!r) continue;
    xs.push(r.minX, r.maxX);
    ys.push(r.minY, r.maxY);
  }
  return { xs, ys };
}
function snapPartitionToRoomGrid(wall, rooms) {
  const grid = roomBoundaryGrid(rooms);
  const out = snapAxisWall(wall);
  const dx = Math.abs(out.end.x - out.start.x);
  const dy = Math.abs(out.end.y - out.start.y);
  const snap = (value, values, tolerance = 0.32) => {
    let best = value, bestD = tolerance;
    for (const v of values) {
      const d = Math.abs(v - value);
      if (d < bestD) {
        best = v;
        bestD = d;
      }
    }
    return best;
  };
  if (dy > dx * 3) {
    const x = snap((out.start.x + out.end.x) / 2, grid.xs);
    out.start.x = x;
    out.end.x = x;
    out.start.y = snap(out.start.y, grid.ys);
    out.end.y = snap(out.end.y, grid.ys);
  } else if (dx > dy * 3) {
    const y = snap((out.start.y + out.end.y) / 2, grid.ys);
    out.start.y = y;
    out.end.y = y;
    out.start.x = snap(out.start.x, grid.xs);
    out.end.x = snap(out.end.x, grid.xs);
  }
  return out;
}
function simplifyOrthogonalPolygon(points = [], epsilon = 0.035) {
  if (!Array.isArray(points) || points.length < 4) return points;
  let out = [...points];
  let changed = true;
  while (changed && out.length >= 4) {
    changed = false;
    const next = [];
    for (let i = 0; i < out.length; i += 1) {
      const prev = out[(i - 1 + out.length) % out.length];
      const cur = out[i];
      const after = out[(i + 1) % out.length];
      const vertical = Math.abs(prev.x - cur.x) <= epsilon && Math.abs(cur.x - after.x) <= epsilon;
      const horizontal = Math.abs(prev.y - cur.y) <= epsilon && Math.abs(cur.y - after.y) <= epsilon;
      if (vertical || horizontal || dist(prev, cur) < epsilon) {
        changed = true;
        continue;
      }
      next.push(cur);
    }
    if (next.length >= 4) out = next;
    else break;
  }
  return out;
}
function partitionCrossesRoomInterior(wall, rooms) {
  const length = dist(wall.start, wall.end);
  if (length < 0.25) return true;
  const mx = (wall.start.x + wall.end.x) / 2;
  const my = (wall.start.y + wall.end.y) / 2;
  const dx = (wall.end.x - wall.start.x) / length;
  const dy = (wall.end.y - wall.start.y) / length;
  const nx = -dy, ny = dx;
  const offset = Math.min(0.18, Math.max(0.08, length * 0.08));
  const left = { x: mx + nx * offset, y: my + ny * offset };
  const right = { x: mx - nx * offset, y: my - ny * offset };
  const roomAt = (p) => rooms.find((room) => pointInPolygon(p, room.polygon))?.id || null;
  const a = roomAt(left), b = roomAt(right);
  if (a && b && a === b) return true;
  const midRoom = roomAt({ x: mx, y: my });
  if (midRoom && a === midRoom && b === midRoom) return true;
  return false;
}
function floorFinishForRoom(room) {
  const type = canonicalRoomType(room);
  if (type === "bathroom") return "wet_tile";
  if (type === "storage" || type === "balcony" || type === "laundry") return "utility_tile";
  if (type === "bedroom") return "light_oak";
  if (["living", "kitchen", "kitchen_dining", "dining", "office"].includes(type)) return "light_stone";
  return "neutral_floor";
}
function polygonSamplePoints(polygon = []) {
  const pts = [...polygon];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  if (xs.length) pts.push({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
  return pts;
}
function roomInsideFootprint(room, footprint) {
  return polygonSamplePoints(room?.polygon || []).every((p) => pointInPolygon(p, footprint) || footprint.some((a, i) => pointToSegmentDistance(p, a, footprint[(i + 1) % footprint.length]) < 0.035));
}
function containRoomInFootprint(room, footprint) {
  if (!room?.polygon?.length || roomInsideFootprint(room, footprint)) return { room, adjusted: false };
  const b = roomBounds(room);
  const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  if (!pointInPolygon(center, footprint)) return { room, adjusted: false };
  for (let scale = 0.98; scale >= 0.55; scale -= 0.02) {
    const polygon = room.polygon.map((p) => ({
      x: center.x + (p.x - center.x) * scale,
      y: center.y + (p.y - center.y) * scale
    }));
    const candidate = { ...room, polygon };
    if (roomInsideFootprint(candidate, footprint)) return { room: candidate, adjusted: true };
  }
  return { room, adjusted: false };
}
function clusterGuideCoordinates(values = [], tolerance = 5) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const clusters = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(value - last.mean) > tolerance) {
      clusters.push({ values: [value], mean: value });
    } else {
      last.values.push(value);
      last.mean = last.values.reduce((s, n) => s + n, 0) / last.values.length;
    }
  }
  return clusters.map((c) => c.mean);
}
function snapRawSceneToPixelGuides(raw, evidence) {
  if (!raw || raw.coordinateMode !== "image_normalized" || !evidence?.guides?.length) {
    return { raw, diagnostics: { applied: false, reason: "no_usable_pixel_guides" } };
  }
  const width = Number(evidence.width) || 1;
  const height = Number(evidence.height) || 1;
  const minDim = Math.max(1, Math.min(width, height));
  const minGuideLength = minDim * 0.055;
  const verticalGuides = [];
  const horizontalGuides = [];
  for (const g of evidence.guides) {
    const dx = Number(g?.end?.x) - Number(g?.start?.x);
    const dy = Number(g?.end?.y) - Number(g?.start?.y);
    const len = Math.hypot(dx, dy);
    if (!(len >= minGuideLength)) continue;
    if (Math.abs(dx) <= Math.abs(dy) * 0.12) {
      verticalGuides.push({
        coord: (Number(g.start.x) + Number(g.end.x)) / 2,
        min: Math.min(Number(g.start.y), Number(g.end.y)),
        max: Math.max(Number(g.start.y), Number(g.end.y)),
        length: len
      });
    } else if (Math.abs(dy) <= Math.abs(dx) * 0.12) {
      horizontalGuides.push({
        coord: (Number(g.start.y) + Number(g.end.y)) / 2,
        min: Math.min(Number(g.start.x), Number(g.end.x)),
        max: Math.max(Number(g.start.x), Number(g.end.x)),
        length: len
      });
    }
  }
  const xClusters = clusterGuideCoordinates(verticalGuides.map((g) => g.coord), 5);
  const yClusters = clusterGuideCoordinates(horizontalGuides.map((g) => g.coord), 5);
  const remapGuides = (guides, clusters) => guides.map((g) => ({
    ...g,
    coord: clusters.reduce(
      (best, c) => Math.abs(c - g.coord) < Math.abs(best - g.coord) ? c : best,
      clusters[0] ?? g.coord
    )
  }));
  const vGuides = remapGuides(verticalGuides, xClusters);
  const hGuides = remapGuides(horizontalGuides, yClusters);
  const tolerancePx = Math.max(5, Math.min(13, Math.round(minDim * 0.015)));
  const spanMarginPx = Math.max(10, Math.min(24, Math.round(minDim * 0.025)));
  let pointsSeen = 0;
  let pointsSnapped = 0;
  let xSnaps = 0;
  let ySnaps = 0;
  let totalSnapDistance = 0;
  const snapPoint = (point2) => {
    if (!point2 || !Number.isFinite(Number(point2.x)) || !Number.isFinite(Number(point2.y))) return point2;
    pointsSeen += 1;
    const px = Number(point2.x) * width;
    const py = Number(point2.y) * height;
    let nx = px;
    let ny = py;
    let changed = false;
    let localDistance = 0;
    let bestV = null;
    for (const g of vGuides) {
      if (py < g.min - spanMarginPx || py > g.max + spanMarginPx) continue;
      const d = Math.abs(px - g.coord);
      if (d <= tolerancePx && (!bestV || d < bestV.d)) bestV = { d, coord: g.coord };
    }
    if (bestV) {
      nx = bestV.coord;
      changed = true;
      xSnaps += 1;
      localDistance += bestV.d;
    }
    let bestH = null;
    for (const g of hGuides) {
      if (px < g.min - spanMarginPx || px > g.max + spanMarginPx) continue;
      const d = Math.abs(py - g.coord);
      if (d <= tolerancePx && (!bestH || d < bestH.d)) bestH = { d, coord: g.coord };
    }
    if (bestH) {
      ny = bestH.coord;
      changed = true;
      ySnaps += 1;
      localDistance += bestH.d;
    }
    if (changed) {
      pointsSnapped += 1;
      totalSnapDistance += localDistance;
    }
    return {
      x: clamp(nx / width, 0, 1, Number(point2.x)),
      y: clamp(ny / height, 0, 1, Number(point2.y))
    };
  };
  const snapped = {
    ...raw,
    footprint: (Array.isArray(raw.footprint) ? raw.footprint : []).map(snapPoint),
    rooms: (Array.isArray(raw.rooms) ? raw.rooms : []).map((room) => ({
      ...room,
      polygon: (Array.isArray(room?.polygon) ? room.polygon : []).map((p) => ({ ...p }))
    })),
    partitions: (Array.isArray(raw.partitions) ? raw.partitions : []).map((wall) => ({
      ...wall,
      start: snapPoint(wall?.start),
      end: snapPoint(wall?.end)
    })),
    openings: (Array.isArray(raw.openings) ? raw.openings : []).map((opening) => ({
      ...opening,
      center: { ...opening?.center || {} }
    }))
  };
  return {
    raw: snapped,
    diagnostics: {
      applied: pointsSnapped > 0,
      reason: "structural_pixel_guide_snap_final",
      tolerancePixels: tolerancePx,
      spanMarginPixels: spanMarginPx,
      verticalGuideCount: vGuides.length,
      horizontalGuideCount: hGuides.length,
      pointsSeen,
      pointsSnapped,
      xSnaps,
      ySnaps,
      meanSnapDistancePixels: pointsSnapped ? Number((totalSnapDistance / Math.max(1, xSnaps + ySnaps)).toFixed(2)) : 0
    }
  };
}
function normalizeScene(inputRaw, imageMeta = {}, imageEvidence = null) {
  const guideSnap = snapRawSceneToPixelGuides(inputRaw, imageEvidence);
  const sourceProjection = projectImageNormalizedSceneToMeters(guideSnap.raw, imageMeta);
  const raw = sourceProjection.raw;
  const width = clamp(raw?.widthMeters, 2, 80, 10);
  const depth = clamp(raw?.depthMeters, 2, 80, 8);
  let footprint = cleanPolygon((raw?.footprint || []).map((p) => sourcePoint(p, width, depth)));
  if (footprint.length < 4 || polygonArea(footprint) < width * depth * 0.18) {
    throw Object.assign(new Error("The preview did not return a usable building outline."), { code: "PREVIEW_BAD_FOOTPRINT" });
  }
  const rawRooms = Array.isArray(raw?.rooms) ? raw.rooms : [];
  const roomCandidates = rawRooms.map((room, index) => {
    const polygon = cleanPolygon((room?.polygon || []).map((p) => sourcePoint(p, width, depth)));
    const visible = room?.labelVisible !== false;
    const printedWidth = clamp(room?.printedWidthMeters, 0, 40, 0);
    const printedDepth = clamp(room?.printedDepthMeters, 0, 40, 0);
    return {
      id: String(room?.id || `room_${index + 1}`).slice(0, 64),
      name: String(room?.name || `Room ${index + 1}`).slice(0, 100),
      type: String(room?.type || "room").slice(0, 64),
      labelVisible: visible,
      printedWidthMeters: printedWidth,
      printedDepthMeters: printedDepth,
      polygon
    };
  }).filter((room) => room.polygon.length >= 3 && polygonArea(room.polygon) > 0.2);
  const roomIds = /* @__PURE__ */ new Set();
  const observedRooms = roomCandidates.map((room) => {
    if (roomIds.has(room.id)) throw Object.assign(new Error("Duplicate room identifier in trace."), { code: "PREVIEW_DUPLICATE_ROOM_ID" });
    roomIds.add(room.id);
    return room;
  });
  const dimensionAlignment = createPrintedDimensionAlignment(observedRooms, width, depth, footprint);
  const alignedPoint = (p) => mapPrintedDimensionPoint(p, dimensionAlignment);
  const sourceScenePoint = (p) => alignedPoint(sourcePoint(p, width, depth));
  footprint = footprint.map(alignedPoint);
  const roomsBeforeLock = observedRooms.map((room) => ({ ...room, polygon: room.polygon.map(alignedPoint) }));
  const dimensionDiagnostic = dimensionLockRooms(roomsBeforeLock, width, depth);
  const dimensionLock = { ...dimensionDiagnostic, rooms: roomsBeforeLock, applied: dimensionAlignment.applied, reason: dimensionAlignment.applied ? "shared_printed_dimension_alignment_v54" : "source_dimensions_preserved" };
  const relationships = normalizeRelationships(raw?.relationships, roomsBeforeLock.map((r) => r.id));
  const topology = {
    rooms: roomsBeforeLock,
    diagnostics: {
      version: "source_image_global_affine_layout_v15",
      applied: false,
      snappedPairs: 0,
      openPairs: relationships.filter((r) => r.relation === "open").length,
      wallPairs: relationships.filter((r) => r.relation === "wall" || r.relation === "door").length,
      relationshipResidualMean: 0,
      maxShiftMeters: 0,
      sourceAnchorMeanShift: 0,
      guardedRelationships: 0,
      maxAllowedShiftMeters: 0
    }
  };
  const overlapCleanup = { rooms: topology.rooms, adjustments: 0 };
  let roomContainmentAdjustments = 0;
  const rooms = overlapCleanup.rooms.map((room) => {
    const semanticType = canonicalRoomType(room);
    const normalized = {
      ...room,
      semanticType,
      // The unchanged V7 viewer maps room.type to its floor material. Integrated
      // kitchen+dining zones are dry open-plan space, so expose them as dining
      // for rendering while preserving semanticType/name for furnishing logic.
      type: ["kitchen_dining", "dining"].includes(semanticType) ? "living" : semanticType,
      floorFinish: floorFinishForRoom({ ...room, type: semanticType })
    };
    const contained = containRoomInFootprint(normalized, footprint);
    if (contained.adjusted) roomContainmentAdjustments += 1;
    return contained.room;
  });
  if (!rooms.length) {
    throw Object.assign(new Error("The preview did not return usable room zones."), { code: "PREVIEW_NO_ROOMS" });
  }
  const rawFootprint = footprint;
  footprint = simplifyOrthogonalPolygon(rawFootprint, 0.045);
  const footprintRepair = {
    repaired: false,
    reason: "model_outer_contour_preserved_v7",
    rawPointCount: rawFootprint.length,
    finalPointCount: footprint.length
  };
  const externalWalls = footprint.map((p, index) => ({
    id: `ext_${index + 1}`,
    type: "external",
    start: { ...p },
    end: { ...footprint[(index + 1) % footprint.length] }
  }));
  const rawPartitions = (Array.isArray(raw?.partitions) ? raw.partitions : []).map((wall, index) => snapPartitionToRoomGrid({
    id: String(wall?.id || `int_${index + 1}`).slice(0, 64),
    provenance: "observed",
    type: "internal",
    start: sourceScenePoint(wall?.start),
    end: sourceScenePoint(wall?.end)
  }, rooms)).filter((wall) => dist(wall.start, wall.end) > 0.15 && !partitionCrossesRoomInterior(wall, rooms));
  const synthesizedRoomWalls = synthesizeRoomBoundaryPartitions(rawPartitions, rooms, externalWalls);
  const openPlanFiltered = filterOpenPlanPartitions(synthesizedRoomWalls.partitions, rooms, relationships, (raw.openings || []).map((opening) => ({ ...opening, center: sourceScenePoint(opening.center) })));
  const relationshipWalls = ensureRelationshipWalls(openPlanFiltered.partitions, rooms, relationships);
  let partitions = relationshipWalls.partitions;
  const seen = /* @__PURE__ */ new Set();
  let walls = [...externalWalls, ...partitions].filter((wall) => {
    const key2 = wallKey(wall);
    if (seen.has(key2)) return false;
    seen.add(key2);
    return true;
  });
  walls = cleanupWallStubs(closeAlignedWallGaps(walls));
  const sourceOpeningObservations = (raw.openings || []).map((opening) => ({ ...opening, center: sourceScenePoint(opening.center) }));
  const openingSupport = prepareObservedOpeningWalls(walls, rooms, sourceOpeningObservations, relationships);
  walls = openingSupport.walls;
  const detectedOpenings = [];
  for (const opening of Array.isArray(raw?.openings) ? raw.openings : []) {
    const center = sourceScenePoint(opening?.center);
    const type = opening?.type === "window" ? "window" : "door";
    const best = chooseBestWallForOpening(center, type, walls, rooms, relationships, opening?.wallIdHint, opening?.wallAxis, opening?.widthMeters);
    if (!best || !best.projection || best.projection.length < 0.35) continue;
    if (best.projection.distance > Math.max(0.9, Math.min(width, depth) * 0.09)) continue;
    if (type === "door" && best.score > 1.05) continue;
    if (type === "window" && String(best.wall.type) !== "external" && best.score > 0.85) continue;
    const observedWidth = Number(opening?.widthMeters);
    detectedOpenings.push({
      id: String(opening?.id || `opening_${detectedOpenings.length + 1}`).slice(0, 64),
      type,
      wallId: best.wall.id,
      offset: best.projection.t,
      width: observedWidth > 0 ? observedWidth : type === "window" ? 1.4 : 0.9,
      ...openingVerticalDimensions(opening, type),
      ...observedDoorOrientation(opening, best.wall),
      provenance: "source_observed",
      _sourceDistance: Number(best.projection.distance || 0),
      _score: Number(best.score || 0)
    });
  }
  const requiredDoorPass = ensureRequiredDoors(dedupeOpenings(detectedOpenings), walls, rooms, relationships);
  const accessDoorPass = normalizeEnclosedRoomDoors(
    requiredDoorPass.openings,
    walls,
    rooms,
    relationships,
    footprint
  );
  const overlapRepair = repairOverlappingWalls(walls, accessDoorPass.openings);
  walls = overlapRepair.walls;
  const outdoor = outdoorBoundaries(walls, rooms, overlapRepair.openings);
  walls = outdoor.walls;
  const finalOpenings = outdoor.openings;
  const furnitureObservations = (raw.furniture || []).map((item) => ({
    ...item,
    backLeft: sourceScenePoint(item.backLeft),
    backRight: sourceScenePoint(item.backRight),
    frontCenter: sourceScenePoint(item.frontCenter)
  }));
  const sourceFurniture = compileSourceFurniture(furnitureObservations, footprint, rooms, walls);
  const furnitureValidation = { assets: sourceFurniture.assets, rejected: [], added: [], collisionAware: true, doorClearanceAware: false };
  let assets = furnitureValidation.assets;
  return {
    sceneType: "floorplan_interactive_preview",
    title: String(raw?.title || "Interactive 3D Preview").slice(0, 120),
    previewMode: "interactive_architectural_cutaway_v20",
    presentationStyle: "ventra_architectural_cutaway_v21",
    width,
    depth,
    height: 3.2,
    cutawayHeight: 3.2,
    heightSource: "design_default_not_measured",
    wallThickness: 0.12,
    externalWallThickness: 0.2,
    footprint,
    holes: [],
    rooms,
    relationships,
    walls,
    openings: finalOpenings,
    assets,
    furnishingMode: "source_observed",
    furnishingReview: {
      observedCount: (raw.furniture || []).length,
      acceptedCount: assets.length,
      rejected: [...sourceFurniture.rejected, ...furnitureValidation.rejected],
      added: furnitureValidation.added,
      observations: furnitureObservations,
      observationCoordinateMode: "scene_meters_y_up",
      requiresReview: sourceFurniture.rejected.length > 0 || furnitureValidation.rejected.length > 0 || assets.length === 0
    },
    palette: {
      wall: "#ECEAE5",
      externalWall: "#45484D",
      floor: "#E3DED6",
      ceiling: "#F7F4EE",
      accent: "#7C624E",
      glass: "#9FC2D0",
      door: "#7B573E",
      furniture: "#AF8460",
      upholstery: "#DDD5CA",
      textileAccent: "#88956F",
      metal: "#6B7074",
      bathroomTile: "#F5F6F4",
      bedroomWood: "#C89C6C",
      mainStone: "#E5E1DA"
    },
    backgroundColor: "#D5D7DA",
    showRoomLabels: false,
    geometryValidation: {
      version: VERSION,
      mode: "visual_interactive_preview",
      confidence: clamp(raw?.confidence, 0, 1, 0.5),
      footprintRepair: { repaired: footprintRepair.repaired, reason: footprintRepair.reason },
      sourceProjection: sourceProjection.diagnostics,
      guideSnap: guideSnap.diagnostics,
      dimensionAlignment,
      dimensionLock: {
        applied: dimensionLock.applied,
        reason: dimensionLock.reason,
        xApplied: Boolean(dimensionLock.x?.applied),
        yApplied: Boolean(dimensionLock.y?.applied),
        xMeanError: Number.isFinite(dimensionLock.x?.meanError) ? Number(dimensionLock.x.meanError.toFixed(4)) : null,
        yMeanError: Number.isFinite(dimensionLock.y?.meanError) ? Number(dimensionLock.y.meanError.toFixed(4)) : null,
        xConstraintCount: dimensionLock.x?.constraints?.length || 0,
        yConstraintCount: dimensionLock.y?.constraints?.length || 0
      },
      topology: {
        version: "source_image_global_affine_layout_v15",
        relationshipCount: relationships.length,
        applied: topology.diagnostics.applied,
        snappedPairs: topology.diagnostics.snappedPairs,
        openPairs: topology.diagnostics.openPairs,
        wallPairs: topology.diagnostics.wallPairs,
        removedOpenPlanPartitions: openPlanFiltered.removed,
        addedRelationshipWalls: relationshipWalls.added,
        addedRequiredDoors: requiredDoorPass.added,
        serviceOverlapAdjustments: overlapCleanup.adjustments,
        relationshipResidualMean: Number.isFinite(topology.diagnostics.relationshipResidualMean) ? Number(topology.diagnostics.relationshipResidualMean.toFixed(4)) : null,
        maxShiftMeters: Number(topology.diagnostics.maxShiftMeters.toFixed(4)),
        sourceAnchorMeanShift: Number((topology.diagnostics.sourceAnchorMeanShift || 0).toFixed(4)),
        guardedRelationships: topology.diagnostics.guardedRelationships || 0,
        maxAllowedShiftMeters: topology.diagnostics.maxAllowedShiftMeters || 0.8
      },
      openings: {
        observations: sourceOpeningObservations,
        observationCoordinateMode: "scene_meters_y_up",
        sharedBoundarySupports: openingSupport.added,
        sourceObservedCount: (raw.openings || []).length,
        preservedCount: finalOpenings.length,
        rejectedObservationIds: (raw.openings || []).filter((o) => !finalOpenings.some((f) => f.id === String(o.id))).map((o) => o.id),
        syntheticCount: 0,
        sourceVerified: false
      },
      roomContainmentAdjustments,
      furnishing: {
        version: "source_image_observation_validated_v2",
        assetCount: assets.length,
        collisionAware: furnitureValidation.collisionAware,
        doorClearanceAware: furnitureValidation.doorClearanceAware,
        roomTypeAware: true,
        rejectedCount: furnitureValidation.rejected.length,
        completedEssentialCount: furnitureValidation.added.length,
        byType: assets.reduce((acc, a) => {
          const key2 = String(a?.type || "unknown");
          acc[key2] = (acc[key2] || 0) + 1;
          return acc;
        }, {}),
        essentialFallbackCount: assets.filter((a) => a.essentialFallback).length,
        byRoom: rooms.map((room) => ({
          roomId: room.id,
          type: canonicalRoomType(room),
          assetCount: assets.filter((a) => String(a.roomId) === String(room.id)).length,
          assetTypes: assets.filter((a) => String(a.roomId) === String(room.id)).map((a) => a.type)
        }))
      },
      materialZoning: {
        version: "room_polygon_material_zoning_v20",
        roomFinishCount: rooms.filter((room) => room.floorFinish).length
      },
      presentation: {
        version: "ventra_architectural_cutaway_v21",
        deterministicFurniture: true,
        darkExternalWalls: true,
        roomSpecificMaterials: true,
        imageGuideSnap: Boolean(guideSnap?.diagnostics?.applied),
        guideSnapScope: "footprint_and_partitions_only",
        targetStyle: "warm_modern_architectural_cutaway",
        openingPlacementMode: "source_axis_and_relationship_attachment_v22"
      },
      note: "Visual interactive preview. Engineering quantities remain on the APS/takeoff pipeline."
    }
  };
}
function parseJson(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
  }
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(value.slice(first, last + 1));
  return null;
}
async function prepareImage(imageUrl, signal) {
  if (!imageUrl) throw Object.assign(new Error("No floor-plan image URL was supplied."), { code: "PREVIEW_NO_IMAGE" });
  const response = await fetch(imageUrl, { cache: "no-store", signal });
  if (!response.ok) throw Object.assign(new Error(`Could not download the floor-plan image (${response.status}).`), { code: "PREVIEW_IMAGE_DOWNLOAD_FAILED" });
  const buffer = Buffer.from(await response.arrayBuffer());
  const image = sharp2(buffer, { failOn: "none" });
  const meta = await image.metadata();
  const maxSide = 1800;
  let pipeline = image.rotate().flatten({ background: "#ffffff" });
  if (Math.max(Number(meta.width || 0), Number(meta.height || 0)) > maxSide) {
    pipeline = pipeline.resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
  }
  const prepared = await pipeline.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true });
  return {
    width: prepared.info.width,
    height: prepared.info.height,
    buffer: prepared.data,
    imageUrl: `data:image/png;base64,${prepared.data.toString("base64")}`
  };
}
var IMAGE_SCENE_CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var imageSceneCache = globalThis.__ventraImageSceneCacheV20 || (globalThis.__ventraImageSceneCacheV20 = /* @__PURE__ */ new Map());
function cleanupImageSceneCache() {
  const now = Date.now();
  for (const [key2, entry] of imageSceneCache.entries()) {
    if (!entry || entry.expiresAt <= now) imageSceneCache.delete(key2);
  }
  while (imageSceneCache.size > 24) {
    const oldest = imageSceneCache.keys().next().value;
    imageSceneCache.delete(oldest);
  }
}
async function runPreview(body) {
  const startedAt = Date.now();
  const diagnostics = {
    format: "ventra-interactive-preview-diagnostic-v2",
    build: VERSION,
    model: MODEL,
    stage: "starting",
    accepted: false
  };
  try {
    diagnostics.stage = "preparing_image";
    const prepared = await prepareImage(body?.imageUrl);
    diagnostics.imageWidth = prepared.width;
    diagnostics.imageHeight = prepared.height;
    cleanupImageSceneCache();
    const imageHash = createHash2("sha256").update(prepared.buffer).digest("hex");
    diagnostics.imageHash = imageHash.slice(0, 16);
    const stableCacheKey = `${VERSION}:${imageHash}`;
    const stableCached = imageSceneCache.get(stableCacheKey);
    if (stableCached?.scene) {
      const cachedScene = JSON.parse(JSON.stringify(stableCached.scene));
      diagnostics.stage = "completed";
      diagnostics.accepted = true;
      diagnostics.cacheHit = true;
      diagnostics.elapsedMs = Date.now() - startedAt;
      diagnostics.roomCount = cachedScene.rooms?.length || 0;
      diagnostics.wallCount = cachedScene.walls?.length || 0;
      diagnostics.openingCount = cachedScene.openings?.length || 0;
      diagnostics.assetCount = cachedScene.assets?.length || 0;
      diagnostics.footprintPointCount = cachedScene.footprint?.length || 0;
      diagnostics.guideSnap = cachedScene.geometryValidation?.guideSnap || null;
      diagnostics.furnishing = cachedScene.geometryValidation?.furnishing || null;
      diagnostics.materialZoning = cachedScene.geometryValidation?.materialZoning || null;
      diagnostics.presentation = cachedScene.geometryValidation?.presentation || null;
      return NextResponse.json({
        scene: cachedScene,
        diagnostics,
        source: "ventra-stable-image-cache-v20",
        routeVersion: VERSION,
        warning: "Visual 3D preview only. APS/engineering geometry remains authoritative for quantities and BOQ."
      });
    }
    const imageEvidence = await prepareRasterImageEvidence(prepared.buffer);
    diagnostics.pixelGuideCount = imageEvidence.guides.length;
    const strokeGuideText = rasterEvidencePrompt(imageEvidence);
    const prompt = `You are reconstructing ONE architectural floor plan into a compact interactive 3D scene graph. Accuracy to the visible plan is more important than decoration.

THIS IS NOT A DESIGN TASK. Do not redesign, improve, simplify, mirror, rotate, add rooms, invent corridors, or reinterpret the plan. Reconstruct what is visibly drawn.

READ THE WHOLE PLAN BEFORE TRACING:
First understand the building layout, entrance, connected spaces, room labels, furniture symbols and outdoor areas together. Then trace architecture and furniture as separate evidence layers. Do not let the stroke guides replace your visual understanding.
For handwritten sketches, room labels may be generic ("Room") and the photograph may be rotated. Read text in its readable orientation to understand meaning, but return ALL coordinates in the original image orientation. A bed symbol can identify a bedroom even when the label is generic. A sofa/TV pair identifies a living use. Counters with a sink or cooker identify kitchen use. Persian/Arabic labels for balcony or terrace identify an outdoor zone; preserve its actual drawn location.
Distinguish physical partitions from furniture edges, leader arrows, handwriting, dimension lines, door leaves and window strokes. An L-shaped sofa or kitchen counter is furniture, never a room boundary. A terrace separator follows the drawn boundary, never a conventional layout you expect.
If a living area and kitchen are visibly one connected open space, represent them as one non-overlapping room of type kitchen_dining or living, or as adjacent use zones with an open relationship. Never add a wall between them. Each observed furniture item belongs to its containing zone regardless of whether that zone's label names the object.
Use room.type for the understood use (bedroom, living, kitchen, kitchen_dining, bathroom, balcony, circulation, storage, laundry); preserve the actual source label in room.name. Do not erase generic or non-English labels.
Where evidence is unclear, lower confidence and omit uncertain objects instead of substituting an invented partition or furnishing. Do not turn uncertain evidence into certainty to produce a complete-looking result.


EVIDENCE PRIORITY, strongest first:
A. Printed overall dimensions and printed room dimensions.
B. Visible heavy wall lines / recesses / projections / entrance notches.
C. Printed room labels.
D. Door/window symbols.
E. Pixel proportions only when no printed dimension exists.

ROOM RULES:
1. Return every visible enclosed space and distinct open-plan use zone, including unlabeled spaces supported by walls or furniture. Use unique IDs even when room names repeat.
2. Do not invent a room without visual evidence. Unlabeled circulation can be recorded when its boundaries are visible.
3. Set labelVisible=true only when the name itself is visibly printed. Otherwise use false and a descriptive inferred name. Both are preserved.
4. Copy visible printed room dimensions into printedWidthMeters/printedDepthMeters. Use 0 only if no dimension is printed for that room.
5. A room polygon must occupy the same location as its visible label and enclosing walls.
5A. Preserve shared room boundaries: if two labeled rooms visibly meet at one wall line, use the SAME coordinate for that shared boundary. Do not center each room independently.
5B. Copy printed room dimensions accurately, but DO NOT resize or relocate a room to force those numbers. The room polygon must follow the visible source-image walls. Printed dimensions are used by the server as validation evidence after one global transform.

RELATIONSHIP RULES:
5C. Return relationships for every pair of labeled rooms that visibly touch or directly open into each other.
5D. relation="open" means there is NO physical wall between the two zones (for example a truly open living + dining/kitchen zone).
5E. relation="wall" means the rooms share a continuous physical wall. relation="door" means the shared physical boundary contains a visible doorway. relation="separate" means they do not directly touch.
5F. direction is the visible relative location of roomB from roomA in the source image. Do not invent adjacency merely because two labels are close.

FOOTPRINT RULES:
6. footprint is the REAL OUTER FACE of the building, not the page rectangle, not a bounding box. Include all recesses/notches/projections, especially entrance cut-ins and side setbacks.
7. Do not make footprint rectangular if the visible building outline is not rectangular. A 4-point footprint is allowed ONLY when all four outer sides are visibly continuous straight boundaries with no setback, notch, projection or entrance cut-in.
8. Inspect the TOP, RIGHT, BOTTOM and LEFT outer boundary independently before emitting footprint vertices. Every change of direction in the visible exterior wall requires a footprint vertex.
9. widthMeters/depthMeters are the overall architectural extents from printed dimensions when available.
9A. The exterior footprint MUST include unlabeled circulation, entrance and open-plan floor area. Never derive or shrink the outer shell from the union of labeled rooms.

PARTITION RULES:
10. partitions contains ONLY physical interior wall centerlines that are visibly present.
11. Do not place a partition merely because two room labels differ. Open-plan living/dining/kitchen zones can share one open space.
12. Partition endpoints must terminate on another physical wall or the footprint, except where a visible doorway gap interrupts it.
12A. Unlabeled circulation is NOT an excuse to omit walls. If a corridor, passage or service strip is visibly bounded by walls, return those walls in partitions and include its visible circulation zone.
12B. Preserve TV/service-core nib walls, corridor separator walls and short return walls when they are physically drawn. A missing separator wall is a geometry error.
12C. Do not create a doorway gap unless a visible door leaf / swing arc / opening symbol supports it. Continuous wall line means continuous wall.

OPENING RULES:
13. Return ALL visible doors AND ALL visible windows. Count them separately before answering. A window must not disappear merely because it sits inside a thick exterior wall.
14. Return visible doors and windows only. Put each opening center on or very near its supporting wall.
15. Doors must correspond to visible swing/opening symbols. Windows must correspond to visible window symbols.
15A. Before returning a door, verify that it sits on the wall actually interrupted by the swing symbol. Never assign a door to a nearby parallel wall merely because it is spatially close.
15C. wallAxis describes the supporting wall as drawn in the source image, NOT the swung door leaf: horizontal, vertical, diagonal, or unknown only if genuinely unclear. Set wallIdHint to the matching partition id when identifiable.
15D. hingeSide must identify the hinge in SOURCE IMAGE coordinates: left, right, top, bottom or unknown. swingDirection must be clockwise or counterclockwise as drawn in the image (Y down), or unknown. Do not guess a hinge or swing.
15E. Only return heightMeters and sillHeightMeters from explicit vertical dimension annotations; never infer them from the plan symbol size. Use -1 for an unknown vertical dimension. A dimensioned floor-level window may have sillHeightMeters=0.
15B. If a visible swing symbol interrupts a wall, include that door even when one side is an unlabeled corridor or passage.

COORDINATES:
16. coordinateMode MUST be "image_normalized". Every footprint / room / partition / opening coordinate is normalized to the SOURCE IMAGE: x=0 left image edge, x=1 right image edge, y=0 top image edge, y=1 bottom image edge. Preserve the SOURCE IMAGE geometry and proportions exactly; do not compensate for printed dimensions by stretching one axis.
16A. Do NOT convert individual rooms to metres. Preserve their visible image positions and shared boundaries. The server applies ONE global image-to-metre transform to the entire plan.
16B. widthMeters/depthMeters still contain the printed overall architectural dimensions in metres when visible.
17. Keep every coordinate between 0 and 1. The footprint should tightly trace the actual exterior walls, not the page margins.

FINAL SELF-CHECK BEFORE ANSWERING:
- Account for every visible space; verify no zone is lost merely because it has no printed label.
- Trace the outer boundary clockwise and verify every visible recess/projection is present. If the footprint has only 4 points, explicitly re-check whether every outer side is truly straight before answering.
- Compare bedroom/bath/store positions to their labels.
- Verify the main entrance is on the same side and same notch as the source.
- Verify no invented corridor/hall room exists.
- Verify relationships includes every directly touching labeled-room pair and correctly distinguishes OPEN from WALL/DOOR adjacency.
- Verify no wall crosses through a room that is visibly open-plan.
- Count visible window symbols and door swing symbols and ensure openings contains both categories.

Trace ALL visible furniture into furniture, including toilets, basins, shower trays and washing_machine symbols in laundry rooms. Do not add a shower to a WC when no shower symbol or explicit shower label exists. Trace ALL visible furniture into furniture; do not invent objects or substitute a generic room furnishing profile. Include dining tables with each visible chair, coffee tables, rugs, kitchen counter runs and embedded fixtures, beds and wardrobes. Include unlabeled spaces (balcony, circulation, dining, study) as separate zones when supported by visible boundaries/use. Room IDs must be unique; names need not be unique. Do not combine zones into overlapping room polygons.
Each furniture item is an oriented rectangle: backLeft/backRight are the ends of its BACK edge and frontCenter is the midpoint of its FRONT edge. Use normalized FULL-IMAGE coordinates, like the walls. Either ordering of the back-edge endpoints is accepted; frontCenter determines the facing direction. Bed back is its headboard; sofa back is its backrest; TV front faces viewers. Other objects face their access side. Trace L-shaped sofas and L/U kitchen counters as multiple non-overlapping rectangular components sharing groupId. Use one sofa component for each leg. Keep every component at its observed location. Never fill the empty corner of an L shape with a bounding rectangle. Empty groupId for single objects. embeddedInCounter=true only for a sink/stove drawn in a counter. Confidence below 0.65 is rejected for review. Heights/materials are visual defaults, not measured evidence.

DETERMINISTIC PIXEL-STROKE EVIDENCE FROM THE SAME IMAGE:
${strokeGuideText}
Treat these guides as supporting evidence only. They are especially useful for locating long physical wall runs and recess corners, but they can include furniture/text and can omit walls interrupted by openings. Do not blindly copy them.

Return only the strict schema.`;
    diagnostics.stage = "model_request";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await getOpenAIClient().responses.create({
        model: MODEL,
        reasoning: { effort: REASONING_EFFORT },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: `${prompt}

Source image size: ${prepared.width}x${prepared.height}px (reference only).` },
            { type: "input_image", image_url: prepared.imageUrl, detail: "high" }
          ]
        }],
        text: {
          verbosity: "low",
          format: { type: "json_schema", name: "ventra_interactive_plan_scene_v2", strict: true, schema: sceneSchema }
        }
      }, { signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw Object.assign(new Error("Interactive preview timed out."), { code: "PREVIEW_TIMEOUT" });
      throw error;
    } finally {
      clearTimeout(timer);
    }
    diagnostics.responseId = response?.id || null;
    diagnostics.status = response?.status || null;
    diagnostics.usage = response?.usage || null;
    diagnostics.incompleteDetails = response?.incomplete_details || null;
    const outputText = String(response?.output_text || "").trim();
    if (!outputText) {
      const reason = response?.incomplete_details?.reason || response?.status || "no_text";
      throw Object.assign(new Error(`Preview model returned no scene JSON (${reason}).`), { code: "PREVIEW_EMPTY_OUTPUT" });
    }
    diagnostics.stage = "normalizing_scene";
    const raw = parseJson(outputText);
    if (!raw) throw Object.assign(new Error("Preview scene JSON could not be parsed."), { code: "PREVIEW_JSON_PARSE_FAILED" });
    let scene = normalizeScene(raw, { width: prepared.width, height: prepared.height }, imageEvidence);
    diagnostics.stage = "source_furniture_review";
    const remainingMs = Math.min(6e4, TIMEOUT_MS - (Date.now() - startedAt));
    if (remainingMs > 5e3) {
      const furnitureController = new AbortController();
      const furnitureTimer = setTimeout(() => furnitureController.abort(), remainingMs);
      try {
        const reviewResponse = await getOpenAIClient().responses.create({
          model: MODEL,
          reasoning: { effort: REASONING_EFFORT },
          max_output_tokens: MAX_OUTPUT_TOKENS,
          input: [{ role: "user", content: [
            { type: "input_text", text: `Review ONLY furniture and fixtures in this original floor plan. Read Persian, Arabic and English labels. Return ALL visible objects, not a generic furnished design. The attached fixed scene supplies room IDs and metre/Y-up polygons; use these IDs. Return coordinates normalized to the FULL ORIGINAL IMAGE, Y down. backLeft/backRight are BACK-edge endpoints; frontCenter is the midpoint of the FRONT edge. For beds the back is the pillow/headboard edge: trace the whole bed and preserve its position and facing. Split every L/U sofa or counter into non-overlapping rectangles sharing groupId, one rectangle per leg. Do not drop the shorter leg or fill its empty corner. Trace each visible toilet, basin, shower and washing-machine symbol, including narrow laundry rooms labeled \u0631\u062E\u062A\u200C\u0634\u0648\u06CC\u200C\u062E\u0627\u0646\u0647, \u0644\u0628\u0627\u0633\u200C\u0634\u0648\u06CC\u06CC, laundry or \u063A\u0631\u0641\u0629 \u063A\u0633\u064A\u0644. A square with a circle inside may be a washing machine or basin: use its room and other symbols to distinguish them. Do not infer a shower from WC alone. Do not add refrigerators, wardrobes or fixtures absent from the drawing. Confidence below .65 must remain uncertain. Do not modify walls, rooms, doors or windows. Fixed scene: ${JSON.stringify({ width: scene.width, depth: scene.depth, sourceBounds: scene.geometryValidation.sourceProjection.sourceBounds, rooms: scene.rooms })}` },
            { type: "input_image", image_url: prepared.imageUrl, detail: "high" }
          ] }],
          text: { format: { type: "json_schema", name: "source_furniture_coverage", strict: true, schema: { type: "object", additionalProperties: false, required: ["furniture"], properties: { furniture: sceneSchema.properties.furniture } } } }
        }, { signal: furnitureController.signal });
        if (reviewResponse.status !== "completed") throw new Error("Furniture review did not complete.");
        const reviewed = parseJson(reviewResponse.output_text || "");
        if (!Array.isArray(reviewed?.furniture)) throw new Error("Furniture review returned invalid observations.");
        const reviewedScene = applySourceFurnitureReview(scene, reviewed.furniture);
        if (!reviewedScene.assets.length && scene.assets.length) throw new Error("Furniture review found no validated objects.");
        for (const prior of scene.assets) {
          const before = scene.assets.filter((a) => a.roomId === prior.roomId && a.type === prior.type).length;
          const after = reviewedScene.assets.filter((a) => a.roomId === prior.roomId && a.type === prior.type).length;
          if (after < before) throw new Error(`Furniture review lost source objects in room ${prior.roomId}; the first trace was preserved.`);
        }
        scene = reviewedScene;
        diagnostics.furnitureReview = { responseId: reviewResponse.id, usage: reviewResponse.usage, status: "completed" };
      } catch (error) {
        scene = { ...scene, furnishingReview: { ...scene.furnishingReview, requiresReview: true, coverageReview: { status: "failed", reason: error?.message || "Furniture review failed" } } };
        diagnostics.furnitureReview = { status: "failed", message: error?.message };
      } finally {
        clearTimeout(furnitureTimer);
      }
    } else {
      scene = { ...scene, furnishingReview: { ...scene.furnishingReview, requiresReview: true, coverageReview: { status: "skipped", reason: "analysis_time_budget" } } };
    }
    diagnostics.stage = "completed";
    diagnostics.accepted = true;
    diagnostics.elapsedMs = Date.now() - startedAt;
    diagnostics.roomCount = scene.rooms.length;
    diagnostics.wallCount = scene.walls.length;
    diagnostics.openingCount = scene.openings.length;
    diagnostics.assetCount = scene.assets.length;
    diagnostics.footprintPointCount = scene.footprint.length;
    diagnostics.footprintRepair = scene.geometryValidation?.footprintRepair || null;
    diagnostics.sourceProjection = scene.geometryValidation?.sourceProjection || null;
    diagnostics.guideSnap = scene.geometryValidation?.guideSnap || null;
    diagnostics.dimensionLock = scene.geometryValidation?.dimensionLock || null;
    diagnostics.topology = scene.geometryValidation?.topology || null;
    diagnostics.roomContainmentAdjustments = scene.geometryValidation?.roomContainmentAdjustments || 0;
    diagnostics.furnishing = scene.geometryValidation?.furnishing || null;
    diagnostics.materialZoning = scene.geometryValidation?.materialZoning || null;
    diagnostics.presentation = scene.geometryValidation?.presentation || null;
    imageSceneCache.set(stableCacheKey, {
      scene: JSON.parse(JSON.stringify(scene)),
      expiresAt: Date.now() + IMAGE_SCENE_CACHE_TTL_MS
    });
    return NextResponse.json({
      scene,
      diagnostics,
      source: "openai-interactive-preview-consolidated-v20",
      routeVersion: VERSION,
      warning: "Visual 3D preview only. APS/engineering geometry remains authoritative for quantities and BOQ."
    });
  } catch (error) {
    diagnostics.stage = "failed";
    diagnostics.elapsedMs = Date.now() - startedAt;
    diagnostics.error = error?.message || String(error);
    diagnostics.failure = { code: error?.code || "INTERACTIVE_PREVIEW_FAILED", message: diagnostics.error };
    console.warn("[VENTRA INTERACTIVE PREVIEW V2 REJECTED]", diagnostics);
    const status = error?.status === 429 ? 429 : error?.code === "PREVIEW_TIMEOUT" ? 504 : 422;
    return NextResponse.json({
      error: diagnostics.error,
      code: diagnostics.failure.code,
      diagnostics,
      routeVersion: VERSION
    }, { status });
  }
}
var PREVIEW_JOB_TTL_MS = 2 * 60 * 1e3;
var previewInFlight = globalThis.__ventraPreviewInFlightV4 || (globalThis.__ventraPreviewInFlightV4 = /* @__PURE__ */ new Map());
var previewCompleted = globalThis.__ventraPreviewCompletedV4 || (globalThis.__ventraPreviewCompletedV4 = /* @__PURE__ */ new Map());
function cleanupPreviewCache() {
  const now = Date.now();
  for (const [key2, entry] of previewCompleted.entries()) {
    if (!entry || entry.expiresAt <= now) previewCompleted.delete(key2);
  }
}
async function runFurnitureRepair(body) {
  const scene = body?.scene;
  try {
    const review = scene?.furnishingReview;
    if (!review?.observations?.length || !scene.geometryValidation?.sourceProjection?.sourceBounds) throw new Error("Source observations are unavailable for this scene.");
    const prepared = await prepareImage(body.imageUrl);
    const projection2 = scene.geometryValidation.sourceProjection;
    if (prepared.width !== projection2.imageWidth || prepared.height !== projection2.imageHeight) throw new Error("Choose the original plan image with the same dimensions.");
    const ids = new Set((review.rejected || []).map((x) => x.id));
    const targets = review.observations.filter((o) => ids.has(o.id));
    if (!targets.length) return NextResponse.json({ scene, repairedCount: 0 });
    const schema = { "type": "object", "additionalProperties": false, "required": ["items"], "properties": { "items": { "type": "array", "maxItems": 80, "items": { "type": "object", "additionalProperties": false, "required": ["left", "right", "top", "bottom", "confidence", "id", "front"], "properties": { "left": { "type": "number" }, "right": { "type": "number" }, "top": { "type": "number" }, "bottom": { "type": "number" }, "confidence": { "type": "number" }, "id": { "type": "string" }, "front": { "type": "string", "enum": ["left", "right", "top", "bottom"] } } } } } };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await getOpenAIClient().responses.create({ model: MODEL, reasoning: { effort: "none" }, max_output_tokens: 5e3, input: [{ role: "user", content: [{ type: "input_text", text: `Locate ONLY the listed rejected furniture in the original plan. Return full-image normalized bounding rectangles and the direction their FRONT faces in image coordinates (Y down). Trace the WHOLE bed, not a pillow. Bed front points from headboard toward foot. Sofa front points from backrest to seating. TV front faces viewers. Counters front faces the room. Preserve exact source positions, no redesign. For components of the same L sofa/counter, rectangles must meet at the corner without overlapping area. Do not invent missing objects; omit uncertain objects. Use the exact supplied IDs. Do not return or modify architecture. The fixed room/wall coordinates are metres Y-up, mapped using sourceBounds and scene width/depth. Targets: ${JSON.stringify(targets)}. Fixed alignment: ${JSON.stringify(projection2)}. Width/depth: ${scene.width},${scene.depth}. Rooms: ${JSON.stringify(scene.rooms)}. Walls: ${JSON.stringify(scene.walls)}.` }, { type: "input_image", image_url: prepared.imageUrl, detail: "high" }] }], text: { format: { type: "json_schema", name: "fixed_furniture_repair", strict: true, schema } } }, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (response.status !== "completed") throw new Error("Furniture extraction did not complete. The current scene was preserved.");
    const raw = parseJson(response.output_text || "");
    if (!Array.isArray(raw?.items)) throw new Error("Furniture response was invalid.");
    const next = repairFixedFurniture(scene, raw.items);
    return NextResponse.json({ scene: next, repairedCount: next.furnishingReview.repair.repairedIds.length });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Furniture repair failed; current scene preserved." }, { status: 422 });
  }
}
async function handleCommercialRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Preview request body was empty or invalid JSON.", code: "PREVIEW_BAD_REQUEST" }, { status: 400 });
  }
  if (body?.mode === "repair_furniture") return runFurnitureRepair(body);
  cleanupPreviewCache();
  const requestId = String(body?.requestId || request.headers.get("x-ventra-request-id") || "").trim();
  const cacheKey = requestId || `${body?.projectId || "project"}:${body?.fileName || "image"}`;
  const completed = previewCompleted.get(cacheKey);
  if (completed?.response) {
    console.log("[VENTRA PREVIEW RESPONSE CACHE HIT v4]", { requestId: cacheKey });
    return completed.response.clone();
  }
  const existing = previewInFlight.get(cacheKey);
  if (existing) {
    console.log("[VENTRA PREVIEW REQUEST COALESCED v4]", { requestId: cacheKey });
    const response = await existing;
    return response.clone();
  }
  const task = runPreview(body);
  previewInFlight.set(cacheKey, task);
  try {
    const response = await task;
    previewCompleted.set(cacheKey, { response: response.clone(), expiresAt: Date.now() + PREVIEW_JOB_TTL_MS });
    return response;
  } finally {
    if (previewInFlight.get(cacheKey) === task) previewInFlight.delete(cacheKey);
  }
}
async function runPreviewRequest(request) {
  return commercialRun(request, "preview", handleCommercialRequest);
}

// src/lib/serverPreviewJobs.js
import { createHash as createHash3, randomBytes } from "node:crypto";
var table = "ventra_preview_jobs";
var nonceHash = (value) => createHash3("sha256").update(value).digest("hex");
async function executePreviewJob(input, run) {
  if (!/^[a-f0-9-]{36}$/i.test(input?.id || "") || !/^\w{64}$/.test(input?.nonce || "") || !/^Bearer .+$/.test(input?.authorization || "")) return;
  const db = commercialAdmin(), { data: job, error } = await db.from(table).update({ status: "running" }).eq("id", input.id).eq("status", "queued").eq("nonce_hash", nonceHash(input.nonce)).select("request_body,actor_id").maybeSingle();
  if (error) throw error;
  if (!job) return;
  let result, httpStatus = 500;
  try {
    const { __backgroundAction = "preview", ...body } = job.request_body;
    if (!["preview", "boq"].includes(__backgroundAction)) throw billingError("Invalid analysis action.", 400);
    const request = new Request(`https://ventra.internal/api/ai/${__backgroundAction === "boq" ? "generate-boq" : "design-3d-preview"}`, { method: "POST", headers: { authorization: input.authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
    const user = await account(request);
    if (user.id !== job.actor_id) throw billingError("Analysis job access denied.", 403);
    const response = await run(request, __backgroundAction);
    httpStatus = response.status;
    result = await response.json();
  } catch (error2) {
    result = { error: error2.status ? error2.message : "Background analysis failed. Retry or contact support.", code: "PREVIEW_BACKGROUND_FAILED" };
    httpStatus = error2.status || 500;
  }
  const saved = await db.from(table).update({ status: httpStatus < 400 ? "completed" : "failed", http_status: httpStatus, result, request_body: null, nonce_hash: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", input.id).eq("status", "running");
  if (saved.error) throw saved.error;
}

// src/lib/estimateClassification.mjs
function classifyEstimateItem(item = {}) {
  if (item.rateMissing === true || ["quantity_pending", "measured_rate_pending"].includes(item.status) || item.verification === "pending") return "pending";
  if (item.reviewRequired === true || item.status === "provisional_estimate" || item.verification === "provisional") return "provisional";
  if (item.includeInCommercialTotal === false) return "pending";
  if (item.verification === "verified" || ["measured", "manual"].includes(item.status)) return "verified";
  return "pending";
}

// src/lib/dwgSchedule.mjs
var qtyHeader = (value) => /qty|quantity|count|number|no\.?\s*(of|required)|تعداد/i.test(value || "") || /^(no\.?|nos\.?)$/i.test(String(value || "").trim());
var norm = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
var family = (value) => {
  const s = norm(value);
  if (/(?:wood|timber|stud).*fram|fram.*(?:wood|timber)|wood stud/.test(s)) return "timber_frame";
  if (/steel.*fram|metal stud|light.gauge/.test(s)) return "steel_frame";
  if (/hardwood|oak flooring|wood floor/.test(s)) return "hardwood";
  if (/tile|ceramic|porcelain/.test(s)) return "tile";
  if (/alumin/.test(s)) return "aluminium";
  if (/upvc|u-pvc|vinyl|pvc/.test(s)) return "pvc";
  if (/wood|timber|oak/.test(s)) return "timber";
  if (/steel/.test(s)) return "steel";
  if (/block|brick|masonry/.test(s)) return "masonry";
  if (/standing.seam|metal roof|metal roofing/.test(s)) return "metal_roof";
  if (/\bfram(?:ing|ed)\b/.test(s)) return "frame_unspecified";
  if (/gypsum|drywall/.test(s)) return "gypsum";
  return "";
};
function applyDwgScheduleToBoq(input = [], evidence = {}, catalog = []) {
  let items = input.map((i) => ({ ...i }));
  const warnings = [...evidence.issues || []];
  const countUnit = (u) => /^(nos?\.?|ea|each|pcs?|item|number)$/.test(norm(u));
  function candidate(kind, material, unit) {
    const f = family(material);
    if (!f) return null;
    return catalog.find((c) => new RegExp(kind).test(norm(c.description)) && family(c.description) === f && (unit === "nos" ? countUnit(c.unit) : norm(c.unit).replace("\xB2", "2") === unit) && Number(c.resolvedRate) > 0 && !/repair|painting|ironmongery|sealant|cleaning/.test(norm(c.description))) || null;
  }
  for (const kind of ["door", "window"]) {
    const schedules = (evidence.tables || []).filter((t2) => t2.kind === kind && t2.accepted && t2.complete && t2.coversProject && qtyHeader(t2.quantityHeader) && Array.isArray(t2.rows) && t2.rows.length > 0 && t2.rows.every((r) => r.quantityAccepted && Number.isInteger(r.quantity) && r.quantity >= 0));
    if (schedules.length !== 1) continue;
    const t = schedules[0];
    const openingItem = (i) => new RegExp(kind).test(norm(i.description)) && !/repair|painting|ironmongery|sealant|cleaning|lintel|sill/.test(norm(i.description)) && (countUnit(i.unit) || ["m2", "m\xB2"].includes(norm(i.unit)));
    const old = items.filter(openingItem);
    if (old.length) warnings.push(`${kind}: geometry/catalog quantities ${old.map((i) => i.quantity).join(", ")} replaced by schedule total ${t.total}; rates remain subject to specification review.`);
    items = items.filter((i) => !openingItem(i));
    for (const [index, row] of t.rows.entries()) {
      if (!row.quantity) continue;
      const c = row.specificationAccepted ? candidate(kind, row.material, "nos") : null;
      const rate = Number(c?.resolvedRate) || 0;
      items.push({
        id: `dwg-${kind}-${index}-${row.mark}`,
        itemCode: c?.item_code || `DWG-${kind}-${index}`,
        section: "Doors & Windows",
        sectionCode: "08",
        description: `${kind === "door" ? "Door" : "Window"} ${row.mark}: ${row.description || kind} \u2014 ${row.material || "material not specified"}${row.dimensions ? " \xB7 " + row.dimensions : ""}`,
        unit: "nos",
        quantity: row.quantity,
        rate,
        amount: Math.round(row.quantity * rate * 100) / 100,
        rateMissing: !rate,
        status: rate ? "provisional_estimate" : "measured_rate_pending",
        verification: rate ? "provisional" : "pending",
        includeInCommercialTotal: false,
        quantityVerification: "schedule_checked",
        quantityBasis: "drawing_schedule_two_reads",
        quantitySource: "drawing_schedule",
        rateSource: c?.resolvedSource || "matching_specification_rate_pending",
        specificationVerification: row.specificationAccepted ? "drawing_transcribed" : "unconfirmed",
        reviewRequired: true,
        source: "Drawing schedule",
        notes: `SCHEDULE: ${t.kind} / ${t.scope}; mark ${row.mark}; QTY column "${t.quantityHeader}" = ${row.quantityText}. ${row.quote || ""} ${rate ? "Catalog budget rate for matching material/unit; dimensions and detailed specification require review." : "No compatible count-unit/material rate: obtain a matching quote; no area rate was applied to a count."}`
      });
    }
  }
  const specs = (evidence.specifications || []).filter((s) => s.accepted);
  const wallFrames = specs.filter((s) => s.scope === "wall" && ["timber_frame", "steel_frame", "frame_unspecified"].includes(family(s.material)));
  if (wallFrames.length && specs.filter((s) => s.scope === "wall").every((s) => ["timber_frame", "steel_frame", "frame_unspecified"].includes(family(s.material)))) {
    items = items.map((i) => /block wall|blockwork|brick wall|masonry wall/.test(norm(i.description)) ? {
      ...i,
      description: `Wall framing \u2014 ${wallFrames.map((s) => `${s.location}: ${s.material}`).join("; ")}`,
      section: wallFrames.every((s) => family(s.material) === "timber_frame") ? "Carpentry" : wallFrames.every((s) => family(s.material) === "steel_frame") ? "Metal Works" : "General",
      quantity: 0,
      rate: 0,
      amount: 0,
      rateMissing: true,
      referenceRate: 0,
      status: "quantity_pending",
      verification: "pending",
      includeInCommercialTotal: false,
      reviewRequired: true,
      quantityBasis: "framing_scope_measurement_pending",
      source: "Drawing general notes",
      notes: `Blockwork assumption replaced by explicit framing specification. Measure each specified wall system separately. ${wallFrames.map((s) => s.quote).join(" ")}`
    } : i);
  }
  const floors = specs.filter((s) => s.scope === "floor");
  const finishFamily = (s) => family(s.material) || norm(s.material);
  const families = [...new Set(floors.map(finishFamily).filter(Boolean))];
  const oldFloors = items.filter((i) => /floor|flooring/.test(norm(i.description)) && ["hardwood", "tile"].includes(family(i.description)));
  if (families.length > 1 || oldFloors.some((i) => !families.includes(family(i.description))) && families.length > 0) {
    const old = oldFloors;
    if (old.length) {
      items = items.filter((i) => !old.includes(i));
      for (const f of families) {
        const relevant = floors.filter((s) => finishFamily(s) === f), c = candidate("floor", relevant[0]?.material, "m2");
        items.push({
          id: `dwg-floor-${f}`,
          itemCode: c?.item_code || `DWG-FLOOR-${f}`,
          section: "Finishes",
          sectionCode: "09",
          description: `${f === "hardwood" ? "Hardwood flooring" : f === "tile" ? "Tile flooring" : `Floor finish: ${relevant.map((s) => s.material).join("; ")}`} \u2014 ${relevant.map((s) => s.location).join("; ")}`,
          unit: "m2",
          quantity: 0,
          rate: 0,
          referenceRate: Number(c?.resolvedRate) || 0,
          amount: 0,
          status: "quantity_pending",
          verification: "pending",
          includeInCommercialTotal: false,
          reviewRequired: true,
          quantityBasis: "room_finish_area_pending",
          source: "Drawing room finish labels",
          notes: `Drawing finish scope: do not apply an unsupported finish to the entire floor area. Measure the listed rooms separately. ${relevant.map((s) => s.quote).join(" ")}`
        });
      }
    }
  }
  const roofNotes = specs.filter((s) => s.scope === "roof" && family(s.material) === "metal_roof");
  if (roofNotes.length) {
    const isCovering = (i) => /roof(?:ing)?|roof covering/.test(norm(i.description)) && /tile|slate|shingle|sheet|covering|standing.seam/.test(norm(i.description)) && !/waterproof|concrete|structur|insulation|truss/.test(norm(i.description));
    items = items.filter((i) => !isCovering(i));
    items.push({
      id: "dwg-roof-covering",
      itemCode: "DWG-ROOF-COVERING",
      section: "Finishes",
      sectionCode: "09",
      description: `Roof covering \u2014 ${roofNotes.map((s) => `${s.location}: ${s.material}`).join("; ")}`,
      unit: "m2",
      quantity: 0,
      rate: 0,
      amount: 0,
      rateMissing: true,
      status: "quantity_pending",
      verification: "pending",
      includeInCommercialTotal: false,
      reviewRequired: true,
      quantityBasis: "roof_covering_area_pending",
      source: "Drawing general notes",
      notes: `Measure the specified roof covering surface and obtain a matching rate; floor area is not roof surface area. ${roofNotes.map((s) => s.quote).join(" ")}`
    });
  }
  return { items, warnings };
}

// src/lib/drawingEvidence.mjs
function getDrawingEvidence(takeoff = {}) {
  return takeoff.drawing_evidence || takeoff.advanced_takeoff?.drawing_evidence || takeoff.raw_result?.drawing_evidence || null;
}

// src/lib/boqEvidence.mjs
function requireBoqReview(item = {}) {
  if (item.review?.confirmed === true || item.source === "manual" || item.status === "manual") return item;
  const quantityVerification = item.quantityVerification || (item.status === "measured" || item.status === "measured_rate_pending" || item.measuredFromApsStructure === true || item.verification === "verified" ? "measured" : item.status === "quantity_pending" ? "pending" : "estimated");
  const next = { ...item, quantityVerification, specificationVerification: "unconfirmed", reviewRequired: true };
  if (item.status === "measured" || item.verification === "verified") {
    next.status = "provisional_estimate";
    next.verification = "provisional";
    next.includeInCommercialTotal = false;
  }
  const note = "REVIEW REQUIRED: Confirm drawing scope, specification, quantity/unit and applicable rate. Geometry alone does not confirm the catalog description.";
  next.notes = String(item.notes || "").includes(note) ? item.notes : [item.notes, note].filter(Boolean).join(" ");
  return next;
}

// src/lib/serverBoqAnalysis.js
import { NextResponse as NextResponse2 } from "next/server.js";
import { createClient as createClient3 } from "@supabase/supabase-js";

// src/services/localBoqBuilder.js
function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
}
function objectValues(input) {
  return input && typeof input === "object" ? input : {};
}
function collectTakeoffSources(input) {
  const sources = [];
  const queue = [input];
  const seen = /* @__PURE__ */ new Set();
  const nestedKeys = [
    "raw_result",
    "takeoff",
    "result",
    "advanced_takeoff",
    "quantities",
    "summary",
    "geometry"
  ];
  while (queue.length > 0 && sources.length < 24) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    sources.push(current);
    for (const key2 of nestedKeys) {
      const nested = current[key2];
      if (nested && typeof nested === "object") queue.push(nested);
    }
  }
  return sources;
}
function firstPositive(sources, keys) {
  for (const source of sources) {
    for (const key2 of keys) {
      const value = toNumber(source?.[key2]);
      if (value > 0) return value;
    }
  }
  return 0;
}
function firstValue(sources, keys, fallback = null) {
  for (const source of sources) {
    for (const key2 of keys) {
      const value = source?.[key2];
      if (value !== void 0 && value !== null && value !== "") return value;
    }
  }
  return fallback;
}
function countDetected(sources, keys) {
  for (const source of sources) {
    for (const key2 of keys) {
      const value = source?.[key2];
      if (Array.isArray(value) && value.length > 0) return value.length;
      const number = toNumber(value);
      if (number > 0) return number;
    }
  }
  return 0;
}
function firstArray(sources, keys) {
  for (const source of sources) {
    for (const key2 of keys) {
      if (Array.isArray(source?.[key2]) && source[key2].length > 0) return source[key2];
    }
  }
  return [];
}
function getOpeningArea(opening) {
  const direct = toNumber(opening?.area ?? opening?.area_m2 ?? opening?.areaM2);
  if (direct > 0) return direct;
  const width = toNumber(opening?.width_m ?? opening?.widthM ?? opening?.width);
  const height = toNumber(opening?.height_m ?? opening?.heightM ?? opening?.height);
  return width > 0 && height > 0 ? width * height : 0;
}
function getOpeningMetrics(sources, type) {
  const singular = type === "door" ? "door" : "window";
  const plural = `${singular}s`;
  const details = firstArray(sources, [plural, `${singular}_details`, `${singular}Details`]);
  const count = details.length || countDetected(sources, [plural, `${singular}_count`, `${singular}Count`]);
  const explicitArea = firstPositive(sources, [`${singular}_area`, `${singular}Area`, `total_${singular}_area`, `total${singular[0].toUpperCase()}${singular.slice(1)}Area`]);
  const derivedArea = details.reduce((sum, opening) => sum + getOpeningArea(opening), 0);
  return { count, area: explicitArea || derivedArea };
}
function getRoomDetails(sources) {
  for (const source of sources) {
    const rooms = source?.object_details?.rooms;
    if (Array.isArray(rooms) && rooms.length > 0) return rooms;
    if (Array.isArray(source?.rooms) && source.rooms.length > 0) return source.rooms;
  }
  return [];
}
function getRoomPerimeter(sources) {
  return getRoomDetails(sources).reduce(
    (sum, room) => sum + toNumber(room?.perimeter ?? room?.perimeter_m),
    0
  );
}
function createItem({
  itemNumber,
  section,
  description,
  unit,
  quantity,
  rate,
  source,
  confidence,
  notes = ""
}) {
  return {
    itemNumber,
    section,
    description,
    unit,
    quantity: round(quantity),
    rate: round(rate),
    amount: round(toNumber(quantity) * toNumber(rate)),
    source,
    confidence: toNumber(confidence),
    notes
  };
}
var DEFAULT_RATES = {
  floorFinish: 95,
  ceilingFinish: 25,
  wallFinish: 22,
  skirting: 18,
  door: 1200,
  window: 650,
  slabConcrete: 350
};
function buildLocalBoq({
  takeoff: inputTakeoff,
  projectName = "Untitled Project",
  vatPercentage = 5
}) {
  const sources = collectTakeoffSources(objectValues(inputTakeoff));
  const items = [];
  const warnings = [];
  let assumptions = [];
  const confidence = firstPositive(sources, ["confidence", "floor_area_confidence"]) || 60;
  const floorArea = firstPositive(sources, [
    "floor_area",
    "floorArea",
    "room_area",
    "roomArea",
    "total_floor_area",
    "totalFloorArea"
  ]);
  const ceilingArea = firstPositive(sources, ["ceiling_area", "ceilingArea"]) || floorArea;
  const wallArea = firstPositive(sources, ["wall_area", "wallArea", "total_wall_area", "totalWallArea"]);
  const wallLength = firstPositive(sources, ["wall_length", "wallLength", "total_wall_length", "totalWallLength"]);
  const roomPerimeter = getRoomPerimeter(sources);
  const doorMetrics = getOpeningMetrics(sources, "door");
  const windowMetrics = getOpeningMetrics(sources, "window");
  const doors = doorMetrics.count;
  const windows = windowMetrics.count;
  const totalOpeningArea = doorMetrics.area + windowMetrics.area;
  const netWallArea = wallArea > 0 && totalOpeningArea > 0 ? Math.max(0, wallArea - totalOpeningArea) : wallArea;
  assumptions = [
    "Rates are editable starter budget rates in AED and must be reviewed before quotation or contract use.",
    totalOpeningArea > 0 ? `Wall finishes use net wall area after deducting ${round(totalOpeningArea)} m\xB2 of measured openings.` : "Wall finishes use gross wall area because opening dimensions are unavailable."
  ];
  const slabVolume = firstPositive(sources, ["slab_volume", "slabVolume"]);
  const skirtingLength = Math.max(0, roomPerimeter || wallLength || 0);
  const floorSource = firstValue(sources, ["floor_area_source", "floorAreaSource"], "quantity_takeoff");
  const wallAreaEstimated = Boolean(firstValue(sources, ["wall_area_estimated", "wallAreaEstimated"], false));
  if (floorArea > 0) {
    items.push(createItem({
      itemNumber: "08.01",
      section: "Finishes",
      description: "Floor finish allowance",
      unit: "m\xB2",
      quantity: floorArea,
      rate: DEFAULT_RATES.floorFinish,
      source: floorSource,
      confidence,
      notes: "Replace the allowance description and rate with the selected floor material."
    }));
  }
  if (ceilingArea > 0) {
    items.push(createItem({
      itemNumber: "08.02",
      section: "Finishes",
      description: "Ceiling finish / paint allowance",
      unit: "m\xB2",
      quantity: ceilingArea,
      rate: DEFAULT_RATES.ceilingFinish,
      source: ceilingArea !== floorArea ? "quantity_takeoff" : "derived_from_floor_area",
      confidence: ceilingArea !== floorArea ? confidence : Math.min(confidence, 70)
    }));
  }
  if (wallArea > 0) {
    items.push(createItem({
      itemNumber: "08.03",
      section: "Finishes",
      description: "Internal cement sand plaster to walls",
      unit: "m\xB2",
      quantity: netWallArea,
      rate: 27,
      source: wallAreaEstimated ? "estimated_from_wall_length" : "quantity_takeoff",
      confidence: wallAreaEstimated ? Math.min(confidence, 68) : confidence,
      notes: totalOpeningArea > 0 ? "Opening areas deducted." : "Gross wall area used; opening dimensions unavailable."
    }));
    items.push(createItem({
      itemNumber: "09.01",
      section: "Painting",
      description: "Internal wall emulsion paint including primer and finishing coats",
      unit: "m\xB2",
      quantity: netWallArea,
      rate: DEFAULT_RATES.wallFinish,
      source: wallAreaEstimated ? "estimated_from_wall_length" : "quantity_takeoff",
      confidence: wallAreaEstimated ? Math.min(confidence, 68) : confidence,
      notes: totalOpeningArea > 0 ? "Opening areas deducted." : "Gross wall area used; opening dimensions unavailable."
    }));
  } else if (wallLength > 0) {
    warnings.push("Wall area is unavailable, so wall paint was not added. Confirm wall height and regenerate the takeoff.");
  }
  if (skirtingLength > 0) {
    items.push(createItem({
      itemNumber: "08.03",
      section: "Finishes",
      description: "Skirting allowance",
      unit: "m",
      quantity: skirtingLength,
      rate: DEFAULT_RATES.skirting,
      source: roomPerimeter > 0 ? "room_perimeter" : "wall_length",
      confidence: roomPerimeter > 0 ? confidence : Math.min(confidence, 70),
      notes: "Door widths have not been deducted because opening widths are not available."
    }));
  }
  if (doors > 0) {
    items.push(createItem({
      itemNumber: "07.01",
      section: "Doors & Windows",
      description: "Door set allowance",
      unit: "nos",
      quantity: doors,
      rate: DEFAULT_RATES.door,
      source: "quantity_takeoff",
      confidence
    }));
  }
  if (windows > 0 || windowMetrics.area > 0) {
    const measuredByArea = windowMetrics.area > 0;
    items.push(createItem({
      itemNumber: "07.02",
      section: "Doors & Windows",
      description: measuredByArea ? "Aluminium framed glazed windows measured by area" : "Aluminium framed glazed window set allowance",
      unit: measuredByArea ? "m\xB2" : "nos",
      quantity: measuredByArea ? windowMetrics.area : windows,
      rate: measuredByArea ? 750 : DEFAULT_RATES.window,
      source: measuredByArea ? "measured_opening_area" : "quantity_takeoff_count",
      confidence,
      notes: measuredByArea ? "Quantity is total detected window area." : "Dimensions unavailable; priced per detected window."
    }));
  }
  if (slabVolume > 0) {
    items.push(createItem({
      itemNumber: "03.01",
      section: "Concrete",
      description: "Concrete slab allowance",
      unit: "m\xB3",
      quantity: slabVolume,
      rate: DEFAULT_RATES.slabConcrete,
      source: "quantity_takeoff",
      confidence
    }));
  }
  if (items.length === 0) {
    warnings.push("No measurable floor, wall, opening, or slab quantities were found in the latest takeoff.");
  }
  const subtotal = round(items.reduce((sum, item) => sum + item.amount, 0));
  const vat = round(subtotal * (toNumber(vatPercentage) / 100));
  return {
    projectName,
    currency: "AED",
    vatPercentage: toNumber(vatPercentage),
    items,
    warnings,
    assumptions,
    summary: { subtotal, vat, grandTotal: round(subtotal + vat) },
    generatedBy: "Ventra deterministic BOQ fallback",
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/services/aiBoqScopeService.js
var MODEL2 = process.env.OPENAI_BOQ_MODEL || process.env.OPENAI_DRAWING_MODEL || "gpt-5";
function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}
function compactRoom(room) {
  const bbox = room?.regionBBox && typeof room.regionBBox === "object" && Number.isFinite(
    Number(
      room.regionBBox.x
    )
  ) && Number.isFinite(
    Number(
      room.regionBBox.y
    )
  ) && Number.isFinite(
    Number(
      room.regionBBox.width
    )
  ) && Number.isFinite(
    Number(
      room.regionBBox.height
    )
  ) && Number(
    room.regionBBox.width
  ) > 0 && Number(
    room.regionBBox.height
  ) > 0 ? {
    x: Number(
      room.regionBBox.x
    ),
    y: Number(
      room.regionBBox.y
    ),
    width: Number(
      room.regionBBox.width
    ),
    height: Number(
      room.regionBBox.height
    )
  } : null;
  const rawCentroidX = room?.centroid?.x;
  const rawCentroidY = room?.centroid?.y;
  const directX = rawCentroidX !== null && rawCentroidX !== void 0 && rawCentroidX !== "" && Number.isFinite(
    Number(rawCentroidX)
  ) ? Number(rawCentroidX) : null;
  const directY = rawCentroidY !== null && rawCentroidY !== void 0 && rawCentroidY !== "" && Number.isFinite(
    Number(rawCentroidY)
  ) ? Number(rawCentroidY) : null;
  const centroid = directX !== null && directY !== null ? {
    x: directX,
    y: directY,
    coordinateSystem: room?.centroid?.coordinateSystem || "viewer_sheet_normalized",
    source: room?.centroid?.source || "semantic_room"
  } : bbox ? {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height / 2,
    coordinateSystem: "viewer_sheet_normalized",
    source: "region_bbox_center"
  } : null;
  return {
    name: String(
      room?.name || room?.label || "Room"
    ),
    type: String(
      room?.roomType || room?.detectedType || room?.type || "room"
    ),
    area: Number(room?.area) || 0,
    perimeter: Number(
      room?.perimeter
    ) || 0,
    confidence: Number(
      room?.roomTypeConfidence
    ) || Number(
      room?.confidence
    ) || 0,
    centroid,
    regionBBox: bbox,
    planId: room?.planId || null,
    planTitle: room?.planTitle || null,
    spatialSource: room?.source || null,
    geometrySource: room?.geometrySource || null,
    geometryPolygonId: room?.geometryPolygonId || null,
    areaEstimated: room?.areaEstimated === true,
    perimeterEstimated: room?.perimeterEstimated === true
  };
}
function uniqueStrings(values) {
  return [
    ...new Set(
      values.map((value) => String(value || "").trim()).filter(Boolean)
    )
  ];
}
var scopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scopes", "catalog_search_terms"],
  properties: {
    scopes: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "room_type",
          "trade",
          "work",
          "quantity_basis",
          "reason"
        ],
        properties: {
          room_type: { type: "string" },
          trade: { type: "string" },
          work: { type: "string" },
          quantity_basis: {
            type: "string",
            enum: [
              "floor_area",
              "ceiling_area",
              "net_wall_area",
              "door_count",
              "window_count",
              "electrical_items",
              "room_count",
              "room_type_count",
              "room_type_floor_area",
              "room_type_perimeter",
              "manual_review"
            ]
          },
          reason: { type: "string" }
        }
      }
    },
    catalog_search_terms: {
      type: "array",
      maxItems: 100,
      items: { type: "string" }
    }
  }
};
var matchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["matches"],
  properties: {
    matches: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "item_code",
          "quantity_basis",
          "room_type",
          "reason"
        ],
        properties: {
          item_code: { type: "string" },
          quantity_basis: {
            type: "string",
            enum: [
              "floor_area",
              "ceiling_area",
              "net_wall_area",
              "door_count",
              "window_count",
              "electrical_items",
              "room_count",
              "room_type_count",
              "room_type_floor_area",
              "room_type_perimeter",
              "manual_review"
            ]
          },
          room_type: { type: "string" },
          reason: { type: "string" }
        }
      }
    }
  }
};
function responseJson(response) {
  const text = response?.output_text || response?.output?.flatMap((item) => item?.content || [])?.find((item) => item?.type === "output_text")?.text;
  if (!text) {
    throw new Error("AI BOQ scope engine returned no JSON.");
  }
  return JSON.parse(text);
}
function getSemanticRooms(rawTakeoff) {
  const rooms = rawTakeoff?.object_details?.rooms;
  return Array.isArray(rooms) ? rooms.map(compactRoom) : [];
}
function hydrateSemanticRoomQuantities(rooms, takeoff) {
  const list = Array.isArray(rooms) ? rooms.map(
    (room) => {
      const rawX = room?.centroid?.x;
      const rawY = room?.centroid?.y;
      const x = rawX !== null && rawX !== void 0 && rawX !== "" && Number.isFinite(
        Number(rawX)
      ) ? Number(rawX) : null;
      const y = rawY !== null && rawY !== void 0 && rawY !== "" && Number.isFinite(
        Number(rawY)
      ) ? Number(rawY) : null;
      return {
        ...room,
        centroid: x !== null && y !== null ? {
          ...room.centroid,
          x,
          y
        } : null
      };
    }
  ) : [];
  const floorArea = Number(takeoff?.floor_area) || 0;
  if (list.length === 0 || floorArea <= 0) {
    return {
      rooms: list,
      applied: false,
      source: "unavailable"
    };
  }
  const alreadyMeasured = list.every(
    (room) => Number(room?.area) > 0
  );
  if (alreadyMeasured) {
    return {
      rooms: list,
      applied: false,
      source: "existing_room_quantities"
    };
  }
  const hasCentroids = list.every(
    (room) => Number.isFinite(
      Number(
        room?.centroid?.x
      )
    ) && Number.isFinite(
      Number(
        room?.centroid?.y
      )
    )
  );
  if (!hasCentroids) {
    const equalArea = floorArea / list.length;
    return {
      rooms: list.map((room) => ({
        ...room,
        area: Number(
          equalArea.toFixed(2)
        ),
        perimeter: Number(
          (4 * Math.sqrt(equalArea)).toFixed(2)
        ),
        areaEstimated: true,
        perimeterEstimated: true,
        quantitySource: "equal_distribution_of_autodesk_floor_area"
      })),
      applied: true,
      source: "equal_distribution_of_autodesk_floor_area"
    };
  }
  const gridSize = 140;
  const counts = new Array(list.length).fill(0);
  for (let gy = 0; gy < gridSize; gy += 1) {
    const y = (gy + 0.5) / gridSize;
    for (let gx = 0; gx < gridSize; gx += 1) {
      const x = (gx + 0.5) / gridSize;
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < list.length; index += 1) {
        const dx = x - Number(
          list[index].centroid.x
        );
        const dy = y - Number(
          list[index].centroid.y
        );
        const distance2 = dx * dx + dy * dy;
        if (distance2 < bestDistance) {
          bestDistance = distance2;
          bestIndex = index;
        }
      }
      counts[bestIndex] += 1;
    }
  }
  const totalCells = gridSize * gridSize;
  let assigned = 0;
  const hydrated = list.map(
    (room, index) => {
      let area2;
      if (index === list.length - 1) {
        area2 = floorArea - assigned;
      } else {
        area2 = floorArea * (counts[index] / totalCells);
        assigned += area2;
      }
      area2 = Math.max(
        0,
        area2
      );
      return {
        ...room,
        area: Number(
          area2.toFixed(2)
        ),
        perimeter: Number(
          (4 * Math.sqrt(area2)).toFixed(2)
        ),
        areaEstimated: true,
        perimeterEstimated: true,
        quantitySource: "semantic_centroid_voronoi_scaled_to_autodesk_floor_area"
      };
    }
  );
  return {
    rooms: hydrated,
    applied: true,
    source: "semantic_centroid_voronoi_scaled_to_autodesk_floor_area"
  };
}
async function inferConstructionScopes({
  rooms,
  takeoff
}) {
  if (!rooms.length) {
    return {
      scopes: [],
      catalog_search_terms: []
    };
  }
  const response = await createResponse({
    model: MODEL2,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You are Ventra's construction scope planner. Read semantic room labels detected from the drawing and decide which normal construction work scopes apply to each room type. Do not invent dimensions, quantities, room names, or products. Do not price anything. Examples: a kitchen can require suitable floor finish, wall finish/backsplash, ceiling finish, plumbing fixtures/points, cabinetry and electrical work; a bathroom can require waterproofing, floor/wall finishes, sanitary/plumbing, ceiling, exhaust and electrical work; bedrooms/living rooms typically require plaster/paint/ceiling/floor/skirting/electrical as applicable. Treat these as reasoning examples, not hard-coded rules. quantity_basis must describe how a downstream deterministic quantity engine could measure the work. Use manual_review when the drawing/takeoff does not contain enough measurable evidence."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              detected_rooms: rooms,
              measured_takeoff: {
                rooms: takeoff.rooms,
                floor_area: takeoff.floor_area,
                ceiling_area: takeoff.ceiling_area,
                wall_area: takeoff.wall_area,
                wall_length: takeoff.wall_length,
                opening_area: takeoff.opening_area,
                doors: takeoff.doors,
                windows: takeoff.windows,
                electrical_items: takeoff.electrical_items
              }
            })
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ventra_room_scope_plan",
        strict: true,
        schema: scopeSchema
      }
    }
  });
  return responseJson(response);
}
function shortlistPriceCatalog(prices, searchTerms, limit = 500) {
  const terms = uniqueStrings(searchTerms).flatMap((value) => {
    const normalized = normalizeText(value);
    const words = normalized.split(/[^a-z0-9]+/i).filter((word) => word.length >= 4);
    return [normalized, ...words];
  }).filter((term) => term.length >= 3);
  if (!terms.length) {
    return [];
  }
  const scored = prices.map((item) => {
    const haystack = normalizeText(
      [
        item.item_code,
        item.description,
        item.category,
        item.sub_category,
        item.unit
      ].join(" ")
    );
    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term)) {
        score += term.includes(" ") ? 4 : 1;
      }
    }
    return { item, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ item }) => ({
    item_code: item.item_code,
    description: item.description,
    category: item.category,
    sub_category: item.sub_category,
    unit: item.unit
  }));
}
async function matchScopesToCatalog({
  scopes,
  candidates
}) {
  if (!scopes.length || !candidates.length) {
    return { matches: [] };
  }
  const response = await createResponse({
    model: MODEL2,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "Match Ventra construction scopes to the supplied UAE price catalog. You may ONLY return item_code values that exist in catalog_candidates. Match by actual construction meaning and compatible unit/quantity basis. Never invent an item code. Do not match an m2 scope to an item/lm/m3 price unless the basis is genuinely compatible. Prefer no match over a wrong match. Avoid duplicate item codes unless they apply to genuinely different room-specific measured quantities."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              scopes,
              catalog_candidates: candidates
            })
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ventra_scope_catalog_matches",
        strict: true,
        schema: matchSchema
      }
    }
  });
  return responseJson(response);
}
function countRoomsByType(rooms, roomType) {
  const target = normalizeText(roomType);
  return rooms.filter(
    (room) => normalizeText(room.type) === target
  ).length;
}
function sumRoomMetric(rooms, roomType, field) {
  const target = normalizeText(roomType);
  return rooms.reduce((sum, room) => {
    if (normalizeText(room.type) !== target) {
      return sum;
    }
    return sum + (Number(room[field]) || 0);
  }, 0);
}
function resolveAiQuantity({
  match,
  rooms,
  takeoff
}) {
  const basis = match.quantity_basis;
  const roomType = normalizeText(
    match.room_type
  );
  const isRoomSpecific = Boolean(roomType) && ![
    "all",
    "all_rooms",
    "building",
    "general",
    "project",
    "whole_building",
    "whole project"
  ].includes(roomType);
  const roomTypeCount = isRoomSpecific ? countRoomsByType(
    rooms,
    roomType
  ) : 0;
  const roomTypeFloorArea = isRoomSpecific ? sumRoomMetric(
    rooms,
    roomType,
    "area"
  ) : 0;
  const roomTypePerimeter = isRoomSpecific ? sumRoomMetric(
    rooms,
    roomType,
    "perimeter"
  ) : 0;
  const totalRoomPerimeter = rooms.reduce(
    (sum, room) => sum + (Number(
      room?.perimeter
    ) || 0),
    0
  );
  const buildingNetWallArea = Math.max(
    0,
    (Number(
      takeoff.wall_area
    ) || 0) - (Number(
      takeoff.opening_area
    ) || 0)
  );
  if (isRoomSpecific) {
    switch (basis) {
      case "room_type_count":
      case "room_count":
        return roomTypeCount;
      case "room_type_floor_area":
      case "floor_area":
      case "ceiling_area":
        return roomTypeFloorArea;
      case "room_type_perimeter":
        return roomTypePerimeter;
      case "net_wall_area":
        if (roomTypePerimeter > 0 && totalRoomPerimeter > 0 && buildingNetWallArea > 0) {
          return buildingNetWallArea * (roomTypePerimeter / totalRoomPerimeter);
        }
        return 0;
      case "door_count":
      case "window_count":
      case "electrical_items":
      case "manual_review":
      default:
        return 0;
    }
  }
  switch (basis) {
    case "floor_area":
      return Number(
        takeoff.floor_area
      ) || 0;
    case "ceiling_area":
      return Number(
        takeoff.ceiling_area
      ) || 0;
    case "net_wall_area":
      return buildingNetWallArea;
    case "door_count":
      return Number(
        takeoff.doors
      ) || 0;
    case "window_count":
      return Number(
        takeoff.windows
      ) || 0;
    case "electrical_items":
      return Number(
        takeoff.electrical_items
      ) || 0;
    case "room_count":
      return Number(
        takeoff.rooms
      ) || rooms.length || 0;
    case "room_type_count":
    case "room_type_floor_area":
    case "room_type_perimeter":
    case "manual_review":
    default:
      return 0;
  }
}

// src/lib/serverBoqAnalysis.js
function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key2 = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing."
    );
  }
  if (!key2) {
    throw new Error(
      "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is missing from .env.local."
    );
  }
  return createClient3(url, key2, {
    db: {
      schema: "public"
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}
function toNumber2(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function round2(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(
    (toNumber2(value) + Number.EPSILON) * factor
  ) / factor;
}
function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}
function normalizeTakeoff(rawTakeoff) {
  const takeoff = rawTakeoff || {};
  const doors = toNumber2(
    takeoff.doors ?? takeoff.door_count ?? takeoff.doorCount
  );
  const windows = toNumber2(
    takeoff.windows ?? takeoff.window_count ?? takeoff.windowCount
  );
  const measuredDoorArea = toNumber2(
    takeoff.door_area ?? takeoff.doorArea
  );
  const measuredWindowArea = toNumber2(
    takeoff.window_area ?? takeoff.windowArea
  );
  const measuredOpeningArea = toNumber2(
    takeoff.opening_area ?? takeoff.openingArea
  );
  const estimatedDoorArea = measuredDoorArea > 0 ? measuredDoorArea : doors > 0 ? doors * 1.89 : 0;
  const estimatedWindowArea = measuredWindowArea > 0 ? measuredWindowArea : windows > 0 ? windows * 1.44 : 0;
  const resolvedOpeningArea = measuredOpeningArea > 0 ? measuredOpeningArea : estimatedDoorArea + estimatedWindowArea;
  return {
    rooms: toNumber2(
      takeoff.rooms ?? takeoff.room_count ?? takeoff.roomCount
    ),
    doors,
    windows,
    walls: toNumber2(takeoff.walls),
    floors: toNumber2(takeoff.floors),
    slabs: toNumber2(takeoff.slabs),
    ceilings: toNumber2(takeoff.ceilings),
    columns: toNumber2(takeoff.columns),
    beams: toNumber2(takeoff.beams),
    foundations: toNumber2(takeoff.foundations),
    stairs: toNumber2(takeoff.stairs),
    ramps: toNumber2(takeoff.ramps),
    roofs: toNumber2(takeoff.roofs),
    pipes: toNumber2(takeoff.pipes),
    ducts: toNumber2(takeoff.ducts),
    electrical_items: toNumber2(
      takeoff.electrical_items ?? takeoff.electricalItems
    ),
    lighting_points: toNumber2(takeoff.lighting_points ?? takeoff.lightingPoints),
    socket_points: toNumber2(takeoff.socket_points ?? takeoff.socketPoints),
    switches: toNumber2(takeoff.switches),
    distribution_boards: toNumber2(takeoff.distribution_boards ?? takeoff.distributionBoards),
    other_electrical: toNumber2(takeoff.other_electrical ?? takeoff.otherElectrical),
    wall_length: toNumber2(
      takeoff.wall_length ?? takeoff.wallLength
    ),
    wall_area: toNumber2(
      takeoff.wall_area ?? takeoff.wallArea
    ),
    wall_volume: toNumber2(
      takeoff.wall_volume ?? takeoff.wallVolume
    ),
    room_area: toNumber2(
      takeoff.room_area ?? takeoff.roomArea
    ),
    floor_area: toNumber2(
      takeoff.floor_area ?? takeoff.floorArea ?? takeoff.slab_area ?? takeoff.slabArea
    ),
    wet_floor_area: toNumber2(takeoff.wet_floor_area ?? takeoff.wetFloorArea),
    wet_room_perimeter: toNumber2(takeoff.wet_room_perimeter ?? takeoff.wetRoomPerimeter),
    bathroom_floor_area: toNumber2(takeoff.bathroom_floor_area ?? takeoff.bathroomFloorArea),
    bathroom_perimeter: toNumber2(takeoff.bathroom_perimeter ?? takeoff.bathroomPerimeter),
    toilet_floor_area: toNumber2(takeoff.toilet_floor_area ?? takeoff.toiletFloorArea),
    toilet_perimeter: toNumber2(takeoff.toilet_perimeter ?? takeoff.toiletPerimeter),
    kitchen_floor_area: toNumber2(takeoff.kitchen_floor_area ?? takeoff.kitchenFloorArea),
    kitchen_perimeter: toNumber2(takeoff.kitchen_perimeter ?? takeoff.kitchenPerimeter),
    laundry_floor_area: toNumber2(takeoff.laundry_floor_area ?? takeoff.laundryFloorArea),
    laundry_perimeter: toNumber2(takeoff.laundry_perimeter ?? takeoff.laundryPerimeter),
    balcony_floor_area: toNumber2(takeoff.balcony_floor_area ?? takeoff.balconyFloorArea),
    balcony_perimeter: toNumber2(takeoff.balcony_perimeter ?? takeoff.balconyPerimeter),
    slab_area: toNumber2(
      takeoff.slab_area ?? takeoff.slabArea
    ),
    slab_volume: toNumber2(
      takeoff.slab_volume ?? takeoff.slabVolume
    ),
    ceiling_area: toNumber2(
      takeoff.ceiling_area ?? takeoff.ceilingArea ?? takeoff.floor_area ?? takeoff.floorArea
    ),
    column_volume: toNumber2(
      takeoff.column_volume ?? takeoff.columnVolume
    ),
    beam_volume: toNumber2(
      takeoff.beam_volume ?? takeoff.beamVolume
    ),
    foundation_volume: toNumber2(
      takeoff.foundation_volume ?? takeoff.foundationVolume
    ),
    column_formwork_area: toNumber2(
      takeoff.column_formwork_area ?? takeoff.columnFormworkArea
    ),
    beam_formwork_area: toNumber2(
      takeoff.beam_formwork_area ?? takeoff.beamFormworkArea
    ),
    foundation_formwork_area: toNumber2(
      takeoff.foundation_formwork_area ?? takeoff.foundationFormworkArea
    ),
    slab_formwork_area: toNumber2(
      takeoff.slab_formwork_area ?? takeoff.slabFormworkArea
    ),
    structural_measurement_status: takeoff.structural_measurement_status && typeof takeoff.structural_measurement_status === "object" ? takeoff.structural_measurement_status : null,
    roof_area: toNumber2(
      takeoff.roof_area ?? takeoff.roofArea
    ),
    pipe_length: toNumber2(
      takeoff.pipe_length ?? takeoff.pipeLength
    ),
    duct_length: toNumber2(
      takeoff.duct_length ?? takeoff.ductLength
    ),
    opening_area: round2(
      resolvedOpeningArea,
      2
    ),
    door_area: round2(
      estimatedDoorArea,
      2
    ),
    window_area: round2(
      estimatedWindowArea,
      2
    ),
    opening_area_estimated: measuredOpeningArea <= 0 && (measuredDoorArea <= 0 || measuredWindowArea <= 0) && resolvedOpeningArea > 0,
    opening_area_source: measuredOpeningArea > 0 ? "takeoff_measured" : resolvedOpeningArea > 0 ? "verified_counts_with_standard_dimensions" : "unavailable",
    confidence: toNumber2(
      takeoff.confidence
    ),
    notes: String(
      takeoff.notes || ""
    )
  };
}
function getGeometryValue(rule, takeoff) {
  const geometryType = String(
    rule.geometry_type || ""
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const property = String(
    rule.geometry_property || ""
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (geometryType === "room" && ["", "count", "room_count", "rooms"].includes(property)) {
    return takeoff.rooms;
  }
  if (geometryType === "door" && ["", "count", "door_count", "doors"].includes(property)) {
    return takeoff.doors;
  }
  if (geometryType === "window" && ["", "count", "window_count", "windows"].includes(property)) {
    return takeoff.windows;
  }
  if (geometryType === "wall" && ["area", "wall_area"].includes(property)) {
    return takeoff.wall_area;
  }
  if (geometryType === "wall" && ["length", "wall_length", "perimeter"].includes(property)) {
    return takeoff.wall_length;
  }
  if (["floor", "slab"].includes(geometryType) && ["", "area", "floor_area", "slab_area"].includes(property)) {
    return takeoff.floor_area;
  }
  if (geometryType === "ceiling" && ["", "area", "ceiling_area"].includes(property)) {
    return takeoff.ceiling_area;
  }
  if (property === "room_count" || property === "rooms") {
    return takeoff.rooms;
  }
  if (property === "door_count" || property === "doors") {
    return takeoff.doors;
  }
  if (property === "window_count" || property === "windows") {
    return takeoff.windows;
  }
  if (property === "window_area") {
    return takeoff.window_area || takeoff.windows;
  }
  if (property === "door_area") {
    return takeoff.door_area || takeoff.doors;
  }
  if (property === "floor_area" || property === "slab_area") {
    return takeoff.floor_area;
  }
  if (property === "ceiling_area") {
    return takeoff.ceiling_area;
  }
  if (property === "opening_area") {
    return takeoff.opening_area;
  }
  const countByGeometryType = {
    wall: takeoff.walls,
    floor: takeoff.floors,
    slab: takeoff.slabs,
    ceiling: takeoff.ceilings,
    column: takeoff.columns,
    beam: takeoff.beams,
    foundation: takeoff.foundations,
    stair: takeoff.stairs,
    ramp: takeoff.ramps,
    roof: takeoff.roofs,
    pipe: takeoff.pipes,
    duct: takeoff.ducts,
    electrical: takeoff.electrical_items
  };
  if (Object.prototype.hasOwnProperty.call(
    countByGeometryType,
    geometryType
  ) && ["", "count", `${geometryType}_count`, `${geometryType}s`].includes(property)) {
    return toNumber2(
      countByGeometryType[geometryType]
    );
  }
  if (geometryType === "wall" && property === "volume") {
    return takeoff.wall_volume;
  }
  if (geometryType === "slab") {
    if (["area", "slab_area"].includes(property)) {
      return takeoff.slab_area || takeoff.floor_area;
    }
    if (["volume", "slab_volume"].includes(property)) {
      return takeoff.slab_volume;
    }
  }
  if (geometryType === "column" && ["volume", "column_volume"].includes(property)) {
    return takeoff.column_volume;
  }
  if (geometryType === "beam" && ["volume", "beam_volume"].includes(property)) {
    return takeoff.beam_volume;
  }
  if (geometryType === "foundation" && ["volume", "foundation_volume"].includes(property)) {
    return takeoff.foundation_volume;
  }
  if (geometryType === "roof" && ["area", "roof_area"].includes(property)) {
    return takeoff.roof_area;
  }
  if (geometryType === "pipe" && ["length", "pipe_length"].includes(property)) {
    return takeoff.pipe_length;
  }
  if (geometryType === "duct" && ["length", "duct_length"].includes(property)) {
    return takeoff.duct_length;
  }
  if (geometryType === "electrical" && ["", "count", "electrical_count", "electrical_items"].includes(property)) {
    return takeoff.electrical_items;
  }
  if (property && Object.prototype.hasOwnProperty.call(
    takeoff,
    property
  )) {
    return toNumber2(
      takeoff[property]
    );
  }
  return 0;
}
function calculateQuantity(rule, takeoff) {
  const itemCode = normalizeCode(
    rule?.item_code
  );
  const measuredElectrical = {
    "ELE-001": toNumber2(
      takeoff?.lighting_points
    ),
    "ELE-002": toNumber2(
      takeoff?.socket_points
    ),
    "ELE-003": toNumber2(
      takeoff?.switches
    ),
    "ELE-004": toNumber2(
      takeoff?.distribution_boards
    )
  };
  if (Object.prototype.hasOwnProperty.call(
    measuredElectrical,
    itemCode
  )) {
    const measuredQuantity = measuredElectrical[itemCode];
    console.log(
      "[VENTRA ELECTRICAL BOQ v26.1]",
      {
        item: itemCode,
        measuredQuantity,
        source: "takeoff_electrical_subtype_count"
      }
    );
    return round2(
      measuredQuantity,
      Number.isInteger(
        rule.rounding_precision
      ) ? rule.rounding_precision : 2
    );
  }
  const formulaType = String(
    rule.formula_type || "multiply"
  ).toLowerCase();
  const multiplier = toNumber2(rule.multiplier) || 1;
  const openingMultiplier = toNumber2(
    rule.opening_multiplier
  ) || 1;
  const baseValue = getGeometryValue(
    rule,
    takeoff
  );
  let quantity = 0;
  switch (formulaType) {
    case "direct":
    case "count":
    case "multiply":
      quantity = baseValue * multiplier;
      break;
    case "wall_net_area": {
      const openingArea = takeoff.opening_area || takeoff.door_area + takeoff.window_area;
      quantity = Math.max(
        0,
        takeoff.wall_area - openingArea * openingMultiplier
      ) * multiplier;
      break;
    }
    case "wall_both_sides": {
      const openingArea = takeoff.opening_area || takeoff.door_area + takeoff.window_area;
      quantity = Math.max(
        0,
        takeoff.wall_area - openingArea * openingMultiplier
      ) * multiplier;
      break;
    }
    case "perimeter":
      quantity = takeoff.wall_length * multiplier;
      break;
    case "manual":
    default:
      quantity = 0;
      break;
  }
  const minimumQuantity = toNumber2(
    rule.minimum_quantity
  );
  if (quantity > 0 && quantity < minimumQuantity) {
    quantity = minimumQuantity;
  }
  return round2(
    quantity,
    Number.isInteger(
      rule.rounding_precision
    ) ? rule.rounding_precision : 2
  );
}
function directRateCandidates(priceItem) {
  const componentRate = toNumber2(
    priceItem?.material_rate
  ) + toNumber2(
    priceItem?.labor_rate
  ) + toNumber2(
    priceItem?.equipment_rate
  ) + toNumber2(
    priceItem?.transport_rate
  );
  return {
    economy: toNumber2(
      priceItem?.economy_rate
    ),
    standard: toNumber2(
      priceItem?.standard_rate
    ),
    premium: toNumber2(
      priceItem?.premium_rate
    ),
    component: componentRate
  };
}
function chooseDirectRate(priceItem, priceLevel) {
  const rates = directRateCandidates(
    priceItem
  );
  const level = String(
    priceLevel || "standard"
  ).toLowerCase();
  const preferredOrder = level === "economy" ? [
    ["economy", rates.economy],
    ["standard", rates.standard],
    ["premium", rates.premium],
    ["component", rates.component]
  ] : level === "premium" ? [
    ["premium", rates.premium],
    ["standard", rates.standard],
    ["economy", rates.economy],
    ["component", rates.component]
  ] : [
    ["standard", rates.standard],
    ["economy", rates.economy],
    ["premium", rates.premium],
    ["component", rates.component]
  ];
  for (const [source, value] of preferredOrder) {
    if (Number(value) > 0) {
      return {
        rate: Number(value),
        source: source === level ? `direct_${source}_rate` : `fallback_${source}_rate`
      };
    }
  }
  return {
    rate: 0,
    source: "missing_direct_rate"
  };
}
function normalizeRateUnit(value) {
  return String(
    value || ""
  ).trim().toLowerCase().replace(/²/g, "2").replace(/³/g, "3").replace(/\s+/g, "");
}
function median(values) {
  const sorted = values.filter(
    (value) => Number.isFinite(
      Number(value)
    ) && Number(value) > 0
  ).map(Number).sort(
    (a, b) => a - b
  );
  if (sorted.length === 0) {
    return 0;
  }
  const middle = Math.floor(
    sorted.length / 2
  );
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}
function resolveRate(priceItem, priceLevel, allPriceItems) {
  const direct = chooseDirectRate(
    priceItem,
    priceLevel
  );
  if (direct.rate > 0) {
    return {
      ...direct,
      peerCount: 0,
      missingRate: false
    };
  }
  const unit = normalizeRateUnit(
    priceItem?.unit
  );
  const category = String(
    priceItem?.category || ""
  ).trim().toLowerCase();
  const subCategory = String(
    priceItem?.sub_category || ""
  ).trim().toLowerCase();
  const sectionCode = String(
    priceItem?.section_code || ""
  ).trim().toLowerCase();
  const description = String(
    priceItem?.description || ""
  ).trim().toLowerCase();
  const candidates = (Array.isArray(
    allPriceItems
  ) ? allPriceItems : []).filter(
    (item) => item && item !== priceItem && normalizeRateUnit(
      item.unit
    ) === unit
  ).map((item) => {
    let score = 0;
    const itemCategory = String(
      item.category || ""
    ).trim().toLowerCase();
    const itemSubCategory = String(
      item.sub_category || ""
    ).trim().toLowerCase();
    const itemSectionCode = String(
      item.section_code || ""
    ).trim().toLowerCase();
    if (category && itemCategory === category) {
      score += 4;
    }
    if (subCategory && itemSubCategory === subCategory) {
      score += 5;
    }
    if (sectionCode && itemSectionCode === sectionCode) {
      score += 3;
    }
    const itemDescription = String(
      item.description || ""
    ).toLowerCase();
    const keywords = description.split(
      /[^a-z0-9]+/
    ).filter(
      (word) => word.length >= 4
    );
    const overlap = keywords.filter(
      (word) => itemDescription.includes(
        word
      )
    ).length;
    score += Math.min(
      overlap,
      4
    );
    const directPeer = chooseDirectRate(
      item,
      priceLevel
    );
    return {
      item,
      score,
      rate: directPeer.rate
    };
  }).filter(
    (candidate) => candidate.rate > 0 && candidate.score >= 4
  ).sort(
    (a, b) => b.score - a.score
  );
  if (candidates.length > 0) {
    const bestScore = candidates[0].score;
    const closePeers = candidates.filter(
      (candidate) => candidate.score >= Math.max(
        4,
        bestScore - 2
      )
    ).slice(
      0,
      15
    );
    const peerMedian = median(
      closePeers.map(
        (candidate) => candidate.rate
      )
    );
    if (peerMedian > 0) {
      return {
        rate: peerMedian,
        source: "peer_database_median_rate",
        peerCount: closePeers.length,
        missingRate: false
      };
    }
  }
  const pricedPeers = (Array.isArray(
    allPriceItems
  ) ? allPriceItems : []).filter(
    (item) => item && item !== priceItem && normalizeRateUnit(
      item.unit
    ) === unit
  ).map((item) => ({
    rate: chooseDirectRate(
      item,
      priceLevel
    ).rate,
    category: String(
      item.category || ""
    ).trim().toLowerCase(),
    subCategory: String(
      item.sub_category || ""
    ).trim().toLowerCase(),
    sectionCode: String(
      item.section_code || ""
    ).trim().toLowerCase()
  })).filter(
    (peer) => peer.rate > 0
  );
  if (String(
    priceItem?.item_code || ""
  ).trim().toUpperCase() === "TIL-007" || /(tile skirting|skirting|wall base|base trim)/.test(
    description
  )) {
    const skirtingPeers = pricedPeers.filter(
      (peer) => {
        const peerDescription = String(
          peer?.item?.description || ""
        ).toLowerCase();
        return /(tile skirting|skirting|wall base|base trim)/.test(
          peerDescription
        ) && Number(
          peer.rate
        ) > 0;
      }
    );
    const skirtingMedian = median(
      skirtingPeers.map(
        (peer) => peer.rate
      )
    );
    if (skirtingMedian > 0) {
      return {
        rate: skirtingMedian,
        source: "skirting_database_median_rate",
        peerCount: skirtingPeers.length,
        missingRate: false
      };
    }
    const sectionLinearPeers = pricedPeers.filter(
      (peer) => sectionCode && peer.sectionCode === sectionCode
    );
    const sectionLinearMedian = median(
      sectionLinearPeers.map(
        (peer) => peer.rate
      )
    );
    if (sectionLinearMedian > 0) {
      return {
        rate: sectionLinearMedian,
        source: "skirting_section_linear_median_rate",
        peerCount: sectionLinearPeers.length,
        missingRate: false
      };
    }
  }
  if (String(
    priceItem?.item_code || ""
  ).trim().toUpperCase() === "TIL-007") {
    const databaseItems = Array.isArray(
      allPriceItems
    ) ? allPriceItems : [];
    const floorTileReference = databaseItems.find(
      (item) => String(
        item?.item_code || ""
      ).trim().toUpperCase() === "FIN-003" && chooseDirectRate(
        item,
        priceLevel
      ).rate > 0
    ) || databaseItems.find(
      (item) => {
        const desc = String(
          item?.description || ""
        ).toLowerCase();
        const peerUnit = normalizeRateUnit(
          item?.unit
        );
        return ["m2", "sqm", "sq.m"].includes(
          peerUnit
        ) && /(ceramic|porcelain).*(floor|tile)|floor.*tile/.test(
          desc
        ) && chooseDirectRate(
          item,
          priceLevel
        ).rate > 0;
      }
    );
    if (floorTileReference) {
      const floorTileRate = chooseDirectRate(
        floorTileReference,
        priceLevel
      ).rate;
      const derivedRate = floorTileRate * 0.15;
      if (derivedRate > 0) {
        return {
          rate: derivedRate,
          source: "derived_tile_skirting_from_floor_tile_rate",
          peerCount: 1,
          missingRate: false
        };
      }
    }
  }
  const fallbackGroups = [
    {
      source: "section_subcategory_unit_median_rate",
      peers: pricedPeers.filter(
        (peer) => sectionCode && peer.sectionCode === sectionCode && subCategory && peer.subCategory === subCategory
      )
    },
    {
      source: "section_category_unit_median_rate",
      peers: pricedPeers.filter(
        (peer) => sectionCode && peer.sectionCode === sectionCode && category && peer.category === category
      )
    },
    {
      source: "section_unit_median_rate",
      peers: pricedPeers.filter(
        (peer) => sectionCode && peer.sectionCode === sectionCode
      )
    },
    {
      source: "category_unit_median_rate",
      peers: pricedPeers.filter(
        (peer) => category && peer.category === category
      )
    },
    {
      source: "unit_database_median_rate",
      peers: pricedPeers
    }
  ];
  for (const group of fallbackGroups) {
    const values = group.peers.map(
      (peer) => peer.rate
    ).filter(
      (rate) => Number(rate) > 0
    );
    const groupMedian = median(values);
    if (groupMedian > 0) {
      return {
        rate: groupMedian,
        source: group.source,
        peerCount: values.length,
        missingRate: false
      };
    }
  }
  return {
    rate: 0,
    source: "rate_missing_in_database",
    peerCount: 0,
    missingRate: true
  };
}
async function fetchAllActivePriceItems(supabase) {
  const pageSize = 1e3;
  const allItems = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("price_items").select("*").eq("is_active", true).order("item_code", {
      ascending: true
    }).range(
      from,
      from + pageSize - 1
    );
    if (error) {
      return {
        data: null,
        error
      };
    }
    const page = data || [];
    allItems.push(...page);
    if (page.length < pageSize) {
      break;
    }
  }
  return {
    data: allItems,
    error: null
  };
}
function getMeasuredRuleFamily(rule, priceItem) {
  const description = String(
    priceItem?.description || ""
  ).toLowerCase();
  const geometry2 = String(
    rule?.geometry_type || ""
  ).toLowerCase();
  const property = String(
    rule?.geometry_property || ""
  ).toLowerCase();
  if (geometry2 === "wall" && property === "area" && /block\s*wall|blockwork|block work|masonry/.test(
    description
  )) {
    return "wall_blockwork";
  }
  return null;
}
function shouldSuppressDatabaseAutoRule(rule, priceItem, claimedFamilies) {
  const ruleName = String(
    rule?.rule_name || ""
  );
  const description = String(
    priceItem?.description || ""
  ).toLowerCase();
  const isDatabaseAuto = ruleName.startsWith(
    "DB Auto:"
  );
  if (!isDatabaseAuto) {
    return false;
  }
  if (String(
    rule?.geometry_type || ""
  ).toLowerCase() === "wall" && String(
    rule?.geometry_property || ""
  ).toLowerCase() === "area" && /(external|weather resistant|weather-resistant|wall tile|wall tiling|backsplash|wet area)/.test(
    description
  )) {
    return true;
  }
  const family2 = getMeasuredRuleFamily(
    rule,
    priceItem
  );
  if (family2 && claimedFamilies.has(
    family2
  )) {
    return true;
  }
  return false;
}
function getSafeQuantityBasis(match, priceItem) {
  const original = String(
    match?.quantity_basis || "manual_review"
  );
  if (original !== "manual_review") {
    return original;
  }
  const roomType = String(
    match?.room_type || ""
  ).toLowerCase();
  const description = String(
    priceItem?.description || ""
  ).toLowerCase();
  const unit = String(
    priceItem?.unit || ""
  ).trim().toLowerCase().replace(/²/g, "2").replace(/\s+/g, "");
  const isAreaUnit = [
    "m2",
    "sqm",
    "sq.m"
  ].includes(unit);
  const isWetRoom = [
    "bathroom",
    "toilet",
    "powder_room",
    "laundry",
    "kitchen",
    "pantry"
  ].includes(roomType);
  const isFloorWaterproofing = /(waterproof|water proof|membrane)/.test(
    description
  ) && !/(wall|vertical|upstand|roof)/.test(
    description
  );
  if (isWetRoom && isAreaUnit && isFloorWaterproofing) {
    return "room_type_floor_area";
  }
  return original;
}
function estimatePendingRuleQuantity(rule, priceItem, takeoff) {
  const geometry2 = String(
    rule?.geometry_type || ""
  ).toLowerCase();
  const description = String(
    priceItem?.description || ""
  ).toLowerCase();
  const unit = String(
    priceItem?.unit || ""
  ).trim().toLowerCase().replace(/²/g, "2").replace(/\s+/g, "");
  const floorArea = Number(
    takeoff?.floor_area
  ) || 0;
  const wallLength = Number(
    takeoff?.wall_length
  ) || 0;
  const wallArea = Number(
    takeoff?.wall_area
  ) || 0;
  const columns = Number(
    takeoff?.columns
  ) || 0;
  const stairs = Number(
    takeoff?.stairs
  ) || 0;
  const electricalItems = Number(
    takeoff?.electrical_items
  ) || 0;
  const roomCount = Number(
    takeoff?.rooms
  ) || 0;
  const bathrooms = Number(
    takeoff?.classifications?.room_types?.bathroom
  ) || 0;
  const kitchens = Number(
    takeoff?.classifications?.room_types?.kitchen
  ) || 0;
  const wetRooms = bathrooms + kitchens + (Number(
    takeoff?.classifications?.room_types?.laundry
  ) || 0);
  if (geometry2 === "preliminaries" && ["item", "ls", "l.s", "sum"].includes(
    unit
  )) {
    return {
      quantity: 1,
      source: "project_allowance",
      confidence: 55
    };
  }
  if (geometry2 === "earthwork") {
    if (/(excavat|soil removal|cut)/.test(
      description
    ) && ["m3", "cum", "cu.m"].includes(
      unit
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.6,
        source: "floor_area_based_earthwork_allowance",
        confidence: 45
      };
    }
    if (/(backfill|fill)/.test(
      description
    ) && ["m3", "cum", "cu.m"].includes(
      unit
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.3,
        source: "floor_area_based_backfill_allowance",
        confidence: 45
      };
    }
  }
  if (geometry2 === "foundation") {
    if (["m3", "cum", "cu.m"].includes(
      unit
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.22,
        source: "floor_area_based_foundation_allowance",
        confidence: 42
      };
    }
    if (["m2", "sqm", "sq.m"].includes(
      unit
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.85,
        source: "floor_area_based_foundation_formwork_allowance",
        confidence: 42
      };
    }
  }
  if (geometry2 === "column") {
    if (["m3", "cum", "cu.m"].includes(
      unit
    ) && columns > 0) {
      return {
        quantity: columns * 0.32,
        source: "column_count_allowance",
        confidence: 48
      };
    }
    if (["m2", "sqm", "sq.m"].includes(
      unit
    ) && columns > 0) {
      return {
        quantity: columns * 3.6,
        source: "column_count_formwork_allowance",
        confidence: 46
      };
    }
  }
  if (geometry2 === "beam") {
    if (["m3", "cum", "cu.m"].includes(
      unit
    ) && wallLength > 0) {
      return {
        quantity: wallLength * 0.045,
        source: "wall_length_beam_allowance",
        confidence: 40
      };
    }
    if (["m2", "sqm", "sq.m"].includes(
      unit
    ) && wallLength > 0) {
      return {
        quantity: wallLength * 0.55,
        source: "wall_length_beam_formwork_allowance",
        confidence: 40
      };
    }
  }
  if (geometry2 === "slab") {
    if (["m3", "cum", "cu.m"].includes(
      unit
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.16,
        source: "floor_area_slab_concrete_allowance",
        confidence: 50
      };
    }
    if (["m2", "sqm", "sq.m"].includes(
      unit
    ) && floorArea > 0) {
      return {
        quantity: floorArea,
        source: "floor_area_slab_formwork_allowance",
        confidence: 60
      };
    }
  }
  if (geometry2 === "plumbing") {
    if (["no", "nos", "nr", "item", "each", "ea", "unit", "set"].includes(
      unit
    )) {
      if (/(wc|toilet|water closet)/.test(
        description
      ) && bathrooms > 0) {
        return {
          quantity: bathrooms,
          source: "bathroom_count_fixture_allowance",
          confidence: 60
        };
      }
      if (/(basin|wash basin|lavatory)/.test(
        description
      ) && bathrooms > 0) {
        return {
          quantity: bathrooms,
          source: "bathroom_count_fixture_allowance",
          confidence: 60
        };
      }
      if (/(shower)/.test(
        description
      ) && bathrooms > 0) {
        return {
          quantity: bathrooms,
          source: "bathroom_count_fixture_allowance",
          confidence: 55
        };
      }
      if (/(sink)/.test(
        description
      ) && kitchens > 0) {
        return {
          quantity: kitchens,
          source: "kitchen_count_fixture_allowance",
          confidence: 60
        };
      }
      if (/(floor drain|drain)/.test(
        description
      ) && wetRooms > 0) {
        return {
          quantity: wetRooms,
          source: "wet_room_count_drain_allowance",
          confidence: 55
        };
      }
    }
    if (["m", "lm", "linear.m", "lin.m"].includes(
      unit
    ) && wetRooms > 0) {
      return {
        quantity: wetRooms * 8,
        source: "wet_room_pipe_length_allowance",
        confidence: 38
      };
    }
  }
  if (geometry2 === "electrical") {
    if (["no", "nos", "nr", "item", "each", "ea", "unit", "point"].includes(
      unit
    ) && electricalItems > 0) {
      if (/(lighting point|light point|downlight|led)/.test(
        description
      )) {
        return {
          quantity: Math.round(
            electricalItems * 0.4
          ),
          source: "electrical_total_split_allowance",
          confidence: 35
        };
      }
      if (/(socket|power outlet|13a)/.test(
        description
      )) {
        return {
          quantity: Math.round(
            electricalItems * 0.35
          ),
          source: "electrical_total_split_allowance",
          confidence: 35
        };
      }
      if (/(switch)/.test(
        description
      )) {
        return {
          quantity: Math.round(
            electricalItems * 0.2
          ),
          source: "electrical_total_split_allowance",
          confidence: 35
        };
      }
      if (/(distribution board|db panel|consumer unit)/.test(
        description
      )) {
        return {
          quantity: 1,
          source: "single_db_allowance",
          confidence: 40
        };
      }
    }
  }
  if (geometry2 === "hvac") {
    if (["no", "nos", "nr", "item", "each", "ea", "unit", "set"].includes(
      unit
    ) && roomCount > 0) {
      if (/(split|ac unit|air conditioning unit|indoor unit|fan coil)/.test(
        description
      )) {
        return {
          quantity: Math.max(
            1,
            Math.round(
              roomCount * 0.55
            )
          ),
          source: "room_count_hvac_allowance",
          confidence: 35
        };
      }
    }
    if (["m", "lm", "linear.m", "lin.m"].includes(
      unit
    ) && roomCount > 0) {
      return {
        quantity: roomCount * 3.5,
        source: "room_count_duct_allowance",
        confidence: 30
      };
    }
  }
  if (geometry2 === "fire") {
    if (["no", "nos", "nr", "item", "each", "ea", "unit"].includes(
      unit
    )) {
      if (/(smoke detector|heat detector|detector)/.test(
        description
      ) && roomCount > 0) {
        return {
          quantity: Math.max(
            1,
            roomCount
          ),
          source: "room_count_fire_detector_allowance",
          confidence: 35
        };
      }
      if (/(extinguisher)/.test(
        description
      )) {
        return {
          quantity: Math.max(
            2,
            Math.ceil(
              roomCount / 6
            )
          ),
          source: "room_count_fire_extinguisher_allowance",
          confidence: 35
        };
      }
    }
  }
  if (geometry2 === "external") {
    if (["m2", "sqm", "sq.m"].includes(
      unit
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.35,
        source: "floor_area_external_works_allowance",
        confidence: 30
      };
    }
    if (["m", "lm", "linear.m", "lin.m"].includes(
      unit
    ) && wallLength > 0) {
      return {
        quantity: wallLength * 0.4,
        source: "wall_length_external_works_allowance",
        confidence: 30
      };
    }
  }
  if (geometry2 === "handover" || geometry2 === "commissioning") {
    if (["item", "ls", "l.s", "sum"].includes(
      unit
    )) {
      return {
        quantity: 1,
        source: "project_allowance",
        confidence: 55
      };
    }
  }
  return {
    quantity: 0,
    source: "unavailable",
    confidence: 0
  };
}
function estimateRemainingPendingQuantity(rule, priceItem, takeoff) {
  const code = String(
    rule?.item_code || ""
  ).trim().toUpperCase();
  const geometry2 = String(
    rule?.geometry_type || ""
  ).toLowerCase();
  const description = String(
    priceItem?.description || ""
  ).toLowerCase();
  const unit = String(
    priceItem?.unit || ""
  ).trim().toLowerCase().replace(/²/g, "2").replace(/³/g, "3").replace(/\s+/g, "");
  const floorArea = Number(takeoff?.floor_area) || 0;
  const ceilingArea = Number(takeoff?.ceiling_area) || floorArea;
  const wallLength = Number(takeoff?.wall_length) || 0;
  const wallArea = Number(takeoff?.wall_area) || 0;
  const slabVolume = Number(takeoff?.slab_volume) || 0;
  const columnVolume = Number(takeoff?.column_volume) || 0;
  const beamVolume = Number(takeoff?.beam_volume) || 0;
  const foundationVolume = Number(takeoff?.foundation_volume) || 0;
  const columnFormworkArea = Number(takeoff?.column_formwork_area) || 0;
  const beamFormworkArea = Number(takeoff?.beam_formwork_area) || 0;
  const foundationFormworkArea = Number(takeoff?.foundation_formwork_area) || 0;
  const slabFormworkArea = Number(takeoff?.slab_formwork_area) || 0;
  const structuralStatus = takeoff?.structural_measurement_status || {};
  const roomCount = Number(takeoff?.rooms) || 0;
  const doors = Number(takeoff?.doors) || 0;
  const windows = Number(takeoff?.windows) || 0;
  const bathrooms = Number(
    takeoff?.classifications?.room_types?.bathroom
  ) || 3;
  const kitchens = Number(
    takeoff?.classifications?.room_types?.kitchen
  ) || 1;
  const laundries = Number(
    takeoff?.classifications?.room_types?.laundry
  ) || 1;
  const wetRooms = Math.max(
    1,
    bathrooms + kitchens + laundries
  );
  const isCountUnit = [
    "no",
    "nos",
    "nr",
    "item",
    "each",
    "ea",
    "unit",
    "set",
    "point",
    "ls",
    "l.s",
    "sum"
  ].includes(unit);
  const isAreaUnit = [
    "m2",
    "sqm",
    "sq.m"
  ].includes(unit);
  const isLengthUnit = [
    "m",
    "lm",
    "lin.m",
    "linear.m",
    "linearm"
  ].includes(unit);
  const isVolumeUnit = [
    "m3",
    "cum",
    "cu.m"
  ].includes(unit);
  const saysConcrete = /\b(concrete|r\.?c\.?c\.?|reinforced\s+concrete)\b/i.test(
    description
  );
  const saysColumn = /\b(column|columns|column\s+concrete|rcc\s+column)\b/i.test(
    description
  );
  const saysBeam = /\b(beam|beams|beam\s+concrete|rcc\s+beam)\b/i.test(
    description
  );
  const saysSlab = /\b(slab|slabs|slab\s+concrete|rcc\s+slab)\b/i.test(
    description
  );
  const saysFoundation = /\b(foundation|footing|footings|raft|pile\s*cap|foundation\s+concrete)\b/i.test(
    description
  );
  const saysFormwork = /\b(formwork|shuttering|form\s*work)\b/i.test(
    description
  );
  if (geometry2 === "general" && isVolumeUnit && saysConcrete && saysColumn && columnVolume > 0 && structuralStatus?.columns?.volumeMeasured === true) {
    return {
      quantity: columnVolume,
      source: "aps_measured_column_volume_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "column"
    };
  }
  if (geometry2 === "general" && isAreaUnit && saysColumn && saysFormwork && columnFormworkArea > 0 && structuralStatus?.columns?.formworkComplete === true) {
    return {
      quantity: columnFormworkArea,
      source: "aps_measured_column_formwork_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "column"
    };
  }
  if (geometry2 === "general" && isVolumeUnit && saysConcrete && saysBeam && beamVolume > 0 && structuralStatus?.beams?.volumeMeasured === true) {
    return {
      quantity: beamVolume,
      source: "aps_measured_beam_volume_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "beam"
    };
  }
  if (geometry2 === "general" && isVolumeUnit && saysConcrete && saysSlab && slabVolume > 0 && structuralStatus?.slabs?.volumeMeasured === true) {
    return {
      quantity: slabVolume,
      source: "aps_measured_slab_volume_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "slab"
    };
  }
  if (geometry2 === "general" && isVolumeUnit && saysConcrete && saysFoundation && foundationVolume > 0 && structuralStatus?.foundations?.volumeMeasured === true) {
    return {
      quantity: foundationVolume,
      source: "aps_measured_foundation_volume_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "foundation"
    };
  }
  if (geometry2 === "foundation") {
    if (isVolumeUnit && foundationVolume > 0 && structuralStatus?.foundations?.volumeMeasured === true) {
      return {
        quantity: foundationVolume,
        source: "aps_measured_foundation_volume",
        confidence: 95,
        measured: true
      };
    }
    if (isAreaUnit && foundationFormworkArea > 0 && structuralStatus?.foundations?.formworkComplete === true) {
      return {
        quantity: foundationFormworkArea,
        source: "aps_measured_foundation_formwork",
        confidence: 95,
        measured: true
      };
    }
  }
  if (geometry2 === "column") {
    if (isVolumeUnit && columnVolume > 0 && structuralStatus?.columns?.volumeMeasured === true) {
      return {
        quantity: columnVolume,
        source: "aps_measured_column_volume",
        confidence: 95,
        measured: true
      };
    }
    if (isAreaUnit && columnFormworkArea > 0 && structuralStatus?.columns?.formworkComplete === true) {
      return {
        quantity: columnFormworkArea,
        source: "aps_measured_column_formwork",
        confidence: 95,
        measured: true
      };
    }
  }
  if (geometry2 === "beam") {
    if (isVolumeUnit && beamVolume > 0 && structuralStatus?.beams?.volumeMeasured === true) {
      return {
        quantity: beamVolume,
        source: "aps_measured_beam_volume",
        confidence: 95,
        measured: true
      };
    }
    if (isAreaUnit && beamFormworkArea > 0 && structuralStatus?.beams?.formworkComplete === true) {
      return {
        quantity: beamFormworkArea,
        source: "aps_measured_beam_formwork",
        confidence: 95,
        measured: true
      };
    }
  }
  if (geometry2 === "slab") {
    if (isVolumeUnit && slabVolume > 0 && structuralStatus?.slabs?.volumeMeasured === true) {
      return {
        quantity: slabVolume,
        source: "aps_measured_slab_volume",
        confidence: 95,
        measured: true
      };
    }
    if (isAreaUnit && slabFormworkArea > 0 && structuralStatus?.slabs?.formworkComplete === true) {
      return {
        quantity: slabFormworkArea,
        source: "aps_measured_slab_formwork",
        confidence: 95,
        measured: true
      };
    }
  }
  const exact = {
    "MAS-004": () => ({
      quantity: isAreaUnit ? Math.max(
        floorArea * 0.12,
        1
      ) : isCountUnit ? 1 : Math.max(
        wallLength * 0.12,
        1
      ),
      source: "masonry_misc_allowance",
      confidence: 28
    }),
    "HVC-001": () => ({
      quantity: isCountUnit ? Math.max(
        1,
        Math.ceil(
          roomCount * 0.5
        )
      ) : isLengthUnit ? Math.max(
        roomCount * 3.5,
        1
      ) : isAreaUnit ? Math.max(
        floorArea * 0.2,
        1
      ) : 1,
      source: "hvac_room_count_allowance",
      confidence: 32
    }),
    "HVC-002": () => ({
      quantity: isCountUnit ? Math.max(
        1,
        Math.ceil(
          roomCount * 0.5
        )
      ) : isLengthUnit ? Math.max(
        roomCount * 3,
        1
      ) : isAreaUnit ? Math.max(
        wallArea * 0.08,
        1
      ) : 1,
      source: "hvac_distribution_allowance",
      confidence: 30
    }),
    "HVC-003": () => ({
      quantity: isCountUnit ? Math.max(
        1,
        Math.ceil(
          roomCount * 0.35
        )
      ) : isLengthUnit ? Math.max(
        roomCount * 2.5,
        1
      ) : 1,
      source: "hvac_accessory_allowance",
      confidence: 28
    }),
    "HVC-004": () => ({
      quantity: isAreaUnit ? Math.max(
        ceilingArea * 0.25,
        1
      ) : isCountUnit ? Math.max(
        1,
        Math.ceil(
          roomCount * 0.25
        )
      ) : 1,
      source: "hvac_ceiling_scope_allowance",
      confidence: 28
    }),
    "WAT-001": () => ({
      quantity: isAreaUnit ? Math.max(
        floorArea,
        1
      ) : isLengthUnit ? Math.max(
        wallLength,
        1
      ) : 1,
      source: "roof_waterproofing_floor_area_allowance",
      confidence: 35
    }),
    "WAT-002": () => ({
      quantity: isAreaUnit ? Math.max(
        floorArea * 0.18,
        1
      ) : isLengthUnit ? Math.max(
        wetRooms * 6,
        1
      ) : 1,
      source: "wet_area_waterproofing_allowance",
      confidence: 35
    }),
    "PLB-001": () => ({
      quantity: isCountUnit ? bathrooms : isLengthUnit ? wetRooms * 8 : 1,
      source: "bathroom_plumbing_allowance",
      confidence: 48
    }),
    "PLB-002": () => ({
      quantity: isCountUnit ? bathrooms : isLengthUnit ? wetRooms * 7 : 1,
      source: "bathroom_plumbing_allowance",
      confidence: 48
    }),
    "PLB-003": () => ({
      quantity: isCountUnit ? Math.max(
        kitchens,
        1
      ) : isLengthUnit ? wetRooms * 6 : 1,
      source: "kitchen_plumbing_allowance",
      confidence: 48
    }),
    "PLB-004": () => ({
      quantity: isCountUnit ? wetRooms : isLengthUnit ? wetRooms * 8 : 1,
      source: "wet_room_drainage_allowance",
      confidence: 45
    }),
    "PLB-005": () => ({
      quantity: isCountUnit ? bathrooms : isLengthUnit ? wetRooms * 5 : 1,
      source: "bathroom_fixture_allowance",
      confidence: 50
    }),
    "PLB-006": () => ({
      quantity: isCountUnit ? bathrooms : isLengthUnit ? wetRooms * 5 : 1,
      source: "bathroom_fixture_allowance",
      confidence: 50
    }),
    "FIR-002": () => ({
      quantity: isCountUnit ? Math.max(
        1,
        roomCount
      ) : isLengthUnit ? Math.max(
        roomCount * 2,
        1
      ) : 1,
      source: "fire_detection_room_allowance",
      confidence: 30
    }),
    "FIR-003": () => ({
      quantity: isCountUnit ? Math.max(
        1,
        Math.ceil(
          roomCount / 4
        )
      ) : isLengthUnit ? Math.max(
        roomCount * 2,
        1
      ) : 1,
      source: "fire_system_allowance",
      confidence: 28
    }),
    "LAN-001": () => ({
      quantity: isAreaUnit ? Math.max(
        floorArea * 0.25,
        1
      ) : isVolumeUnit ? Math.max(
        floorArea * 0.08,
        1
      ) : isCountUnit ? 1 : Math.max(
        wallLength * 0.2,
        1
      ),
      source: "landscape_area_allowance",
      confidence: 25
    }),
    "LAN-002": () => ({
      quantity: isAreaUnit ? Math.max(
        floorArea * 0.18,
        1
      ) : isCountUnit ? 1 : Math.max(
        wallLength * 0.15,
        1
      ),
      source: "landscape_hardscape_allowance",
      confidence: 25
    }),
    "LAN-003": () => ({
      quantity: isCountUnit ? Math.max(
        1,
        Math.ceil(
          floorArea / 60
        )
      ) : isAreaUnit ? Math.max(
        floorArea * 0.12,
        1
      ) : Math.max(
        wallLength * 0.1,
        1
      ),
      source: "landscape_misc_allowance",
      confidence: 22
    })
  };
  if (exact[code]) {
    return exact[code]();
  }
  if (isCountUnit) {
    if (/(door|window)/.test(
      description
    )) {
      return {
        quantity: /(door)/.test(description) ? Math.max(doors, 1) : Math.max(windows, 1),
        source: "opening_count_final_allowance",
        confidence: 25
      };
    }
    return {
      quantity: 1,
      source: "single_item_final_allowance",
      confidence: 18
    };
  }
  if (isAreaUnit) {
    if (geometry2 === "roof") {
      return {
        quantity: Math.max(
          floorArea,
          1
        ),
        source: "floor_area_final_allowance",
        confidence: 22
      };
    }
    if (geometry2 === "ceiling") {
      return {
        quantity: Math.max(
          ceilingArea,
          1
        ),
        source: "ceiling_area_final_allowance",
        confidence: 25
      };
    }
    if (geometry2 === "wall") {
      return {
        quantity: Math.max(
          wallArea * 0.1,
          1
        ),
        source: "wall_area_final_allowance",
        confidence: 18
      };
    }
    return {
      quantity: Math.max(
        floorArea * 0.25,
        1
      ),
      source: "floor_area_fraction_final_allowance",
      confidence: 18
    };
  }
  if (isLengthUnit) {
    return {
      quantity: Math.max(
        wallLength * 0.25,
        1
      ),
      source: "wall_length_final_allowance",
      confidence: 18
    };
  }
  if (isVolumeUnit) {
    return {
      quantity: Math.max(
        floorArea * 0.08,
        1
      ),
      source: "floor_area_volume_final_allowance",
      confidence: 18
    };
  }
  return {
    quantity: 1,
    source: "unknown_unit_single_allowance",
    confidence: 12
  };
}
function normalizeSpatialPoints(items) {
  const valid = (Array.isArray(items) ? items : []).filter(
    (item) => {
      const x = item?.centroid?.x;
      const y = item?.centroid?.y;
      return x !== null && x !== void 0 && x !== "" && y !== null && y !== void 0 && y !== "" && Number.isFinite(
        Number(x)
      ) && Number.isFinite(
        Number(y)
      );
    }
  );
  if (!valid.length) {
    return [];
  }
  const xs = valid.map(
    (item) => Number(item.centroid.x)
  );
  const ys = valid.map(
    (item) => Number(item.centroid.y)
  );
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(
    maxX - minX,
    1e-9
  );
  const height = Math.max(
    maxY - minY,
    1e-9
  );
  return valid.map(
    (item) => ({
      item,
      x: (Number(item.centroid.x) - minX) / width,
      y: (Number(item.centroid.y) - minY) / height
    })
  );
}
function collectElectricalObjectEvidence(item) {
  const values = [];
  const pushValue = (value) => {
    if (typeof value === "string" && value.trim()) {
      values.push(
        value.trim()
      );
    }
  };
  const visit = (value, depth = 0) => {
    if (depth > 3 || value == null) {
      return;
    }
    if (typeof value === "string") {
      pushValue(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 80)) {
        visit(
          child,
          depth + 1
        );
      }
      return;
    }
    if (typeof value === "object") {
      for (const [
        key2,
        child
      ] of Object.entries(
        value
      ).slice(0, 120)) {
        if ([
          "centroid",
          "boundingBox",
          "bbox"
        ].includes(key2)) {
          continue;
        }
        pushValue(key2);
        visit(
          child,
          depth + 1
        );
      }
    }
  };
  for (const key2 of [
    "name",
    "displayName",
    "objectName",
    "category",
    "family",
    "familyName",
    "type",
    "typeName",
    "layer",
    "layerName",
    "classification",
    "description",
    "symbol",
    "blockName",
    "properties",
    "rawProperties"
  ]) {
    visit(
      item?.[key2],
      0
    );
  }
  return values.join(" ").toLowerCase().replace(
    /[_/\\|:;,-]+/g,
    " "
  ).replace(
    /\s+/g,
    " "
  ).trim();
}
function classifyElectricalSubtypeFromAps(item) {
  const existing = String(
    item?.electricalSubtype || ""
  ).toLowerCase().trim();
  if ([
    "lighting",
    "socket",
    "switch",
    "distribution_board"
  ].includes(existing)) {
    return existing;
  }
  const text = collectElectricalObjectEvidence(
    item
  );
  if (!text) {
    return "other";
  }
  const hasAny = (patterns) => patterns.some(
    (pattern) => pattern.test(text)
  );
  if (hasAny([
    /\bdistribution\s*board\b/i,
    /\bpanel\s*board\b/i,
    /\bpanelboard\b/i,
    /\bswitch\s*board\b/i,
    /\bconsumer\s*unit\b/i,
    /\bmain\s*distribution\b/i,
    /\bsub\s*main\s*distribution\b/i,
    /\bmdb\b/i,
    /\bsmdb\b/i,
    /\bdb\s*\d*\b/i
  ])) {
    return "distribution_board";
  }
  if (hasAny([
    /\bsocket\b/i,
    /\breceptacle\b/i,
    /\bpower\s*outlet\b/i,
    /\boutlet\s*point\b/i,
    /\bpower\s*point\b/i,
    /\bgpo\b/i,
    /\b13a\b/i,
    /\b15a\b/i,
    /\b20a\b/i,
    /\be[\s-]*powr\b/i,
    /\be[\s-]*power\b/i
  ])) {
    return "socket";
  }
  if (hasAny([
    /\blight\s*switch\b/i,
    /\bswitch\s*point\b/i,
    /\bdimmer\b/i,
    /\bpush\s*button\b/i,
    /\b\d+\s*gang\s*switch\b/i,
    /\b1g\s*switch\b/i,
    /\b2g\s*switch\b/i,
    /\b3g\s*switch\b/i,
    /\be[\s-]*swch\b/i,
    /\be[\s-]*switch\b/i
  ])) {
    return "switch";
  }
  if (hasAny([
    /\blighting\b/i,
    /\bluminaire\b/i,
    /\bdown\s*light\b/i,
    /\bdownlight\b/i,
    /\bspot\s*light\b/i,
    /\bspotlight\b/i,
    /\bceiling\s*light\b/i,
    /\bwall\s*light\b/i,
    /\bpendant\s*light\b/i,
    /\bchandelier\b/i,
    /\bsconce\b/i,
    /\blamp\b/i,
    /\blight\s*fitting\b/i,
    /\blight\s*fixture\b/i,
    /\be[\s-]*lite\b/i,
    /\be[\s-]*light\b/i
  ])) {
    return "lighting";
  }
  return "other";
}
function summarizeElectricalSubtypes(electrical) {
  const counts = {
    lighting: 0,
    socket: 0,
    switch: 0,
    distribution_board: 0,
    other: 0
  };
  for (const item of electrical || []) {
    const subtype = classifyElectricalSubtypeFromAps(
      item
    );
    if (Object.prototype.hasOwnProperty.call(
      counts,
      subtype
    )) {
      counts[subtype] += 1;
    } else {
      counts.other += 1;
    }
  }
  return counts;
}
function buildWorldRoomLocalMepCounts(takeoff, semanticRooms) {
  const mep = Array.isArray(
    takeoff?.object_details?.mep
  ) ? takeoff.object_details.mep : [];
  const electrical = mep.filter(
    (item) => item?.detectedType === "electrical" && Number.isFinite(
      Number(
        item?.centroid?.x
      )
    ) && Number.isFinite(
      Number(
        item?.centroid?.y
      )
    )
  );
  const rooms = (Array.isArray(
    semanticRooms
  ) ? semanticRooms : []).filter(
    (room) => Number.isFinite(
      Number(
        room?.apsWorldCentroid?.x
      )
    ) && Number.isFinite(
      Number(
        room?.apsWorldCentroid?.y
      )
    )
  );
  const base = {
    valid: false,
    mapper: "aps_world_to_aps_world",
    worldRoomCount: rooms.length,
    totalCount: electrical.length,
    electricalSubtypeCounts: summarizeElectricalSubtypes(
      electrical
    ),
    byRoomType: {},
    assignedCount: 0
  };
  if (electrical.length === 0 || rooms.length === 0) {
    return {
      ...base,
      reason: rooms.length === 0 ? "aps_world_room_centroids_unavailable" : "aps_world_electrical_centroids_unavailable"
    };
  }
  const xs = [
    ...electrical.map(
      (item) => Number(
        item.centroid.x
      )
    ),
    ...rooms.map(
      (room) => Number(
        room.apsWorldCentroid.x
      )
    )
  ];
  const ys = [
    ...electrical.map(
      (item) => Number(
        item.centroid.y
      )
    ),
    ...rooms.map(
      (room) => Number(
        room.apsWorldCentroid.y
      )
    )
  ];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(
    maxX - minX,
    1e-9
  );
  const height = Math.max(
    maxY - minY,
    1e-9
  );
  const normalizedRooms = rooms.map(
    (room) => ({
      room,
      x: (Number(
        room.apsWorldCentroid.x
      ) - minX) / width,
      y: (Number(
        room.apsWorldCentroid.y
      ) - minY) / height
    })
  );
  const rawAssignments = electrical.map(
    (item) => {
      const point2 = {
        x: (Number(
          item.centroid.x
        ) - minX) / width,
        y: (Number(
          item.centroid.y
        ) - minY) / height
      };
      const ranked = normalizedRooms.map(
        (candidate) => ({
          ...candidate,
          distance: Math.hypot(
            point2.x - candidate.x,
            point2.y - candidate.y
          )
        })
      ).sort(
        (a, b) => a.distance - b.distance
      );
      const nearest = ranked[0] || null;
      const second = ranked[1] || null;
      return {
        item,
        room: nearest?.room || null,
        distance: nearest?.distance ?? Infinity,
        separation: nearest && second ? second.distance - nearest.distance : 1
      };
    }
  );
  const finiteDistances = rawAssignments.map(
    (entry) => entry.distance
  ).filter(
    Number.isFinite
  ).sort(
    (a, b) => a - b
  );
  const medianDistance = finiteDistances.length ? finiteDistances[Math.floor(
    finiteDistances.length / 2
  )] : Infinity;
  const adaptiveLimit = Number.isFinite(
    medianDistance
  ) ? Math.max(
    0.04,
    Math.min(
      0.18,
      medianDistance * 3
    )
  ) : 0.1;
  const accepted = rawAssignments.filter(
    (entry) => entry.room && entry.distance <= adaptiveLimit
  );
  const coverage = electrical.length ? accepted.length / electrical.length : 0;
  if (coverage < 0.6) {
    return {
      ...base,
      reason: "aps_world_room_assignment_low_coverage",
      assignedCount: accepted.length,
      coverage: Number(
        coverage.toFixed(4)
      ),
      medianDistance: Number.isFinite(
        medianDistance
      ) ? Number(
        medianDistance.toFixed(
          4
        )
      ) : null,
      adaptiveLimit: Number(
        adaptiveLimit.toFixed(
          4
        )
      )
    };
  }
  const byRoomType = {};
  for (const assignment of accepted) {
    const roomType = String(
      assignment.room?.type || assignment.room?.roomType || "room"
    );
    if (!byRoomType[roomType]) {
      byRoomType[roomType] = {
        electrical_items: 0,
        lighting_points: 0,
        socket_points: 0,
        switches: 0,
        distribution_boards: 0,
        other_electrical: 0
      };
    }
    const bucket = byRoomType[roomType];
    bucket.electrical_items += 1;
    const subtype = classifyElectricalSubtypeFromAps(
      assignment.item
    );
    if (subtype === "lighting") {
      bucket.lighting_points += 1;
    } else if (subtype === "socket") {
      bucket.socket_points += 1;
    } else if (subtype === "switch") {
      bucket.switches += 1;
    } else if (subtype === "distribution_board") {
      bucket.distribution_boards += 1;
    } else {
      bucket.other_electrical += 1;
    }
  }
  return {
    valid: true,
    mapper: "aps_world_to_aps_world",
    reason: "aps_world_electrical_to_matched_aps_room",
    byRoomType,
    assignedCount: accepted.length,
    totalCount: electrical.length,
    worldRoomCount: rooms.length,
    coverage: Number(
      coverage.toFixed(4)
    ),
    medianDistance: Number(
      medianDistance.toFixed(
        4
      )
    ),
    adaptiveLimit: Number(
      adaptiveLimit.toFixed(
        4
      )
    )
  };
}
function normalizeRoomRegions(semanticRooms) {
  const rooms = (Array.isArray(
    semanticRooms
  ) ? semanticRooms : []).filter(
    (room) => room?.regionBBox && Number.isFinite(
      Number(
        room.regionBBox.x
      )
    ) && Number.isFinite(
      Number(
        room.regionBBox.y
      )
    ) && Number.isFinite(
      Number(
        room.regionBBox.width
      )
    ) && Number.isFinite(
      Number(
        room.regionBBox.height
      )
    ) && Number(
      room.regionBBox.width
    ) > 0 && Number(
      room.regionBBox.height
    ) > 0
  );
  if (!rooms.length) {
    return [];
  }
  const rawBoxes = rooms.map(
    (room) => ({
      room,
      x: Number(
        room.regionBBox.x
      ),
      y: Number(
        room.regionBBox.y
      ),
      width: Number(
        room.regionBBox.width
      ),
      height: Number(
        room.regionBBox.height
      )
    })
  );
  const alreadyNormalized = rawBoxes.every(
    (box) => box.x >= -0.05 && box.y >= -0.05 && box.x + box.width <= 1.05 && box.y + box.height <= 1.05
  );
  if (alreadyNormalized) {
    return rawBoxes.map(
      (box) => ({
        ...box.room,
        regionBBox: {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height
        },
        centroid: {
          ...box.room.centroid,
          x: Number.isFinite(
            Number(
              box.room?.centroid?.x
            )
          ) ? Number(
            box.room.centroid.x
          ) : box.x + box.width / 2,
          y: Number.isFinite(
            Number(
              box.room?.centroid?.y
            )
          ) ? Number(
            box.room.centroid.y
          ) : box.y + box.height / 2
        }
      })
    );
  }
  const minX = Math.min(
    ...rawBoxes.map(
      (box) => box.x
    )
  );
  const minY = Math.min(
    ...rawBoxes.map(
      (box) => box.y
    )
  );
  const maxX = Math.max(
    ...rawBoxes.map(
      (box) => box.x + box.width
    )
  );
  const maxY = Math.max(
    ...rawBoxes.map(
      (box) => box.y + box.height
    )
  );
  const width = Math.max(
    maxX - minX,
    1e-9
  );
  const height = Math.max(
    maxY - minY,
    1e-9
  );
  return rawBoxes.map(
    (box) => {
      const x = (box.x - minX) / width;
      const y = (box.y - minY) / height;
      const w = box.width / width;
      const h = box.height / height;
      return {
        ...box.room,
        regionBBox: {
          x,
          y,
          width: w,
          height: h
        },
        centroid: {
          ...box.room.centroid,
          x: x + w / 2,
          y: y + h / 2
        }
      };
    }
  );
}
function buildRoomCentroidElectricalCounts(takeoff, semanticRooms) {
  const mep = Array.isArray(
    takeoff?.object_details?.mep
  ) ? takeoff.object_details.mep : [];
  const electrical = mep.filter(
    (item) => item?.detectedType === "electrical" && Number.isFinite(
      Number(
        item?.centroid?.x
      )
    ) && Number.isFinite(
      Number(
        item?.centroid?.y
      )
    )
  );
  const rooms = (Array.isArray(
    semanticRooms
  ) ? semanticRooms : []).filter(
    (room) => {
      const x = room?.centroid?.x;
      const y = room?.centroid?.y;
      return x !== null && x !== void 0 && y !== null && y !== void 0 && Number.isFinite(
        Number(x)
      ) && Number.isFinite(
        Number(y)
      );
    }
  );
  const base = {
    valid: false,
    mapper: "aps_world_normalized_to_room_centroid_v11",
    roomCount: rooms.length,
    totalCount: electrical.length,
    electricalSubtypeCounts: summarizeElectricalSubtypes(
      electrical
    ),
    byRoomType: {},
    assignedCount: 0
  };
  if (electrical.length === 0 || rooms.length < 4) {
    return {
      ...base,
      reason: electrical.length === 0 ? "electrical_centroids_unavailable" : "semantic_room_centroids_insufficient"
    };
  }
  const normalizedElectrical = normalizeSpatialPoints(
    electrical
  );
  const roomXs = rooms.map(
    (room) => Number(
      room.centroid.x
    )
  );
  const roomYs = rooms.map(
    (room) => Number(
      room.centroid.y
    )
  );
  const minRoomX = Math.min(...roomXs);
  const maxRoomX = Math.max(...roomXs);
  const minRoomY = Math.min(...roomYs);
  const maxRoomY = Math.max(...roomYs);
  const roomWidth = Math.max(
    maxRoomX - minRoomX,
    1e-9
  );
  const roomHeight = Math.max(
    maxRoomY - minRoomY,
    1e-9
  );
  const roomCentroids = rooms.map(
    (room) => ({
      room,
      x: (Number(
        room.centroid.x
      ) - minRoomX) / roomWidth,
      y: (Number(
        room.centroid.y
      ) - minRoomY) / roomHeight
    })
  );
  const transforms = [
    (point2) => ({
      x: point2.x,
      y: point2.y
    }),
    (point2) => ({
      x: point2.x,
      y: 1 - point2.y
    }),
    (point2) => ({
      x: 1 - point2.x,
      y: point2.y
    }),
    (point2) => ({
      x: 1 - point2.x,
      y: 1 - point2.y
    }),
    (point2) => ({
      x: point2.y,
      y: point2.x
    }),
    (point2) => ({
      x: point2.y,
      y: 1 - point2.x
    }),
    (point2) => ({
      x: 1 - point2.y,
      y: point2.x
    }),
    (point2) => ({
      x: 1 - point2.y,
      y: 1 - point2.x
    })
  ];
  const solutions = transforms.map(
    (transform, transformIndex) => {
      const assignments = normalizedElectrical.map(
        (entry) => {
          const point2 = transform(entry);
          const ranked = roomCentroids.map(
            (candidate) => ({
              ...candidate,
              distance: Math.hypot(
                point2.x - candidate.x,
                point2.y - candidate.y
              )
            })
          ).sort(
            (a, b) => a.distance - b.distance
          );
          const nearest = ranked[0] || null;
          const second = ranked[1] || null;
          if (!nearest) {
            return {
              entry,
              room: null,
              distance: Infinity,
              margin: 0
            };
          }
          return {
            entry,
            room: nearest.room,
            distance: nearest.distance,
            margin: second ? second.distance - nearest.distance : 1
          };
        }
      );
      const distances = assignments.map(
        (item) => item.distance
      ).filter(
        Number.isFinite
      ).sort(
        (a, b) => a - b
      );
      const medianDistance = distances.length ? distances[Math.floor(
        distances.length / 2
      )] : Infinity;
      const p80Distance = distances.length ? distances[Math.min(
        distances.length - 1,
        Math.floor(
          distances.length * 0.8
        )
      )] : Infinity;
      const roomUseCounts = /* @__PURE__ */ new Map();
      for (const assignment of assignments) {
        const key2 = String(
          assignment.room?.name || assignment.room?.type || "room"
        );
        roomUseCounts.set(
          key2,
          (roomUseCounts.get(
            key2
          ) || 0) + 1
        );
      }
      const usedRooms = roomUseCounts.size;
      const maxRoomShare = electrical.length ? Math.max(
        ...roomUseCounts.values()
      ) / electrical.length : 1;
      const distinctRoomTypes = new Set(
        assignments.map(
          (assignment) => String(
            assignment.room?.type || assignment.room?.roomType || "room"
          )
        )
      ).size;
      const averageMargin = assignments.length ? assignments.reduce(
        (sum, item) => sum + Math.max(
          0,
          Number(
            item.margin
          ) || 0
        ),
        0
      ) / assignments.length : 0;
      const score = (Number.isFinite(
        medianDistance
      ) ? 1 - Math.min(
        medianDistance,
        1
      ) : 0) * 4 + (Number.isFinite(
        p80Distance
      ) ? 1 - Math.min(
        p80Distance,
        1
      ) : 0) * 2 + Math.min(
        usedRooms,
        10
      ) * 0.12 + Math.min(
        distinctRoomTypes,
        8
      ) * 0.08 + Math.min(
        averageMargin,
        0.25
      ) * 2 - Math.max(
        0,
        maxRoomShare - 0.35
      ) * 4;
      return {
        transformIndex,
        assignments,
        medianDistance,
        p80Distance,
        usedRooms,
        distinctRoomTypes,
        maxRoomShare,
        averageMargin,
        score
      };
    }
  );
  solutions.sort(
    (a, b) => b.score - a.score
  );
  const best = solutions[0];
  if (!best) {
    return {
      ...base,
      reason: "room_centroid_transform_unavailable"
    };
  }
  const adaptiveLimit = Math.max(
    0.07,
    Math.min(
      0.2,
      (Number.isFinite(
        best.medianDistance
      ) ? best.medianDistance : 0.1) * 2.25
    )
  );
  const accepted = best.assignments.filter(
    (assignment) => assignment.room && assignment.distance <= adaptiveLimit
  );
  const coverage = electrical.length ? accepted.length / electrical.length : 0;
  const acceptedRoomUse = /* @__PURE__ */ new Map();
  for (const assignment of accepted) {
    const key2 = String(
      assignment.room?.name || assignment.room?.type || "room"
    );
    acceptedRoomUse.set(
      key2,
      (acceptedRoomUse.get(
        key2
      ) || 0) + 1
    );
  }
  const acceptedMaxRoomShare = accepted.length ? Math.max(
    ...acceptedRoomUse.values()
  ) / accepted.length : 1;
  const reliable = coverage >= 0.7 && best.usedRooms >= 4 && best.distinctRoomTypes >= 3 && best.medianDistance <= 0.16 && best.p80Distance <= 0.27 && acceptedMaxRoomShare <= 0.42;
  if (!reliable) {
    return {
      ...base,
      reason: "room_centroid_spatial_match_low_confidence",
      assignedCount: accepted.length,
      coverage: Number(
        coverage.toFixed(
          4
        )
      ),
      medianDistance: Number.isFinite(
        best.medianDistance
      ) ? Number(
        best.medianDistance.toFixed(
          4
        )
      ) : null,
      p80Distance: Number.isFinite(
        best.p80Distance
      ) ? Number(
        best.p80Distance.toFixed(
          4
        )
      ) : null,
      adaptiveLimit: Number(
        adaptiveLimit.toFixed(
          4
        )
      ),
      usedRooms: best.usedRooms,
      distinctRoomTypes: best.distinctRoomTypes,
      maxRoomShare: Number(
        acceptedMaxRoomShare.toFixed(
          4
        )
      ),
      transformIndex: best.transformIndex
    };
  }
  const byRoomType = {};
  for (const assignment of accepted) {
    const roomType = String(
      assignment.room?.type || assignment.room?.roomType || "room"
    );
    if (!byRoomType[roomType]) {
      byRoomType[roomType] = {
        electrical_items: 0,
        lighting_points: 0,
        socket_points: 0,
        switches: 0,
        distribution_boards: 0,
        other_electrical: 0
      };
    }
    const bucket = byRoomType[roomType];
    bucket.electrical_items += 1;
    const subtype = classifyElectricalSubtypeFromAps(
      assignment.entry.item
    );
    if (subtype === "lighting") {
      bucket.lighting_points += 1;
    } else if (subtype === "socket") {
      bucket.socket_points += 1;
    } else if (subtype === "switch") {
      bucket.switches += 1;
    } else if (subtype === "distribution_board") {
      bucket.distribution_boards += 1;
    } else {
      bucket.other_electrical += 1;
    }
  }
  return {
    ...base,
    valid: true,
    reason: "aps_electrical_to_semantic_room_centroid_v11",
    byRoomType,
    assignedCount: accepted.length,
    totalCount: electrical.length,
    coverage: Number(
      coverage.toFixed(
        4
      )
    ),
    medianDistance: Number(
      best.medianDistance.toFixed(
        4
      )
    ),
    p80Distance: Number(
      best.p80Distance.toFixed(
        4
      )
    ),
    adaptiveLimit: Number(
      adaptiveLimit.toFixed(
        4
      )
    ),
    usedRooms: best.usedRooms,
    distinctRoomTypes: best.distinctRoomTypes,
    maxRoomShare: Number(
      acceptedMaxRoomShare.toFixed(
        4
      )
    ),
    transformIndex: best.transformIndex
  };
}
function buildRoomLocalMepCounts(takeoff, semanticRooms) {
  const mep = Array.isArray(
    takeoff?.object_details?.mep
  ) ? takeoff.object_details.mep : [];
  const electrical = mep.filter(
    (item) => item?.detectedType === "electrical" && Number.isFinite(
      Number(
        item?.centroid?.x
      )
    ) && Number.isFinite(
      Number(
        item?.centroid?.y
      )
    )
  );
  const rooms = normalizeRoomRegions(
    semanticRooms
  );
  const baseResult = {
    fixVersion: "2026-08-17-electrical-subtype-v9",
    mapper: "aps_world_normalized_to_ai_room_bbox",
    electricalObjects: mep.filter(
      (item) => item?.detectedType === "electrical"
    ).length,
    electricalObjectsWithCentroid: electrical.length,
    electricalSubtypeCounts: summarizeElectricalSubtypes(
      electrical
    ),
    semanticRooms: rooms.length
  };
  if (electrical.length === 0 || rooms.length === 0) {
    return {
      ...baseResult,
      valid: false,
      reason: electrical.length === 0 ? "aps_electrical_centroids_missing_reanalyze_required" : "semantic_room_regions_missing",
      byRoomType: {},
      assignedCount: 0,
      totalCount: electrical.length
    };
  }
  const normalizedElectrical = normalizeSpatialPoints(
    electrical
  );
  const transforms = [
    (point2) => ({
      x: point2.x,
      y: point2.y
    }),
    (point2) => ({
      x: point2.x,
      y: 1 - point2.y
    }),
    (point2) => ({
      x: 1 - point2.x,
      y: point2.y
    }),
    (point2) => ({
      x: 1 - point2.x,
      y: 1 - point2.y
    }),
    (point2) => ({
      x: point2.y,
      y: point2.x
    }),
    (point2) => ({
      x: point2.y,
      y: 1 - point2.x
    }),
    (point2) => ({
      x: 1 - point2.y,
      y: point2.x
    }),
    (point2) => ({
      x: 1 - point2.y,
      y: 1 - point2.x
    })
  ];
  const distanceToRegion = (point2, room) => {
    const box = room.regionBBox;
    const dx = point2.x < box.x ? box.x - point2.x : point2.x > box.x + box.width ? point2.x - (box.x + box.width) : 0;
    const dy = point2.y < box.y ? box.y - point2.y : point2.y > box.y + box.height ? point2.y - (box.y + box.height) : 0;
    return Math.hypot(
      dx,
      dy
    );
  };
  const roomCenterDistance = (point2, room) => Math.hypot(
    point2.x - (room.regionBBox.x + room.regionBBox.width / 2),
    point2.y - (room.regionBBox.y + room.regionBBox.height / 2)
  );
  const solutions = transforms.map(
    (transform, transformIndex) => {
      const assignments = normalizedElectrical.map(
        (entry) => {
          const point2 = transform(entry);
          const ranked = rooms.map(
            (room) => ({
              room,
              regionDistance: distanceToRegion(
                point2,
                room
              ),
              centerDistance: roomCenterDistance(
                point2,
                room
              )
            })
          ).sort(
            (a, b) => a.regionDistance - b.regionDistance || a.centerDistance - b.centerDistance
          );
          const best2 = ranked[0] || null;
          const second = ranked[1] || null;
          if (!best2) {
            return {
              entry,
              room: null,
              insideRegion: false,
              regionDistance: Infinity,
              separation: 0
            };
          }
          const insideRegion = best2.regionDistance === 0;
          const accepted = insideRegion || best2.regionDistance <= 0.055;
          const separation3 = second ? second.regionDistance - best2.regionDistance : 1;
          return {
            entry,
            room: accepted ? best2.room : null,
            insideRegion,
            regionDistance: best2.regionDistance,
            centerDistance: best2.centerDistance,
            separation: separation3
          };
        }
      );
      const assigned = assignments.filter(
        (item) => item.room
      );
      const inside3 = assigned.filter(
        (item) => item.insideRegion
      ).length;
      const coverage = electrical.length ? assigned.length / electrical.length : 0;
      const regionCoverage = electrical.length ? inside3 / electrical.length : 0;
      const averageRegionDistance = assigned.length ? assigned.reduce(
        (sum, item) => sum + item.regionDistance,
        0
      ) / assigned.length : Infinity;
      const roomTypesUsed = new Set(
        assigned.map(
          (item) => String(
            item.room?.type || item.room?.roomType || "room"
          )
        )
      ).size;
      return {
        transformIndex,
        assignments,
        coverage,
        regionCoverage,
        averageRegionDistance,
        roomTypesUsed,
        score: regionCoverage * 8 + coverage * 3 + Math.min(
          roomTypesUsed,
          8
        ) * 0.12 - Math.min(
          averageRegionDistance,
          1
        ) * 2
      };
    }
  );
  solutions.sort(
    (a, b) => b.score - a.score
  );
  const best = solutions[0];
  const reliable = Boolean(
    best && best.coverage >= 0.6 && best.regionCoverage >= 0.35 && best.roomTypesUsed >= 2
  );
  if (!reliable) {
    return {
      ...baseResult,
      valid: false,
      reason: "room_region_spatial_match_low_confidence",
      byRoomType: {},
      assignedCount: best ? best.assignments.filter(
        (item) => item.room
      ).length : 0,
      totalCount: electrical.length,
      coverage: Number(
        (best?.coverage || 0).toFixed(4)
      ),
      regionCoverage: Number(
        (best?.regionCoverage || 0).toFixed(4)
      ),
      averageRegionDistance: Number.isFinite(
        best?.averageRegionDistance
      ) ? Number(
        best.averageRegionDistance.toFixed(
          4
        )
      ) : null,
      roomTypesUsed: best?.roomTypesUsed || 0,
      transformIndex: best?.transformIndex ?? null
    };
  }
  const byRoomType = {};
  for (const assignment of best.assignments) {
    if (!assignment.room) {
      continue;
    }
    const roomType = String(
      assignment.room.type || assignment.room.roomType || "room"
    );
    if (!byRoomType[roomType]) {
      byRoomType[roomType] = {
        electrical_items: 0,
        lighting_points: 0,
        socket_points: 0,
        switches: 0,
        distribution_boards: 0,
        other_electrical: 0
      };
    }
    const bucket = byRoomType[roomType];
    bucket.electrical_items += 1;
    const subtype = classifyElectricalSubtypeFromAps(
      assignment.entry.item
    );
    if (subtype === "lighting") {
      bucket.lighting_points += 1;
    } else if (subtype === "socket") {
      bucket.socket_points += 1;
    } else if (subtype === "switch") {
      bucket.switches += 1;
    } else if (subtype === "distribution_board") {
      bucket.distribution_boards += 1;
    } else {
      bucket.other_electrical += 1;
    }
  }
  return {
    ...baseResult,
    valid: true,
    reason: "aps_electrical_centroid_to_verified_ai_room_bbox",
    byRoomType,
    assignedCount: best.assignments.filter(
      (item) => item.room
    ).length,
    totalCount: electrical.length,
    coverage: Number(
      best.coverage.toFixed(
        4
      )
    ),
    regionCoverage: Number(
      best.regionCoverage.toFixed(
        4
      )
    ),
    averageRegionDistance: Number(
      best.averageRegionDistance.toFixed(
        4
      )
    ),
    roomTypesUsed: best.roomTypesUsed,
    transformIndex: best.transformIndex
  };
}
function resolveRoomLocalElectricalQuantity(match, roomLocalMep) {
  if (!roomLocalMep?.valid) {
    return 0;
  }
  const roomType = String(
    match?.room_type || ""
  );
  const bucket = roomLocalMep.byRoomType[roomType];
  if (!bucket) {
    return 0;
  }
  const code = String(
    match?.item_code || ""
  ).toUpperCase();
  if (code === "ELE-001") {
    return bucket.lighting_points || 0;
  }
  if (code === "ELE-002") {
    return bucket.socket_points || 0;
  }
  if (code === "ELE-003") {
    return bucket.switches || 0;
  }
  if (code === "ELE-004") {
    return bucket.distribution_boards || 0;
  }
  if (code === "ELE-005") {
    return bucket.lighting_points || 0;
  }
  return bucket.electrical_items || 0;
}
function buildDeterministicRoomElectricalMatches(roomLocalMep, pricesByCode) {
  if (!roomLocalMep?.valid || !roomLocalMep?.byRoomType || !(pricesByCode instanceof Map)) {
    return [];
  }
  const matches = [];
  const definitions = [
    {
      itemCode: "ELE-001",
      bucketKey: "lighting_points",
      label: "APS measured room lighting points"
    },
    {
      itemCode: "ELE-002",
      bucketKey: "socket_points",
      label: "APS measured room socket points"
    },
    {
      itemCode: "ELE-003",
      bucketKey: "switches",
      label: "APS measured room switches"
    },
    {
      itemCode: "ELE-004",
      bucketKey: "distribution_boards",
      label: "APS measured room distribution boards"
    }
  ];
  for (const [
    roomType,
    bucket
  ] of Object.entries(
    roomLocalMep.byRoomType
  )) {
    for (const definition of definitions) {
      const quantity = Number(
        bucket?.[definition.bucketKey]
      ) || 0;
      if (quantity <= 0) {
        continue;
      }
      const code = normalizeCode(
        definition.itemCode
      );
      if (!pricesByCode.has(code)) {
        console.warn(
          "[VENTRA ROOM ELECTRICAL] catalog item missing",
          {
            item_code: definition.itemCode,
            room_type: roomType,
            measuredQuantity: quantity
          }
        );
        continue;
      }
      matches.push({
        item_code: definition.itemCode,
        quantity_basis: "electrical_items",
        room_type: roomType,
        reason: `${definition.label}; injected deterministically because Autodesk APS measured this subtype in the matched room.`,
        deterministicRoomElectrical: true
      });
    }
  }
  return matches;
}
async function handleCommercialRequest2(request) {
  try {
    const body = await request.json();
    const projectId = body?.projectId || null;
    const projectName = body?.projectName || "Untitled Project";
    const priceLevel = body?.priceLevel || "standard";
    const vatPercentage = Math.max(
      0,
      toNumber2(
        body?.vatPercentage ?? 5
      )
    );
    const rawTakeoff = body?.takeoff || {};
    const takeoff = normalizeTakeoff(
      rawTakeoff
    );
    const rawSemanticRooms = getSemanticRooms(rawTakeoff);
    const hydratedRoomResult = hydrateSemanticRoomQuantities(
      rawSemanticRooms,
      takeoff
    );
    const semanticRooms = hydratedRoomResult.rooms;
    const rawElectricalForSpatial = Array.isArray(
      rawTakeoff?.object_details?.mep
    ) ? rawTakeoff.object_details.mep.filter(
      (item) => item?.detectedType === "electrical"
    ) : [];
    const validElectricalForSpatial = rawElectricalForSpatial.filter(
      (item) => {
        const x = item?.centroid?.x;
        const y = item?.centroid?.y;
        return x !== null && x !== void 0 && x !== "" && y !== null && y !== void 0 && y !== "" && Number.isFinite(
          Number(x)
        ) && Number.isFinite(
          Number(y)
        );
      }
    );
    console.log(
      "[VENTRA ELECTRICAL SPATIAL INPUT v14]",
      {
        total: rawElectricalForSpatial.length,
        withValidCentroid: validElectricalForSpatial.length,
        distinctCentroids: new Set(
          validElectricalForSpatial.map(
            (item) => `${Number(
              item.centroid.x
            ).toFixed(6)}:${Number(
              item.centroid.y
            ).toFixed(6)}`
          )
        ).size,
        centroidSources: validElectricalForSpatial.reduce(
          (result, item) => {
            const source = item?.centroid?.source || "unknown";
            result[source] = (result[source] || 0) + 1;
            return result;
          },
          {}
        )
      }
    );
    const worldRoomLocalMep = buildWorldRoomLocalMepCounts(
      rawTakeoff,
      semanticRooms
    );
    const roomCentroidDiagnostic = buildRoomCentroidElectricalCounts(
      rawTakeoff,
      semanticRooms
    );
    const imageRoomLocalDiagnostic = buildRoomLocalMepCounts(
      rawTakeoff,
      semanticRooms
    );
    const roomLocalMep = worldRoomLocalMep.valid ? {
      ...worldRoomLocalMep,
      fixVersion: "2026-08-17-electrical-centroid-root-v14"
    } : roomCentroidDiagnostic.valid ? {
      ...roomCentroidDiagnostic,
      fixVersion: "2026-08-17-electrical-centroid-root-v14",
      mapper: "verified_room_centroid_fallback",
      worldDiagnostic: worldRoomLocalMep,
      roomRegionDiagnostic: imageRoomLocalDiagnostic
    } : imageRoomLocalDiagnostic.valid ? {
      ...imageRoomLocalDiagnostic,
      fixVersion: "2026-08-17-electrical-centroid-root-v14",
      mapper: "verified_ai_room_bbox_fallback",
      worldDiagnostic: worldRoomLocalMep,
      roomCentroidDiagnostic
    } : {
      valid: false,
      mapper: "room_local_unavailable",
      fixVersion: "2026-08-17-electrical-centroid-root-v14",
      reason: `${worldRoomLocalMep.reason}; ${roomCentroidDiagnostic.reason}; ${imageRoomLocalDiagnostic.reason}`,
      byRoomType: {},
      assignedCount: 0,
      totalCount: worldRoomLocalMep.totalCount || roomCentroidDiagnostic.totalCount || imageRoomLocalDiagnostic.totalCount || 0,
      worldRoomCount: worldRoomLocalMep.worldRoomCount || 0,
      coverage: roomCentroidDiagnostic.coverage ?? imageRoomLocalDiagnostic.coverage ?? worldRoomLocalMep.coverage ?? 0,
      worldDiagnostic: worldRoomLocalMep,
      roomCentroidDiagnostic,
      roomRegionDiagnostic: imageRoomLocalDiagnostic
    };
    console.log(
      "[VENTRA ROOM SPATIAL INPUT v12]",
      {
        semanticRoomCount: semanticRooms.length,
        roomsWithCentroid: semanticRooms.filter(
          (room) => {
            const x = room?.centroid?.x;
            const y = room?.centroid?.y;
            return x !== null && x !== void 0 && y !== null && y !== void 0 && Number.isFinite(
              Number(x)
            ) && Number.isFinite(
              Number(y)
            );
          }
        ).length,
        distinctRoomCentroids: new Set(
          semanticRooms.filter(
            (room) => room?.centroid && room.centroid.x !== null && room.centroid.x !== void 0 && room.centroid.y !== null && room.centroid.y !== void 0
          ).map(
            (room) => `${Number(
              room.centroid.x
            ).toFixed(6)}:${Number(
              room.centroid.y
            ).toFixed(6)}`
          )
        ).size,
        roomsWithRegionBBox: semanticRooms.filter(
          (room) => room?.regionBBox && Number(
            room.regionBBox.width
          ) > 0 && Number(
            room.regionBBox.height
          ) > 0
        ).length,
        plans: [...new Set(
          semanticRooms.map(
            (room) => room?.planId
          ).filter(Boolean)
        )],
        sample: semanticRooms.slice(0, 4).map(
          (room) => ({
            name: room?.name,
            type: room?.type,
            planId: room?.planId || null,
            centroid: room?.centroid || null,
            regionBBox: room?.regionBBox || null
          })
        )
      }
    );
    console.log(
      "[VENTRA ROOM LOCAL MEP]",
      roomLocalMep
    );
    console.log(
      "[VENTRA ELECTRICAL SUBTYPE CLASSIFIER]",
      {
        total: Array.isArray(
          rawTakeoff?.object_details?.mep
        ) ? rawTakeoff.object_details.mep.filter(
          (item) => item?.detectedType === "electrical"
        ).length : 0,
        counts: summarizeElectricalSubtypes(
          Array.isArray(
            rawTakeoff?.object_details?.mep
          ) ? rawTakeoff.object_details.mep.filter(
            (item) => item?.detectedType === "electrical"
          ) : []
        )
      }
    );
    console.log("[VENTRA AI BOQ SCOPE] input", {
      semanticRoomCount: semanticRooms.length,
      roomQuantityHydration: hydratedRoomResult.source,
      roomsWithArea: semanticRooms.filter(
        (room) => Number(room?.area) > 0
      ).length,
      roomAreaTotal: Number(
        semanticRooms.reduce(
          (sum, room) => sum + (Number(room?.area) || 0),
          0
        ).toFixed(2)
      ),
      rawRoomCount: toNumber2(rawTakeoff.rooms),
      hasObjectDetails: Boolean(rawTakeoff.object_details),
      objectRoomCount: Array.isArray(rawTakeoff?.object_details?.rooms) ? rawTakeoff.object_details.rooms.length : 0
    });
    console.log("========== TAKEOFF ==========");
    console.log(takeoff);
    console.log("=============================");
    const supabase = createServerSupabase();
    const [
      rulesResult,
      pricesResult,
      sectionsResult
    ] = await Promise.all([
      supabase.from("boq_rules").select("*").eq("is_active", true).order("priority", {
        ascending: true
      }),
      fetchAllActivePriceItems(
        supabase
      ),
      supabase.from("boq_sections").select(
        "section_code, section_name, sort_order"
      ).eq("is_active", true)
    ]);
    console.log("[BOQ DEBUG]", {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      rulesCount: rulesResult.data?.length || 0,
      pricesCount: pricesResult.data?.length || 0,
      sectionsCount: sectionsResult.data?.length || 0,
      rulesError: rulesResult.error?.message || null,
      pricesError: pricesResult.error?.message || null,
      sectionsError: sectionsResult.error?.message || null,
      takeoff
    });
    if (rulesResult.error) {
      throw rulesResult.error;
    }
    if (pricesResult.error) {
      throw pricesResult.error;
    }
    if (sectionsResult.error) {
      throw sectionsResult.error;
    }
    const rules = rulesResult.data || [];
    const prices = pricesResult.data || [];
    if (rules.length === 0 || prices.length === 0) {
      const fallbackBoq = buildLocalBoq({
        takeoff,
        projectName,
        vatPercentage
      });
      const fallbackDwg = applyDwgScheduleToBoq(fallbackBoq?.items || [], getDrawingEvidence(rawTakeoff) || {}, []);
      const fallbackItems = fallbackDwg.items.map(requireBoqReview);
      const fallbackSubtotal = fallbackItems.reduce((sum, item) => sum + (classifyEstimateItem(item) === "pending" ? 0 : Number(item.amount) || 0), 0);
      const fallbackVat = fallbackSubtotal * Number(vatPercentage || 0) / 100;
      if (fallbackItems.length === 0) {
        return NextResponse2.json(
          {
            success: false,
            error: "BOQ database is empty and the fallback builder found no measurable quantities.",
            debug: {
              rules: rules.length,
              prices: prices.length,
              wallArea: takeoff.wall_area,
              wallLength: takeoff.wall_length,
              floorArea: takeoff.floor_area,
              rooms: takeoff.rooms,
              doors: takeoff.doors,
              windows: takeoff.windows
            }
          },
          { status: 422 }
        );
      }
      return NextResponse2.json({
        success: true,
        boq: {
          ...fallbackBoq,
          items: fallbackItems,
          summary: { subtotal: fallbackSubtotal, vat: fallbackVat, grandTotal: fallbackSubtotal + fallbackVat },
          projectId,
          priceLevel,
          warnings: [
            `Ventra UAE BOQ database is not populated (rules: ${rules.length}, prices: ${prices.length}).`,
            "Starter allowance rates are being used. Review/edit rates before quotation or contract use.",
            ...fallbackDwg.warnings,
            ...Array.isArray(fallbackBoq.warnings) ? fallbackBoq.warnings : []
          ],
          assumptions: [
            ...Array.isArray(fallbackBoq.assumptions) ? fallbackBoq.assumptions : [],
            "This BOQ used Ventra's deterministic local fallback because the database rule/price tables were empty."
          ]
        }
      });
    }
    const pricesByCode = new Map(
      (pricesResult.data || []).map(
        (item) => [
          normalizeCode(item.item_code),
          item
        ]
      )
    );
    const sectionsByCode = new Map(
      (sectionsResult.data || []).map((section) => [
        section.section_code,
        section
      ])
    );
    const warnings = [];
    const items = [];
    const claimedMeasuredFamilies = /* @__PURE__ */ new Set();
    const ventraBoqMode = String(
      process.env.VENTRA_BOQ_MODE || "commercial_safe"
    ).trim().toLowerCase();
    const allowEstimatedQuantities = ventraBoqMode === "development_estimates";
    const allowProvisionalDerivation = ventraBoqMode === "commercial_safe" || allowEstimatedQuantities;
    console.log(
      "[VENTRA BOQ HARDENING v29]",
      {
        mode: ventraBoqMode,
        allowEstimatedQuantities,
        allowProvisionalDerivation,
        policy: allowEstimatedQuantities ? "development_estimates_enabled" : allowProvisionalDerivation ? "measured_plus_provisional_derived_scope" : "measured_only"
      }
    );
    for (const rule of rulesResult.data || []) {
      const priceItem = pricesByCode.get(
        normalizeCode(rule.item_code)
      );
      if (!priceItem) {
        warnings.push(
          `Missing price item: ${rule.item_code}`
        );
        continue;
      }
      if (shouldSuppressDatabaseAutoRule(
        rule,
        priceItem,
        claimedMeasuredFamilies
      )) {
        console.log(
          "[VENTRA RULE SAFETY] suppressed",
          {
            item: rule.item_code,
            description: priceItem.description,
            reason: "conflicting_or_location_specific_database_auto_rule"
          }
        );
        continue;
      }
      let quantity = calculateQuantity(
        rule,
        takeoff
      );
      let quantityEstimate = null;
      if (allowProvisionalDerivation && quantity <= 0 && String(
        rule.formula_type || ""
      ).toLowerCase() === "manual") {
        quantityEstimate = estimateRemainingPendingQuantity(
          rule,
          priceItem,
          takeoff
        );
        if (Number(
          quantityEstimate.quantity
        ) <= 0 || quantityEstimate.measured !== true && [
          "foundation",
          "column",
          "beam",
          "slab"
        ].includes(
          String(
            rule.geometry_type || ""
          ).toLowerCase()
        )) {
          const fallbackEstimate = estimatePendingRuleQuantity(
            rule,
            priceItem,
            takeoff
          );
          if (quantityEstimate.measured !== true && Number(
            fallbackEstimate.quantity
          ) > 0) {
            quantityEstimate = fallbackEstimate;
          }
        }
        if (Number(
          quantityEstimate.quantity
        ) > 0) {
          quantity = round2(
            Number(
              quantityEstimate.quantity
            ),
            Number.isInteger(
              rule.rounding_precision
            ) ? rule.rounding_precision : 2
          );
        }
      }
      console.log({
        item: rule.item_code,
        geometry: rule.geometry_type,
        property: rule.geometry_property,
        quantity,
        estimateSource: quantityEstimate?.source || null
      });
      if ([
        "foundation",
        "column",
        "beam",
        "slab"
      ].includes(
        String(
          rule.geometry_type || ""
        ).toLowerCase()
      ) || quantityEstimate?.mappedGeometry) {
        console.log(
          "[VENTRA STRUCTURAL BOQ BINDING v33]",
          {
            item: rule.item_code,
            geometry: rule.geometry_type,
            mappedGeometry: quantityEstimate?.mappedGeometry || null,
            description: priceItem.description,
            unit: priceItem.unit,
            quantity,
            source: quantityEstimate?.source || null,
            measured: quantityEstimate?.measured === true
          }
        );
      }
      const isManualRule = String(
        rule.formula_type || ""
      ).toLowerCase() === "manual";
      const isQuantityPending = quantity <= 0;
      const isMeasuredDerivedRule = Number(
        quantityEstimate?.quantity
      ) > 0 && quantityEstimate?.measured === true;
      const isEstimatedRule = Number(
        quantityEstimate?.quantity
      ) > 0 && !isMeasuredDerivedRule;
      if (isQuantityPending && !isManualRule) {
        continue;
      }
      const section = sectionsByCode.get(
        rule.section_code || priceItem.section_code
      );
      const rateResolution = resolveRate(
        priceItem,
        priceLevel,
        prices
      );
      const unitRate = rateResolution.rate;
      if (rateResolution.source !== `direct_${String(
        priceLevel || "standard"
      ).toLowerCase()}_rate`) {
        console.log(
          "[VENTRA RATE RESOLVER]",
          {
            item: priceItem.item_code,
            description: priceItem.description,
            selectedPriceLevel: priceLevel,
            standardRate: toNumber2(
              priceItem.standard_rate
            ),
            economyRate: toNumber2(
              priceItem.economy_rate
            ),
            premiumRate: toNumber2(
              priceItem.premium_rate
            ),
            componentRate: toNumber2(
              priceItem.material_rate
            ) + toNumber2(
              priceItem.labor_rate
            ) + toNumber2(
              priceItem.equipment_rate
            ) + toNumber2(
              priceItem.transport_rate
            ),
            resolvedRate: unitRate,
            source: rateResolution.source,
            peerCount: rateResolution.peerCount
          }
        );
      }
      const amount = isQuantityPending ? 0 : round2(
        quantity * unitRate,
        2
      );
      const commercialRate = isQuantityPending ? 0 : unitRate;
      const measuredFamily = getMeasuredRuleFamily(
        rule,
        priceItem
      );
      if (measuredFamily) {
        claimedMeasuredFamilies.add(
          measuredFamily
        );
      }
      items.push({
        itemNumber: "",
        itemCode: priceItem.item_code,
        sectionCode: rule.section_code || priceItem.section_code || "00",
        section: section?.section_name || priceItem.category || "General",
        category: priceItem.category || "",
        subCategory: priceItem.sub_category || "",
        description: priceItem.description,
        unit: priceItem.unit || "item",
        quantity,
        materialRate: toNumber2(
          priceItem.material_rate
        ),
        laborRate: toNumber2(
          priceItem.labor_rate
        ),
        equipmentRate: toNumber2(
          priceItem.equipment_rate
        ),
        transportRate: toNumber2(
          priceItem.transport_rate
        ),
        rate: round2(
          commercialRate,
          2
        ),
        referenceRate: round2(
          unitRate,
          2
        ),
        rateSource: isQuantityPending ? "reference_rate_not_priced_until_quantity_verified" : rateResolution.source,
        rateMissing: rateResolution.missingRate,
        amount,
        priceLevel,
        source: isQuantityPending ? "Ventra Rule Library - Quantity Pending" : isEstimatedRule ? "Ventra Rule Library - Estimated Quantity" : priceItem.source_name || "Ventra UAE Base Rate",
        status: isQuantityPending ? "quantity_pending" : isEstimatedRule ? "provisional_estimate" : "measured",
        verification: isQuantityPending ? "pending" : isEstimatedRule ? "provisional" : "verified",
        includeInCommercialTotal: !isQuantityPending && !isEstimatedRule,
        measuredFromApsStructure: isMeasuredDerivedRule,
        confidence: isEstimatedRule ? Math.min(
          toNumber2(
            quantityEstimate?.confidence
          ) || 35,
          65
        ) : toNumber2(
          priceItem.confidence_score
        ),
        quantityBasis: quantityEstimate?.source || (isEstimatedRule ? "derived_allowance" : "measured_takeoff"),
        quantitySource: isMeasuredDerivedRule ? "aps_measured_structural_properties" : isEstimatedRule ? "derived_from_verified_project_metrics" : isQuantityPending ? "unavailable" : "measured",
        notes: [
          rule.notes || "",
          isEstimatedRule ? `PROVISIONAL: ${quantityEstimate?.source || "derived allowance"}. Excluded from verified commercial subtotal until replaced by measured quantity.` : isMeasuredDerivedRule ? `MEASURED FROM APS STRUCTURAL PROPERTIES: ${quantityEstimate?.source || "structural measurement"}.` : ""
        ].filter(Boolean).join(" ")
      });
    }
    const v36ColumnVolume = Number(
      takeoff?.column_volume
    ) || 0;
    const v36ColumnMeasured = takeoff?.structural_measurement_status?.columns?.volumeMeasured === true;
    if (v36ColumnMeasured && v36ColumnVolume > 0) {
      const v36Quantity = Math.round(
        v36ColumnVolume * 100
      ) / 100;
      const v36ConcreteCandidates = (pricesResult.data || []).filter((candidate) => {
        const unit = normalizeRateUnit(
          candidate?.unit
        );
        const description = String(
          candidate?.description || ""
        ).toLowerCase();
        const sectionCode = String(
          candidate?.section_code || ""
        ).trim();
        return unit === "m3" && /concrete/.test(
          description
        ) && !/block|masonry|screed|precast|kerb|curb/.test(
          description
        ) && (sectionCode === "03" || /reinforced|structural|c25|c30/.test(
          description
        ));
      }).map((candidate) => {
        const rateResolution = resolveRate(
          candidate,
          priceLevel,
          pricesResult.data || []
        );
        const description = String(
          candidate?.description || ""
        ).toLowerCase();
        let score = 0;
        if (/c25/.test(description)) {
          score += 8;
        }
        if (/reinforced/.test(description)) {
          score += 5;
        }
        if (/structural/.test(description)) {
          score += 4;
        }
        if (/column/.test(description)) {
          score += 3;
        }
        if (String(
          candidate?.section_code || ""
        ).trim() === "03") {
          score += 3;
        }
        return {
          candidate,
          rate: Number(
            rateResolution?.rate
          ) || 0,
          rateSource: rateResolution?.source || "catalog_rate",
          score
        };
      }).filter(
        (candidate) => candidate.rate > 0
      ).sort(
        (a, b) => b.score - a.score || a.rate - b.rate
      );
      const v36SelectedConcrete = v36ConcreteCandidates[0] || null;
      const v36Rate = v36SelectedConcrete?.rate || 0;
      const v36Amount = Math.round(
        v36Quantity * v36Rate * 100
      ) / 100;
      items.push({
        itemNumber: "",
        itemCode: "VSTR-COLUMN-CONC",
        sectionCode: "03",
        section: "Concrete Works",
        category: "Concrete Works",
        subCategory: "Column Concrete",
        description: v36SelectedConcrete ? `Reinforced concrete to columns - priced from ${v36SelectedConcrete.candidate?.description || "UAE concrete catalog"}` : "Reinforced concrete to columns - rate pending",
        unit: "m\xB3",
        quantity: v36Quantity,
        materialRate: 0,
        laborRate: 0,
        equipmentRate: 0,
        transportRate: 0,
        rate: v36Rate,
        referenceRate: v36Rate,
        rateSource: v36SelectedConcrete ? `structural_catalog_${v36SelectedConcrete.rateSource}` : "rate_pending_no_safe_concrete_catalog_match",
        rateMissing: v36Rate <= 0,
        amount: v36Amount,
        priceLevel,
        source: "Autodesk APS Structural Measurement + Ventra UAE Price Library",
        status: v36Rate > 0 ? "measured" : "measured_rate_pending",
        verification: "verified",
        includeInCommercialTotal: v36Rate > 0,
        measuredFromApsStructure: true,
        confidence: v36Rate > 0 ? 94 : 90,
        quantityBasis: "aps_measured_column_volume",
        quantitySource: "aps_measured_structural_properties",
        notes: v36SelectedConcrete ? "Column volume measured from APS. Rate selected deterministically from the existing UAE concrete price catalog; no OpenAI call used." : "Column volume measured from APS. No safe concrete catalog rate was available."
      });
      console.log(
        "[VENTRA FINAL COLUMN CONCRETE v36]",
        {
          quantity: v36Quantity,
          rate: v36Rate,
          amount: v36Amount,
          selectedCatalogItem: v36SelectedConcrete?.candidate?.item_code || null,
          selectedDescription: v36SelectedConcrete?.candidate?.description || null,
          rateSource: v36SelectedConcrete?.rateSource || null,
          commercial: v36Rate > 0
        }
      );
    }
    let aiScopePlan = null;
    let aiScopeMatches = [];
    const ventraMode = String(
      process.env.NEXT_PUBLIC_VENTRA_MODE || process.env.VENTRA_MODE || "production"
    ).trim().toLowerCase();
    const allowBoqAi = String(
      process.env.VENTRA_ENABLE_BOQ_AI || ""
    ).trim().toLowerCase() === "true" || ventraMode === "production" && String(
      process.env.VENTRA_DISABLE_BOQ_AI || ""
    ).trim().toLowerCase() !== "true";
    console.log(
      "[VENTRA LOW COST v23] BOQ AI gate",
      {
        ventraMode,
        allowBoqAi,
        semanticRoomCount: semanticRooms.length,
        behavior: allowBoqAi ? "openai_scope_expansion_enabled" : "deterministic_boq_only_openai_skipped"
      }
    );
    if (allowBoqAi && semanticRooms.length > 0) {
      try {
        aiScopePlan = await inferConstructionScopes({
          rooms: semanticRooms,
          takeoff
        });
        const scopeSearchTerms = [
          ...aiScopePlan.catalog_search_terms || [],
          ...(aiScopePlan.scopes || []).flatMap((scope) => [
            scope.work,
            scope.trade,
            `${scope.trade || ""} ${scope.work || ""}`.trim()
          ])
        ];
        const catalogCandidates = shortlistPriceCatalog(
          prices,
          scopeSearchTerms,
          500
        );
        console.log("[VENTRA AI BOQ SCOPE] plan", {
          semanticRooms: semanticRooms.map((room) => ({
            name: room.name,
            type: room.type,
            area: room.area,
            perimeter: room.perimeter
          })),
          scopesCount: aiScopePlan.scopes?.length || 0,
          searchTermsCount: scopeSearchTerms.length,
          catalogCandidates: catalogCandidates.length
        });
        const matched = await matchScopesToCatalog({
          scopes: aiScopePlan.scopes || [],
          candidates: catalogCandidates
        });
        const deterministicElectricalMatches = buildDeterministicRoomElectricalMatches(
          roomLocalMep,
          pricesByCode
        );
        const mergedMatches = [];
        const mergedMatchKeys = /* @__PURE__ */ new Set();
        for (const match of [
          ...matched.matches || [],
          ...deterministicElectricalMatches
        ]) {
          const key2 = `${normalizeCode(
            match?.item_code
          )}|${String(
            match?.room_type || ""
          )}`;
          if (mergedMatchKeys.has(
            key2
          )) {
            continue;
          }
          mergedMatchKeys.add(
            key2
          );
          mergedMatches.push(
            match
          );
        }
        console.log("[VENTRA AI BOQ SCOPE] catalog matches", {
          returnedMatches: matched.matches?.length || 0,
          deterministicElectricalMatches: deterministicElectricalMatches.length,
          mergedMatches: mergedMatches.length,
          matches: mergedMatches.slice(
            0,
            80
          )
        });
        const candidateCodes = new Set(
          catalogCandidates.map(
            (item) => normalizeCode(
              item.item_code
            )
          )
        );
        const existingCodes = new Set(
          items.map(
            (item) => normalizeCode(
              item.itemCode
            )
          )
        );
        const measuredRoomLocalCodes = /* @__PURE__ */ new Set();
        for (const match of mergedMatches) {
          const code = normalizeCode(
            match.item_code
          );
          if (!candidateCodes.has(code) && match?.deterministicRoomElectrical !== true) {
            continue;
          }
          const existingItemIndex = items.findIndex(
            (item) => normalizeCode(
              item.itemCode
            ) === code
          );
          const existingItem = existingItemIndex >= 0 ? items[existingItemIndex] : null;
          const priceItem = pricesByCode.get(code);
          if (!priceItem) {
            continue;
          }
          const effectiveQuantityBasis = getSafeQuantityBasis(
            match,
            priceItem
          );
          const effectiveMatch = {
            ...match,
            quantity_basis: effectiveQuantityBasis
          };
          const roomLocalElectricalQuantity = effectiveQuantityBasis === "electrical_items" ? resolveRoomLocalElectricalQuantity(
            match,
            roomLocalMep
          ) : 0;
          const quantity = round2(
            roomLocalElectricalQuantity > 0 ? roomLocalElectricalQuantity : resolveAiQuantity({
              match: effectiveMatch,
              rooms: semanticRooms,
              takeoff
            }),
            2
          );
          if (quantity <= 0) {
            console.log(
              "[VENTRA AI BOQ SCOPE] rejected quantity",
              {
                item_code: priceItem.item_code,
                room_type: match.room_type,
                quantity_basis: effectiveQuantityBasis,
                reason: "no_safe_room_local_quantity"
              }
            );
            continue;
          }
          const section = sectionsByCode.get(
            priceItem.section_code
          );
          const rateResolution = resolveRate(
            priceItem,
            priceLevel,
            prices
          );
          const unitRate = rateResolution.rate;
          if (unitRate <= 0) {
            console.log(
              "[VENTRA RATE MISSING]",
              {
                item: priceItem.item_code,
                description: priceItem.description,
                selectedPriceLevel: priceLevel,
                standardRate: toNumber2(
                  priceItem.standard_rate
                ),
                economyRate: toNumber2(
                  priceItem.economy_rate
                ),
                premiumRate: toNumber2(
                  priceItem.premium_rate
                ),
                materialRate: toNumber2(
                  priceItem.material_rate
                ),
                laborRate: toNumber2(
                  priceItem.labor_rate
                ),
                equipmentRate: toNumber2(
                  priceItem.equipment_rate
                ),
                transportRate: toNumber2(
                  priceItem.transport_rate
                )
              }
            );
          }
          const amount = round2(
            quantity * unitRate,
            2
          );
          if (roomLocalElectricalQuantity > 0 && existingItem && existingItem.status === "measured_estimated") {
            const firstMeasuredRoomForCode = !measuredRoomLocalCodes.has(
              code
            );
            existingItem.quantity = round2(
              firstMeasuredRoomForCode ? quantity : (Number(
                existingItem.quantity
              ) || 0) + quantity,
              2
            );
            existingItem.rate = round2(
              unitRate,
              2
            );
            existingItem.rateSource = rateResolution.source;
            existingItem.rateMissing = rateResolution.missingRate;
            existingItem.amount = round2(
              existingItem.quantity * unitRate,
              2
            );
            existingItem.source = "Autodesk APS Room-local Measurement";
            existingItem.status = "measured";
            existingItem.notes = `${firstMeasuredRoomForCode ? "Replaced estimated electrical allowance with measured APS room-local quantities." : existingItem.notes || ""} Room ${match.room_type}: ${quantity}. ${match.reason}`.trim();
            measuredRoomLocalCodes.add(
              code
            );
          } else if (roomLocalElectricalQuantity > 0 && existingItem && existingItem.source === "Autodesk APS Room-local Measurement") {
            existingItem.quantity = round2(
              (Number(
                existingItem.quantity
              ) || 0) + quantity,
              2
            );
            existingItem.amount = round2(
              existingItem.quantity * unitRate,
              2
            );
            existingItem.notes = `${existingItem.notes || ""} Room ${match.room_type}: ${quantity}.`.trim();
            measuredRoomLocalCodes.add(
              code
            );
          } else if (existingItem && existingItem.status === "quantity_pending") {
            existingItem.quantity = round2(
              (Number(
                existingItem.quantity
              ) || 0) + quantity,
              2
            );
            existingItem.rate = round2(
              unitRate,
              2
            );
            existingItem.rateSource = rateResolution.source;
            existingItem.rateMissing = rateResolution.missingRate;
            existingItem.amount = round2(
              existingItem.quantity * unitRate,
              2
            );
            existingItem.source = "Ventra AI Scope Engine";
            existingItem.status = "measured_estimated";
            existingItem.notes = `${existingItem.notes || ""} AI quantity upgrade: ${match.reason} Basis: ${effectiveQuantityBasis}. Room type: ${match.room_type}. ${semanticRooms.some(
              (room) => room.type === match.room_type && room.areaEstimated
            ) ? "Room quantity is currently estimated from semantic room layout and Autodesk total floor area." : ""}`.trim();
          } else if (!existingItem) {
            items.push({
              itemNumber: "",
              itemCode: priceItem.item_code,
              sectionCode: priceItem.section_code || "00",
              section: section?.section_name || priceItem.category || "General",
              category: priceItem.category || "",
              subCategory: priceItem.sub_category || "",
              description: priceItem.description,
              unit: priceItem.unit || "item",
              quantity,
              materialRate: toNumber2(
                priceItem.material_rate
              ),
              laborRate: toNumber2(
                priceItem.labor_rate
              ),
              equipmentRate: toNumber2(
                priceItem.equipment_rate
              ),
              transportRate: toNumber2(
                priceItem.transport_rate
              ),
              rate: round2(
                unitRate,
                2
              ),
              amount,
              priceLevel,
              source: roomLocalElectricalQuantity > 0 ? "Autodesk APS Room-local Measurement" : "Ventra AI Scope Engine",
              status: roomLocalElectricalQuantity > 0 ? "measured" : semanticRooms.some(
                (room) => room.type === match.room_type && room.areaEstimated
              ) ? "measured_estimated" : "measured",
              confidence: toNumber2(
                priceItem.confidence_score
              ),
              notes: `AI scope: ${match.reason} Quantity basis: ${effectiveQuantityBasis}. Room type: ${match.room_type}.`
            });
          } else if (existingItem.source === "Ventra AI Scope Engine" || existingItem.status === "measured_estimated") {
            existingItem.quantity = round2(
              (Number(
                existingItem.quantity
              ) || 0) + quantity,
              2
            );
            existingItem.amount = round2(
              existingItem.quantity * unitRate,
              2
            );
          } else {
            continue;
          }
          existingCodes.add(code);
          aiScopeMatches.push({
            item_code: priceItem.item_code,
            quantity_basis: effectiveQuantityBasis,
            room_type: match.room_type,
            quantity,
            roomLocalQuantity: roomLocalElectricalQuantity > 0,
            deterministicRoomElectrical: match?.deterministicRoomElectrical === true,
            upgradedPendingRule: Boolean(
              existingItem && existingItem.status === "measured_estimated"
            )
          });
        }
        console.log("[VENTRA AI BOQ SCOPE] accepted", {
          acceptedItems: aiScopeMatches.length,
          items: aiScopeMatches,
          safetyMode: "room_specific_scopes_require_room_local_quantities"
        });
      } catch (aiScopeError) {
        warnings.push(
          `AI scope expansion skipped: ${aiScopeError instanceof Error ? aiScopeError.message : "unknown error"}`
        );
        console.warn(
          "[VENTRA AI BOQ SCOPE]",
          aiScopeError
        );
      }
    }
    const dwgResult = applyDwgScheduleToBoq(items, getDrawingEvidence(rawTakeoff) || {}, prices.map((price) => {
      const resolved = resolveRate(price, priceLevel, prices);
      return { ...price, resolvedRate: resolved.missingRate ? 0 : resolved.rate, resolvedSource: resolved.source };
    }));
    items.splice(0, items.length, ...dwgResult.items);
    warnings.push(...dwgResult.warnings);
    if (getDrawingEvidence(rawTakeoff)?.extractionError) warnings.push(`DWG schedule extraction: ${getDrawingEvidence(rawTakeoff).extractionError}`);
    items.forEach((item, index) => {
      items[index] = requireBoqReview(item);
    });
    console.log("[VENTRA BOQ EVIDENCE v37]", { reviewRequiredItems: items.filter((item) => item.reviewRequired).length, automaticScheduleReconciliation: true });
    warnings.push("Catalog descriptions and budget rates require project-specific review. Measured quantities alone do not verify scope or specification. Accepted DWG schedule quantities and explicit material notes are reconciled separately; unreadable or conflicting evidence remains unresolved.");
    console.log(
      "[VENTRA STRUCTURAL MEASUREMENT v30]",
      {
        slabVolume: Number(takeoff?.slab_volume) || 0,
        columnVolume: Number(takeoff?.column_volume) || 0,
        beamVolume: Number(takeoff?.beam_volume) || 0,
        foundationVolume: Number(takeoff?.foundation_volume) || 0,
        columnFormworkArea: Number(takeoff?.column_formwork_area) || 0,
        beamFormworkArea: Number(takeoff?.beam_formwork_area) || 0,
        foundationFormworkArea: Number(takeoff?.foundation_formwork_area) || 0,
        slabFormworkArea: Number(takeoff?.slab_formwork_area) || 0,
        status: takeoff?.structural_measurement_status || null,
        measuredStructuralItems: items.filter(
          (item) => item.measuredFromApsStructure === true
        ).length
      }
    );
    console.log(
      "[VENTRA BOQ RULE VISIBILITY]",
      {
        totalVisibleItems: items.length,
        measuredItems: items.filter(
          (item) => item.status === "measured"
        ).length,
        provisionalItems: items.filter(
          (item) => item.status === "provisional_estimate"
        ).length,
        measuredStructuralItems: items.filter(
          (item) => item.measuredFromApsStructure === true
        ).length,
        quantityPendingItems: items.filter(
          (item) => item.status === "quantity_pending"
        ).length,
        zeroAmountItems: items.filter(
          (item) => Number(
            item.amount
          ) === 0
        ).length,
        missingRateItems: items.filter(
          (item) => item.rateMissing === true
        ).length,
        peerRateFallbackItems: items.filter(
          (item) => String(
            item.rateSource || ""
          ).includes(
            "median_rate"
          ) || String(
            item.rateSource || ""
          ).includes(
            "median"
          )
        ).length
      }
    );
    items.sort((a, b) => {
      const sectionCompare = String(
        a.sectionCode
      ).localeCompare(
        String(
          b.sectionCode
        )
      );
      if (sectionCompare !== 0) {
        return sectionCompare;
      }
      return String(
        a.itemCode
      ).localeCompare(
        String(
          b.itemCode
        )
      );
    });
    items.forEach(
      (item, index) => {
        item.itemNumber = `${item.sectionCode}.${String(
          index + 1
        ).padStart(2, "0")}`;
      }
    );
    const verifiedSubtotal = round2(
      items.filter(
        (item) => item.includeInCommercialTotal === true
      ).reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0
      ),
      2
    );
    const provisionalSubtotal = round2(
      items.filter(
        (item) => item.status === "provisional_estimate"
      ).reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0
      ),
      2
    );
    const pendingItems = items.filter(
      (item) => item.status === "quantity_pending"
    ).length;
    const subtotal = verifiedSubtotal;
    const vatAmount = round2(
      verifiedSubtotal * (vatPercentage / 100),
      2
    );
    const grandTotal = round2(
      verifiedSubtotal + vatAmount,
      2
    );
    console.log(
      "[VENTRA COMMERCIAL TOTAL v24]",
      {
        verifiedSubtotal,
        provisionalSubtotal,
        pendingItems,
        quotedSubtotal: subtotal
      }
    );
    if (projectId && items.length) {
      const {
        error: deleteError
      } = await supabase.from("project_boq_items").delete().eq(
        "project_id",
        projectId
      ).eq(
        "source",
        "Ventra Rule Engine"
      );
      if (deleteError) {
        throw deleteError;
      }
      const rows = items.map(
        (item, index) => ({
          project_id: projectId,
          section_code: item.sectionCode,
          item_code: item.itemCode,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          material_rate: item.materialRate,
          labor_rate: item.laborRate,
          equipment_rate: item.equipmentRate,
          transport_rate: item.transportRate,
          unit_rate: item.rate,
          total_amount: item.amount,
          source: item.source || "Ventra Rule Engine",
          notes: item.notes,
          sort_order: index + 1
        })
      );
      const {
        error: insertError
      } = await supabase.from("project_boq_items").insert(rows);
      if (insertError) {
        throw insertError;
      }
    }
    if (items.length === 0) {
      return NextResponse2.json(
        {
          success: false,
          error: `No BOQ items generated. Rules: ${rulesResult.data?.length || 0}, Prices: ${pricesResult.data?.length || 0}, Wall area: ${takeoff.wall_area}, Wall length: ${takeoff.wall_length}`,
          debug: {
            rules: (rulesResult.data || []).map((rule) => ({
              item_code: rule.item_code,
              geometry_type: rule.geometry_type,
              geometry_property: rule.geometry_property,
              formula_type: rule.formula_type,
              multiplier: rule.multiplier
            })),
            availablePriceCodes: (pricesResult.data || []).map(
              (item) => item.item_code
            )
          }
        },
        { status: 422 }
      );
    }
    return NextResponse2.json({
      success: true,
      boq: {
        projectId,
        projectName,
        currency: "AED",
        priceLevel,
        takeoff,
        items,
        assumptions: [
          "Quantities were generated from detected drawing geometry.",
          "Rates were loaded from the Ventra UAE price database."
        ],
        warnings,
        aiScope: {
          detectedRooms: semanticRooms.map((room) => ({
            name: room.name,
            type: room.type,
            area: room.area,
            perimeter: room.perimeter
          })),
          plannedScopes: aiScopePlan?.scopes || [],
          matchedItems: aiScopeMatches
        },
        summary: {
          totalItems: items.length,
          verifiedItems: items.filter(
            (item) => item.status === "measured"
          ).length,
          provisionalItems: items.filter(
            (item) => item.status === "provisional_estimate"
          ).length,
          pendingItems,
          verifiedSubtotal,
          provisionalSubtotal,
          subtotal,
          vatPercentage,
          vatAmount,
          grandTotal,
          commercialSafe: false,
          evidencePolicyVersion: 37,
          scopeCoverage: "unconfirmed",
          reviewRequiredItems: items.filter((item) => item.reviewRequired).length
        }
      }
    });
  } catch (error) {
    console.error(
      "[Generate BOQ]",
      error
    );
    return NextResponse2.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unable to generate BOQ."
      },
      {
        status: 500
      }
    );
  }
}
async function runBoqRequest(request) {
  return commercialRun(request, "boq", handleCommercialRequest2);
}

// netlify/worker/preview-background.mjs
async function handler(request) {
  const input = await request.json();
  await executePreviewJob(input, (request2, action) => action === "boq" ? runBoqRequest(request2) : runPreviewRequest(request2));
}
var config = { background: true };
export {
  config,
  handler as default
};
