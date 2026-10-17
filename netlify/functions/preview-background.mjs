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
  const name2 = String(room?.name || "").normalize("NFKC").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/ي/g, "\u06CC").replace(/ك/g, "\u06A9").toLowerCase();
  const text = `${name2} ${room?.type || ""} ${room?.semanticType || ""}`.toLowerCase();
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
        const headers2 = new Headers(request.headers);
        headers2.set("x-ventra-request-id", key2);
        headers2.delete("content-length");
        const scoped = new Request(request.url, { method: "POST", headers: headers2, body: JSON.stringify(body), signal: request.signal });
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
  const table3 = a.type === "dining_table" ? a : b.type === "dining_table" ? b : null;
  if (!chair || !table3 || chair.roomId !== table3.roomId) return false;
  const r = chair.rotation * Math.PI / 180, fx = -Math.sin(r), fy = Math.cos(r);
  const tx = table3.xMeters - chair.xMeters, ty = table3.yMeters - chair.yMeters;
  if (tx * fx + ty * fy <= 0) return false;
  const cut = Math.min(0.18, chair.depth * 0.45);
  const rear = { ...chair, depth: chair.depth - cut, xMeters: chair.xMeters - fx * cut / 2, yMeters: chair.yMeters - fy * cut / 2 };
  return !furnitureOverlaps(rear, table3, { width: 0, depth: 0 }, 0);
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
var inside2 = (p, polygon2 = []) => {
  let hit = false;
  for (let i = 0, j = polygon2.length - 1; i < polygon2.length; j = i++) {
    const a = polygon2[i], b = polygon2[j];
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

// src/lib/previewSceneWire.mjs
var aliases = {
  title: "t",
  confidence: "c",
  coordinateMode: "cm",
  widthMeters: "w",
  depthMeters: "d",
  footprint: "fp",
  rooms: "r",
  relationships: "rel",
  partitions: "p",
  openings: "o",
  furniture: "f",
  id: "i",
  name: "n",
  type: "t",
  labelVisible: "lv",
  printedWidthMeters: "pw",
  printedDepthMeters: "pd",
  polygon: "pg",
  groupId: "g",
  roomId: "r",
  backLeft: "bl",
  backRight: "br",
  frontCenter: "fc",
  embeddedInCounter: "ec",
  roomAId: "a",
  roomBId: "b",
  relation: "r",
  direction: "d",
  start: "s",
  end: "e",
  center: "p",
  heightMeters: "h",
  sillHeightMeters: "sh",
  wallIdHint: "wh",
  wallAxis: "ax",
  hingeSide: "hs",
  swingDirection: "sd"
};
var fail2 = (code, message) => Object.assign(new Error(message), { code });
function createPreviewWireCodec(originalSchema) {
  const legend = [];
  function compile(node, path) {
    if (node.type === "object") {
      const keys = Object.keys(node.properties);
      if (keys.length === 2 && keys.includes("x") && keys.includes("y") && node.properties.x.type === "number" && node.properties.y.type === "number") {
        return {
          schema: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
          decode: (value) => ({ x: value[0], y: value[1] })
        };
      }
      const entries = keys.map((key2) => ({
        key: key2,
        alias: aliases[key2] || key2,
        child: compile(node.properties[key2], `${path}.${key2}`)
      }));
      if (new Set(entries.map((e) => e.alias)).size !== entries.length) throw new Error(`Duplicate preview wire keys at ${path}.`);
      legend.push(`${path}: ${entries.map((e) => `${e.alias}=${e.key}`).join(", ")}`);
      return {
        schema: {
          ...node,
          required: node.required.map((key2) => aliases[key2] || key2),
          properties: Object.fromEntries(entries.map((e) => [e.alias, e.child.schema]))
        },
        decode: (value) => Object.fromEntries(entries.map((e) => [e.key, e.child.decode(value[e.alias])]))
      };
    }
    if (node.type === "array") {
      const child = compile(node.items, `${path}[]`);
      return { schema: { ...node, items: child.schema }, decode: (value) => value.map(child.decode) };
    }
    return { schema: { ...node }, decode: (value) => value };
  }
  const compiled = compile(originalSchema, "scene");
  return {
    schema: compiled.schema,
    instructions: `WIRE FORMAT (same source observations, shorter JSON): return short keys as listed below. Every point is [x,y], not an object; polygons/footprint remain arrays of points. All preceding geometry rules use the original field names; map them using this legend. Preserve ALL observed objects and coordinate precision; do not omit observations to save tokens. Use concise unique IDs and source room labels. No prose or Markdown.
${legend.join("\n")}`,
    decode(value) {
      validate(value, compiled.schema, "scene");
      return compiled.decode(value);
    }
  };
}
function validate(value, schema, path) {
  const invalid = () => {
    throw fail2("PREVIEW_SCHEMA_INVALID", `Preview returned invalid scene data at ${path}. No new scene was saved.`);
  };
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    if (schema.required.some((key2) => !Object.hasOwn(value, key2)) || Object.keys(value).some((key2) => !Object.hasOwn(schema.properties, key2))) invalid();
    for (const [key2, child] of Object.entries(schema.properties)) validate(value[key2], child, `${path}.${key2}`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) invalid();
    value.forEach((item, i) => validate(item, schema.items, `${path}[${i}]`));
  } else if (typeof value !== schema.type || schema.type === "number" && !Number.isFinite(value)) invalid();
  if (schema.enum && !schema.enum.includes(value)) invalid();
}
function readCompletedPreview(response, codec) {
  if (response?.status !== "completed") {
    const reason = response?.incomplete_details?.reason;
    throw fail2(
      reason === "max_output_tokens" ? "PREVIEW_OUTPUT_LIMIT" : "PREVIEW_INCOMPLETE_OUTPUT",
      reason === "max_output_tokens" ? "3D analysis reached its response limit before completing. No new scene was saved and no automatic retry was made." : "3D analysis did not complete. No new scene was saved and no automatic retry was made."
    );
  }
  if (response.output?.some((item) => item.content?.some((part) => part.type === "refusal"))) {
    throw fail2("PREVIEW_REFUSED", "The preview model declined this image. No new scene was saved.");
  }
  const text = String(response.output_text || "").trim();
  if (!text) throw fail2("PREVIEW_EMPTY_OUTPUT", "The preview model returned no scene data. No new scene was saved.");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw fail2("PREVIEW_JSON_PARSE_FAILED", "The preview model returned invalid JSON. No new scene was saved.");
  }
  return codec.decode(raw);
}

// src/lib/serverPreviewAnalysis.js
var VERSION = "preview-compact-response-v133-20261015";
var MODEL = process.env.OPENAI_3D_PREVIEW_MODEL || "gpt-5.6-sol";
var requestedReasoning = process.env.OPENAI_3D_PREVIEW_REASONING || "low";
var REASONING_EFFORT = ["low", "medium", "high"].includes(requestedReasoning) ? requestedReasoning : "low";
var requestedOutputTokens = Number(process.env.VENTRA_3D_PREVIEW_MAX_OUTPUT_TOKENS || 8e3);
var MAX_OUTPUT_TOKENS = Number.isFinite(requestedOutputTokens) ? Math.max(3500, Math.min(8e3, requestedOutputTokens)) : 8e3;
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
function pointInPolygon(point2, polygon2 = []) {
  let inside3 = false;
  for (let i = 0, j = polygon2.length - 1; i < polygon2.length; j = i++) {
    const a = polygon2[i];
    const b = polygon2[j];
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
  const valid2 = (Array.isArray(points) ? points : []).filter(
    (p) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y))
  );
  if (!valid2.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return {
    minX: Math.min(...valid2.map((p) => Number(p.x))),
    minY: Math.min(...valid2.map((p) => Number(p.y))),
    maxX: Math.max(...valid2.map((p) => Number(p.x))),
    maxY: Math.max(...valid2.map((p) => Number(p.y)))
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
  const valid2 = new Set(roomIds.map(String));
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rel of Array.isArray(rawRelationships) ? rawRelationships : []) {
    const a = String(rel?.roomAId || "");
    const b = String(rel?.roomBId || "");
    if (!a || !b || a === b || !valid2.has(a) || !valid2.has(b)) continue;
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
function polygonSamplePoints(polygon2 = []) {
  const pts = [...polygon2];
  for (let i = 0; i < polygon2.length; i += 1) {
    const a = polygon2[i], b = polygon2[(i + 1) % polygon2.length];
    pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  const xs = polygon2.map((p) => p.x), ys = polygon2.map((p) => p.y);
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
    const polygon2 = room.polygon.map((p) => ({
      x: center.x + (p.x - center.x) * scale,
      y: center.y + (p.y - center.y) * scale
    }));
    const candidate = { ...room, polygon: polygon2 };
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
    const polygon2 = cleanPolygon((room?.polygon || []).map((p) => sourcePoint(p, width, depth)));
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
      polygon: polygon2
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
var sceneWire = createPreviewWireCodec(sceneSchema);
var furnitureWire = createPreviewWireCodec({
  type: "object",
  additionalProperties: false,
  required: ["furniture"],
  properties: { furniture: sceneSchema.properties.furniture }
});
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
    accepted: false,
    reasoningEffort: REASONING_EFFORT,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    wireFormat: "lossless-short-keys-point-pairs-v1"
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

${sceneWire.instructions}

Source image size: ${prepared.width}x${prepared.height}px (reference only).` },
            { type: "input_image", image_url: prepared.imageUrl, detail: "high" }
          ]
        }],
        text: {
          verbosity: "low",
          format: { type: "json_schema", name: "ventra_compact_plan_scene_v133", strict: true, schema: sceneWire.schema }
        }
      }, { signal: controller.signal, maxRetries: 0 });
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
    diagnostics.stage = "validating_response";
    const raw = readCompletedPreview(response, sceneWire);
    diagnostics.stage = "normalizing_scene";
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
            { type: "input_text", text: furnitureWire.instructions },
            { type: "input_image", image_url: prepared.imageUrl, detail: "high" }
          ] }],
          text: { format: { type: "json_schema", name: "compact_furniture_coverage_v133", strict: true, schema: furnitureWire.schema } }
        }, { signal: furnitureController.signal, maxRetries: 0 });
        diagnostics.furnitureReview = { responseId: reviewResponse.id, usage: reviewResponse.usage, status: reviewResponse.status, incompleteDetails: reviewResponse.incomplete_details || null };
        const reviewed = readCompletedPreview(reviewResponse, furnitureWire);
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
        diagnostics.furnitureReview = { ...diagnostics.furnitureReview, status: "failed", code: error?.code || null, message: error?.message };
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
    diagnostics.failedStage = diagnostics.stage;
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

// src/lib/pdfRoomInventory.mjs
function recoverPdfRoomInventory(page) {
  if (page.page_evidence?.kind !== "floor_plan") return { page, warnings: [] };
  const rooms = /* @__PURE__ */ new Map(), warnings = [];
  for (const item of page.detected_items || []) {
    if (!["m2", "m\xB2"].includes(String(item.unit).toLowerCase()) || !Number.isFinite(item.quantity) || item.quantity <= 0) continue;
    const tag = String(item.name || "").match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1]?.toUpperCase();
    if (!tag) continue;
    if (rooms.has(tag)) {
      warnings.push(`Duplicate room area tag ${tag} on page ${page.pageNumber}; inventory withheld.`);
      return { page, warnings };
    }
    const name2 = String(item.name || ""), description = String(item.description || "");
    const finish = /\bVOID\b/i.test(name2) || /^VOID\b/i.test(description) ? "void" : /\bterrace\b|\bbalcony\b/i.test(name2) || /^OUTDOOR\b/i.test(description) ? "outdoor" : /^WOOD\b|^parquet\b/i.test(description) ? "wood" : /^EPOXY\b/i.test(description) ? "epoxy" : /^TILE\b|^ceramic\b/i.test(description) ? "tile" : null;
    rooms.set(tag, { ...item, tag, finish });
  }
  if (!rooms.size) return { page, warnings };
  const list = [...rooms.values()], enclosed = list.filter((r) => !["void", "outdoor"].includes(r.finish)), outdoor = list.filter((r) => r.finish === "outdoor");
  const inner = enclosed.reduce((s, r) => s + r.quantity, 0), outside = outdoor.reduce((s, r) => s + r.quantity, 0), walkable = inner + outside;
  if (Math.abs(page.floor_area - walkable) > 0.01 && Math.abs(page.floor_area - inner) > 0.01) {
    warnings.push(`Room area inventory on page ${page.pageNumber} does not reconcile to its floor summary; finish recovery withheld.`);
    return { page, warnings };
  }
  const values = { floor_area: walkable }, scope = page.page_evidence.scope_id;
  const materialKeys = { wood: "wood_floor_area", tile: "ceramic_floor_area", epoxy: "epoxy_floor_area", outdoor: "terrace_floor_area" };
  for (const [finish, key2] of Object.entries(materialKeys)) {
    const matching = list.filter((r) => r.finish === finish);
    if (!matching.length) continue;
    if ((page.page_evidence.quantities || []).some((q) => q.key === key2)) continue;
    values[key2] = matching.reduce((s, r) => s + r.quantity, 0);
  }
  const quantities = (page.page_evidence.quantities || []).filter((q) => q.key !== "floor_area");
  for (const [key2, value] of Object.entries(values)) quantities.push({
    key: key2,
    value,
    unit: "m2",
    scope_id: scope,
    evidence: `Tagged room inventory on page ${page.pageNumber} reconciles to floor summary; ${key2}: ` + list.filter((r) => key2 === "floor_area" ? r.finish !== "void" : r.finish === Object.keys(materialKeys).find((k) => materialKeys[k] === key2)).map((r) => `${r.tag}=${r.quantity} m2 (${r.description})`).join(" + ") + `. AI room labels/materials require review.`
  });
  return { page: { ...page, floor_area: walkable, page_evidence: { ...page.page_evidence, quantities } }, warnings };
}

// src/lib/pdfNativeRoomInventory.mjs
var tagOf = (value) => String(value || "").trim().match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1]?.toUpperCase();
var finishOf = (value) => {
  const text = String(value || "").toUpperCase(), values = new Set([...text.matchAll(/(?:^|\||\/|M(?:2|²)\s+)\s*(WOOD|TILE|EPOXY|OUTDOOR|VOID)\b/g)].map((m) => m[1].toLowerCase()));
  if (/\bVOID\s*$/.test(text)) values.add("void");
  return values.size === 1 ? [...values][0] : null;
};
var printedArea = (value) => String(value || "").match(/(?:^|\s|\|)(\d+(?:\.\d+)?)\s*m(?:2|²)(?=\s|$|\|)/i);
function recoverNativeRoomInventory(page, validatedSpaces) {
  const original = page.detected_items || [], native = page.native_plan_text;
  if (native?.status !== "readable" || !Array.isArray(native.spans) || native.spans.length > 3e3) return { items: original, recovered: [] };
  const shapes = new Map(validatedSpaces.map((s) => [tagOf(s.tag), s])), captions = /* @__PURE__ */ new Map(), recovered = [];
  for (const span of native.spans) {
    const tag = tagOf(span.text);
    if (!tag || !/^\S+\s+\S/.test(span.text)) continue;
    const list = captions.get(tag) || [];
    list.push(span);
    captions.set(tag, list);
  }
  const items = [...original];
  for (const [tag, rows] of captions) {
    if (rows.length !== 1 || original.some((i) => tagOf(i.name) === tag && ["m2", "m\xB2"].includes(String(i.unit).toLowerCase()))) continue;
    const caption = rows[0], shape2 = shapes.get(tag), inline = printedArea(caption.text);
    const neighbours = native.spans.filter((s) => Math.abs(caption.angle || 0) < 1e-3 && s !== caption && Math.abs(s.angle || 0) < 1e-3 && s.y < caption.y && caption.y - s.y <= 2.5 * caption.height && Math.abs(s.x - caption.x) <= Math.max(20, 4 * caption.height) && printedArea(s.text) && finishOf(s.text));
    if (!inline && neighbours.length > 1) continue;
    const areaLine = inline ? caption : neighbours.length === 1 ? neighbours[0] : null;
    const finish = finishOf(caption.text) || finishOf(areaLine?.text);
    if (!finish) continue;
    if (finishOf(caption.text) && finishOf(areaLine?.text) && finishOf(caption.text) !== finishOf(areaLine.text)) continue;
    const match = areaLine && printedArea(areaLine.text), labelArea = match ? Number(match[1]) : null;
    const quantity = labelArea ?? shape2?.quantity;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e6) continue;
    if (shape2 && (finish === "void" ? shape2.kind !== "void" : finish === "outdoor" ? shape2.kind !== "outdoor" : shape2.kind !== "enclosed") || shape2 && finish !== "void" && shape2.finish !== finish) continue;
    const evidence = labelArea !== null ? `printed source label: ${caption.text}; ${areaLine.text}` : `independently dimensioned polygon for source label ${caption.text}; ${shape2.evidence}`;
    const name2 = caption.text.trim().replace(/\s*\|.*$/, "").replace(/\s*\/\s*(?:WOOD|TILE|EPOXY|OUTDOOR|VOID)\s*$/i, "");
    items.push({ name: name2, unit: "m2", quantity, description: `${finish.toUpperCase()} | ${evidence}` });
    recovered.push({ tag, page: page.pageNumber, basis: labelArea !== null ? "native_printed_area" : "existing_validated_polygon", source_label: caption.text });
  }
  return { items, recovered };
}

// src/lib/pdfAreaGeometry.mjs
var EPS3 = 1e-8;
var cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
var signed = (p) => p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length];
  return s + a.x * b.y - b.x * a.y;
}, 0) / 2;
var area2 = (p) => Math.abs(signed(p));
function on(a, b, p) {
  return Math.abs(cross(a, b, p)) < EPS3 && p.x >= Math.min(a.x, b.x) - EPS3 && p.x <= Math.max(a.x, b.x) + EPS3 && p.y >= Math.min(a.y, b.y) - EPS3 && p.y <= Math.max(a.y, b.y) + EPS3;
}
function intersects(a, b, c, d) {
  return cross(a, b, c) * cross(a, b, d) < -EPS3 && cross(c, d, a) * cross(c, d, b) < -EPS3 || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}
function polygon(raw) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 64) throw Error("Polygon requires 3\u201364 dimensioned vertices.");
  let p = raw.map((v) => ({ x: v.x, y: v.y }));
  if (p.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.abs(v.x) > 1e6 || Math.abs(v.y) > 1e6)) throw Error("Invalid polygon coordinates.");
  if (p[0].x === p.at(-1).x && p[0].y === p.at(-1).y) p.pop();
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    if (j === i + 1 || i === 0 && j === p.length - 1) continue;
    if (intersects(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])) throw Error("Polygon crosses or touches itself.");
  }
  if (area2(p) < EPS3) throw Error("Polygon has no usable area.");
  if (signed(p) < 0) p.reverse();
  return p;
}
function triangulate(p) {
  const points = [...p], triangles = [];
  let guard = p.length * p.length;
  while (points.length > 3 && guard--) {
    let cut = false;
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length], b = points[i], c = points[(i + 1) % points.length];
      if (Math.abs(cross(a, b, c)) < EPS3) {
        points.splice(i, 1);
        cut = true;
        break;
      }
      if (cross(a, b, c) < EPS3) continue;
      if (points.some((v) => v !== a && v !== b && v !== c && cross(a, b, v) >= -EPS3 && cross(b, c, v) >= -EPS3 && cross(c, a, v) >= -EPS3)) continue;
      triangles.push([a, b, c]);
      points.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) throw Error("Polygon triangulation failed.");
  }
  if (points.length === 3) triangles.push(points);
  else if (points.length > 3) throw Error("Polygon triangulation exceeded limit.");
  return triangles;
}
function clip(subject, triangle) {
  let out = subject;
  for (let i = 0; i < 3 && out.length; i++) {
    const a = triangle[i], b = triangle[(i + 1) % 3], input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length], dp = cross(a, b, p), dq = cross(a, b, q), pin = dp >= -EPS3, qin = dq >= -EPS3;
      if (pin) out.push(p);
      if (pin !== qin) {
        const t = dp / (dp - dq);
        out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
      }
    }
  }
  return out.length >= 3 ? area2(out) : 0;
}
var bbox = (p) => ({ minX: Math.min(...p.map((v) => v.x)), maxX: Math.max(...p.map((v) => v.x)), minY: Math.min(...p.map((v) => v.y)), maxY: Math.max(...p.map((v) => v.y)) });
function intersection(a, b) {
  const x = bbox(a.p), y = bbox(b.p);
  if (x.maxX <= y.minX + EPS3 || y.maxX <= x.minX + EPS3 || x.maxY <= y.minY + EPS3 || y.maxY <= x.minY + EPS3) return 0;
  return a.t.reduce((s, u) => s + b.t.reduce((n, v) => n + clip(u, v), 0), 0);
}
var metricKeys = ["floor_area", "ceiling_area", "wood_floor_area", "ceramic_floor_area", "epoxy_floor_area", "terrace_floor_area"];
var material = { wood: "wood_floor_area", tile: "ceramic_floor_area", epoxy: "epoxy_floor_area", outdoor: "terrace_floor_area" };
var inferred = /\binferred\b|\bassumed\b|\bremainder\b|\bderived\b|استنباط|تخمین/i;
var roomTag = (name2) => String(name2 || "").match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1]?.toUpperCase();
var labeledFinish = (r) => /\bVOID\b/i.test(r.name) || /^VOID\b/i.test(r.description) ? "void" : /^OUTDOOR\b/i.test(r.description) ? "outdoor" : /^WOOD\b|^parquet\b/i.test(r.description) ? "wood" : /^TILE\b|^ceramic\b/i.test(r.description) ? "tile" : /^EPOXY\b/i.test(r.description) ? "epoxy" : null;
function partialInventory(page, geometry2, spaces, envelopeArea, tolerance) {
  if (geometry2.basis !== "wall_centerline_zones") throw Error("Partial clear-area geometry cannot resolve missing wall footprints");
  const inventory = /* @__PURE__ */ new Map(), polygons = /* @__PURE__ */ new Map(), corrections = [], labels = [], unresolved = [];
  for (const r of spaces) {
    const tag = roomTag(r.tag);
    if (!tag || polygons.has(tag)) throw Error("Partial geometry requires unique printed room tags");
    polygons.set(tag, r);
  }
  const nativeInventory = recoverNativeRoomInventory(page, spaces);
  for (const item of nativeInventory.items) {
    if (!["m2", "m\xB2"].includes(String(item.unit).toLowerCase())) continue;
    const tag = roomTag(item.name);
    if (!tag) continue;
    if (inventory.has(tag)) throw Error(`Duplicate area inventory tag ${tag}`);
    const finish = labeledFinish(item), shape2 = polygons.get(tag);
    if (!finish || !Number.isFinite(item.quantity) || item.quantity <= 0) throw Error(`Missing printed room area/material for ${tag}`);
    if (shape2) {
      if (shape2.kind === "wall" || (finish === "void" ? shape2.kind !== "void" : finish === "outdoor" ? shape2.kind !== "outdoor" : shape2.kind !== "enclosed") || finish !== "void" && shape2.finish !== finish) throw Error(`Conflicting room identity/material for ${tag}`);
      if (Math.abs(item.quantity - shape2.quantity) > 0.01) corrections.push({ tag, reported: item.quantity, computed: shape2.quantity, evidence: shape2.evidence });
      inventory.set(tag, { ...item, quantity: shape2.quantity, finish, description: `${String(item.description).split("|")[0].trim()} | independently dimensioned polygon: ${shape2.evidence}` });
    } else {
      if (inferred.test(item.description || "")) unresolved.push(tag);
      else if (!/\bprinted\b|\breported\b|برچسب|چاپ|مذكور|مطبوعة/i.test(item.description || "")) throw Error(`Room ${tag} lacks an explicit printed area basis`);
      labels.push(tag);
      inventory.set(tag, { ...item, finish });
    }
  }
  for (const tag of polygons.keys()) if (!inventory.has(tag)) throw Error(`Dimensioned space ${tag} is absent from the tagged inventory`);
  if (unresolved.length) throw Error(`Inferred rooms still lack dimensioned polygons: ${unresolved.join(", ")}`);
  const list = [...inventory.values()], total = list.reduce((s, r) => s + r.quantity, 0);
  if (!list.length || Math.abs(total - envelopeArea) > tolerance) throw Error("Mixed polygon/printed-area inventory does not reconcile to the dimensioned envelope");
  const dimensions = { floor_area: list.filter((r) => r.finish !== "void").reduce((s, r) => s + r.quantity, 0), ceiling_area: list.filter((r) => !["void", "outdoor"].includes(r.finish)).reduce((s, r) => s + r.quantity, 0) };
  for (const [finish, key2] of Object.entries(material)) dimensions[key2] = list.filter((r) => r.finish === finish).reduce((s, r) => s + r.quantity, 0);
  const quantities = (page.page_evidence.quantities || []).filter((q) => !metricKeys.includes(q.key));
  const basis = `Partial dimensioned geometry plus printed room labels on page ${page.pageNumber}; dimensioned tags: ${[...polygons.keys()].join(", ")}; label-only tags: ${labels.join(", ")}; ${geometry2.envelope_evidence}. Inventory closure checked; unmeasured room boundaries and AI materials require review.`;
  for (const [key2, value] of Object.entries(dimensions)) quantities.push({ key: key2, value, unit: "m2", scope_id: page.page_evidence.scope_id, evidence: basis });
  const updated = { ...page, ...dimensions, __areaGeometryValidated: true, page_evidence: { ...page.page_evidence, quantities }, detected_items: nativeInventory.items.map((r) => inventory.has(roomTag(r.name)) && ["m2", "m\xB2"].includes(String(r.unit).toLowerCase()) ? Object.fromEntries(Object.entries(inventory.get(roomTag(r.name))).filter(([k]) => k !== "finish")) : r) };
  return { page: updated, audit: { page: page.pageNumber, status: "partial_geometry_with_printed_labels", basis: geometry2.basis, envelope_area: envelopeArea, covered_area: spaces.reduce((s, r) => s + r.quantity, 0), dimensioned_tags: [...polygons.keys()], label_only_tags: labels, corrections, native_inventory_recovery: nativeInventory.recovered, withheld_metrics: [] }, warnings: [`PDF page ${page.pageNumber}: partial area geometry; printed room labels retained provisionally, full room boundaries are not verified.`] };
}
function withheld(page, keys, reason) {
  const original = page.__withheldAreaClaims || { claims: (page.page_evidence?.quantities || []).filter((q) => keys.includes(q.key)), fields: Object.fromEntries(keys.filter((k) => Number.isFinite(page[k])).map((k) => [k, page[k]])) };
  const quantities = (page.page_evidence?.quantities || []).filter((q) => !keys.includes(q.key));
  const next = { ...page, __withheldAreaClaims: original, page_evidence: { ...page.page_evidence, quantities } };
  for (const key2 of keys) next[key2] = 0;
  return { page: next, audit: { page: page.pageNumber, status: "withheld", reason, withheld_metrics: keys, original_area_evidence: original }, warnings: [`PDF page ${page.pageNumber}: ${reason}; ${keys.join(", ")} withheld.`] };
}
function auditPdfAreaGeometry(page) {
  if (page.page_evidence?.kind !== "floor_plan") return { page, audit: null, warnings: [] };
  const geometry2 = page.area_geometry;
  if (!geometry2) {
    const ambiguous = (page.detected_items || []).filter((r) => ["m2", "m\xB2"].includes(String(r.unit).toLowerCase()) && inferred.test(r.description || ""));
    if (!ambiguous.length) return { page, audit: { page: page.pageNumber, status: "label_areas_only", reason: "Independent dimensioned polygons unavailable." }, warnings: [] };
    const keys = /* @__PURE__ */ new Set(["floor_area", "ceiling_area"]);
    for (const r of ambiguous) {
      const desc = String(r.description || "");
      if (/^WOOD\b/i.test(desc)) keys.add("wood_floor_area");
      else if (/^TILE\b/i.test(desc)) keys.add("ceramic_floor_area");
      else if (/^EPOXY\b/i.test(desc)) keys.add("epoxy_floor_area");
      else if (/^OUTDOOR\b/i.test(desc)) keys.add("terrace_floor_area");
      else for (const key2 of Object.values(material)) keys.add(key2);
    }
    return withheld(page, [...keys], "Inferred room areas lack independent dimensioned geometry");
  }
  try {
    if (!["wall_centerline_zones", "clear_internal"].includes(geometry2.basis) || !geometry2.envelope_evidence?.trim()) throw Error("Independent area measurement basis or envelope evidence missing");
    const envelope = polygon(geometry2.envelope), outer = { p: envelope, t: triangulate(envelope) }, envelopeArea = area2(envelope), tolerance = Math.max(0.01, envelopeArea * 1e-3);
    if (!Array.isArray(geometry2.spaces) || !geometry2.spaces.length || geometry2.spaces.length > 200) throw Error("A complete tagged space inventory is required");
    const seen = /* @__PURE__ */ new Set(), spaces = [];
    for (const r of geometry2.spaces) {
      if (!r.tag?.trim() || seen.has(r.tag.trim().toUpperCase()) || !r.evidence?.trim() || !["enclosed", "outdoor", "void", "wall"].includes(r.kind) || !["wood", "tile", "epoxy", "outdoor", "unknown"].includes(r.finish)) throw Error("Missing or duplicate room identity/material/geometry evidence");
      seen.add(r.tag.trim().toUpperCase());
      if (geometry2.coverage === "partial" && Array.isArray(r.polygon) && r.polygon.length === 0) {
        const tag = roomTag(r.tag), items = (page.detected_items || []).filter((i) => roomTag(i.name) === tag && ["m2", "m\xB2"].includes(String(i.unit).toLowerCase()));
        if (geometry2.basis !== "wall_centerline_zones" || !tag || items.length !== 1 || !Number.isFinite(r.reported_area) || r.reported_area <= 0 || Math.abs(items[0].quantity - r.reported_area) > 0.01 || !/\bprinted\b|\breported\b|\blabel\b/i.test(r.evidence) || inferred.test(items[0].description || "") || !/\bprinted\b|\breported\b|برچسب|چاپ/i.test(items[0].description || "")) throw Error(`Unmeasured space ${r.tag} lacks a consistent printed label`);
        const finish = labeledFinish(items[0]);
        if (!finish || (finish === "void" ? r.kind !== "void" : finish === "outdoor" ? r.kind !== "outdoor" : r.kind !== "enclosed") || finish !== "void" && r.finish !== finish) throw Error(`Conflicting printed-label identity/material for ${r.tag}`);
        continue;
      }
      const p = polygon(r.polygon), shape2 = { p, t: triangulate(p) }, quantity = area2(p);
      if (Math.abs(intersection(shape2, outer) - quantity) > tolerance) throw Error(`Space ${r.tag} lies outside the dimensioned envelope`);
      for (const old of spaces) if (intersection(shape2, old.shape) > tolerance) throw Error(`Spaces ${old.tag} and ${r.tag} overlap`);
      if (r.kind === "outdoor" && r.finish !== "outdoor" || r.kind === "enclosed" && r.finish === "outdoor") throw Error(`Space ${r.tag} has conflicting indoor/outdoor classification`);
      spaces.push({ ...r, quantity, shape: shape2 });
    }
    const total = spaces.reduce((s, r) => s + r.quantity, 0);
    if (geometry2.coverage === "partial") return partialInventory(page, geometry2, spaces, envelopeArea, tolerance);
    if (geometry2.coverage != null && geometry2.coverage !== "complete") throw Error("Unknown area geometry coverage mode");
    if (Math.abs(total - envelopeArea) > tolerance) throw Error("Space polygons do not cover the complete dimensioned envelope");
    const usable = (r) => ["enclosed", "outdoor"].includes(r.kind);
    const dimensions = { floor_area: spaces.filter(usable).reduce((s, r) => s + r.quantity, 0), ceiling_area: spaces.filter((r) => r.kind === "enclosed").reduce((s, r) => s + r.quantity, 0) };
    for (const [finish, key2] of Object.entries(material)) dimensions[key2] = spaces.filter((r) => usable(r) && r.finish === finish).reduce((s, r) => s + r.quantity, 0);
    const scope = page.page_evidence.scope_id, quantities = (page.page_evidence.quantities || []).filter((q) => !metricKeys.includes(q.key));
    for (const [key2, value] of Object.entries(dimensions)) quantities.push({ key: key2, value, unit: "m2", scope_id: scope, evidence: `Area computed from dimensioned, non-overlapping space polygons (${geometry2.basis}) on page ${page.pageNumber}; ${geometry2.envelope_evidence}; AI dimension transcription and materials require review.` });
    const corrections = [];
    for (const r of spaces) if (Number.isFinite(r.reported_area) && Math.abs(r.reported_area - r.quantity) > 0.01) corrections.push({ tag: r.tag, reported: r.reported_area, computed: r.quantity, evidence: r.evidence });
    const unknown = spaces.filter((r) => usable(r) && r.finish === "unknown").map((r) => r.tag);
    const measuredRooms = spaces.filter((r) => r.kind !== "wall").map((r) => ({
      name: r.tag,
      unit: "m2",
      quantity: r.quantity,
      description: `${r.kind === "void" ? "VOID" : r.kind === "outdoor" ? "OUTDOOR" : r.finish.toUpperCase()} | source dimensioned space: ${r.evidence}`
    }));
    return {
      page: {
        ...page,
        ...dimensions,
        page_evidence: { ...page.page_evidence, quantities },
        __areaGeometryValidated: true,
        detected_items: [...(page.detected_items || []).filter((i) => !["m2", "m\xB2"].includes(String(i.unit).toLowerCase())), ...measuredRooms]
      },
      audit: { page: page.pageNumber, status: "dimension_geometry_checked", basis: geometry2.basis, envelope_area: envelopeArea, covered_area: total, corrections, unknown_finish_spaces: unknown, withheld_metrics: unknown.length ? Object.values(material) : [] },
      warnings: unknown.length ? [`PDF page ${page.pageNumber}: unknown floor finishes; complete material totals withheld.`] : []
    };
  } catch (error) {
    return withheld(page, metricKeys, error.message);
  }
}

// src/lib/pdfNativeSchedules.mjs
var clean = (s) => String(s || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
var headers = { id: /^(?:id|tag|mark|reference)$/, host: /^(?:host wall|wall|host)$/, kind: /^(?:type|opening type|description)$/, width: /^width(?:\s*\((?:mm|m)\))?$/, height: /^height(?:\s*\((?:mm|m)\))?$/, sill: /^sill(?:\s*height)?(?:\s*\((?:mm|m)\))?$/, quantity: /^(?:quantity|qty|count)$/ };
var kindOf = (s) => /^(?:garage door|overhead door|roller shutter)$/.test(clean(s)) ? "garage_door" : /^(?:door|internal door|external door|entrance door|service door|main door)$/.test(clean(s)) ? "door" : /^(?:window|glazed window)$/.test(clean(s)) ? "window" : null;
var dimension = (s) => /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
function tableUnit(spans, head, inherited) {
  const text = spans.filter((s) => s.y > head.y).map((s) => s.text).join(" ");
  const source2 = [...text.matchAll(/(?:all\s+)?dimensions\s+(?:are\s+|in\s+)(millimet(?:er|re)s?|met(?:er|re)s?|mm|m)\b/gi)].map((m) => /^mm|^milli/i.test(m[1]) ? 1e-3 : 1);
  const fromHeaders = ["width", "height"].map((k) => head.cols.find((c) => c.key === k)?.text.match(/\((mm|m)\)/i)?.[1]).filter(Boolean).map((u) => u.toLowerCase() === "mm" ? 1e-3 : 1);
  const signature = head.cols.map((c) => `${c.key}:${Math.round(c.x - head.cols[0].x)}`).join("|");
  const factors = [...source2, ...fromHeaders];
  if (!factors.length && inherited?.signature === signature && inherited.allow_continuation) return { ...inherited };
  if (!factors.length || new Set(factors).size !== 1) throw Error("Missing or conflicting schedule dimension units");
  return { factor: factors[0], signature, allow_continuation: /all\s+dimensions\s+(?:are|in)\s+/i.test(text) };
}
function readNativeOpeningSchedule(page, normalizeScope, inherited) {
  const native = page.native_text_evidence;
  if (native?.version !== 1 || native.status !== "readable") return { status: "unavailable", rows: [] };
  const spans = native.spans, scope = normalizeScope(page.page_evidence?.scope_id);
  if (!scope || scope === "project") return { status: "pending", reason: "Schedule floor scope is unresolved", rows: [] };
  try {
    const heads = [];
    for (const s of spans.filter((s2) => headers.id.test(clean(s2.text)))) {
      const band = spans.filter((x) => Math.abs(x.y - s.y) < Math.min(2, s.height * 0.2));
      const cols = [];
      for (const x of band) {
        const key2 = Object.keys(headers).find((k) => headers[k].test(clean(x.text)));
        if (key2) cols.push({ ...x, key: key2 });
      }
      if (["id", "kind", "width", "height"].every((k) => cols.filter((c) => c.key === k).length === 1)) heads.push({ y: s.y, cols: cols.sort((a, b) => a.x - b.x) });
    }
    if (heads.length !== 1) throw Error("A single complete opening table is required per schedule page");
    const head = heads[0], dimension_basis = tableUnit(spans, head, inherited), factor = dimension_basis.factor, rows = [], ids = /* @__PURE__ */ new Set();
    const printed = spans.filter((s) => s.y > head.y && s.y - head.y < 100 && /^(?:ground|first|second|third|basement|roof|floor\s+\d+)(?:\s+floor)?$/i.test(s.text.trim())).map((s) => normalizeScope(s.text));
    if (printed.length !== 1 || printed[0] !== scope) throw Error("Printed schedule floor does not match selected scope");
    const below = spans.filter((s) => s.y < head.y - 3).sort((a, b) => b.y - a.y || a.x - b.x), bands = [];
    for (const s of below) {
      let b = bands.find((b2) => Math.abs(b2.y - s.y) < 2);
      if (!b) {
        b = { y: s.y, spans: [] };
        bands.push(b);
      }
      b.spans.push(s);
    }
    for (const band of bands) {
      const cells = {};
      for (const s of band.spans) {
        let nearest = head.cols.reduce((a, b) => Math.abs(s.x - a.x) <= Math.abs(s.x - b.x) ? a : b);
        if (Math.abs(s.x - nearest.x) > 20) continue;
        (cells[nearest.key] ??= []).push(s.text.trim());
      }
      if (!cells.kind && !cells.width && !cells.height) {
        if (cells.id?.some((s) => /^[A-Za-z][A-Za-z0-9._/-]{1,39}$/.test(s))) throw Error("Tagged row without dimensions; partial schedule withheld");
        continue;
      }
      const raw = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.join(" ")])), kind = kindOf(raw.kind);
      if (head.cols.some((c) => c.key === "quantity") && raw.quantity !== "1") throw Error("Multi-instance or missing schedule row quantity requires explicit instance mapping");
      if (!kind || !raw.id || !/^[\p{L}\p{N}][\p{L}\p{N}._/-]{0,39}$/u.test(raw.id)) throw Error("Unrecognized opening row; partial table withheld");
      const width = dimension(raw.width), height = dimension(raw.height), sill = raw.sill === void 0 ? null : dimension(raw.sill);
      if (!(width > 0) || !(height > 0) || width * factor > 50 || height * factor > 50 || sill !== null && (!(sill >= 0) || sill * factor > 50) || head.cols.some((c) => c.key === "sill") && sill === null) throw Error("Missing or invalid opening dimensions");
      const id = raw.id.toLowerCase();
      if (ids.has(id)) throw Error("Repeated opening tag in schedule");
      ids.add(id);
      rows.push({ id: raw.id, wall_id: raw.host || null, kind, width: width * factor, height: height * factor, sill: sill === null ? null : sill * factor, page: page.pageNumber, source_row: Object.values(raw).join(" | ") });
    }
    if (!rows.length || rows.length > 1e3) throw Error("Empty or excessive opening schedule");
    dimension_basis.pages = [.../* @__PURE__ */ new Set([...inherited && dimension_basis.pages || [], page.pageNumber])];
    for (const row of rows) row.dimension_pages = dimension_basis.pages;
    return { status: "read", scope_id: scope, page: page.pageNumber, rows, dimension_basis };
  } catch (e) {
    return { status: "pending", reason: e.message, page: page.pageNumber, rows: [] };
  }
}
function nativeOpeningEvidence(pages, normalizeScope) {
  const schedules = [];
  for (const p of pages.filter((p2) => p2.page_evidence?.kind === "opening_schedule").sort((a, b) => a.pageNumber - b.pageNumber)) {
    const previous = schedules.at(-1), inherited = previous?.status === "read" && previous.page === p.pageNumber - 1 ? previous.dimension_basis : null;
    schedules.push(readNativeOpeningSchedule(p, normalizeScope, inherited));
  }
  const floors = pages.filter((p) => p.page_evidence?.kind === "floor_plan").map((p) => normalizeScope(p.page_evidence.scope_id));
  const warnings = [], claims = [], blocked = [];
  if (!schedules.some((s) => s.status === "read")) return { claims, blocked, warnings, schedules };
  if (new Set(floors).size !== floors.length || schedules.some((s) => s.status !== "read") || schedules.length !== floors.length || floors.some((f) => schedules.filter((s) => s.scope_id === f).length !== 1)) {
    warnings.push("Native opening schedule coverage incomplete; partial native totals withheld");
    return { claims, blocked, warnings, schedules };
  }
  for (const s of schedules) {
    for (const [kind, key2] of [["door", "door_count"], ["window", "window_count"]]) {
      const rows = s.rows.filter((r) => kind === "door" ? r.kind === "door" || r.kind === "garage_door" : r.kind === "window");
      for (const [metric, value, unit2] of [[key2, rows.length, "nr"], [`${kind}_area`, rows.reduce((v, r) => v + r.width * r.height, 0), "m2"]]) claims.push({
        key: metric,
        value,
        unit: unit2,
        scope_id: s.scope_id,
        pages: s.dimension_basis.pages,
        native_calculated: true,
        document_calculated: true,
        evidence: `Native PDF opening table, complete source rows including garage doors: ${rows.map((r) => r.source_row).join("; ")}. Dimensions read from printed table and source units; specification requires review.`
      });
    }
  }
  return { claims, blocked, warnings, schedules };
}

// src/lib/pdfSourceMeasurements.mjs
var PDF_SOURCE_MEASUREMENT_KEYS = ["internal_wall_length", "external_wall_length", "wall_length", "wall_area", "internal_block_area", "external_block_area", "plaster_area", "paint_area", "wet_wall_tile_area", "wet_wall_waterproofing_area", "ceiling_paint_area", "gypsum_ceiling_area"];
var floorScope = (s) => String(s || "").trim().toLowerCase().replace(/[ _-]+/g, " ");
var canon = (s) => ["ground floor", "ground", "gf", "floor 0"].includes(floorScope(s)) ? "floor:0" : ["first floor", "first", "ff", "floor 1"].includes(floorScope(s)) ? "floor:1" : floorScope(s);
var name = (s) => String(s || "").trim().toLowerCase();
var roomTag2 = (s) => String(s || "").match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1]?.toLowerCase();
var unique = (rows, key2) => {
  const ids = rows.map((r) => name(r[key2]));
  if (ids.some((s) => !s) || new Set(ids).size !== ids.length) throw Error(`Missing or duplicated ${key2}`);
};
function calculatePdfSourceMeasurements(basis, pages, metricUnits, availablePages) {
  const calculations = [], blocked = /* @__PURE__ */ new Set(), issues = [];
  const source2 = (s, unit2) => {
    if (!s || !Number.isFinite(s.value) || s.value < 0 || s.value > 1e6 || !s.evidence?.trim() || !s.pages?.length || s.pages.some((p) => !availablePages.has(p))) throw Error("Missing or unsourced source dimension");
    return { value: s.value, unit: unit2, operation: "multiply", pages: s.pages, evidence: s.evidence, clip: null };
  };
  const rule = (r) => {
    if (typeof r?.value !== "boolean" || !r.evidence?.trim() || !r.pages?.length || r.pages.some((p) => !availablePages.has(p))) throw Error("Missing source finish rule");
    return r;
  };
  const term = (id, operation, factors) => ({ id, operation, factors });
  const add = (key2, terms, evidence) => calculations.push({ key: key2, scope_id: "project", terms, evidence });
  const tryGroup = (keys, work) => {
    try {
      work();
    } catch (e) {
      keys.forEach((k) => blocked.add(k));
      issues.push(`${keys.join(", ")}: ${e.message}`);
    }
  };
  const selected = pages.filter((p) => p.page_evidence?.kind === "floor_plan");
  const native = nativeOpeningEvidence(pages, canon);
  const floors = basis?.floors || [];
  let matched = [];
  tryGroup(PDF_SOURCE_MEASUREMENT_KEYS, () => {
    if (!floors.length || floors.length > 30 || floors.length !== selected.length) throw Error("Source basis does not cover every selected floor");
    unique(floors, "scope_id");
    if (new Set(floors.map((f) => canon(f.scope_id))).size !== floors.length) throw Error("Repeated floor aliases");
    matched = floors.map((f) => {
      const found = selected.filter((p) => canon(p.page_evidence.scope_id) === canon(f.scope_id));
      if (found.length !== 1) throw Error("Unresolved source floor identity");
      return { f, page: found[0] };
    });
  });
  if (!matched.length) return { calculations, blocked: [...blocked], issues };
  const wallTerms = { internal: [], external: [] }, wallLengths = { internal: [], external: [] }, openingIndex = /* @__PURE__ */ new Map();
  let plasterTerms = [], tileTerms = [];
  tryGroup(["internal_wall_length", "external_wall_length", "wall_length", "wall_area", "internal_block_area", "external_block_area", "paint_area"], () => {
    for (const { f } of matched) {
      if (!f.walls_complete || !f.wall_inventory_evidence?.trim() || !f.source_pages?.length || f.source_pages.some((p) => !availablePages.has(p)) || !f.walls?.length || f.walls.length > 500 || !Array.isArray(f.openings) || f.openings.length > 1e3) throw Error("Incomplete wall/opening inventory");
      unique(f.walls, "id");
      unique(f.openings, "id");
      const prefix = canon(f.scope_id), walls = new Map(f.walls.map((w) => [name(w.id), w]));
      for (const w of f.walls) {
        if (!["internal", "external"].includes(w.classification) || !["printed_dimensions", "calibrated_geometry"].includes(w.length_basis)) throw Error("Unresolved wall class or dimensional basis");
        const length = source2(w.length, "m"), height = source2(w.height, "m");
        if (length.value <= 0 || height.value <= 0) throw Error("Zero wall dimensions");
        const id = `${prefix}:${w.id}`;
        wallLengths[w.classification].push(term(`${id}:length`, "add", [length]));
        wallTerms[w.classification].push(term(`${id}:gross`, "add", [length, height]));
        let openingArea = 0;
        for (const o of f.openings.filter((o2) => name(o2.wall_id) === name(w.id))) {
          const width = source2(o.width, "m"), oh = source2(o.height, "m"), sill = source2(o.sill, "m");
          if (!["door", "window"].includes(o.kind) || width.value <= 0 || oh.value <= 0 || width.value > length.value || oh.value + sill.value > height.value + 1e-6) throw Error("Opening dimensions exceed its host wall");
          openingArea += width.value * oh.value;
          wallTerms[w.classification].push(term(`${prefix}:${o.id}:opening`, "subtract", [width, oh]));
          openingIndex.set(`${prefix}:${name(o.id)}`, o);
        }
        if (openingArea > length.value * height.value + 1e-6) throw Error("Opening areas exceed host face area");
      }
      if (f.openings.some((o) => !walls.has(name(o.wall_id)))) throw Error("Opening host wall is missing");
      const nativeRows = native.claims.length ? native.schedules.find((s) => s.scope_id === prefix)?.rows : null;
      if (nativeRows) {
        if (nativeRows.length !== f.openings.length) throw Error("Opening inventory does not cover native source tags");
        for (const row of nativeRows) {
          const o = f.openings.find((o2) => name(o2.id) === name(row.id));
          if (!o || o.kind !== (row.kind === "window" ? "window" : "door") || Math.abs(o.width.value - row.width) > 1e-6 || Math.abs(o.height.value - row.height) > 1e-6 || row.sill !== null && Math.abs(o.sill.value - row.sill) > 1e-6 || row.wall_id && name(o.wall_id) !== name(row.wall_id)) throw Error("Opening facts conflict with native schedule dimensions or host");
        }
      }
      for (const kind of ["door", "window"]) {
        const key2 = `${kind}_count`, candidates = (native.claims.length ? native.claims : pages.flatMap((p) => (p.page_evidence?.quantities || []).filter((q) => p.page_evidence.kind === "opening_schedule" || q.document_calculated))).filter((q) => q.key === key2 && canon(q.scope_id) === prefix && q.unit === "nr");
        if (candidates.some((q) => q.value !== f.openings.filter((o) => o.kind === kind).length)) throw Error("Opening ledger does not reconcile to source schedule count");
      }
    }
    for (const cls of ["internal", "external"]) {
      if (!wallTerms[cls].length) throw Error("Both wall classes require complete source coverage");
      add(`${cls}_wall_length`, wallLengths[cls], "Complete source wall centreline inventory, shared walls counted once");
      add(`${cls}_block_area`, wallTerms[cls], "Net wall face area: source lengths \xD7 heights minus each hosted opening once");
    }
    add("wall_length", [...wallLengths.internal, ...wallLengths.external], "Complete internal and external wall inventory");
    add("wall_area", [...wallTerms.internal, ...wallTerms.external], "Net single wall faces, by source classification");
  });
  tryGroup(["plaster_area", "paint_area"], () => {
    if (blocked.has("internal_block_area") || blocked.has("external_block_area")) throw Error("Plaster needs complete net wall faces");
    const faces = { internal: source2(basis.rules.plaster_internal_faces, "count"), external: source2(basis.rules.plaster_external_faces, "count") };
    if (Object.values(faces).some((s) => !Number.isInteger(s.value) || s.value > 2)) throw Error("Invalid plaster face rule");
    plasterTerms = ["internal", "external"].flatMap((cls) => wallTerms[cls].map((t) => ({ ...t, id: `plaster:${t.id}`, factors: [...t.factors, faces[cls]] })));
    add("plaster_area", plasterTerms, "Source plaster face convention applied to net walls");
  });
  tryGroup(["wet_wall_tile_area", "wet_wall_waterproofing_area"], () => {
    const tileHeight = source2(basis.rules.wet_tile_height, "m"), membraneHeight = source2(basis.rules.wet_waterproof_height, "m");
    const wetTerms = (height) => matched.flatMap(({ f }) => {
      if (!f.wet_rooms_complete || !Array.isArray(f.wet_rooms) || f.wet_rooms.length > 500) throw Error("Incomplete wet-room boundary inventory");
      unique(f.wet_rooms, "id");
      return f.wet_rooms.flatMap((r) => {
        const prefix = canon(f.scope_id);
        if (!r.boundary_complete || !Array.isArray(r.boundary_lengths) || r.boundary_lengths.length < 3 || r.boundary_lengths.length > 100) throw Error("Missing complete wet-room boundary");
        const terms = r.boundary_lengths.map((side, i) => {
          const length = source2(side, "m");
          if (length.value <= 0) throw Error("Zero wet-room boundary side");
          return term(`${prefix}:${r.id}:wet-side-${i}`, "add", [length, height]);
        });
        if (!Array.isArray(r.opening_ids) || new Set(r.opening_ids.map(name)).size !== r.opening_ids.length) throw Error("Repeated wet-room opening");
        for (const id of r.opening_ids) {
          const o = openingIndex.get(`${prefix}:${name(id)}`);
          if (!o) throw Error("Wet-room opening is not in the source host ledger");
          const width = source2(o.width, "m"), h = source2(o.height, "m"), sill = source2(o.sill, "m");
          terms.push(term(`${prefix}:${r.id}:${id}:wet-opening`, "subtract", [width, {
            value: null,
            unit: "m",
            operation: "multiply",
            pages: [.../* @__PURE__ */ new Set([...h.pages, ...sill.pages, ...height.pages])],
            evidence: `${h.evidence}; ${sill.evidence}; ${height.evidence}`,
            clip: { opening_height_m: h.value, sill_m: sill.value, finish_height_m: height.value }
          }]));
        }
        return terms;
      });
    });
    tileTerms = wetTerms(tileHeight);
    const membrane = wetTerms(membraneHeight);
    if (!tileTerms.length) throw Error("Wet-room scope is not confirmed");
    add("wet_wall_tile_area", tileTerms, "Wet-room perimeters \xD7 source tile height, openings clipped to that height");
    add("wet_wall_waterproofing_area", membrane, "Wet-room perimeters \xD7 source membrane height, openings clipped to that height");
  });
  tryGroup(["paint_area"], () => {
    if (!plasterTerms.length || blocked.has("plaster_area")) throw Error("Wall paint needs the complete net plaster basis");
    if (!rule(basis.rules.paint_uses_plastered_faces).value) throw Error("Source paint face convention is not confirmed");
    const paintTerms = [...plasterTerms];
    if (rule(basis.rules.paint_excludes_wet_tiles).value) {
      if (blocked.has("wet_wall_tile_area") || !tileTerms.length) throw Error("Wall paint exclusion needs a complete wet tile basis");
      paintTerms.push(...tileTerms.map((t) => ({ ...t, id: `paint-exclude:${t.id}`, operation: t.operation === "add" ? "subtract" : "add" })));
    }
    if (rule(basis.rules.paint_excludes_backsplash).value) paintTerms.push(term("paint-exclude:backsplash", "subtract", [source2(basis.rules.backsplash_length, "m"), source2(basis.rules.backsplash_height, "m")]));
    add("paint_area", paintTerms, "Explicit source paint face and exclusion convention");
  });
  tryGroup(["ceiling_paint_area"], () => {
    const paint = rule(basis.rules.paint_enclosed_ceilings);
    if (!paint.value) throw Error("Enclosed ceiling paint rule is not confirmed");
    const terms = matched.map(({ page }) => {
      const checked = auditPdfAreaGeometry(page);
      if (!checked.page.__areaGeometryValidated || checked.audit?.withheld_metrics?.includes("ceiling_area") || !(checked.page.ceiling_area > 0)) throw Error("Audited enclosed ceiling area unavailable");
      return term(`${canon(page.page_evidence.scope_id)}:enclosed-ceiling-paint`, "add", [source2({ value: checked.page.ceiling_area, pages: [.../* @__PURE__ */ new Set([page.pageNumber, ...page.document_area_source_pages || [], ...paint.pages])], evidence: `Audited enclosed ceiling area; ${paint.evidence}` }, "m2")]);
    });
    add("ceiling_paint_area", terms, "Explicit paint-all-enclosed rule applied independently of gypsum exclusions");
  });
  tryGroup(["gypsum_ceiling_area"], () => {
    const gypsumRule = rule(basis.rules.gypsum_exclusions_confirmed);
    if (!gypsumRule.value) throw Error("Source gypsum finish rule is not confirmed");
    const gypsumTerms = [];
    for (const { f, page } of matched) {
      const checked = auditPdfAreaGeometry(page);
      if (checked.audit?.withheld_metrics?.includes("ceiling_area") || !f.ceilings_complete || !Array.isArray(f.ceiling_spaces)) throw Error("Ceiling areas or finish coverage remain unresolved");
      const indoor = (checked.page.detected_items || []).filter((i) => ["m2", "m\xB2"].includes(String(i.unit).toLowerCase()) && i.quantity > 0 && !/\bvoid\b|\bterrace\b|\bbalcony\b/i.test(i.name) && !/^VOID\b|^OUTDOOR\b/i.test(i.description));
      unique(f.ceiling_spaces, "room_name");
      if (!indoor.length || Math.abs(indoor.reduce((s, i) => s + i.quantity, 0) - checked.page.ceiling_area) > 0.01 || f.ceiling_spaces.length !== indoor.length) throw Error("Ceiling inventory does not reconcile to audited enclosed area");
      const used = /* @__PURE__ */ new Set();
      let measuredCeilingArea = 0;
      for (const r of f.ceiling_spaces) {
        const matching = indoor.filter((i) => name(i.name) === name(r.room_name) || roomTag2(i.name) && roomTag2(i.name) === roomTag2(r.room_name));
        if (matching.length !== 1 || used.has(matching[0].name)) throw Error("Unknown or repeated ceiling room identity");
        used.add(matching[0].name);
        if (typeof r.include_gypsum !== "boolean" || !r.evidence?.trim() || !r.pages?.length || r.pages.some((p) => !availablePages.has(p))) throw Error("Missing source gypsum room classification");
        const item = matching[0], nativeArea = r.native_area ? source2(r.native_area, "m2") : null;
        measuredCeilingArea += nativeArea?.value ?? item.quantity;
        const id = `${canon(f.scope_id)}:${item.name}:ceiling`, factor = {
          value: nativeArea?.value ?? item.quantity,
          unit: "m2",
          operation: "multiply",
          clip: null,
          pages: [.../* @__PURE__ */ new Set([page.pageNumber, ...gypsumRule.pages, ...r.pages, ...nativeArea?.pages || []])],
          evidence: `${nativeArea?.evidence || `Audited source room area: ${item.name}; ${item.description}`}; ${gypsumRule.evidence}; ${r.evidence}`
        };
        if (r.include_gypsum) gypsumTerms.push(term(id, "add", [factor]));
      }
      if (Math.abs(measuredCeilingArea - checked.page.ceiling_area) > 0.01) throw Error("Native room areas do not close the audited enclosed ceiling scope");
    }
    if (!gypsumTerms.length) throw Error("No confirmed gypsum scope");
    add("gypsum_ceiling_area", gypsumTerms, "Audited room areas with source gypsum exclusions");
  });
  return { calculations: calculations.filter((c) => !blocked.has(c.key)), blocked: [...blocked], issues };
}

// src/lib/pdfNativeDocumentCalculations.mjs
function nativePdfDocumentCalculations(pages, review, validate2) {
  const calculations = [], issues = [], readable = pages.filter((p) => p.native_text_evidence?.status === "readable");
  const texts = readable.map((p) => ({ page: p.pageNumber, text: [...p.native_text_evidence.spans].sort((a, b) => b.y - a.y || a.x - b.x).map((s) => s.text).join(" ") }));
  const cabinets = [];
  for (const p of texts.filter((p2) => pages.find((x) => x.pageNumber === p2.page)?.page_evidence?.kind === "specification")) {
    const matches = [...p.text.matchAll(/\bbase cabinets?\s+measured\s+((?:\d+(?:\.\d+)?\s*\+\s*)+\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)\s+linear met(?:re|er)s\b/gi)];
    for (const m of matches) {
      const lengths = m[1].split("+").map(Number);
      if (lengths.length > 20 || lengths.some((v) => !Number.isFinite(v) || v <= 0) || Math.abs(lengths.reduce((a, b) => a + b, 0) - Number(m[2])) > 1e-6) {
        issues.push("Printed cabinet equation is inconsistent");
        continue;
      }
      cabinets.push({ key: "kitchen_cabinet_length", scope_id: "project", evidence: `Original PDF explicit cabinet measurement equation: ${m[0]}`, terms: lengths.map((v, i) => ({ id: `native-cabinet-leg:${i + 1}`, operation: "add", factors: [{ value: v, unit: "m", operation: "multiply", pages: [p.page], evidence: m[0], clip: null }] })) });
    }
  }
  if (cabinets.length === 1) calculations.push(cabinets[0]);
  else if (cabinets.length > 1) issues.push("Multiple cabinet statements require physical scope reconciliation");
  const convention = texts.filter((p) => /slab soffit includes beam (?:undersides|soffits)/i.test(p.text) && /beam formwork contains ONLY two downstand sides/i.test(p.text));
  if (convention.length === 1) {
    const terms = [];
    let valid2 = true;
    for (const [key2, label] of [["first_slab_volume", "First"], ["roof_slab_volume", "Roof"]]) {
      const candidates = (review.calculations || []).filter((c2) => c2.key === key2), thicknesses = texts.filter((p) => /All dimensions (?:in|are) metres/i.test(p.text)).flatMap((p) => [...p.text.matchAll(new RegExp(`\\b${label} slab:\\s*(\\d*\\.\\d+|\\d+)\\s*;\\s*omit\\s+(\\d+(?:\\.\\d+)?)\\s*x\\s*(\\d+(?:\\.\\d+)?)\\s+(?:stair void|terrace)\\b`, "gi"))].map((m) => ({ value: Number(m[1]), omit: [Number(m[2]), Number(m[3])].sort((a, b) => a - b), page: p.page, evidence: m[0] })));
      if (candidates.length !== 1 || thicknesses.length !== 1 || !(thicknesses[0].value > 0)) {
        valid2 = false;
        break;
      }
      const c = candidates[0], t = thicknesses[0];
      try {
        validate2(c);
      } catch {
        valid2 = false;
        break;
      }
      if (c.terms.length !== 2 || c.terms.filter((x) => x.operation === "add").length !== 1 || c.terms.filter((x) => x.operation === "subtract").length !== 1) {
        valid2 = false;
        break;
      }
      const envelopePairs = pages.filter((p) => p.page_evidence?.kind === "floor_plan" && c.terms.some((term) => term.factors.some((f) => f.pages.includes(p.pageNumber)))).flatMap((p) => (p.native_plan_text?.spans || []).flatMap((s) => [...s.text.matchAll(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s+envelope\b/gi)].map((m) => [Number(m[1]), Number(m[2])].sort((a, b) => a - b))));
      const uniqueEnvelopes = [...new Map(envelopePairs.map((pair) => [pair.join(","), pair])).values()];
      if (uniqueEnvelopes.length !== 1) {
        valid2 = false;
        break;
      }
      for (const term of c.terms) {
        const eligible = term.factors.filter((f) => f.operation === "multiply" && !f.clip && ["m", "mm"].includes(f.unit) && /slab thickness/i.test(f.evidence) && Math.abs(f.value * (f.unit === "mm" ? 1e-3 : 1) - t.value) < 1e-7 && f.pages.includes(t.page));
        if (eligible.length !== 1) {
          valid2 = false;
          break;
        }
        const remaining = term.factors.filter((f) => f !== eligible[0]), expected = term.operation === "add" ? uniqueEnvelopes[0] : t.omit;
        const measured = remaining.map((f) => f.operation === "multiply" && !f.clip && ["m", "mm"].includes(f.unit) ? f.value * (f.unit === "mm" ? 1e-3 : 1) : NaN).sort((a, b) => a - b);
        if (measured.length !== 2 || measured.some((n, i) => !Number.isFinite(n) || Math.abs(n - expected[i]) > 1e-6)) {
          valid2 = false;
          break;
        }
        terms.push({ ...term, id: `native-soffit:${key2}:${term.id}`, factors: remaining.map((f) => ({ ...f, pages: [.../* @__PURE__ */ new Set([...f.pages, t.page, convention[0].page])], evidence: `${f.evidence}; original source ${t.evidence}; envelope ${uniqueEnvelopes[0].join(" x ")} m` })) });
      }
    }
    if (valid2 && terms.length) calculations.push({ key: "slab_formwork_area", scope_id: "project", terms, evidence: `Source suspended first/roof slab volume operands divided by their explicit source thickness; source page ${convention[0].page}: slab soffit includes beam undersides. Full original volume calculations and remaining area units validated; beam strips are not added again. Source operand transcription still requires review.` });
    else issues.push("Slab soffit could not be derived from complete source thickness/volume operands");
  }
  return { calculations, issues };
}

// src/lib/pdfNativeWallGeometry.mjs
var EPS4 = 1e-5;
var near = (a, b) => Math.abs(a - b) < EPS4;
var round = (n) => Math.round(n * 1e6) / 1e6;
var dist2 = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
var signed2 = (p) => p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length];
  return s + a.x * b.y - b.x * a.y;
}, 0) / 2;
function contains(poly, p) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (poly[i].y > p.y !== poly[j].y > p.y && p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) yes = !yes;
  return yes;
}
function facesOf(walls) {
  const nodes = /* @__PURE__ */ new Map(), edges2 = [];
  const node = (p) => {
    const id = `${round(p.x)},${round(p.y)}`;
    if (!nodes.has(id)) nodes.set(id, { ...p, id, to: [] });
    return nodes.get(id);
  };
  for (const w of walls) {
    const points = [w.a, w.b];
    for (const other of walls) for (const p of [other.a, other.b]) if (dist2(p, w.a, w.b) < EPS4) points.push(p);
    for (const other of walls) if (w.axis !== other.axis) {
      const h = w.axis === "h" ? w : other, v = w.axis === "v" ? w : other, p = { x: v.a.x, y: h.a.y };
      if (dist2(p, h.a, h.b) < EPS4 && dist2(p, v.a, v.b) < EPS4) points.push(p);
    }
    const sorted = [...new Map(points.map((p) => [`${round(p.x)},${round(p.y)}`, p])).values()].sort((a, b) => w.axis === "h" ? a.x - b.x : a.y - b.y);
    for (let i = 1; i < sorted.length; i++) {
      const a = node(sorted[i - 1]), b = node(sorted[i]);
      if (!a.to.includes(b.id)) {
        a.to.push(b.id);
        b.to.push(a.id);
        edges2.push([a.id, b.id], [b.id, a.id]);
      }
    }
  }
  for (const n of nodes.values()) n.to.sort((a, b) => Math.atan2(nodes.get(a).y - n.y, nodes.get(a).x - n.x) - Math.atan2(nodes.get(b).y - n.y, nodes.get(b).x - n.x));
  const visited = /* @__PURE__ */ new Set(), faces = [];
  for (const edge of edges2) {
    let [a, b] = edge;
    const start = a + "|" + b;
    if (visited.has(start)) continue;
    const polygon2 = [];
    let closed = false;
    for (let guard = 0; guard <= edges2.length; guard++) {
      const id = a + "|" + b;
      if (visited.has(id)) {
        closed = id === start;
        break;
      }
      visited.add(id);
      polygon2.push(nodes.get(a));
      const n = nodes.get(b), index = n.to.indexOf(a), next = n.to[(index + n.to.length - 1) % n.to.length];
      a = b;
      b = next;
    }
    if (closed && polygon2.length >= 3 && signed2(polygon2) > EPS4) faces.push({ polygon: polygon2.map(({ x, y }) => ({ x, y })), area: signed2(polygon2) });
  }
  return faces;
}
function measureNativeWallFloor(page, schedule) {
  const audit = { page: page.pageNumber, status: "pending", method: "calibrated_centreline_graph", warnings: [] };
  try {
    const text = page.native_plan_text, graphics = page.native_graphics;
    if (text?.status !== "readable" || graphics?.status !== "readable" || schedule?.status !== "read") throw Error("Readable plan text, vectors and complete opening table are required");
    if (graphics.strokes.length > 5e3 || schedule.rows.length > 300) throw Error("Native wall graph size limit; independent extraction required");
    const all = text.spans.map((s) => s.text).join(" "), envelopes = [...all.matchAll(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s+envelope\b/gi)];
    const declared = [...all.matchAll(/all dimensions (?:in|are)\s*(millimet(?:re|er)s|centimet(?:re|er)s|met(?:re|er)s|mm|cm|m)\b/gi)].map((m) => /^milli|^mm$/i.test(m[1]) ? 1e-3 : /^centi|^cm$/i.test(m[1]) ? 0.01 : 1);
    if (envelopes.length !== 1 || !declared.length || new Set(declared).size !== 1 || !/datum\s*:\s*wall cent(?:re|er)lines/i.test(all)) throw Error("Explicit metric envelope and wall-centreline datum are required");
    const dimensionFactor = declared[0], ew = Number(envelopes[0][1]) * dimensionFactor, eh = Number(envelopes[0][2]) * dimensionFactor, ext = all.match(/External:\s*(\d+(?:\.\d+)?)\s*mm/i), int = all.match(/Internal:\s*(\d+(?:\.\d+)?)\s*mm/i);
    if (!(ew > 0 && eh > 0) || !ext || !int || !(Number(ext[1]) > 0 && Number(int[1]) > 0) || Number(ext[1]) === Number(int[1])) throw Error("Two explicit distinct source wall thickness classes are required");
    const styles = /* @__PURE__ */ new Map();
    for (const s of graphics.strokes) {
      if (s.dash?.length) continue;
      const id = s.width.toFixed(5) + "|" + s.color.map((n) => n.toFixed(5)).join(",");
      if (!styles.has(id)) styles.set(id, { width: s.width, color: s.color, paths: [] });
      styles.get(id).paths.push(s);
    }
    if (styles.size > 50) throw Error("Excessive source line styles");
    const pairs = [];
    for (const outer2 of styles.values()) for (const inner2 of styles.values()) {
      if (!(outer2.width > 0 && inner2.width > 0) || outer2.width === inner2.width || JSON.stringify(outer2.color) !== JSON.stringify(inner2.color) || Math.abs(outer2.width / inner2.width - Number(ext[1]) / Number(int[1])) > 0.01) continue;
      if (outer2.paths.some((p) => p.curved) || inner2.paths.some((p) => p.curved)) continue;
      const pts = outer2.paths.flatMap((s) => s.segments.flatMap((l) => [l.a, l.b]));
      if (!pts.length) continue;
      const x02 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x)), y02 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y)), sx = (x1 - x02) / ew, sy = (y1 - y02) / eh;
      if (sx > 0 && Math.abs(sx - sy) / sx < 1e-3) pairs.push({ outer: outer2, inner: inner2, x0: x02, y0: y02, scale: (sx + sy) / 2 });
    }
    if (pairs.length !== 1) throw Error("Wall stroke classes or envelope calibration are ambiguous");
    const { outer, inner, x0, y0, scale } = pairs[0], toMetres = (p) => ({ x: round((p.x - x0) / scale), y: round((p.y - y0) / scale) });
    const numeric = text.spans.filter((s) => /^\d+(?:\.\d+)?$/.test(s.text));
    const widthAnchors = numeric.filter((s) => near(Number(s.text) * dimensionFactor, ew) && Math.abs(s.angle || 0) < EPS4 && s.y < y0 && y0 - s.y < 6 * s.height && Math.abs(s.x - (x0 + ew * scale / 2)) < 2 * s.height);
    const heightAnchors = numeric.filter((s) => near(Number(s.text) * dimensionFactor, eh) && Math.abs(Math.abs(s.angle || 0) - Math.PI / 2) < EPS4 && s.x < x0 && x0 - s.x < 6 * s.height && Math.abs(s.y - (y0 + eh * scale / 2)) < 2 * s.height);
    if (widthAnchors.length !== 1 || heightAnchors.length !== 1) throw Error("Independent overall dimension anchors do not confirm the envelope scale");
    const spans = text.spans.filter((s) => Math.abs(s.angle || 0) < EPS4).map((s) => ({ ...s, ...toMetres(s), height: s.height / scale }));
    const groups = /* @__PURE__ */ new Map();
    for (const [style, classification] of [[outer, "external"], [inner, "internal"]]) for (const path of style.paths) for (const segment of path.segments) {
      let a = toMetres(segment.a), b = toMetres(segment.b);
      if (Math.hypot(b.x - a.x, b.y - a.y) < EPS4) continue;
      const axis = near(a.y, b.y) ? "h" : near(a.x, b.x) ? "v" : null;
      if (!axis) throw Error("Only orthogonal centreline walls are supported");
      if (axis === "h" ? a.x > b.x : a.y > b.y) [a, b] = [b, a];
      const fixed = axis === "h" ? a.y : a.x, id = `${classification}:${axis}:${fixed}`;
      if (!groups.has(id)) groups.set(id, { classification, axis, fixed, pieces: [] });
      groups.get(id).pieces.push({ a: axis === "h" ? a.x : a.y, b: axis === "h" ? b.x : b.y });
    }
    const gaps = [];
    for (const g of groups.values()) {
      const sorted = g.pieces.sort((a, b) => a.a - b.a), merged = [];
      for (const p of sorted) {
        const last = merged.at(-1);
        if (last && p.a <= last.b + EPS4) last.b = Math.max(last.b, p.b);
        else merged.push({ ...p });
      }
      g.pieces = merged;
      for (let i = 1; i < merged.length; i++) {
        const a = merged[i - 1].b, b = merged[i].a;
        gaps.push({ g, a, b, width: b - a });
      }
    }
    const bindings = [];
    for (const opening of schedule.rows) {
      const labels = spans.filter((s) => s.text.trim().toLowerCase() === opening.id.toLowerCase());
      if (labels.length !== 1) throw Error("Opening tag missing or repeated on the source plan: " + opening.id);
      const label = labels[0], candidates = gaps.filter((g) => Math.abs(g.width - opening.width) < 1e-3 && Math.abs((g.g.axis === "h" ? label.y : label.x) - g.g.fixed) < 3.5 * label.height && (g.g.axis === "h" ? label.x : label.y) > g.a - label.height && (g.g.axis === "h" ? label.x : label.y) < g.b + label.height);
      if (candidates.length !== 1 || bindings.some((b) => b.gap === candidates[0])) throw Error("Opening gap or tag location is ambiguous: " + opening.id);
      bindings.push({ opening, gap: candidates[0] });
    }
    const walls = [];
    for (const g of groups.values()) {
      const pieces = [];
      for (const piece of g.pieces) {
        const last = pieces.at(-1), bridge = last && bindings.find((b) => b.gap.g === g && near(b.gap.a, last.b) && near(b.gap.b, piece.a));
        if (bridge) last.b = piece.b;
        else pieces.push({ ...piece });
      }
      const divided = [];
      for (const p of pieces) {
        const attached = bindings.filter((o) => o.gap.g === g && o.gap.a >= p.a - EPS4 && o.gap.b <= p.b + EPS4).sort((a, b) => a.gap.a - b.gap.a), cuts = [];
        for (let i = 1; i < attached.length; i++) if (attached[i - 1].opening.wall_id && attached[i].opening.wall_id && attached[i - 1].opening.wall_id !== attached[i].opening.wall_id) {
          const junctions = [...new Set([...groups.values()].filter((other) => other.axis !== g.axis && other.fixed > attached[i - 1].gap.b + EPS4 && other.fixed < attached[i].gap.a - EPS4 && other.pieces.some((piece) => g.fixed >= piece.a - EPS4 && g.fixed <= piece.b + EPS4)).map((other) => other.fixed))];
          if (junctions.length !== 1) throw Error("Different source host IDs require one unambiguous intervening wall junction");
          cuts.push(junctions[0]);
        }
        const bounds2 = [p.a, ...cuts, p.b];
        for (let i = 1; i < bounds2.length; i++) divided.push({ a: bounds2[i - 1], b: bounds2[i] });
      }
      for (const p of divided) {
        const a = g.axis === "h" ? { x: p.a, y: g.fixed } : { x: g.fixed, y: p.a }, b = g.axis === "h" ? { x: p.b, y: g.fixed } : { x: g.fixed, y: p.b };
        const attached = bindings.filter((o) => o.gap.g === g && o.gap.a >= p.a - EPS4 && o.gap.b <= p.b + EPS4), hosts = [...new Set(attached.map((o) => o.opening.wall_id).filter(Boolean))];
        if (hosts.length > 1) throw Error(`Physical wall ${g.axis}:${g.fixed}:${p.a}:${p.b} maps to conflicting source host IDs: ${hosts.join(", ")}`);
        walls.push({ id: hosts[0] || `native:${g.axis}:${g.fixed}:${p.a}:${p.b}`, a, b, axis: g.axis, classification: g.classification, length: round(p.b - p.a), openings: attached.map((o) => o.opening.id) });
      }
    }
    const discarded = [];
    if (walls.length > 300) throw Error("Native wall graph exceeds bounded connectivity check");
    for (const w of [...walls]) if (w.classification === "internal" && [w.a, w.b].every((p) => !walls.some((other) => other !== w && dist2(p, other.a, other.b) < EPS4))) {
      const tv = spans.find((s) => /^TV$/i.test(s.text.trim()) && dist2(s, w.a, w.b) < 3 * s.height);
      if (!tv) throw Error("Unclassified isolated wall-weight stroke");
      discarded.push({ a: w.a, b: w.b, source_label: tv.text, reason: "Isolated annotated TV object; requires source review" });
      walls.splice(walls.indexOf(w), 1);
    }
    for (const w of walls) for (const p of [w.a, w.b]) if (!walls.some((other) => other !== w && dist2(p, other.a, other.b) < EPS4)) throw Error("Unclosed wall endpoint; untagged gap or free-standing wall requires review");
    const external = walls.filter((w) => w.classification === "external");
    for (const w of external) for (const p of [w.a, w.b]) if (external.filter((other) => other !== w && dist2(p, other.a, other.b) < EPS4).length !== 1) throw Error("External centreline envelope is not a single closed boundary");
    const faces = facesOf(walls);
    if (!faces.length || faces.length > 200) throw Error("Closed wall faces unavailable");
    const roomSpans = text.spans.map((s) => ({ ...s, ...toMetres(s) }));
    for (const face of faces) {
      face.tags = roomSpans.filter((s) => /^[A-Z]{1,4}[-_]?\d{1,4}(?=\s)/i.test(s.text.trim()) && contains(face.polygon, s)).map((s) => s.text.trim().match(/^[A-Z]{1,4}[-_]?\d{1,4}/i)[0]);
      face.opening_ids = bindings.filter((o) => {
        const g = o.gap, p = g.g.axis === "h" ? { x: (g.a + g.b) / 2, y: g.g.fixed } : { x: g.g.fixed, y: (g.a + g.b) / 2 };
        return face.polygon.some((a, i) => dist2(p, a, face.polygon[(i + 1) % face.polygon.length]) < EPS4);
      }).map((o) => o.opening.id);
    }
    for (const d of discarded) {
      const enclosing = faces.filter((f) => f.tags.length === 1 && contains(f.polygon, d.a) && contains(f.polygon, d.b));
      if (enclosing.length !== 1) throw Error("Isolated annotation is not inside one tagged source room");
      d.room_tag = enclosing[0].tags[0];
    }
    Object.assign(audit, {
      status: "provisional",
      calibration: { width_m: ew, height_m: eh, points_per_m: scale, source_dimension_factor_to_m: dimensionFactor, origin: { x: x0, y: y0 } },
      wall_styles: { external: outer.width, internal: inner.width },
      discarded_annotations: discarded,
      opening_bindings: bindings.map((o) => ({ id: o.opening.id, host: o.opening.wall_id, gap_width_m: o.gap.width })),
      wall_count: walls.length,
      requires_review: true
    });
    return { status: "provisional", walls, faces, audit };
  } catch (e) {
    audit.reason = e.message;
    return { status: "pending", walls: [], faces: [], audit };
  }
}

// src/lib/pdfNativeSourceBasis.mjs
var source = (value, pages, evidence) => ({ value, pages, evidence });
var empty = () => source(null, [], "Source rule unavailable");
var roomTag3 = (s) => String(s || "").match(/^[A-Z]{1,4}[-_]?\d{1,4}/i)?.[0]?.toLowerCase();
var words = (s) => String(s || "").toLowerCase().replace(/^[a-z]{1,4}[-_]?\d{1,4}\s*/, "").replace(/\bstairs?\s+landing\b/g, "landing").replace(/\bstairs\b/g, "stair").replace(/[^a-z0-9]+/g, " ").trim();
function buildNativePdfSourceBasis(pages, normalizeScope) {
  const floors = pages.filter((p) => p.page_evidence?.kind === "floor_plan"), native = nativeOpeningEvidence(pages, normalizeScope), sections = /* @__PURE__ */ new Map();
  for (const p of pages.filter((p2) => p2.page_evidence?.kind === "specification" && p2.native_text_evidence?.status === "readable")) {
    const text = [...p.native_text_evidence.spans].sort((a, b) => b.y - a.y || a.x - b.x).map((s) => s.text).join(" "), headers2 = [...text.matchAll(/\b([A-Z][A-Z ]{2,30}):\s*/g)];
    for (let i = 0; i < headers2.length; i++) {
      const key2 = headers2[i][1].trim(), value = text.slice(headers2[i].index + headers2[i][0].length, headers2[i + 1]?.index ?? text.length).trim();
      if (!sections.has(key2)) sections.set(key2, []);
      sections.get(key2).push({ text: value, page: p.pageNumber });
    }
  }
  const get = (key2) => {
    const rows = sections.get(key2) || [];
    return rows.length && new Set(rows.map((r) => r.text)).size === 1 ? { text: rows[0].text, pages: rows.map((r) => r.page) } : null;
  };
  const dimension2 = (section, regex) => {
    const s = get(section), match = s?.text.match(regex);
    return match ? source(Number(match[1]) * ({ mm: 1e-3, cm: 0.01, m: 1 }[match[2]] || 1), s.pages, `${section}: ${match[0]}`) : empty();
  };
  const flag = (section, regex) => {
    const s = get(section);
    return s && regex.test(s.text) ? source(true, s.pages, `${section}: ${s.text}`) : empty();
  };
  const wallHeight = dimension2("WALLS", /clear height\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i), plaster = get("PLASTER"), ceilings = get("CEILINGS"), wet = get("WET ROOMS"), kitchen = get("KITCHEN");
  const rules = {
    wall_height: wallHeight,
    plaster_internal_faces: plaster && /both faces of internal walls/i.test(plaster.text) ? source(2, plaster.pages, plaster.text) : empty(),
    plaster_external_faces: plaster && /inner face of external walls/i.test(plaster.text) ? source(1, plaster.pages, plaster.text) : empty(),
    wet_tile_height: dimension2("WET ROOMS", /\btile height\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i),
    wet_waterproof_height: dimension2("WET ROOMS", /wall waterproofing\s+height\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i),
    backsplash_length: dimension2("KITCHEN", /Backsplash\s+is\s+\d+(?:\.\d+)?\s+high\s+along\s*(\d+(?:\.\d+)?)\s*m\b/i),
    backsplash_height: kitchen && /Backsplash\s+is\s+(\d+(?:\.\d+)?)\s+high\s+along\s*\d+(?:\.\d+)?\s*m\b/i.test(kitchen.text) ? source(Number(kitchen.text.match(/Backsplash\s+is\s+(\d+(?:\.\d+)?)/i)[1]), kitchen.pages, kitchen.text) : empty(),
    paint_uses_plastered_faces: plaster && /both faces of internal walls plus inner face of external walls/i.test(plaster.text) && /Interior paint excludes/i.test(plaster.text) ? source(true, plaster.pages, plaster.text) : empty(),
    paint_excludes_wet_tiles: flag("PLASTER", /Interior paint excludes wet wall tiles/i),
    paint_excludes_backsplash: flag("PLASTER", /Interior paint excludes[^.]*kitchen backsplash/i),
    paint_enclosed_ceilings: flag("CEILINGS", /^paint all enclosed areas\./i),
    gypsum_exclusions_confirmed: empty()
  };
  const ceilingExclusions = [];
  let ceilingRuleKnown = false;
  const exclusionText = ceilings?.text.match(/Gypsum ceiling excludes\s+([^.]+)\./i)?.[1];
  if (exclusionText) {
    ceilingRuleKnown = true;
    for (const entry of exclusionText.split(/,|\s+and\s+/i)) {
      const match = entry.trim().match(/^(GF|FF|ground(?: floor)?|first(?: floor)?|floor\s+\d+)\s+(.+)$/i);
      if (!match) {
        ceilingRuleKnown = false;
        break;
      }
      const scope = normalizeScope(match[1]), matches = floors.filter((p) => normalizeScope(p.page_evidence.scope_id) === scope).flatMap((p) => (p.detected_items || []).filter((i) => ["m2", "m\xB2"].includes(i.unit) && words(i.name) === words(match[2])).map((i) => ({ scope, tag: roomTag3(i.name) })));
      if (matches.length !== 1) {
        ceilingRuleKnown = false;
        break;
      }
      ceilingExclusions.push(matches[0]);
    }
  }
  if (ceilingRuleKnown) rules.gypsum_exclusions_confirmed = source(true, ceilings.pages, ceilings.text);
  const wetNames = wet?.text.split(/\.\s+/)[0].match(/\b[A-Z]{1,4}[-_]?\d{1,4}\b/g) || [], geometry2 = [], basis = { floors: [], rules, exclusions: [], notes: "Native calibrated graph and explicitly recognized source rules; provisional, source review required." };
  for (const p of floors) {
    const scope = normalizeScope(p.page_evidence.scope_id), schedule = native.claims.length ? native.schedules.find((s) => s.scope_id === scope) : null, measured = measureNativeWallFloor(p, schedule);
    geometry2.push(measured.audit);
    const f = {
      scope_id: scope,
      walls_complete: measured.status === "provisional",
      wall_inventory_evidence: `Native source centreline graph; calibration, opening gaps and connectivity checked. ${JSON.stringify(measured.audit)}`,
      source_pages: [p.pageNumber, ...schedule?.dimension_basis?.pages || []],
      walls: [],
      openings: [],
      wet_rooms_complete: false,
      wet_rooms: [],
      ceilings_complete: ceilingRuleKnown,
      ceiling_spaces: []
    };
    if (measured.status === "provisional") {
      f.walls = measured.walls.map((w) => ({ id: w.id, classification: w.classification, length_basis: "calibrated_geometry", length: source(w.length, [p.pageNumber], `Original vector wall ${w.id}: ${JSON.stringify(w.a)} to ${JSON.stringify(w.b)}; calibrated using printed envelope`), height: wallHeight }));
      f.openings = schedule.rows.map((o) => ({ id: o.id, wall_id: measured.walls.find((w) => w.openings.includes(o.id))?.id, kind: o.kind === "window" ? "window" : "door", width: source(o.width, o.dimension_pages, o.source_row), height: source(o.height, o.dimension_pages, o.source_row), sill: source(o.sill, o.dimension_pages, o.source_row) }));
      const planTags = new Set(p.native_plan_text.spans.flatMap((s) => {
        const m = s.text.match(/^[A-Z]{1,4}[-_]?\d{1,4}(?=\s)/i);
        return m ? [m[0].toLowerCase()] : [];
      })), wanted = wetNames.filter((tag) => planTags.has(tag.toLowerCase()));
      f.wet_rooms_complete = !!wet && wetNames.length > 0;
      for (const tag of wanted) {
        const faces = measured.faces.filter((face2) => face2.tags.some((t) => t.toLowerCase() === tag.toLowerCase()));
        if (faces.length !== 1 || faces[0].tags.length !== 1) {
          f.wet_rooms_complete = false;
          continue;
        }
        const face = faces[0];
        f.wet_rooms.push({ id: tag, boundary_complete: true, boundary_lengths: face.polygon.map((a, i) => {
          const b = face.polygon[(i + 1) % face.polygon.length];
          return source(Math.hypot(b.x - a.x, b.y - a.y), [p.pageNumber, ...wet.pages], `Closed native wall face ${tag}, side ${i + 1}; ${wet.text}`);
        }), opening_ids: face.opening_ids });
      }
    }
    const indoors = (p.detected_items || []).filter((i) => ["m2", "m\xB2"].includes(i.unit) && i.quantity > 0 && !/\bvoid\b|\bterrace\b|\bbalcony\b/i.test(i.name) && !/^VOID\b|^OUTDOOR\b/i.test(i.description));
    f.ceiling_spaces = indoors.map((i) => {
      const matching = measured.faces.filter((face) => face.tags.length === 1 && face.tags[0].toLowerCase() === roomTag3(i.name));
      return {
        room_name: i.name,
        include_gypsum: ceilingRuleKnown ? !ceilingExclusions.some((e) => e.scope === scope && e.tag === roomTag3(i.name)) : null,
        pages: ceilings?.pages || [],
        evidence: ceilings?.text || "Source ceiling rule unavailable",
        ...matching.length === 1 ? { native_area: source(matching[0].area, [p.pageNumber], `Area of calibrated original closed wall face ${roomTag3(i.name)}; polygon ${JSON.stringify(matching[0].polygon)}`) } : {}
      };
    });
    basis.floors.push(f);
  }
  const wetResolved = basis.floors.flatMap((f) => f.wet_rooms.map((r) => r.id.toLowerCase()));
  if (wetNames.some((tag) => wetResolved.filter((t) => t === tag.toLowerCase()).length !== 1)) basis.floors.forEach((f) => f.wet_rooms_complete = false);
  return { basis, source_pages: [.../* @__PURE__ */ new Set([...floors.flatMap((p) => [p.pageNumber, ...p.document_area_source_pages || []]), ...native.schedules.flatMap((s) => s.dimension_basis?.pages || []), ...[...sections.values()].flatMap((a) => a.map((r) => r.page))])], geometry: geometry2 };
}

// src/lib/pdfMeasurementCalculations.mjs
var units = {
  scalar: [1, 0, 0],
  count: [1, 0, 0],
  nr: [1, 0, 0],
  m: [1, 1, 0],
  mm: [1e-3, 1, 0],
  m2: [1, 2, 0],
  m3: [1, 3, 0],
  kg: [1, 0, 1],
  ton: [1e3, 0, 1],
  kg_per_m: [1, -1, 1],
  m_mm2_per_kg: [1e-6, 3, -1]
};
var nonempty = (s) => typeof s === "string" && s.trim().length > 0;
var PDF_AREA_KEYS = ["floor_area", "ceiling_area", "wood_floor_area", "ceramic_floor_area", "epoxy_floor_area", "terrace_floor_area"];
function assertPdfSoffitCoverage(calculation, notes = "") {
  if (calculation?.key !== "slab_formwork_area") return;
  const convention = `${calculation.evidence || ""} ${notes}`;
  const includesBeams = /slab\s+soffit\s+(?:already\s+)?includes?\s+beam\s+(?:undersides?|soffits?)/i.test(convention) || /beam\s+(?:undersides?|soffits?)\s+(?:are\s+)?included\s+(?:within|in)\s+slab/i.test(convention);
  const addsBeamSoffit = (calculation.terms || []).some((term) => term.operation === "add" && /beam[\s_-]*(?:soffit|underside)|(?:soffit|underside)[\s_-]*beam/i.test(`${term.id} ${(term.factors || []).map((f) => f.evidence).join(" ")}`));
  if (includesBeams && addsBeamSoffit) throw Error("Slab soffit includes beam undersides but calculation adds them again; source coverage review required");
}
function reconcilePdfSoffitCoverage(calculation, notes, metricUnits, availablePages) {
  try {
    assertPdfSoffitCoverage(calculation, notes);
    return { calculation, adjustment: null };
  } catch (contradiction) {
    const rulePages = [...new Set([...String(calculation.evidence || "").matchAll(/\bp(?:age)?\s*(\d+)\b/gi)].map((m) => Number(m[1])))];
    if (!rulePages.length || rulePages.some((p) => !availablePages.has(p))) throw contradiction;
    const baseGroups = /* @__PURE__ */ new Map(), beamTerms = [];
    for (const term of calculation.terms || []) {
      const id = String(term.id || "").toLowerCase();
      const gross = id.match(/^(.+?)[_-]slab[_-]soffit[_-]gross$/);
      const opening = id.match(/^(.+?)[_-]slab[_-](?:soffit[_-])?(?:void|terrace|opening)(?:[_-](?:omit|deduct))?$/);
      const beam = id.match(/^(.+?)[_-]beam[_-](?:soffits?|undersides?)$/);
      if (!Array.isArray(term.factors) || term.factors.length !== 2 || term.factors.some((f) => f.unit !== "m" || f.operation !== "multiply" || f.clip)) throw contradiction;
      calculatePdfMeasurement({ ...calculation, terms: [{ ...term, operation: "add" }] }, metricUnits, availablePages);
      if (gross && term.operation === "add" && term.factors.every((f) => /envelope|\bgross\b/i.test(f.evidence))) {
        if (baseGroups.has(gross[1])) throw contradiction;
        baseGroups.set(gross[1], { area: term.factors[0].value * term.factors[1].value, omitted: 0, beamArea: 0 });
      } else if (opening && term.operation === "subtract") {
      } else if (beam && term.operation === "add") beamTerms.push({ term, group: beam[1] });
      else throw contradiction;
    }
    if (!baseGroups.size || !beamTerms.length) throw contradiction;
    for (const term of calculation.terms) if (term.operation === "subtract") {
      const group = term.id.toLowerCase().match(/^(.+?)[_-]slab[_-](?:soffit[_-])?(?:void|terrace|opening)(?:[_-](?:omit|deduct))?$/)?.[1];
      if (!baseGroups.has(group)) throw contradiction;
      baseGroups.get(group).omitted += term.factors[0].value * term.factors[1].value;
    }
    for (const { term, group } of beamTerms) {
      if (!baseGroups.has(group)) throw contradiction;
      baseGroups.get(group).beamArea += term.factors[0].value * term.factors[1].value;
    }
    if ([...baseGroups.values()].some((g) => g.area - g.omitted <= 0 || g.beamArea > g.area - g.omitted)) throw contradiction;
    const removed = new Set(beamTerms.map((x) => x.term.id));
    const adjusted = {
      ...calculation,
      terms: calculation.terms.filter((t) => !removed.has(t.id)),
      evidence: `${calculation.evidence} Coverage reconciliation: full sourced envelope minus openings already includes beam undersides; omitted repeated strips ${[...removed].join(", ")}.`
    };
    calculatePdfMeasurement(calculation, metricUnits, availablePages);
    calculatePdfMeasurement(adjusted, metricUnits, availablePages);
    return { calculation: adjusted, adjustment: {
      key: calculation.key,
      scope_id: calculation.scope_id,
      removed_terms: [...removed],
      source_pages: rulePages,
      reason: "Explicit included beam undersides duplicated within fully sourced gross soffit envelopes"
    } };
  }
}
function calculatePdfMeasurement(calculation, metricUnits, availablePages) {
  const { key: key2, scope_id: scope, evidence, terms } = calculation || {};
  const expected = units[metricUnits[key2]];
  if (!expected || !nonempty(scope) || !nonempty(evidence)) throw Error("Missing metric, scope or measurement evidence");
  if (PDF_AREA_KEYS.includes(key2)) throw Error("Floor and finish areas require audited space geometry");
  if (!Array.isArray(terms) || !terms.length || terms.length > 500) throw Error("Missing or excessive calculation terms");
  let value = 0;
  const pages = /* @__PURE__ */ new Set(), termIds = /* @__PURE__ */ new Set(), basis = [];
  for (const term of terms) {
    if (!nonempty(term.id) || termIds.has(term.id)) throw Error("Missing or repeated physical term identity");
    termIds.add(term.id);
    if (!["add", "subtract"].includes(term.operation) || !Array.isArray(term.factors) || !term.factors.length || term.factors.length > 16) throw Error("Invalid measurement term");
    let product = 1, length = 0, mass = 0;
    const factors = [];
    for (const input of term.factors) {
      const unit2 = units[input.unit];
      let operand = input.value;
      if (input.clip) {
        const { opening_height_m: h, sill_m: s, finish_height_m: f } = input.clip;
        if (input.value !== null || input.unit !== "m" || ![h, s, f].every((n) => Number.isFinite(n) && n >= 0 && n <= 1e6)) throw Error("Invalid clipped opening heights");
        operand = Math.max(0, Math.min(h, f - s));
      }
      if (!unit2 || !Number.isFinite(operand) || operand < 0 || operand > 1e12 || !["multiply", "divide"].includes(input.operation) || !nonempty(input.evidence) || !Array.isArray(input.pages) || !input.pages.length || input.pages.some((p) => !availablePages.has(p))) throw Error("Invalid or unsourced measurement operand");
      if (["count", "nr"].includes(input.unit) && !Number.isInteger(operand)) throw Error("Fractional counted operand");
      const divisor = input.operation === "divide";
      if (divisor && operand === 0) throw Error("Zero measurement divisor");
      product = divisor ? product / (operand * unit2[0]) : product * operand * unit2[0];
      length += (divisor ? -1 : 1) * unit2[1];
      mass += (divisor ? -1 : 1) * unit2[2];
      input.pages.forEach((p) => pages.add(p));
      factors.push(`${divisor ? "/" : "*"} ${operand} ${input.unit} [${input.evidence}${input.clip ? "; clip " + JSON.stringify(input.clip) : ""}]`);
    }
    if (length !== expected[1] || mass !== expected[2] || !Number.isFinite(product)) throw Error("Calculation dimensions do not match metric unit");
    value += term.operation === "subtract" ? -product : product;
    basis.push(`${term.operation} ${term.id}: ${factors.join(" ")}`);
  }
  if (!Number.isFinite(value) || value < -1e-8 || value > 1e12) throw Error("Invalid net measurement");
  value = Math.max(0, value);
  if (metricUnits[key2] === "nr" && !Number.isInteger(value)) throw Error("Fractional counted result");
  return {
    key: key2,
    scope_id: scope,
    value,
    unit: metricUnits[key2],
    pages: [...pages].sort((a, b) => a - b),
    evidence: `${evidence}. Independently calculated: ${basis.join("; ")} = ${value} ${metricUnits[key2]}. Source transcription requires review.`
  };
}
function applyPdfDocumentReview(inputPages, metricUnits, normalizeScope = (s) => String(s).trim().toLowerCase()) {
  const host = inputPages.find((p) => p.document_measurement_review);
  if (!host) return { pages: inputPages, audit: null, warnings: [], blocked: [] };
  const review = host.document_measurement_review;
  const actualPages = new Set(inputPages.map((p) => p.pageNumber));
  const sourcePages = host.document_review_status?.source_pages;
  const available = new Set(sourcePages?.length ? sourcePages.filter((p) => actualPages.has(p)) : actualPages);
  const revisionsByDrawing = /* @__PURE__ */ new Map();
  for (const p of inputPages) {
    const e = p.page_evidence;
    const id = e?.drawing_id || (e?.kind === "floor_plan" ? normalizeScope(e.scope_id) : null);
    if (!id) continue;
    const revisions2 = revisionsByDrawing.get(id) || /* @__PURE__ */ new Set();
    revisions2.add(e.revision);
    revisionsByDrawing.set(id, revisions2);
  }
  if ([...revisionsByDrawing.values()].some((r) => r.size > 1)) return {
    pages: inputPages,
    blocked: [],
    audit: { status: "withheld", reason: "Conflicting source revisions" },
    warnings: ["PDF document review withheld: conflicting source revisions require selection."]
  };
  const pages = inputPages.map((p) => ({ ...p, page_evidence: p.page_evidence ? { ...p.page_evidence, quantities: [...p.page_evidence.quantities || []] } : void 0 }));
  const warnings = [], accepted = [], rejected = [], revised = [], adjustments = [], blocked = /* @__PURE__ */ new Set(), identities = /* @__PURE__ */ new Set();
  const revisions = review.floor_revisions || [];
  const targetCounts = /* @__PURE__ */ new Map();
  for (const r of revisions) targetCounts.set(r.pageNumber, (targetCounts.get(r.pageNumber) || 0) + 1);
  for (const r of revisions) {
    const p = pages.find((p2) => p2.pageNumber === r.pageNumber);
    if (!p || p.page_evidence?.kind !== "floor_plan" || targetCounts.get(r.pageNumber) !== 1 || !r.area_geometry || !nonempty(r.evidence) || !Array.isArray(r.source_pages) || !r.source_pages.includes(r.pageNumber) || r.source_pages.some((n) => !available.has(n)) || !Array.isArray(r.detected_items) || !r.detected_items.length) {
      warnings.push(`PDF document review: invalid floor revision on page ${r.pageNumber}`);
      continue;
    }
    p.document_original_area_evidence = p.document_original_area_evidence || {
      area_geometry: p.area_geometry,
      detected_items: p.detected_items,
      fields: Object.fromEntries(PDF_AREA_KEYS.map((k) => [k, p[k] || 0]))
    };
    p.area_geometry = r.area_geometry;
    p.detected_items = r.detected_items;
    p.document_area_source_pages = r.source_pages;
    delete p.__areaGeometryValidated;
    revised.push({ page: r.pageNumber, source_pages: r.source_pages, evidence: r.evidence });
  }
  for (const p of pages) if (p.page_evidence?.kind === "floor_plan" && p.native_plan_text?.status === "readable") {
    const checked = auditPdfAreaGeometry(p);
    if (checked.audit?.status !== "withheld") Object.assign(p, checked.page);
  }
  const nativeFresh = host.native_measurement_basis && pages.some((p) => p.native_graphics?.status === "readable") ? buildNativePdfSourceBasis(pages, normalizeScope) : null;
  if (nativeFresh) {
    const target2 = pages.find((p) => p.pageNumber === host.pageNumber);
    target2.native_measurement_basis = nativeFresh.basis;
    target2.native_source_status = { source_pages: nativeFresh.source_pages, geometry: nativeFresh.geometry };
  }
  const sourceAvailable = new Set((host.source_measurement_status?.source_pages || []).filter((p) => available.has(p)));
  const sourceResult = review.measurement_basis ? calculatePdfSourceMeasurements(review.measurement_basis, pages, metricUnits, sourceAvailable) : null;
  const nativeAvailable = new Set((nativeFresh?.source_pages || host.native_source_status?.source_pages || []).filter((p) => available.has(p)));
  const nativeBasis = nativeFresh?.basis || host.native_measurement_basis;
  const nativeResult = nativeBasis ? calculatePdfSourceMeasurements(nativeBasis, pages, metricUnits, nativeAvailable) : null;
  const nativeDocument = nativePdfDocumentCalculations(pages, review, (c) => calculatePdfMeasurement(c, metricUnits, available));
  const nativeKeys = /* @__PURE__ */ new Set([...nativeResult?.calculations.map((c) => c.key) || [], ...nativeDocument.calculations.map((c) => c.key)]);
  const derivedKeys = /* @__PURE__ */ new Set([...sourceResult?.calculations.map((c) => c.key) || [], ...nativeKeys]);
  const allCalculations = [...(review.calculations || []).filter((c) => !derivedKeys.has(c.key)), ...(sourceResult?.calculations || []).filter((c) => !nativeKeys.has(c.key)), ...nativeResult?.calculations || [], ...nativeDocument.calculations];
  for (const key2 of sourceResult?.blocked || []) if (!nativeKeys.has(key2)) blocked.add(key2);
  warnings.push(...(sourceResult?.issues || []).map((s) => `PDF source measurement withheld: ${s}`));
  warnings.push(...(nativeResult?.issues || []).map((s) => `PDF native source measurement pending: ${s}`));
  warnings.push(...nativeDocument.issues.map((s) => `PDF native document measurement pending: ${s}`));
  for (const c of allCalculations) {
    const id = `${c.key}|${normalizeScope(c.scope_id)}`;
    try {
      if (identities.has(id)) throw Error("Duplicate complete metric/scope calculation");
      identities.add(id);
      const reconciled = reconcilePdfSoffitCoverage(c, review.notes, metricUnits, available);
      assertPdfSoffitCoverage(reconciled.calculation, review.notes);
      const claim2 = calculatePdfMeasurement(reconciled.calculation, metricUnits, available);
      if (reconciled.adjustment) {
        claim2.pages = [.../* @__PURE__ */ new Set([...claim2.pages, ...reconciled.adjustment.source_pages])].sort((a, b) => a - b);
        adjustments.push(reconciled.adjustment);
      }
      accepted.push(claim2);
    } catch (error) {
      rejected.push({ key: c.key, scope_id: c.scope_id, reason: error.message });
      if (metricUnits[c.key] && !PDF_AREA_KEYS.includes(c.key)) blocked.add(c.key);
      warnings.push(`PDF document calculation ${c.key} withheld: ${error.message}`);
    }
  }
  for (const key2 of blocked) {
    for (const p of pages) {
      if (Object.hasOwn(p, key2)) p[key2] = 0;
      p.page_evidence?.quantities.splice(
        0,
        p.page_evidence.quantities.length,
        ...p.page_evidence.quantities.filter((q) => q.key !== key2)
      );
    }
  }
  const target = pages.find((p) => p.pageNumber === host.pageNumber);
  for (const q of accepted.filter((q2) => !blocked.has(q2.key))) {
    for (const p of pages) if (p.page_evidence) p.page_evidence.quantities = p.page_evidence.quantities.filter((old) => old.key !== q.key || normalizeScope(old.scope_id) !== normalizeScope(q.scope_id));
    target.page_evidence.quantities = target.page_evidence.quantities.filter((old) => !(old.document_calculated && old.key === q.key && old.scope_id === q.scope_id));
    target.page_evidence.quantities.push({ ...q, document_calculated: true });
  }
  return { pages, blocked: [...blocked], warnings, audit: {
    status: "source_document_review",
    floor_revisions: revised,
    calculations: accepted.filter((q) => !blocked.has(q.key)),
    rejected,
    adjustments,
    source_measurements: sourceResult ? { status: sourceResult.blocked.length ? "incomplete" : "calculated", issues: sourceResult.issues } : null,
    native_source_measurements: nativeResult ? { status: nativeResult.blocked.length ? "partial" : "provisional", issues: nativeResult.issues, derived_keys: [...nativeKeys], geometry: host.native_source_status?.geometry || [], requires_review: true } : null,
    exclusions: [.../* @__PURE__ */ new Set([...(review.exclusions || []).filter((s) => !derivedKeys.has(s)), ...review.measurement_basis?.exclusions || []])].filter(nonempty),
    notes: [review.notes, review.measurement_basis?.notes].filter(nonempty).join("\n")
  } };
}

// src/lib/pdfCatalogScope.mjs
function pdfCatalogScope(description) {
  const d = String(description || "").toLowerCase().replace(/[-‐‑–—]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(?:disposal|haul|backfill|pool|tank|raft|pile|stairs?|staircase)\b/.test(d)) return null;
  const match = (key2, unit2, extra = {}) => ({ key: key2, unit: unit2, ...extra });
  if (/\bformwork\b/.test(d)) {
    if (/\bslabs?\b/.test(d) && (!/\bbeams?\b/.test(d) || /\bsoffit\b/.test(d))) return match("slab_formwork_area", "m2");
    if (/\bbeams?\b/.test(d) && !/\b(?:slabs?|soffits?|undersides?|bottoms?)\b/.test(d)) return match("beam_formwork_area", "m2");
    if (/\bcolumns?\b/.test(d) && !/\b(?:beam|slab|footing|pedestal)\b/.test(d)) return match("column_formwork_area", "m2");
    if (/\bfootings?\b/.test(d) && /\bpedestals?\b/.test(d) && !/\b(?:column|beam|slab)\b/.test(d)) return match("foundation_formwork_area", "m2");
    return null;
  }
  if (/\b(?:rc|reinforced concrete)\b/.test(d) && !/\bc\s*\d|\bmpa\b|\bgrade\b|\b(?:precast|prestressed|post tensioned)\b/.test(d)) {
    const members = [[/\bfootings?\b/, "foundation_volume"], [/\bpedestals?\b/, "pedestal_volume"], [/\bcolumns?\b/, "column_volume"], [/\bbeam downstands?\b/, "beam_volume"], [/\bground (?:floor )?slabs?\b/, "ground_slab_volume"], [/\bfirst (?:floor )?slabs?\b/, "first_slab_volume"], [/\broof slabs?\b/, "roof_slab_volume"]].filter(([re]) => re.test(d));
    if (members.length === 1) {
      const thickness = d.match(/\b(\d+(?:\.\d+)?)\s*mm\b/);
      return match(members[0][1], "m3", thickness ? { sourceThicknessM: Number(thickness[1]) / 1e3 } : {});
    }
  }
  if (/^excavat(?:e|ion|ing)\b/.test(d) && !/\b(?:rock|trench|strip)\b/.test(d)) return match("excavation_volume", "m3");
  if (/^rebar\b/.test(d) && !/\b(?:footing|slab|beam|column|pedestal|mesh)\b/.test(d)) return match("rebar_kg", "kg");
  if (/\bterrace\b/.test(d) && /\bceramic\b/.test(d) && !/\b(?:wall|walls|balcony)\b/.test(d)) return match("terrace_floor_area", "m2");
  if (/^roof (?:waterproofing|membrane)$/.test(d)) return match("roof_waterproofing_area", "m2");
  if (/^terrace (?:floor )?(?:waterproofing|membrane)$/.test(d)) return match("terrace_waterproofing_area", "m2");
  if (/^wc pans?(?: complete)?$/.test(d)) return match("toilet_count", "nr");
  if (/^(?:water supply|water) pipes?(?: complete)?$/.test(d)) return match("water_pipe_length", "m");
  if (/^waste pipes?(?: complete)?$/.test(d)) return match("waste_pipe_length", "m");
  if (/^split (?:ac|air conditioning) units?(?: complete)?$/.test(d)) return match("ac_count", "nr");
  if (/^ac insulated pipe(?:work|s)?$/.test(d)) return match("ac_pipe_length", "m");
  if (/^kitchen and laundry sink sets?(?: complete)?$/.test(d)) return match("kitchen_sink_count+laundry_sink_count", "nr", { keys: ["kitchen_sink_count", "laundry_sink_count"] });
  if (/^kitchen sink sets?(?: complete)?$/.test(d)) return match("kitchen_sink_count", "nr");
  if (/^laundry sink sets?(?: complete)?$/.test(d)) return match("laundry_sink_count", "nr");
  if (/^kitchen (?:hob and hood|hob hood) package$/.test(d)) return match("kitchen_hob_hood_count", "nr");
  if (/^(?:glass and metal )?terrace railing$/.test(d)) return match("terrace_railing_length", "m");
  if (/^driveway paving$/.test(d)) return match("driveway_area", "m2");
  if (/^soft landscaping$/.test(d)) return match("landscape_area", "m2");
  return null;
}
function pdfCatalogThicknessMatches(metric, rows) {
  if (metric.sourceThicknessM === void 0) return true;
  const labels = { ground_slab_volume: "(?:gf|ground(?: floor)?)", first_slab_volume: "(?:ff|first(?: floor)?)", roof_slab_volume: "roof" };
  const slab = labels[metric.key] ? new RegExp(`^${labels[metric.key]}\\s+slab:\\s*(\\d*\\.\\d+|\\d+)\\.?$`, "i") : null;
  const values = rows.flatMap((r) => [...String(r.evidence || "").matchAll(/\*\s*(\d+(?:\.\d+)?)\s+(m|mm)\s*\[([^\]]*)\]/gi)].flatMap((m) => {
    const raw = Number(m[1]), source2 = m[3].trim(), explicit = slab?.exec(source2);
    if (!/\bthick(?:ness)?\b/i.test(source2) && !(explicit && Math.abs(Number(explicit[1]) - raw) < 1e-9)) return [];
    return [raw * (m[2].toLowerCase() === "mm" ? 1e-3 : 1)];
  }));
  return values.length > 0 && values.every((v) => Math.abs(v - metric.sourceThicknessM) < 1e-9);
}
function pdfCatalogHeightMatches(metric, rows, description) {
  if (!["wet_wall_tile_area", "wet_wall_waterproofing_area"].includes(metric.key)) return true;
  const text = String(description || "").toLowerCase(), dimension2 = text.match(/\b(\d+(?:\.\d+)?)\s*(mm|m)\b/);
  if (!dimension2) return true;
  const height = Number(dimension2[1]) * (dimension2[2] === "mm" ? 1e-3 : 1), kind = metric.key === "wet_wall_tile_area" ? "tile" : "waterproofing";
  const operands = rows.flatMap((r) => [...String(r.evidence || "").matchAll(/\*\s*(\d+(?:\.\d+)?)\s+m\s*\[WET ROOMS:\s*([^\]]*height[^\]]*)\]/gi)].filter((m) => m[2].toLowerCase().includes(kind)).map((m) => Number(m[1])));
  return operands.length > 0 && operands.every((v) => Math.abs(v - height) < 1e-9);
}

// src/lib/pdfSourceSpecifications.mjs
var concrete = [["pcc_volume", /\b(?:pcc|blinding)\b/], ["foundation_volume", /\b(?:foundations?|footings?)\b/], ["pedestal_volume", /\bpedestals?\b/], ["column_volume", /\bcolumns?\b/], ["beam_volume", /\bbeams?\b/], ["ground_slab_volume", /\b(?:ground|gf)(?: floor)? slabs?\b/], ["first_slab_volume", /\b(?:first|ff)(?: floor)? slabs?\b/], ["roof_slab_volume", /\broof slabs?\b/]];
var normal = (s) => String(s || "").toLowerCase().replace(/[‐‑–—-]/g, " ").replace(/\s+/g, " ").trim();
var unique2 = (xs) => [...new Set(xs)];
function clauses(text) {
  return String(text).split(/;|\n|\.(?=\s+[A-Z])/).map((s) => s.trim()).filter(Boolean);
}
function factsIn(text, page, scope = "project") {
  const facts = [];
  for (const quote of clauses(text)) {
    if (quote.length > 2e3) continue;
    const d = normal(quote), local = d.match(/\b(gf|ff|ground floor|first floor|floor\s*-?\d+)\b/);
    const scopeId = local ? ["gf", "ground floor"].includes(local[1]) ? "floor:0" : ["ff", "first floor"].includes(local[1]) ? "floor:1" : local[1].replace(/floor\s*/, "floor:") : scope;
    const add = (metric, property, values) => {
      for (const value of unique2(values)) facts.push({ metric, property, value, page, scope_id: scopeId, quote, source: "native_pdf_text" });
    };
    if (/\b(?:not|unless|option|optional|alternative|except|excluding)\b/.test(d)) continue;
    for (const [word, key2] of [["external", "external_block_area"], ["exterior", "external_block_area"], ["internal", "internal_block_area"], ["interior", "internal_block_area"]]) {
      const material2 = "(?:autoclaved aerated concrete|hollow concrete|solid concrete|aac|concrete|clay|brick)";
      const pattern = new RegExp(`\\b${word}\\s*(?:${material2}\\s+)?(?:walls?|partitions?|blockwork|masonry)?\\s*[:=]?\\s*(?:${material2}\\s+)?(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m)\\b`, "g");
      add(key2, "thickness_mm", [...d.matchAll(pattern)].map((m) => Number(m[1]) * { mm: 1, cm: 10, m: 1e3 }[m[2]]));
      const reversed = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m)\\s+(?:thick\\s+)?${word}\\s+(?:${material2}\\s+)?(?:walls?|partitions?|blockwork|masonry)\\b`, "g");
      add(key2, "thickness_mm", [...d.matchAll(reversed)].map((m) => Number(m[1]) * { mm: 1, cm: 10, m: 1e3 }[m[2]]));
    }
    const grades = [...d.matchAll(/\bc\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?\b/g)].map((m) => `C${m[1]}${m[2] ? "/" + m[2] : ""}`);
    for (const [key2, re] of concrete) if (re.test(d)) add(key2, "concrete_grade", grades);
    if (/\ball\s+(?:structural\s+)?concrete\b/.test(d) && !/\bexcept\b/.test(d)) for (const [key2] of concrete.filter(([k]) => k !== "pcc_volume")) add(key2, "concrete_grade", grades);
    for (const [key2, re] of [["water_pipe_length", /\b(?:water supply|domestic water|water pipes?)\b/], ["waste_pipe_length", /\b(?:waste|drainage|soil)\s*(?:water\s*)?pipes?\b/]]) if (re.test(d)) {
      const dn = [...d.matchAll(/(?:\b(?:dn|dia(?:meter)?|od)\s*[:=]?\s*|[ø⌀]\s*)(\d+(?:\.\d+)?)\s*(mm|cm|m)?\b/g)].map((m) => Number(m[1]) * { mm: 1, cm: 10, m: 1e3 }[m[2] || "mm"]);
      const series = [...d.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:\/|and|,)\s*(\d+(?:\.\d+)?)\s*mm\b/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
      add(key2, "diameter_mm", series.length ? series : dn.length ? dn : [...d.matchAll(/\b(\d+(?:\.\d+)?)\s*mm\b/g)].map((m) => Number(m[1])));
      add(key2, "pipe_material", [...d.matchAll(/\b(ppr|cpvc|u?pvc|hdpe|copper|pex|steel|galvanized)\b/g)].map((m) => m[1].toUpperCase()));
    }
    if (/\b(?:ac|air conditioning|refrigerant)\b/.test(d) && /\b(?:pipes?|pipework|piping|line sets?)\b/.test(d)) {
      add("ac_pipe_length", "pipe_material", [...d.matchAll(/\b(copper|steel|aluminium|aluminum|ppr|u?pvc|hdpe)\b/g)].map((m) => m[1].toUpperCase()));
      const inches = [...d.matchAll(/\b(\d+)\s*\/\s*(\d+)\s*(?:["″]|inch(?:es)?\b|in\b)/g)].map((m) => Math.round(Number(m[1]) / Number(m[2]) * 25.4 * 1e6) / 1e6).filter((v) => Number.isFinite(v) && v > 0);
      if (inches.length === 2) add("ac_pipe_length", "diameter_pair_mm", [inches.sort((a, b) => a - b).join("+")]);
      if (inches.length && inches.length !== 2 || [...d.matchAll(/\b\d+\s*\/\s*\d+/g)].length !== inches.length) add("ac_pipe_length", "unparsed_pipe_detail", ["present"]);
      const insulation = [...d.matchAll(/\b(\d+(?:\.\d+)?)\s*mm\s+(?:thick\s+)?insulation\b|\binsulation\s*[:=]?\s*(\d+(?:\.\d+)?)\s*mm\b/g)].map((m) => Number(m[1] || m[2]));
      add("ac_pipe_length", "insulation_mm", insulation);
      const detail = d.replace(/\b\d+(?:\.\d+)?\s*mm\s+(?:thick\s+)?insulation\b|\binsulation\s*[:=]?\s*\d+(?:\.\d+)?\s*mm\b/g, "");
      if (/\b(?:dn|diameter|dia|od)\b|\d\s*mm|[øØ]/.test(detail)) add("ac_pipe_length", "unparsed_pipe_detail", ["present"]);
    }
    if (/\b(?:ac|air conditioning|air conditioner|split)\b/.test(d)) add("ac_count", "capacity_tr", [...d.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:tr|tons?|tonnes?)\b/g)].map((m) => Number(m[1])));
    for (const [key2, re] of [["internal_block_area", /\b(?:internal|interior|partition)\b/], ["external_block_area", /\b(?:external|exterior)\b/]]) if (re.test(d) && /\b(?:blockwork|blocks?|masonry|walls?)\b/.test(d)) {
      const material2 = /\b(?:aac|autoclaved)\b/.test(d) ? "aac" : /\b(?:clay|brick)\b/.test(d) ? "clay" : /\bconcrete\b/.test(d) ? "concrete" : null;
      if (material2) add(key2, "block_material", [material2]);
    }
    if (/\b(?:wood(?:en)?|timber|parquet)\b/.test(d) && /\bfloor/.test(d)) {
      const system = /\bengineered\b/.test(d) ? "engineered_wood" : /\bsolid\b/.test(d) ? "solid_wood" : /\blaminate\b/.test(d) ? "laminate" : null;
      if (system) add("wood_floor_area", "floor_system", [system]);
    }
    for (const [key2, re] of [["terrace_floor_area", /\bterrace\b/], ["wet_wall_tile_area", /\bwet\s+(?:area\s+)?wall\b/], ["backsplash_area", /\bbacksplash\b/]]) if (re.test(d) && /\b(?:tile|tiling|ceramic|porcelain|marble|granite)\b/.test(d)) {
      const material2 = ["porcelain", "marble", "granite", "ceramic"].find((s) => new RegExp("\\b" + s + "\\b").test(d));
      if (material2) add(key2, "tile_material", [material2]);
    }
    for (const [key2, re] of [["roof_waterproofing_area", /\broof\b/], ["terrace_waterproofing_area", /\bterrace\b/], ["wet_floor_waterproofing_area", /\bwet\s+(?:area\s+)?floor\b/], ["wet_wall_waterproofing_area", /\bwet\s+(?:area\s+)?wall\b/]]) if (re.test(d) && /\b(?:waterproof|membrane)/.test(d)) {
      const system = /\b(?:polyurethane|pu)\b/.test(d) ? "polyurethane" : /\bcementitious\b/.test(d) ? "cementitious" : /\b(?:torch|bitumen|bituminous)\b/.test(d) ? "torch_bitumen" : null;
      if (system) add(key2, "waterproofing_system", [system]);
    }
    if (/\bkitchen\b/.test(d) && /\bcabinet/.test(d)) {
      const material2 = /\balumini?um\b/.test(d) ? "aluminium" : /\bmdf\b/.test(d) ? "mdf" : /\bplywood\b/.test(d) ? "plywood" : null;
      if (material2) add("kitchen_cabinet_length", "cabinet_material", [material2]);
    }
    if (/\b(?:ac|air conditioning|air conditioner)\b/.test(d)) {
      const system = /\bvrf\b/.test(d) ? "vrf" : /\bducted\s+split\b/.test(d) ? "ducted_split" : /\bsplit\b/.test(d) ? "split" : null;
      if (system) add("ac_count", "unit_system", [system]);
    }
  }
  return facts.filter((f) => typeof f.value !== "number" || Number.isFinite(f.value) && f.value > 0 && f.value < 1e6);
}
function readPdfSourceSpecifications(takeoff) {
  const pages = takeoff?.page_results || [], facts = [];
  let native = false;
  for (const p of pages) {
    if (["boq", "estimate", "quotation", "cost_schedule"].includes(p.page_evidence?.kind)) continue;
    const text = p.native_text_evidence?.status === "readable" ? p.native_text_evidence : p.native_plan_text?.status === "readable" ? p.native_plan_text : null;
    if (!text) continue;
    native = true;
    if (!Number.isInteger(p.pageNumber) || p.pageNumber < 1 || !Array.isArray(text.spans) || text.spans.length > 1e4) continue;
    const bands = [];
    const spans = text.spans.filter((s) => typeof s.text === "string" && Number.isFinite(s.y) && Number.isFinite(s.x)).sort((a, b) => b.y - a.y || a.x - b.x);
    for (const s of spans) {
      let band = bands.at(-1);
      if (!band || Math.abs(band.y - s.y) >= 1.5) {
        band = { y: s.y, spans: [] };
        bands.push(band);
      }
      band.spans.push(s);
    }
    const value = bands.map((b) => b.spans.sort((a, b2) => a.x - b2.x).map((s) => s.text).join(" ")).join("\n");
    let scope = normal(p.page_evidence?.scope_id || "project").replace(/floor\s*[: ]\s*/, "floor:");
    if (["gf", "ground floor"].includes(scope)) scope = "floor:0";
    if (["ff", "first floor"].includes(scope)) scope = "floor:1";
    if (value.length > 1e5) continue;
    facts.push(...factsIn(value, p.pageNumber, scope));
  }
  if (!native && !pages.length) {
    for (const f of takeoff?.pdf_analysis?.specification_facts || []) {
      if (f?.source !== "native_pdf_text" || !Number.isInteger(f.page) || f.page < 1 || typeof f.scope_id !== "string" || typeof f.quote !== "string" || f.quote.length > 2e3) continue;
      if (factsIn(f.quote, f.page, f.scope_id).some((r) => r.metric === f.metric && r.property === f.property && r.value === f.value && r.scope_id === f.scope_id)) facts.push({ ...f });
    }
  }
  return [...new Map(facts.map((f) => [JSON.stringify([f.metric, f.property, f.value, f.page, f.scope_id, f.quote]), f])).values()];
}
function valueFor(facts, key2, property, takeoff) {
  const rows = facts.filter((f) => f.metric === key2 && f.property === property), found = unique2(rows.map((f) => f.value));
  if (found.length !== 1) return null;
  if (rows.some((f) => f.scope_id === "project")) return found[0];
  const intrinsic = { ground_slab_volume: "floor:0", first_slab_volume: "floor:1", roof_slab_volume: "roof" }[key2];
  const scopes = intrinsic ? [intrinsic] : unique2((takeoff?.pdf_analysis?.selected_floor_pages || []).map((p) => p.scope));
  return scopes.length && scopes.every((s) => rows.some((f) => f.scope_id === s)) ? found[0] : null;
}
function compatible(facts, key2, constraints, takeoff) {
  return Object.entries(constraints).every(([p, v]) => valueFor(facts, key2, p, takeoff) === v);
}
function resolvedPdfSpecifications(takeoff, key2, facts = readPdfSourceSpecifications(takeoff)) {
  return unique2(facts.filter((f) => f.metric === key2).map((f) => f.property)).flatMap((property) => {
    const value = valueFor(facts, key2, property, takeoff);
    return value === null ? [] : [{ property, value, pages: unique2(facts.filter((f) => f.metric === key2 && f.property === property).map((f) => f.page)) }];
  });
}
function pdfSpecificationConflicts(facts) {
  const groups = /* @__PURE__ */ new Map();
  for (const f of facts) {
    const key2 = f.metric + "|" + f.property;
    if (!groups.has(key2)) groups.set(key2, []);
    groups.get(key2).push(f);
  }
  return [...groups.values()].filter((rows) => unique2(rows.map((f) => f.value)).length > 1).map((rows) => ({ metric: rows[0].metric, property: rows[0].property, values: unique2(rows.map((f) => f.value)), pages: unique2(rows.map((f) => f.page)), reason: "Mixed or conflicting specifications cannot price one aggregate quantity." }));
}
function sourceSpecificationMetric(description, unit2, takeoff, facts = readPdfSourceSpecifications(takeoff)) {
  const d = normal(description), finish = (keys, expected, constraints = {}) => {
    if (!keys.length || !["m2", "m3", "m", "nr", "nos", "no", "each", "ea"].includes(unit2) || !(unit2 === expected || expected === "nr" && ["nos", "no", "each", "ea"].includes(unit2))) return null;
    return { key: keys.join("+"), ...keys.length > 1 ? { keys } : {}, factor: 1, specificationFacts: facts.filter((f) => keys.includes(f.metric) && Object.keys(constraints).includes(f.property)) };
  };
  if (/\b(?:blockwork|blocks?|masonry)\b/.test(d) && unit2 === "m2") {
    const thickness = d.match(/\b(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/), constraints = thickness ? { thickness_mm: Number(thickness[1]) * { mm: 1, cm: 10, m: 1e3 }[thickness[2]] } : {};
    const ext = /\b(?:external|exterior)\b/.test(d), int = /\b(?:internal|interior|partition)\b/.test(d);
    if (ext && int || !thickness && !ext && !int || /\b(?:aac|autoclaved|gypsum|glass|clay|brick)\b/.test(d)) return null;
    const keys = (ext ? ["external_block_area"] : int ? ["internal_block_area"] : ["external_block_area", "internal_block_area"]).filter((k) => compatible(facts, k, constraints, takeoff));
    return keys.length === 1 ? finish(keys, "m2", constraints) : null;
  }
  const grades = [...d.matchAll(/\bc\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?\b/g)].map((m) => `C${m[1]}${m[2] ? "/" + m[2] : ""}`);
  if (grades.length && /\b(?:concrete|rc|blinding)\b/.test(d)) {
    if (unique2(grades).length !== 1 || /\b(?:precast|prestressed|post tensioned|mesh)\b/.test(d)) return null;
    if (/\b\d+(?:\.\d+)?\s*(?:mm|cm)\b|\d\s*[x×]\s*\d/.test(d)) return null;
    const named = concrete.filter(([, re]) => re.test(d));
    const keys = (named.length ? named.map(([k]) => k) : concrete.filter(([k]) => k !== "pcc_volume").map(([k]) => k)).filter((k) => takeoff?.pdf_analysis?.quantity_evidence?.[k]?.length && compatible(facts, k, { concrete_grade: grades[0] }, takeoff));
    if (named.length && keys.length !== named.length) return null;
    return finish(keys, "m3", { concrete_grade: grades[0] });
  }
  if (/\bpipes?\b/.test(d) && /\b(?:water|waste|drainage|soil)\b/.test(d)) {
    const waste = /\b(?:waste|drainage|soil)\b/.test(d), water = /\bwater\b/.test(d) && !waste;
    const key2 = waste ? "waste_pipe_length" : water ? "water_pipe_length" : null, diameter = d.match(/\b(?:dn\s*)?(\d+(?:\.\d+)?)\s*(mm|cm)?\b/), material2 = d.match(/\b(ppr|u?pvc|hdpe|copper)\b/);
    if (!key2 || !diameter && !material2) return null;
    const constraints = { ...diameter ? { diameter_mm: Number(diameter[1]) * (diameter[2] === "cm" ? 10 : 1) } : {}, ...material2 ? { pipe_material: material2[1].toUpperCase() } : {} };
    return compatible(facts, key2, constraints, takeoff) ? finish([key2], "m", constraints) : null;
  }
  if (/\b(?:ac|air conditioning|air conditioner)\b/.test(d) && /\b(?:units?|split)\b/.test(d)) {
    const capacity = d.match(/\b(\d+(?:\.\d+)?)\s*(?:tr|tons?|tonnes?)\b/);
    if (!capacity) return null;
    const constraints = { capacity_tr: Number(capacity[1]) };
    return compatible(facts, "ac_count", constraints, takeoff) ? finish(["ac_count"], "nr", constraints) : null;
  }
  return null;
}
function hasSourceSpecificationScope(description) {
  const d = normal(description);
  return /\b(?:blockwork|blocks?|masonry)\b/.test(d) || /\bc\s*\d/.test(d) && /\b(?:concrete|rc|blinding)\b/.test(d) || /\bpipes?\b/.test(d) && /\b(?:ppr|u?pvc|hdpe|copper|dn)\b|\d\s*mm\b/.test(d) || /\b(?:ac|air conditioning|air conditioner)\b/.test(d) && /\d+(?:\.\d+)?\s*(?:tr|tons?|tonnes?)\b/.test(d);
}

// src/lib/pdfNativePageExtraction.mjs
var number = (text) => /^\d+(?:\.\d+)?$/.test(String(text).trim()) ? Number(text) : NaN;
var clean2 = (text) => String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
var floor = (text) => /^(?:ground|first|second|third|basement|roof)(?: floor)?$|^floor \d+$/i.test(text.trim());
var zero = { rooms: 0, doors: 0, windows: 0, wall_length: 0, wall_area: 0, floor_area: 0, ceiling_area: 0, door_area: 0, window_area: 0 };
var claim = (key2, value, unit2, scope, page, evidence) => ({ key: key2, value, unit: unit2, scope_id: scope, pages: [page], evidence, native_calculated: true, document_calculated: true });
function table2(spans, columns) {
  const matches = [];
  for (const anchor of spans) {
    if (!columns[0].test(clean2(anchor.text))) continue;
    const band = spans.filter((s) => Math.abs(s.y - anchor.y) < 1.5);
    const cells = columns.map((pattern) => band.filter((s) => pattern.test(clean2(s.text))));
    if (cells.every((c) => c.length === 1)) matches.push({ y: anchor.y, cols: cells.map((c) => c[0]) });
  }
  if (matches.length !== 1) throw Error("A single unambiguous table header is required");
  const head = matches[0];
  if (head.cols.some((c, i) => i && c.x - head.cols[i - 1].x < 25)) throw Error("Table columns overlap");
  const rows = [];
  for (const s of [...spans].filter((s2) => s2.y < head.y - 3).sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = rows.find((r) => Math.abs(r.y - s.y) < 1.5);
    if (!row) {
      row = { y: s.y, cells: head.cols.map(() => []) };
      rows.push(row);
    }
    let index = 0;
    for (let i = 1; i < head.cols.length; i++) if (Math.abs(s.x - head.cols[i].x) < 15) index = i;
    row.cells[index].push(s.text.trim());
  }
  return { head, rows: rows.filter((r) => r.cells.slice(1).some((c) => c.length)).map((r) => r.cells.map((c) => c.join(" "))) };
}
var services = /* @__PURE__ */ new Map([
  ["light points", ["light_count", "nr"]],
  ["lighting points", ["light_count", "nr"]],
  ["socket points", ["socket_count", "nr"]],
  ["distribution boards", ["distribution_board_count", "nr"]],
  ["split ac units", ["ac_count", "nr"]],
  ["insulated ac pipes", ["ac_pipe_length", "m"]],
  ["smoke detectors", ["smoke_detector_count", "nr"]],
  ["water supply pipes", ["water_pipe_length", "m"]],
  ["waste pipes", ["waste_pipe_length", "m"]]
]);
function serviceClaims(native, page, normalizePdfScope2) {
  const t = table2(native.spans, [/^item$/, /^(?:ground|ground floor|gf)$/, /^(?:first|first floor|ff)$/, /^unit$/]);
  const scopes = t.head.cols.slice(1, 3).map((s) => normalizePdfScope2(/^(ground|first)$/i.test(s.text) ? s.text + " floor" : s.text));
  if (new Set(scopes).size !== 2 || !t.rows.length || t.rows.length > 500) throw Error("Invalid service scope/table");
  const seen = /* @__PURE__ */ new Set(), claims = [];
  for (const row of t.rows) {
    const mapping = services.get(clean2(row[0]));
    if (!mapping || seen.has(mapping[0])) throw Error("Unknown or repeated service row");
    seen.add(mapping[0]);
    const [key2, unit2] = mapping;
    if (clean2(row[3]) !== unit2) throw Error("Unsupported service unit");
    for (let i = 0; i < 2; i++) {
      const value = number(row[i + 1]);
      if (!Number.isFinite(value) || value < 0 || value > 1e6 || unit2 === "nr" && !Number.isInteger(value)) throw Error("Invalid service quantity");
      claims.push(claim(key2, value, unit2, scopes[i], page, `Native source table: ${row[0]}; ${t.head.cols[i + 1].text}: ${row[i + 1]} ${unit2}. Material, diameter and capacity are separate source requirements.`));
    }
  }
  return claims;
}
function barClaims(native, page) {
  const text = native.spans.map((s) => s.text).join(" ");
  const formula = [...text.matchAll(/diameter\s*\(mm\)\s*\^\s*2\s*\/\s*(\d+(?:\.\d+)?)\s*kg\/m/gi)];
  if (formula.length !== 1 || !(Number(formula[0][1]) > 0) || !/sum all rows/i.test(text) || !/(?:only scheduled\s+reinforcement|complete project reinforcement|all project reinforcement)/i.test(text)) throw Error("Complete reinforcement scope/formula required");
  const t = table2(native.spans, [/^element$/, /^dia(?:meter)? mm$/, /^count$/, /^cut length m$/]);
  if (!t.rows.length || t.rows.length > 500) throw Error("Empty/excessive reinforcement table");
  const seen = /* @__PURE__ */ new Set(), terms = [];
  for (const row of t.rows) {
    const id = clean2(row[0]), [diameter, count, length] = row.slice(1).map(number);
    if (!id || seen.has(id) || ![diameter, count, length].every((n) => Number.isFinite(n) && n > 0) || !Number.isInteger(count) || diameter > 100 || count > 1e6 || length > 1e6) throw Error("Invalid or repeated reinforcement row");
    seen.add(id);
    terms.push({ id, diameter, count, length, kg: count * length * diameter * diameter / Number(formula[0][1]) });
  }
  const value = terms.reduce((sum, t2) => sum + t2.kg, 0);
  if (!Number.isFinite(value)) throw Error("Invalid reinforcement total");
  return [claim("rebar_kg", value, "kg", "project", page, `Native complete bar table; ${formula[0][0]}; no intermediate rounding: ${terms.map((t2) => `${t2.id}: ${t2.count} \xD7 ${t2.length} m \xD7 ${t2.diameter} mm squared / ${formula[0][1]}`).join("; ")}. No unscheduled reinforcement or wastage added.`)];
}
function extractNativePdfPages(readings, normalizePdfScope2) {
  const pages = [], audits = [];
  let inherited = null;
  for (const reading of [...readings].sort((a, b) => a.pageNumber - b.pageNumber)) {
    const { pageNumber, native_text_evidence: native } = reading;
    const audit = { page: pageNumber, text_status: native?.status || "unavailable", extracted: false };
    audits.push(audit);
    if (native?.status !== "readable" || !Array.isArray(native.spans) || native.spans.length > 3e3) {
      inherited = null;
      continue;
    }
    const spans = native.spans, text = spans.map((s) => s.text).join(" ");
    let kind = null, scope = "project", quantities = [];
    try {
      const openingHeader = ["id", "type", "width", "height"].every((h) => spans.some((s) => clean2(s.text) === h));
      if (openingHeader) {
        const headings = spans.filter((s) => floor(s.text));
        if (headings.length !== 1) throw Error("Opening floor heading unresolved");
        kind = "opening_schedule";
        scope = normalizePdfScope2(headings[0].text);
        const result = readNativeOpeningSchedule({ pageNumber, page_evidence: { kind, scope_id: scope }, native_text_evidence: native }, normalizePdfScope2, inherited?.page === pageNumber - 1 ? inherited.basis : null);
        if (result.status !== "read") throw Error(result.reason || "Opening table unavailable");
        inherited = { page: pageNumber, basis: result.dimension_basis };
      } else {
        inherited = null;
        if (/\bdeclared services schedule\b|\bservices quantity schedule\b/i.test(text)) {
          kind = "quantity_schedule";
          quantities = serviceClaims(native, pageNumber, normalizePdfScope2);
        } else if (/\b(?:declared bar schedule|reinforcement schedule)\b/i.test(text)) {
          kind = "quantity_schedule";
          quantities = barClaims(native, pageNumber);
        } else if (/\b(?:measurement and finishes|construction specifications|finish specifications)\b/i.test(text) && ["WALLS:", "FLOORS:", "CEILINGS:"].filter((s) => text.includes(s)).length >= 2) {
          kind = "specification";
        } else throw Error("No fully supported local page contract");
      }
      const revisions = [...new Set([...text.matchAll(/\bR\d+\b/g)].map((m) => m[0]))];
      if (revisions.length > 1) throw Error("Conflicting native source revisions");
      pages.push({
        ...zero,
        pageNumber,
        confidence: 0,
        detected_items: [],
        area_geometry: null,
        page_evidence: { kind, scope_id: scope, drawing_id: null, revision: revisions[0] || null, quantities },
        native_text_evidence: native,
        native_extraction: { version: 1, method: "explicit_source_table_or_specification", parsed_keys: [...new Set(quantities.map((q) => q.key))], requires_source_review: true },
        notes: "Locally extracted source evidence. Unparsed prose and cross-page relationships require source review; not a complete or approved takeoff."
      });
      Object.assign(audit, { extracted: true, kind, scope, parsed_keys: [...new Set(quantities.map((q) => q.key))] });
    } catch (error) {
      audit.reason = String(error.message).slice(0, 180);
      inherited = null;
    }
  }
  return { pages, audits };
}

// src/lib/pdfTakeoffEvidence.mjs
var PDF_METRIC_UNITS = Object.freeze({ rooms: "nr", door_count: "nr", window_count: "nr", door_area: "m2", window_area: "m2", wall_length: "m", wall_area: "m2", floor_area: "m2", ceiling_area: "m2", roof_area: "m2", pcc_volume: "m3", foundation_volume: "m3", pedestal_volume: "m3", column_volume: "m3", beam_volume: "m3", ground_slab_volume: "m3", first_slab_volume: "m3", roof_slab_volume: "m3", rebar_kg: "kg", foundation_formwork_area: "m2", column_formwork_area: "m2", beam_formwork_area: "m2", slab_formwork_area: "m2", external_block_area: "m2", internal_block_area: "m2", wood_floor_area: "m2", ceramic_floor_area: "m2", epoxy_floor_area: "m2", terrace_floor_area: "m2", wet_floor_area: "m2", wet_wall_area: "m2", plaster_area: "m2", paint_area: "m2", gypsum_ceiling_area: "m2", excavation_volume: "m3", toilet_count: "nr", basin_count: "nr", shower_count: "nr", socket_count: "nr", light_count: "nr", distribution_board_count: "nr", ac_count: "nr", smoke_detector_count: "nr", water_pipe_length: "m", waste_pipe_length: "m", ac_pipe_length: "m", kitchen_cabinet_length: "m", terrace_railing_length: "m", roof_waterproofing_area: "m2", terrace_waterproofing_area: "m2", wet_floor_waterproofing_area: "m2", wet_wall_waterproofing_area: "m2", wet_wall_tile_area: "m2", ceiling_paint_area: "m2", backsplash_area: "m2", driveway_area: "m2", landscape_area: "m2", kitchen_sink_count: "nr", laundry_sink_count: "nr", internal_wall_length: "m", external_wall_length: "m", internal_door_count: "nr", service_door_count: "nr", entrance_door_count: "nr", garage_door_count: "nr", kitchen_hob_hood_count: "nr" });
function normalizePdfScope(s) {
  const v = String(s || "").toLowerCase().trim().replace(/[ _-]+/g, " ");
  if (["gf", "ground", "ground floor", "floor 0", "\u0647\u0645\u06A9\u0641", "\u0627\u0644\u0637\u0627\u0628\u0642 \u0627\u0644\u0623\u0631\u0636\u064A"].includes(v)) return "floor:0";
  if (["ff", "first", "first floor", "floor 1", "\u0637\u0628\u0642\u0647 \u0627\u0648\u0644", "\u0627\u0644\u0637\u0627\u0628\u0642 \u0627\u0644\u0623\u0648\u0644"].includes(v)) return "floor:1";
  if (["project", "whole project", "all floors", "total"].includes(v)) return "project";
  return v;
}
var valid = (n) => Number.isFinite(n) && n >= 0;
function pdfExcludedMetricKeys(exclusions) {
  const declared = /* @__PURE__ */ new Set();
  for (const text of exclusions || []) for (const token of String(text).match(/[A-Za-z_][A-Za-z_0-9]*/g) || [])
    if (Object.hasOwn(PDF_METRIC_UNITS, token)) declared.add(token);
  return [...declared];
}
function mergePdfEvidence(pages, failed = [], total = pages.length) {
  const warnings = [], selected = /* @__PURE__ */ new Map(), excluded = [], conflictedFloors = /* @__PURE__ */ new Set();
  const documentReview = applyPdfDocumentReview(pages, PDF_METRIC_UNITS, normalizePdfScope);
  pages = documentReview.pages;
  warnings.push(...documentReview.warnings);
  const reviewStatus = pages.find((p) => p.document_review_status)?.document_review_status;
  if (reviewStatus && ["failed", "pending"].includes(reviewStatus.status)) warnings.push("PDF cross-page measurement review " + reviewStatus.status + ": " + reviewStatus.reason);
  const areaValidation = [];
  pages = pages.map((p) => {
    const checked = auditPdfAreaGeometry(p);
    if (checked.audit) areaValidation.push(checked.audit);
    warnings.push(...checked.warnings);
    if (checked.page.__areaGeometryValidated) return checked.page;
    const recovered = recoverPdfRoomInventory(checked.page);
    warnings.push(...recovered.warnings);
    return recovered.page;
  });
  for (const p of pages) {
    const e = p.page_evidence;
    if (e?.kind !== "floor_plan") {
      excluded.push({ page: p.pageNumber, reason: "not_an_architectural_floor_plan" });
      continue;
    }
    const scope = normalizePdfScope(e.scope_id);
    if (!scope || scope === "project") {
      excluded.push({ page: p.pageNumber, reason: "unresolved_floor_scope" });
      warnings.push("Floor scope missing on page " + p.pageNumber);
      continue;
    }
    const existing = selected.get(scope);
    if (!existing) {
      selected.set(scope, p);
      continue;
    }
    if (existing.page_evidence.revision !== e.revision) {
      warnings.push("Conflicting floor revisions: " + scope);
      conflictedFloors.add(scope);
    }
    if ((p.confidence || 0) > (existing.confidence || 0)) {
      excluded.push({ page: existing.pageNumber, reason: "duplicate_floor_scope" });
      selected.set(scope, p);
    } else excluded.push({ page: p.pageNumber, reason: "duplicate_floor_scope" });
  }
  const floors = [...selected.entries()].filter(([scope]) => !conflictedFloors.has(scope)).map(([, p]) => p), fields = { rooms: 0, doors: 0, windows: 0, wall_length: 0, wall_area: 0, floor_area: 0, ceiling_area: 0, door_area: 0, window_area: 0 };
  const native = nativeOpeningEvidence(pages.filter((p) => p.page_evidence?.kind !== "floor_plan" || floors.includes(p)), normalizePdfScope);
  const nativeTables = extractNativePdfPages(pages.map((p) => ({ pageNumber: p.pageNumber, native_text_evidence: p.native_text_evidence })), normalizePdfScope);
  const tableClaims = nativeTables.pages.flatMap((p) => p.page_evidence.quantities);
  const nativeOpeningKeys = new Set(native.claims.map((q) => q.key));
  const nativeWholeTableKeys = new Set(tableClaims.filter((q) => normalizePdfScope(q.scope_id) === "project").map((q) => q.key));
  const nativeFloorTableKeys = new Set(tableClaims.filter((q) => normalizePdfScope(q.scope_id) !== "project").map((q) => q.key));
  const nativeTableIdentities = new Set(tableClaims.map((q) => q.key + "|" + normalizePdfScope(q.scope_id)));
  warnings.push(...native.warnings);
  const nativeKeys = new Set([...native.claims, ...tableClaims].map((q) => q.key));
  for (const p of floors) for (const k of Object.keys(fields)) {
    if (valid(p[k])) fields[k] += p[k];
  }
  const claims = /* @__PURE__ */ new Map(), rejected = [];
  const observations = pages.filter((p) => p.page_evidence?.kind !== "floor_plan" || floors.includes(p)).map((p) => {
    const direct = p.page_evidence?.kind === "floor_plan" ? Object.entries({ rooms: "rooms", doors: "door_count", windows: "window_count", floor_area: "floor_area", ceiling_area: "ceiling_area", wall_length: "wall_length", wall_area: "wall_area", window_area: "window_area", door_area: "door_area" }).filter(([k]) => valid(p[k]) && p[k] > 0).map(([k, key2]) => ({ key: key2, value: p[k], unit: PDF_METRIC_UNITS[key2], scope_id: p.page_evidence.scope_id, evidence: `Architectural plan page ${p.pageNumber}: ${k} summary; AI extraction requires review.` })) : [];
    return { ...p, claims: [...direct, ...p.page_evidence?.quantities || []] };
  });
  if (native.claims.length) observations.push({ pageNumber: native.schedules[0].page, page_evidence: { kind: "opening_schedule" }, claims: native.claims });
  for (const p of nativeTables.pages) if (p.page_evidence.quantities.length) observations.push({ pageNumber: p.pageNumber, page_evidence: p.page_evidence, claims: p.page_evidence.quantities });
  for (const p of observations) for (const q of p.claims) {
    const scope = normalizePdfScope(q.scope_id), unit2 = PDF_METRIC_UNITS[q.key];
    if (!q.native_calculated && (nativeOpeningKeys.has(q.key) || nativeWholeTableKeys.has(q.key) || nativeTableIdentities.has(q.key + "|" + scope) || nativeFloorTableKeys.has(q.key) && scope === "project")) continue;
    if (!unit2 || q.unit !== unit2 || !scope || !valid(q.value) || unit2 === "nr" && !Number.isInteger(q.value) || !String(q.evidence || "").trim()) {
      rejected.push({ page: p.pageNumber, key: q.key, reason: "invalid_or_unsupported_evidence" });
      continue;
    }
    const id = q.key + "|" + scope, priority = q.document_calculated ? 3 : p.page_evidence.kind === "floor_plan" ? 1 : 2;
    const sourcePages = q.document_calculated ? q.pages : PDF_AREA_KEYS.includes(q.key) && p.document_area_source_pages ? p.document_area_source_pages : [p.pageNumber];
    const row = { ...q, scope_id: scope, pages: [...new Set(sourcePages)], priority };
    const old = claims.get(id);
    if (!old || priority > old.priority) claims.set(id, row);
    else if (priority === old.priority) {
      old.pages = [.../* @__PURE__ */ new Set([...old.pages, ...row.pages])];
      if (Math.abs(old.value - row.value) > 1e-3) old.conflict = true;
    }
  }
  const resolved = {}, evidence = {}, overlappingScopeClaims = [], nativeIncompleteKeys = /* @__PURE__ */ new Set();
  const floorScopes = new Set(floors.map((p) => normalizePdfScope(p.page_evidence.scope_id)));
  for (const key2 of Object.keys(PDF_METRIC_UNITS)) {
    const values = [...claims.values()].filter((q) => q.key === key2), whole = values.find((q) => q.scope_id === "project");
    const isFloorScope = (q) => floorScopes.has(q.scope_id) || /^floor:-?\d+$/.test(q.scope_id);
    const floorTotals = values.filter(isFloorScope);
    if (nativeFloorTableKeys.has(key2) && [...floorScopes].some((scope) => !floorTotals.some((q) => q.scope_id === scope))) {
      warnings.push("Native table does not cover every selected floor for " + key2 + "; project total withheld");
      resolved[key2] = 0;
      nativeIncompleteKeys.add(key2);
      continue;
    }
    const structural = /^(?:beam|column|foundation|pedestal|.*slab)_volume$|_formwork_area$/.test(key2);
    const use = whole ? [whole] : floorTotals.length ? values.filter((q) => isFloorScope(q) || structural && q.scope_id === "roof") : values;
    for (const q of values) if (!use.includes(q)) overlappingScopeClaims.push({ key: key2, scope: q.scope_id, pages: q.pages, value: q.value, reason: whole ? "project_total_precedes_subsets" : "qualified_subset_not_added_to_floor_totals" });
    if (!use.length) continue;
    if (use.some((q) => q.conflict)) {
      warnings.push("Conflicting scheduled quantity: " + key2);
      resolved[key2] = 0;
      continue;
    }
    resolved[key2] = use.reduce((n, q) => n + q.value, 0);
    evidence[key2] = use.map(({ priority, ...q }) => q);
  }
  const names = { door_count: "doors", window_count: "windows" };
  for (const [key2, n] of Object.entries(resolved)) fields[names[key2] || key2] = n;
  const blocked = /* @__PURE__ */ new Set([...areaValidation.flatMap((a) => a.withheld_metrics || []), ...documentReview.blocked, ...nativeIncompleteKeys]);
  for (const key2 of nativeKeys) if (!nativeIncompleteKeys.has(key2)) blocked.delete(key2);
  const omitted = pdfExcludedMetricKeys(documentReview.audit?.exclusions);
  for (const key2 of omitted) if (PDF_SOURCE_MEASUREMENT_KEYS.includes(key2) && !evidence[key2]?.some((q) => q.document_calculated)) {
    blocked.add(key2);
    warnings.push("PDF explicitly unresolved source measurement: " + key2);
  }
  for (const key2 of blocked) {
    fields[names[key2] || key2] = 0;
    resolved[key2] = 0;
    delete evidence[key2];
  }
  fields.window_area = resolved.window_area ?? fields.window_area;
  fields.door_area = resolved.door_area ?? fields.door_area;
  const report = { version: 108, measurement_review_version: 1, document_review_status: reviewStatus || null, document_measurement_review: documentReview.audit, total_pages: total, selected_floor_pages: floors.map((p) => ({ page: p.pageNumber, scope: normalizePdfScope(p.page_evidence.scope_id) })), excluded_pages: excluded, failed_pages: failed, conflicts: warnings, rejected_claims: rejected, quantity_evidence: evidence, area_validation: areaValidation, withheld_area_metrics: [...new Set(areaValidation.flatMap((a) => a.withheld_metrics || []))], withheld_measurement_metrics: [...blocked].filter((k) => !PDF_AREA_KEYS.includes(k)), overlapping_scope_claims: overlappingScopeClaims, unresolved_floor_scopes: [...conflictedFloors] };
  report.source_measurement_status = pages.find((p) => p.source_measurement_status)?.source_measurement_status || null;
  report.native_opening_schedules = native.schedules.map((s) => ({ page: s.page, status: s.status, scope_id: s.scope_id, rows: s.rows.length, reason: s.reason || null }));
  report.local_pdf_recovery = pages.find((p) => p.local_pdf_recovery)?.local_pdf_recovery || null;
  report.native_first_read = pages.find((p) => p.native_first_read)?.native_first_read || null;
  report.specification_facts = readPdfSourceSpecifications({ page_results: pages });
  report.specification_conflicts = pdfSpecificationConflicts(report.specification_facts);
  for (const issue of report.specification_conflicts) warnings.push(`PDF specifications ${issue.metric}/${issue.property}: ${issue.values.join(", ")} on pages ${issue.pages.join(", ")}; source breakdown required before selecting a catalog variant.`);
  const unmeasured = omitted.filter((k) => !evidence[k]?.length);
  report.measurement_completion = {
    status: failed.length || conflictedFloors.size || blocked.size || unmeasured.length || ["failed", "pending"].includes(reviewStatus?.status) || ["failed", "pending", "partial"].includes(report.source_measurement_status?.status) ? "incomplete" : "provisional",
    unmeasured_metrics: [...new Set(unmeasured)],
    withheld_metrics: [...blocked],
    reason: "AI-extracted evidence requires source review; completed requests do not establish a complete or approved BOQ."
  };
  const nativeHeight = pages.find((p) => p.native_measurement_basis)?.native_measurement_basis?.rules?.wall_height;
  const sourcedHeight = Number.isFinite(nativeHeight?.value) && nativeHeight.value > 0 && nativeHeight.evidence?.trim() && nativeHeight.pages?.length && nativeHeight.pages.every((n) => pages.some((p) => p.pageNumber === n));
  return { ...fields, confidence: floors.length ? Math.round(floors.reduce((s, p) => s + (p.confidence || 0), 0) / floors.length * 10) / 10 : 0, wall_height: sourcedHeight ? nativeHeight.value : 3.2, wall_length_estimated: false, wall_area_estimated: false, wall_length_source: "pdf_scoped_floor_plan", wall_area_source: "pdf_scoped_floor_plan", wall_height_source: sourcedHeight ? "pdf_native_source_rule" : "project_default", total_pages: total, analyzed_pages: pages.length, failed_pages: failed, page_results: pages, detected_items: floors.flatMap((p) => (p.detected_items || []).map((i) => ({ ...i, pages: [p.pageNumber] }))), scheduled_quantities: resolved, pdf_analysis: report, notes: `PDF reconciled by page role and floor scope. ${floors.length} distinct floor plans selected. Schedules override matching scope instead of adding duplicates. AI extraction requires review. ${warnings.join("; ")}` };
}
function pdfRuleMetric(description, unit2, takeoff = null, specificationFacts = void 0) {
  const d = String(description || "").toLowerCase().replace(/[-‐‑–—]/g, " ").replace(/\s+/g, " ").trim(), rawUnit = String(unit2 || "").toLowerCase().trim().replace("\xB2", "2").replace("\xB3", "3");
  const u = { "sqm": "m2", "sq.m": "m2", "sq m": "m2", "cum": "m3", "cu.m": "m3", "cu m": "m3", "lm": "m", "lin.m": "m", "linear metre": "m", "linear meter": "m", "no.": "nr", "nos.": "nr", "each": "nr", "ea": "nr", "set": "nr" }[rawUnit] || rawUnit;
  if (/disposal|cart\s*away|haul|backfill|downlight|luminaire|light fixture|\bled\b/.test(d)) return null;
  if (hasSourceSpecificationScope(d)) return sourceSpecificationMetric(d, u, takeoff, specificationFacts);
  if (/\bformwork\b/.test(d) && /\bbeams?\b/.test(d) && /\b(?:soffits?|undersides?|bottoms?)\b/.test(d) && !/\bslabs?\b/.test(d)) return null;
  if (/\bformwork\b/.test(d)) {
    const groups = [/\b(?:foundations?|footings?|pedestals?)\b/, /\bcolumns?\b/, /\bbeams?\b/, /\bslabs?\b/].filter((re) => re.test(d));
    const slabBeamSoffit = groups.length === 2 && /\bslabs?\b/.test(d) && /\bbeams?\b/.test(d) && /\bsoffit\b/.test(d);
    if (groups.length > 1 && !slabBeamSoffit) return null;
  }
  if (/\bplaster(?:ing)?\b/.test(d) && (!/\b(?:internal|interior)\b/.test(d) || /\b(?:external|exterior|facade|ceiling|render)\b/.test(d))) return null;
  const specific = [
    [/\b(?:ceiling\s+(?:emulsion\s+)?paint|paint(?:ing)?\s+(?:to\s+)?(?:internal\s+)?ceilings?)\b/, "ceiling_paint_area", "m2"],
    [/\b(?:wet\s+(?:area|room)s?\s+wall\s+(?:tiles?|tiling)|wall\s+(?:tiles?|tiling)\s+(?:to|in)\s+wet\s+(?:area|room)s?)\b/, "wet_wall_tile_area", "m2"],
    [/\bwet\s+(?:area|room)s?\s+wall\s+waterproofing\b/, "wet_wall_waterproofing_area", "m2"],
    [/\bwet\s+(?:area|room)s?\s+floor\s+waterproofing\b/, "wet_floor_waterproofing_area", "m2"],
    [/\bkitchen\s+backsplash\b/, "backsplash_area", "m2"],
    [/\b(?:kitchen\s+base\s+cabinets?|base\s+kitchen\s+cabinets?)\b/, "kitchen_cabinet_length", "m"]
  ];
  if (/\b(?:wall|walls)\b/.test(d) && /\b(?:floor|floors|ceiling|ceilings)\b/.test(d)) return null;
  for (const [pattern, key2, expected] of specific) if (pattern.test(d)) return u === expected ? { key: key2, factor: 1 } : null;
  const operation = pdfCatalogScope(d);
  if (operation) {
    const { unit: expected, ...metric } = operation;
    if (expected === "kg" && ["ton", "tonne", "t"].includes(u)) return { ...metric, factor: 1e-3 };
    if (u === expected || expected === "nr" && ["nos", "no", "number", "nr"].includes(u)) return { ...metric, factor: 1 };
    return null;
  }
  const rules = [[/blinding/, "pcc_volume", "m3"], [/\bexcavation\b/, "excavation_volume", "m3"], [/formwork.*found/, "foundation_formwork_area", "m2"], [/formwork.*column/, "column_formwork_area", "m2"], [/formwork.*beam/, "beam_formwork_area", "m2"], [/formwork.*slab/, "slab_formwork_area", "m2"], [/reinforcement|reinforcing steel/, "rebar_kg", "kg"], [/wood.*floor|parquet/, "wood_floor_area", "m2"], [/ceramic.*floor/, "ceramic_floor_area", "m2"], [/epoxy.*floor|garage.*epoxy/, "epoxy_floor_area", "m2"], [/plaster/, "plaster_area", "m2"], [/internal wall.*paint|wall emulsion/, "paint_area", "m2"], [/gypsum.*ceiling/, "gypsum_ceiling_area", "m2"], [/glazed window|aluminium.*window/, "window_area", "m2"], [/water closet|toilet pan/, "toilet_count", "nr"], [/wash\s*basin/, "basin_count", "nr"], [/shower/, "shower_count", "nr"], [/socket/, "socket_count", "nr"], [/lighting?\s+point|light\s+point/, "light_count", "nr"], [/distribution board/, "distribution_board_count", "nr"], [/smoke detector/, "smoke_detector_count", "nr"]];
  for (const [pattern, key2, expected] of rules) if (pattern.test(d)) {
    if (expected === "kg" && ["ton", "tonne", "t"].includes(u)) return { key: key2, factor: 1e-3 };
    if (u === expected || expected === "nr" && ["nos", "no", "number", "point", "nr"].includes(u)) return { key: key2, factor: 1 };
    return null;
  }
  return null;
}
function pdfScheduledRule(takeoff, description, unit2, specificationFacts = void 0) {
  const metric = pdfRuleMetric(description, unit2, takeoff, specificationFacts);
  if (!metric) return null;
  const keys = metric.keys || [metric.key], rows = [];
  let value = 0;
  for (const key2 of keys) {
    const claims = takeoff.pdf_analysis?.quantity_evidence?.[key2], quantity = takeoff.scheduled_quantities?.[key2];
    if (!claims?.length || !valid(quantity) || claims.some((r) => r.key !== key2 || r.unit !== PDF_METRIC_UNITS[key2] || !valid(r.value) || r.unit === "nr" && !Number.isInteger(r.value) || !String(r.evidence || "").trim() || !Array.isArray(r.pages) || !r.pages.length)) return null;
    if (Math.abs(claims.reduce((n, r) => n + r.value, 0) - quantity) > 1e-3) return null;
    rows.push(...claims);
    value += quantity;
  }
  if (!pdfCatalogThicknessMatches(metric, rows) || !pdfCatalogHeightMatches(metric, rows, description)) return null;
  const specifications = metric.specificationFacts || [];
  return { quantity: value * metric.factor, metricKey: metric.key, ...metric.keys ? { metricKeys: keys } : {}, source: "pdf_schedule_evidence", measured: true, pages: [.../* @__PURE__ */ new Set([...rows.flatMap((r) => r.pages), ...specifications.map((f) => f.page)])], evidence: [...rows.map((r) => r.evidence), ...specifications.map((f) => `Source specification p.${f.page}: ${f.quote}`)].join(" | ") };
}

// src/lib/boqCatalogRate.mjs
function resolvePdfCatalogRate(item, priceLevel = "standard") {
  const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0;
  const components = ["material_rate", "labor_rate", "equipment_rate", "transport_rate"].map((k) => Number(item?.[k] || 0));
  const rates = {
    standard: positive(item?.standard_rate),
    economy: positive(item?.economy_rate),
    premium: positive(item?.premium_rate),
    component: components.every((v) => Number.isFinite(v) && v >= 0) ? positive(components.reduce((a, b) => a + b, 0)) : 0
  };
  const level = String(priceLevel || "standard").toLowerCase();
  const order = level === "economy" ? ["economy", "standard", "premium", "component"] : level === "premium" ? ["premium", "standard", "economy", "component"] : ["standard", "economy", "premium", "component"];
  for (const key2 of order) if (rates[key2] > 0) return { rate: rates[key2], source: key2 === level ? `direct_${key2}_rate` : `fallback_${key2}_rate`, peerCount: 0, missingRate: false };
  return { rate: 0, source: "rate_missing_on_catalog_item", peerCount: 0, missingRate: true };
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

// src/lib/boqPriceSelection.mjs
function clearBoqGapNote(notes) {
  return String(notes || "").replace(/\s*\[BOQ GAP\][\s\S]*?\[\/BOQ GAP\]/g, "").replace(/The matched catalog item has no own rate\. Quantity retained; no peer or median rate borrowed\./g, "").replace(/Quantity retained without assuming a catalog specification or rate\. Not included in tender or priced budget\./g, "").trim();
}

// src/lib/pdfDefaultSpecifications.mjs
var allowed = {
  water_pipe_length: ["pipe_material", "diameter_mm"],
  waste_pipe_length: ["pipe_material", "diameter_mm"],
  ac_pipe_length: ["pipe_material", "diameter_pair_mm", "insulation_mm"],
  internal_block_area: ["thickness_mm", "block_material"],
  external_block_area: ["thickness_mm", "block_material"],
  wood_floor_area: ["floor_system"],
  epoxy_floor_area: ["floor_system"],
  terrace_floor_area: ["tile_material"],
  wet_wall_tile_area: ["tile_material"],
  backsplash_area: ["tile_material"],
  ceiling_paint_area: ["paint_system"],
  roof_waterproofing_area: ["waterproofing_system"],
  terrace_waterproofing_area: ["waterproofing_system"],
  wet_floor_waterproofing_area: ["waterproofing_system"],
  wet_wall_waterproofing_area: ["waterproofing_system"],
  door_count: ["door_system"],
  internal_door_count: ["door_system"],
  service_door_count: ["door_system"],
  entrance_door_count: ["door_system"],
  garage_door_count: ["door_system"],
  ac_count: ["capacity_tr", "unit_system"],
  kitchen_cabinet_length: ["cabinet_material"],
  kitchen_hob_hood_count: ["appliance_package"],
  kitchen_sink_count: ["fixture_system"],
  laundry_sink_count: ["fixture_system"],
  shower_count: ["fixture_system"],
  terrace_railing_length: ["railing_system"],
  driveway_area: ["paving_system"],
  landscape_area: ["landscape_system"]
};
for (const key2 of ["pcc_volume", "foundation_volume", "pedestal_volume", "column_volume", "beam_volume", "ground_slab_volume", "first_slab_volume", "roof_slab_volume"]) allowed[key2] = ["concrete_grade"];
var unit = (s) => ({ nos: "nr", no: "nr", each: "nr", ea: "nr", set: "nr", sqm: "m2", cum: "m3", lm: "m" })[String(s || "").toLowerCase()] || String(s || "").toLowerCase().replace("\xB2", "2").replace("\xB3", "3");
function metadata(item) {
  try {
    return typeof item?.source_reference === "string" ? JSON.parse(item.source_reference) : item?.source_reference;
  } catch {
    return null;
  }
}
function isPdfDefaultOnlyPrice(item) {
  return metadata(item)?.fallback_only === true;
}
function policy(item) {
  if (item?.is_active === false) return null;
  const p = metadata(item), keys = Object.hasOwn(allowed, p?.metric) ? allowed[p.metric] : null;
  if (p?.kind !== "pricing_default" || p.enabled !== true || !keys || unit(item.unit) !== PDF_METRIC_UNITS[p.metric] || item.currency && item.currency !== "AED" || typeof p.label !== "string" || !p.label.trim()) return null;
  const spec = p.specification;
  if (!spec || keys.some((k) => spec[k] === void 0) || Object.keys(spec).some((k) => !keys.includes(k))) return null;
  if (Object.values(spec).some((v) => typeof v === "string" ? !v.trim() : typeof v !== "number" || !Number.isFinite(v) || v <= 0)) return null;
  if (p.metric === "ac_pipe_length") {
    const pair = String(spec.diameter_pair_mm).split("+").map(Number);
    if (pair.length !== 2 || pair.some((v) => !Number.isFinite(v) || v <= 0) || !(Number(spec.insulation_mm) > 0)) return null;
  }
  if (typeof p.rate_basis !== "string" || !p.rate_basis.trim() || p.conditions !== void 0 && typeof p.conditions !== "string") return null;
  if (p.source_required !== void 0 && (!Array.isArray(p.source_required) || p.source_required.some((k) => !keys.includes(k)))) return null;
  return p;
}
function pricedRow(item, p, rateItem, resolution, known, extra = {}) {
  const quantity = Number(item.quantity), assumed = Object.fromEntries(Object.entries(p.specification).filter(([property]) => !known.some((k) => k.property === property)));
  const disclosure = `PRICING ASSUMPTION (EDITABLE; NOT A DRAWING SPECIFICATION): ${p.label}; rate item ${rateItem.item_code}; ${p.rate_basis}.${p.conditions ? " " + p.conditions : ""}`;
  return {
    ...item,
    description: `${p.label} [assumed specification \u2014 editable]`,
    rate: resolution.rate,
    referenceRate: resolution.rate,
    amount: Math.round((quantity * resolution.rate + Number.EPSILON) * 100) / 100,
    rateMissing: false,
    rateSource: `Assumed specification; catalog ${rateItem.item_code}; ${resolution.source}`,
    source: "PDF measured quantity + editable catalog specification assumption",
    status: "provisional_estimate",
    verification: "provisional",
    specificationVerification: "assumed",
    reviewRequired: true,
    includeInCommercialTotal: false,
    defaultSpecification: { status: "applied", metric: item.pdfEvidence.metricKey, assumed, sourceSpecifications: known, catalogItemCode: rateItem.item_code, catalogUnit: rateItem.unit, catalogRate: resolution.rate, rateBasis: p.rate_basis, policy: p, originalDescription: item.description, ...extra },
    completion: { code: "assumed_specification_review_required", required_information: ["Confirm or edit the assumed specification and its budget rate."] },
    notes: [clearBoqGapNote(item.notes), disclosure].filter(Boolean).join(" ")
  };
}
function doorParts(item, takeoff, p, catalog, priceLevel) {
  if (!p.opening_components) return null;
  const native = nativeOpeningEvidence(takeoff.page_results || [], normalizePdfScope);
  const rows = native.schedules.filter((s) => s.status === "read").flatMap((s) => s.rows.filter((r) => ["door", "garage_door"].includes(r.kind)));
  const count = native.claims.filter((c) => c.key === "door_count").reduce((n, c) => n + c.value, 0);
  if (!native.claims.length || native.schedules.some((s) => s.status !== "read") || count !== Number(item.quantity) || rows.length !== count) return null;
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const list = grouped.get(row.kind) || [];
    list.push(row);
    grouped.set(row.kind, list);
  }
  const result = [];
  for (const [kind, group] of grouped) {
    const config2 = p.opening_components[kind], matches = catalog.filter((c) => c.item_code === config2?.item_code && c.is_active !== false);
    if (!config2 || matches.length !== 1 || unit(matches[0].unit) !== "nr") return null;
    const rateItem = matches[0], rate = resolvePdfCatalogRate(rateItem, priceLevel);
    if (rate.missingRate) return null;
    const pages = [...new Set(group.flatMap((r) => r.dimension_pages || [r.page]))];
    const basis = `Source opening table ${kind}: ${group.map((r) => r.source_row).join("; ")}. Count allocated from complete source table, not a pricing assumption.`;
    const child = {
      ...item,
      id: `${item.id || item.itemCode}:${kind}`,
      itemCode: `${item.itemCode}-${kind.toUpperCase()}`,
      quantity: group.length,
      pdfEvidence: { ...item.pdfEvidence, pages, basis, sourceAllocation: { kind, count: group.length, parentQuantity: count, tags: group.map((r) => r.id) } }
    };
    const partPolicy = { ...p, label: config2.label, specification: { door_system: config2.door_system }, rate_basis: config2.rate_basis || p.rate_basis, conditions: config2.conditions || p.conditions };
    const scaled = group.map((r) => Math.max(1, config2.reference_area_m2 > 0 ? r.width * r.height / config2.reference_area_m2 : 1));
    if (new Set(scaled.map((v) => v.toFixed(6))).size > 1) {
      for (let i = 0; i < group.length; i++) {
        const single = { ...child, id: child.id + ":" + group[i].id, itemCode: child.itemCode + "-" + group[i].id, quantity: 1, pdfEvidence: { ...child.pdfEvidence, sourceAllocation: { kind, count: 1, parentQuantity: count, tags: [group[i].id] } } };
        result.push(pricedRow(single, partPolicy, rateItem, { ...rate, rate: Math.round(rate.rate * scaled[i] * 100) / 100 }, [], { openingKind: kind, sizeFactor: scaled[i] }));
      }
    } else result.push(pricedRow(child, partPolicy, rateItem, { ...rate, rate: Math.round(rate.rate * scaled[0] * 100) / 100 }, [], { openingKind: kind, sizeFactor: scaled[0] }));
  }
  return result;
}
function applyPdfDefaultSpecifications(items, takeoff, catalog = [], priceLevel = "standard") {
  if (!takeoff?.pdf_analysis) return items;
  const facts = readPdfSourceSpecifications(takeoff), conflicts = pdfSpecificationConflicts(facts), byMetric = /* @__PURE__ */ new Map();
  for (const rateItem of catalog) {
    const p = policy(rateItem);
    if (!p) continue;
    const entries = byMetric.get(p.metric) || [];
    entries.push({ p, rateItem });
    byMetric.set(p.metric, entries);
  }
  return items.flatMap((item) => {
    const key2 = item.pdfEvidence?.metricKey;
    if (item.review?.confirmed || item.source === "manual" || item.defaultSpecification?.rateOverridden || item.defaultSpecification?.status && item.defaultSpecification.status !== "applied" || !(Number(item.quantity) > 0) || Number(item.rate) > 0 || unit(item.unit) !== PDF_METRIC_UNITS[key2]) return [item];
    if (items.filter((i) => i.quantity > 0 && (i.pdfEvidence?.metricKeys || [i.pdfEvidence?.metricKey]).includes(key2)).length !== 1 || conflicts.some((f) => f.metric === key2)) return [item];
    const source2 = facts.filter((f) => f.metric === key2), known = resolvedPdfSpecifications(takeoff, key2, facts);
    const policies = (byMetric.get(key2) || []).filter(({ p: p2 }) => !source2.some((f) => !known.some((k) => k.property === f.property)) && !known.some((k) => p2.specification[k.property] !== k.value) && !(p2.source_required || []).some((prop) => !known.some((k) => k.property === prop)));
    if (policies.length !== 1) return [item];
    const { p, rateItem } = policies[0], rate = resolvePdfCatalogRate(rateItem, priceLevel);
    if (rate.missingRate) return [item];
    const claims = takeoff.pdf_analysis.quantity_evidence?.[key2], quantity = Number(item.quantity), expected = PDF_METRIC_UNITS[key2];
    if (!claims?.length || claims.some((c) => c.key !== key2 || c.unit !== expected || !Number.isFinite(c.value) || c.value < 0 || !c.evidence?.trim() || !c.pages?.length) || Math.abs(claims.reduce((n, c) => n + c.value, 0) - quantity) > 1e-3) return [item];
    if (expected === "nr" && !Number.isInteger(quantity)) return [item];
    if (["water_pipe_length", "waste_pipe_length", "ac_pipe_length"].includes(key2) && !source2.length && claims.some((c) => /\b(?:dn|dia(?:meter)?)\s*[:=]?\s*\d+|\b(?:ppr|u?pvc|cpvc|hdpe|copper|steel|pex)\b|\d\s*mm|[øØ⌀]|\d\s*\/\s*\d/i.test(c.evidence))) return [item];
    if (key2 === "door_count" && p.opening_components) {
      const parts = doorParts(item, takeoff, p, catalog, priceLevel);
      if (parts) return parts;
      if (claims.some((c) => /garage[_ ]door|roller shutter|overhead door/i.test(c.evidence))) return [item];
    }
    return [pricedRow(item, p, rateItem, rate, known)];
  });
}

// src/lib/pdfBoqCoverage.mjs
function planPdfCatalogBindings(takeoff, candidates) {
  const byMetric = /* @__PURE__ */ new Map(), byCode = /* @__PURE__ */ new Map();
  const specificationFacts = readPdfSourceSpecifications(takeoff);
  const signatures = /* @__PURE__ */ new Map(), conflictingCodes = /* @__PURE__ */ new Set();
  for (const item of candidates || []) {
    if (!item || item.is_active === false || isPdfDefaultOnlyPrice(item)) continue;
    const code = String(item.item_code || item.itemCode || "").trim().toUpperCase();
    if (!code) continue;
    const signature = JSON.stringify([String(item.description || "").trim().toLowerCase(), String(item.unit || "").trim().toLowerCase()]);
    if (signatures.has(code) && signatures.get(code) !== signature) conflictingCodes.add(code);
    signatures.set(code, signature);
    const evidence = pdfScheduledRule(takeoff, item.description, item.unit, specificationFacts);
    if (!evidence || evidence.quantity <= 0) continue;
    byCode.set(code, evidence);
    for (const key2 of evidence.metricKeys || [evidence.metricKey]) {
      const group = byMetric.get(key2) || /* @__PURE__ */ new Map();
      group.set(code, evidence);
      byMetric.set(key2, group);
    }
  }
  const bindings = /* @__PURE__ */ new Map(), warnings = [];
  for (const [metric, group] of byMetric) {
    if (group.size !== 1 || conflictingCodes.has([...group.keys()][0])) {
      warnings.push(`PDF quantity ${metric} has ${group.size === 1 ? "inconsistent definitions for catalog code" : "competing catalog items"} (${[...group.keys()].join(", ")}). Specification selection required; quantity was not repeated across them.`);
    }
  }
  for (const [code, evidence] of byCode) if (!conflictingCodes.has(code) && (evidence.metricKeys || [evidence.metricKey]).every((k) => byMetric.get(k)?.size === 1)) bindings.set(code, evidence);
  return { bindings, warnings };
}
function planPdfCatalogRules(takeoff, rules, candidates) {
  const next = [...rules || []], codes = new Set(next.map((r) => String(r.item_code || "").trim().toUpperCase()));
  const allActive = (candidates || []).filter((i) => i && i.is_active !== false);
  const active = allActive.filter((i) => !isPdfDefaultOnlyPrice(i));
  const configuredCodes = new Set(active.filter((i) => {
    const code = String(i.item_code || i.itemCode || "").trim().toUpperCase();
    const section = String(i.section_code || "").trim();
    return codes.has(code) || Boolean(section && !/^unassigned$/i.test(section)) || Boolean(String(i.source_name || "").trim()) || !resolvePdfCatalogRate(i).missingRate;
  }).map((i) => String(i.item_code || i.itemCode || "").trim().toUpperCase()));
  const eligible = active.filter((i) => configuredCodes.has(String(i.item_code || i.itemCode || "").trim().toUpperCase()));
  const plan = planPdfCatalogBindings(takeoff, eligible);
  const ignored = active.length - eligible.length;
  if (ignored) plan.warnings.push(`PDF catalog: ${ignored} unconfigured scope entries have no section, source, own catalog rate or active formula rule; they were not treated as competing commercial items. No catalog records were changed.`);
  for (const item of eligible) {
    const code = String(item?.item_code || "").trim().toUpperCase();
    if (!plan.bindings.has(code) || codes.has(code)) continue;
    next.push({
      item_code: item.item_code,
      section_code: item.section_code,
      formula_type: "manual",
      rule_name: "PDF evidence: existing catalog item",
      notes: "Explicit PDF operation matched to a unique existing catalog item; review required."
    });
    codes.add(code);
  }
  return { ...plan, rules: next, catalogAudit: { activeEntries: allActive.length, defaultOnlyEntries: allActive.length - active.length, commercialCandidates: eligible.length, unconfiguredEntries: ignored } };
}
var operations = {
  excavation_volume: ["02", "Site Works", "Excavation"],
  pcc_volume: ["03", "Concrete Works", "Concrete blinding \u2014 grade requires confirmation"],
  foundation_volume: ["03", "Concrete Works", "Foundation concrete \u2014 grade requires confirmation"],
  pedestal_volume: ["03", "Concrete Works", "Pedestal concrete \u2014 grade requires confirmation"],
  column_volume: ["03", "Concrete Works", "Column concrete \u2014 grade requires confirmation"],
  beam_volume: ["03", "Concrete Works", "Beam concrete \u2014 grade requires confirmation"],
  ground_slab_volume: ["03", "Concrete Works", "Ground slab concrete \u2014 grade requires confirmation"],
  first_slab_volume: ["03", "Concrete Works", "First floor slab concrete \u2014 grade requires confirmation"],
  roof_slab_volume: ["03", "Concrete Works", "Roof slab concrete \u2014 grade requires confirmation"],
  rebar_kg: ["03", "Concrete Works", "Reinforcement \u2014 scheduled mass"],
  foundation_formwork_area: ["03", "Concrete Works", "Foundation formwork"],
  column_formwork_area: ["03", "Concrete Works", "Column formwork"],
  beam_formwork_area: ["03", "Concrete Works", "Beam formwork"],
  slab_formwork_area: ["03", "Concrete Works", "Slab formwork"],
  external_block_area: ["04", "Masonry Works", "External blockwork \u2014 specification requires confirmation"],
  internal_block_area: ["04", "Masonry Works", "Internal blockwork \u2014 specification requires confirmation"],
  wood_floor_area: ["07", "Finishes", "Wood floor finish"],
  ceramic_floor_area: ["07", "Finishes", "Ceramic floor finish"],
  epoxy_floor_area: ["07", "Finishes", "Epoxy floor finish"],
  terrace_floor_area: ["07", "Finishes", "Terrace floor finish \u2014 specification requires confirmation"],
  plaster_area: ["07", "Finishes", "Plaster"],
  paint_area: ["07", "Finishes", "Wall paint"],
  gypsum_ceiling_area: ["07", "Finishes", "Gypsum ceiling"],
  window_area: ["06", "Doors and Windows", "Windows \u2014 measured opening area; specification requires confirmation"],
  door_count: ["06", "Doors and Windows", "Door sets \u2014 material and type require confirmation"],
  internal_door_count: ["06", "Doors and Windows", "Internal door sets \u2014 material requires confirmation"],
  service_door_count: ["06", "Doors and Windows", "External service door sets \u2014 specification requires confirmation"],
  entrance_door_count: ["06", "Doors and Windows", "Entrance door sets \u2014 specification requires confirmation"],
  garage_door_count: ["06", "Doors and Windows", "Garage door sets \u2014 specification requires confirmation"],
  kitchen_hob_hood_count: ["07", "Finishes", "Kitchen hob and hood package \u2014 specification requires confirmation"],
  toilet_count: ["08", "Plumbing", "Toilet pans"],
  basin_count: ["08", "Plumbing", "Wash basins"],
  shower_count: ["08", "Plumbing", "Showers"],
  water_pipe_length: ["08", "Plumbing", "Water pipe \u2014 diameter and material require confirmation"],
  waste_pipe_length: ["08", "Plumbing", "Waste pipe \u2014 diameter and material require confirmation"],
  light_count: ["09", "Electrical", "Lighting points \u2014 fixture types require confirmation"],
  socket_count: ["09", "Electrical", "Socket points"],
  distribution_board_count: ["09", "Electrical", "Distribution boards"],
  ac_count: ["10", "HVAC", "Air conditioning units \u2014 capacities require confirmation"],
  ac_pipe_length: ["10", "HVAC", "Air conditioning pipe \u2014 specification requires confirmation"],
  smoke_detector_count: ["11", "Fire Fighting", "Smoke detectors"],
  kitchen_cabinet_length: ["07", "Finishes", "Kitchen cabinetry \u2014 specification requires confirmation"],
  terrace_railing_length: ["12", "External Works", "Terrace railing \u2014 specification requires confirmation"],
  roof_waterproofing_area: ["05", "Waterproofing", "Roof waterproofing"],
  terrace_waterproofing_area: ["05", "Waterproofing", "Terrace waterproofing"],
  wet_floor_waterproofing_area: ["05", "Waterproofing", "Wet area floor waterproofing"],
  wet_wall_waterproofing_area: ["05", "Waterproofing", "Wet area wall waterproofing"],
  wet_wall_tile_area: ["07", "Finishes", "Wet area wall tiles"],
  ceiling_paint_area: ["07", "Finishes", "Ceiling paint"],
  backsplash_area: ["07", "Finishes", "Kitchen backsplash"],
  driveway_area: ["12", "External Works", "Driveway \u2014 paving specification requires confirmation"],
  landscape_area: ["13", "Landscaping", "Landscaping \u2014 planting specification requires confirmation"],
  kitchen_sink_count: ["08", "Plumbing", "Kitchen sinks"],
  laundry_sink_count: ["08", "Plumbing", "Laundry sinks"]
};
function retainUnboundPdfQuantities(items, takeoff) {
  if (!takeoff.pdf_analysis) return { items, warnings: [] };
  const next = [...items], warnings = [];
  const doorKeys = ["internal_door_count", "service_door_count", "entrance_door_count", "garage_door_count"];
  const doorBreakdown = doorKeys.filter((k) => Number.isFinite(takeoff.scheduled_quantities?.[k]));
  const completeDoors = doorBreakdown.length > 0 && Math.abs(doorBreakdown.reduce((n, k) => n + takeoff.scheduled_quantities[k], 0) - (takeoff.scheduled_quantities?.door_count ?? -1)) < 1e-3;
  const bound = new Set(items.filter((i) => i.quantity > 0).flatMap((i) => i.pdfEvidence?.metricKeys || [i.pdfEvidence?.metricKey]).filter(Boolean));
  for (const [key2, [sectionCode, section, description]] of Object.entries(operations)) {
    if (key2 === "door_count" && completeDoors) continue;
    if (doorKeys.includes(key2) && !completeDoors) continue;
    const quantity = takeoff.scheduled_quantities?.[key2];
    const claims = takeoff.pdf_analysis.quantity_evidence?.[key2];
    if (bound.has(key2) || !Number.isFinite(quantity) || quantity <= 0 || !claims?.length) continue;
    const unit2 = PDF_METRIC_UNITS[key2];
    if (claims.some((c) => c.key !== key2 || c.unit !== unit2 || !Number.isFinite(c.value) || c.value < 0 || !c.evidence?.trim()) || Math.abs(claims.reduce((n, c) => n + c.value, 0) - quantity) > 1e-3) continue;
    const pages = [...new Set(claims.flatMap((c) => c.pages || []))];
    const basis = claims.map((c) => c.evidence).join(" | ");
    const itemCode = `PDF-${key2.toUpperCase()}`;
    if (next.some((i) => i.itemCode === itemCode)) continue;
    next.push({
      itemCode,
      sectionCode,
      section,
      category: section,
      subCategory: "",
      description,
      unit: unit2,
      quantity,
      materialRate: 0,
      laborRate: 0,
      equipmentRate: 0,
      transportRate: 0,
      rate: 0,
      referenceRate: 0,
      amount: 0,
      rateMissing: true,
      rateSource: "unavailable_specification_or_catalog_match",
      status: "measured_rate_pending",
      verification: "pending",
      includeInCommercialTotal: false,
      quantityVerification: "pdf_evidence_requires_review",
      reviewRequired: true,
      quantityBasis: "pdf_schedule_evidence",
      quantitySource: "pdf_schedule_evidence",
      source: "PDF evidence - rate and specification pending",
      pdfEvidence: { metricKey: key2, pages, basis },
      notes: `PDF EVIDENCE (AI; REVIEW REQUIRED): pages ${pages.join(", ")}; ${basis}. Quantity retained without assuming a catalog specification or rate. Not included in tender or priced budget.`
    });
    warnings.push(`PDF quantity ${key2} retained as an unpriced row; confirm specification and rate.`);
  }
  return { items: next, warnings };
}

// src/lib/pdfBoqCompletion.mjs
var requirements = {
  internal_block_area: ["Block thickness/material matching the drawing", "An own catalog or project rate for that specification"],
  door_count: ["Door material/type breakdown including garage doors", "Applicable rate for each selected door type"],
  internal_door_count: ["Door material and set specification"],
  service_door_count: ["Service door classification and specification"],
  entrance_door_count: ["Entrance door classification and specification"],
  garage_door_count: ["Garage door system and specification"],
  water_pipe_length: ["Pipe material and diameter breakdown"],
  waste_pipe_length: ["Drainage material and diameter breakdown"],
  ac_count: ["Unit type and capacity breakdown"],
  ac_pipe_length: ["AC pipe material/diameter and insulation specification"],
  wet_wall_tile_area: ["Wall tile material and installation specification"],
  backsplash_area: ["Backsplash material and installation specification"],
  roof_waterproofing_area: ["Roof waterproofing system, layers and installation specification"],
  terrace_waterproofing_area: ["Terrace waterproofing system and installation specification"],
  wet_floor_waterproofing_area: ["Wet floor waterproofing system and installation specification"],
  wet_wall_waterproofing_area: ["Wet wall waterproofing system and installation specification"],
  ceiling_paint_area: ["Applicable ceiling paint system and its own rate"],
  epoxy_floor_area: ["Epoxy floor system and its own rate"],
  wood_floor_area: ["Wood flooring system/material and its own rate"],
  terrace_floor_area: ["Outdoor flooring material and installation specification"],
  kitchen_cabinet_length: ["Base cabinet material/finish and linear-metre rate"],
  kitchen_hob_hood_count: ["Hob/hood package specification and package rate"],
  kitchen_sink_count: ["Kitchen sink and fittings specification"],
  laundry_sink_count: ["Laundry sink and fittings specification"],
  shower_count: ["Shower/fittings package specification"],
  terrace_railing_length: ["Railing material/system and linear-metre rate"],
  driveway_area: ["Driveway paving material and construction specification"],
  landscape_area: ["Landscape planting/groundcover specification"]
};
function annotatePdfBoqCompletion(items, takeoff, catalog = [], priceLevel = "standard") {
  if (!takeoff.pdf_analysis) return { items, summary: null, gaps: [] };
  items = applyPdfDefaultSpecifications(items, takeoff, catalog, priceLevel);
  const candidates = /* @__PURE__ */ new Map();
  const specificationFacts = readPdfSourceSpecifications(takeoff);
  const specificationConflicts = pdfSpecificationConflicts(specificationFacts);
  for (const p of catalog) {
    if (p?.is_active === false || isPdfDefaultOnlyPrice(p)) continue;
    const m = pdfRuleMetric(p?.description, p?.unit, takeoff, specificationFacts);
    if (!m) continue;
    const rows = candidates.get(m.key) || [];
    rows.push({ code: p.item_code || p.itemCode, unit: p.unit, rateAvailable: !resolvePdfCatalogRate(p).missingRate });
    candidates.set(m.key, rows);
  }
  const summary = { pricedMeasuredOperations: 0, unpricedMeasuredOperations: 0, catalogOptionsWithoutQuantity: 0, assumedSpecificationOperations: 0, unmeasuredCatalogRowsAreNotMissingProjectScope: true, completePricedBudget: false };
  const gaps = [];
  const next = items.map((item) => {
    const quantity = Number(item.quantity), rate = Number(item.rate);
    const existingNotes = String(item.notes || "").replace(/\s*\[BOQ GAP\][\s\S]*?\[\/BOQ GAP\]/g, "").trim();
    if (!(quantity > 0)) {
      summary.catalogOptionsWithoutQuantity++;
      const completion2 = { code: "catalog_option_without_quantity", required_information: ["Select this catalog option only if it belongs to the project and has its own measured quantity."] };
      return { ...item, completion: completion2, notes: [existingNotes, "[BOQ GAP] Catalog option without a project quantity. This row is not evidence of an additional missing project scope. [/BOQ GAP]"].filter(Boolean).join(" ") };
    }
    if (rate > 0 && !item.rateMissing) {
      summary.pricedMeasuredOperations++;
      if (item.defaultSpecification?.status === "applied") summary.assumedSpecificationOperations++;
      return item;
    }
    summary.unpricedMeasuredOperations++;
    const key2 = item.pdfEvidence?.metricKey || String(item.itemCode || "").replace(/^PDF-/, "").toLowerCase();
    const matching = candidates.get(key2) || [];
    let required = /_volume$/.test(key2) && key2 !== "excavation_volume" ? ["Concrete grade/specification for this element", "Applicable own catalog or project rate"] : requirements[key2] || ["Applicable scope/material specification and matching own catalog or project rate"];
    let code = matching.length && matching.every((p) => !p.rateAvailable) ? "catalog_rate_missing" : matching.length > 1 ? "catalog_selection_required" : "specification_or_catalog_match_required";
    const known = resolvedPdfSpecifications(takeoff, key2, specificationFacts), conflicts = specificationConflicts.filter((f) => f.metric === key2);
    if (conflicts.length) {
      code = "source_specification_breakdown_required";
      required = ["Provide disjoint measured quantities for the mixed/conflicting source specifications before selecting rates."];
    } else if (known.length && !matching.length) {
      code = "source_specification_without_catalog_match";
      required = ["Select or provide an applicable rate matching the known source specification; the source quantity is retained."];
    }
    const completion = { code, metric: key2, required_information: required, candidate_codes: matching.map((p) => p.code), ...known.length ? { source_specifications: known } : {}, ...conflicts.length ? { specification_conflicts: conflicts } : {} };
    gaps.push({ itemCode: item.itemCode, description: item.description, quantity, unit: item.unit, ...completion });
    const sourceNote = known.length ? " Source: " + known.map((f) => `${f.property}=${f.value} (pages ${f.pages.join(", ")})`).join("; ") + "." : "";
    const note = `[BOQ GAP] ${code}: ${required.join("; ")}.${matching.length ? " Catalog candidates: " + matching.map((p) => p.code).join(", ") + "." : ""}${sourceNote} [/BOQ GAP]`;
    return { ...item, completion, notes: [existingNotes, note].filter(Boolean).join(" ") };
  });
  summary.knownMeasuredOperationsHaveRates = summary.pricedMeasuredOperations > 0 && summary.unpricedMeasuredOperations === 0;
  return { items: next, summary, gaps };
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
  function candidate(kind, material2, unit2) {
    const f = family(material2);
    if (!f) return null;
    return catalog.find((c) => new RegExp(kind).test(norm(c.description)) && family(c.description) === f && (unit2 === "nos" ? countUnit(c.unit) : norm(c.unit).replace("\xB2", "2") === unit2) && Number(c.resolvedRate) > 0 && !/repair|painting|ironmongery|sealant|cleaning/.test(norm(c.description))) || null;
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

// src/lib/serverBoqAnalysis.js
import { NextResponse as NextResponse2 } from "next/server.js";
import { createClient as createClient3 } from "@supabase/supabase-js";

// src/services/localBoqBuilder.js
function toNumber(value) {
  const number2 = Number(value);
  return Number.isFinite(number2) ? number2 : 0;
}
function round2(value, digits = 2) {
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
  for (const source2 of sources) {
    for (const key2 of keys) {
      const value = toNumber(source2?.[key2]);
      if (value > 0) return value;
    }
  }
  return 0;
}
function firstValue(sources, keys, fallback = null) {
  for (const source2 of sources) {
    for (const key2 of keys) {
      const value = source2?.[key2];
      if (value !== void 0 && value !== null && value !== "") return value;
    }
  }
  return fallback;
}
function countDetected(sources, keys) {
  for (const source2 of sources) {
    for (const key2 of keys) {
      const value = source2?.[key2];
      if (Array.isArray(value) && value.length > 0) return value.length;
      const number2 = toNumber(value);
      if (number2 > 0) return number2;
    }
  }
  return 0;
}
function firstArray(sources, keys) {
  for (const source2 of sources) {
    for (const key2 of keys) {
      if (Array.isArray(source2?.[key2]) && source2[key2].length > 0) return source2[key2];
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
  for (const source2 of sources) {
    const rooms = source2?.object_details?.rooms;
    if (Array.isArray(rooms) && rooms.length > 0) return rooms;
    if (Array.isArray(source2?.rooms) && source2.rooms.length > 0) return source2.rooms;
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
  unit: unit2,
  quantity,
  rate,
  source: source2,
  confidence,
  notes = ""
}) {
  return {
    itemNumber,
    section,
    description,
    unit: unit2,
    quantity: round2(quantity),
    rate: round2(rate),
    amount: round2(toNumber(quantity) * toNumber(rate)),
    source: source2,
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
    totalOpeningArea > 0 ? `Wall finishes use net wall area after deducting ${round2(totalOpeningArea)} m\xB2 of measured openings.` : "Wall finishes use gross wall area because opening dimensions are unavailable."
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
  const subtotal = round2(items.reduce((sum, item) => sum + item.amount, 0));
  const vat = round2(subtotal * (toNumber(vatPercentage) / 100));
  return {
    projectName,
    currency: "AED",
    vatPercentage: toNumber(vatPercentage),
    items,
    warnings,
    assumptions,
    summary: { subtotal, vat, grandTotal: round2(subtotal + vat) },
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
  const bbox2 = room?.regionBBox && typeof room.regionBBox === "object" && Number.isFinite(
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
  } : bbox2 ? {
    x: bbox2.x + bbox2.width / 2,
    y: bbox2.y + bbox2.height / 2,
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
    regionBBox: bbox2,
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
      let area3;
      if (index === list.length - 1) {
        area3 = floorArea - assigned;
      } else {
        area3 = floorArea * (counts[index] / totalCells);
        assigned += area3;
      }
      area3 = Math.max(
        0,
        area3
      );
      return {
        ...room,
        area: Number(
          area3.toFixed(2)
        ),
        perimeter: Number(
          (4 * Math.sqrt(area3)).toFixed(2)
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
    const words2 = normalized.split(/[^a-z0-9]+/i).filter((word) => word.length >= 4);
    return [normalized, ...words2];
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
  const number2 = Number(value);
  return Number.isFinite(number2) ? number2 : 0;
}
function round3(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(
    (toNumber2(value) + Number.EPSILON) * factor
  ) / factor;
}
function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}
function normalizeTakeoff(rawTakeoff) {
  const takeoff = rawTakeoff?.pdf_analysis && rawTakeoff?.page_results?.length ? { ...rawTakeoff, ...mergePdfEvidence(rawTakeoff.page_results, rawTakeoff.failed_pages || [], rawTakeoff.total_pages) } : rawTakeoff || {};
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
  const estimatedDoorArea = measuredDoorArea > 0 ? measuredDoorArea : !takeoff.pdf_analysis && doors > 0 ? doors * 1.89 : 0;
  const estimatedWindowArea = measuredWindowArea > 0 ? measuredWindowArea : !takeoff.pdf_analysis && windows > 0 ? windows * 1.44 : 0;
  const resolvedOpeningArea = measuredOpeningArea > 0 ? measuredOpeningArea : estimatedDoorArea + estimatedWindowArea;
  return {
    pdf_analysis: takeoff.pdf_analysis || (/pdf/i.test(takeoff.document_type || "") || /\.pdf$/i.test(takeoff.document_name || "") ? { version: 0, requiresReanalysis: true, quantity_evidence: {} } : null),
    scheduled_quantities: takeoff.scheduled_quantities || {},
    page_results: takeoff.pdf_analysis && Array.isArray(takeoff.page_results) ? takeoff.page_results : [],
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
    opening_area: round3(
      resolvedOpeningArea,
      2
    ),
    door_area: round3(
      estimatedDoorArea,
      2
    ),
    window_area: round3(
      measuredWindowArea,
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
    return takeoff.window_area || 0;
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
    return round3(
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
  return round3(
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
  for (const [source2, value] of preferredOrder) {
    if (Number(value) > 0) {
      return {
        rate: Number(value),
        source: source2 === level ? `direct_${source2}_rate` : `fallback_${source2}_rate`
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
  const unit2 = normalizeRateUnit(
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
    ) === unit2
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
    ) === unit2
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
  const unit2 = String(
    priceItem?.unit || ""
  ).trim().toLowerCase().replace(/²/g, "2").replace(/\s+/g, "");
  const isAreaUnit = [
    "m2",
    "sqm",
    "sq.m"
  ].includes(unit2);
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
  const unit2 = String(
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
    unit2
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
      unit2
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
      unit2
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
      unit2
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.22,
        source: "floor_area_based_foundation_allowance",
        confidence: 42
      };
    }
    if (["m2", "sqm", "sq.m"].includes(
      unit2
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
      unit2
    ) && columns > 0) {
      return {
        quantity: columns * 0.32,
        source: "column_count_allowance",
        confidence: 48
      };
    }
    if (["m2", "sqm", "sq.m"].includes(
      unit2
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
      unit2
    ) && wallLength > 0) {
      return {
        quantity: wallLength * 0.045,
        source: "wall_length_beam_allowance",
        confidence: 40
      };
    }
    if (["m2", "sqm", "sq.m"].includes(
      unit2
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
      unit2
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.16,
        source: "floor_area_slab_concrete_allowance",
        confidence: 50
      };
    }
    if (["m2", "sqm", "sq.m"].includes(
      unit2
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
      unit2
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
      unit2
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
      unit2
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
      unit2
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
      unit2
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
      unit2
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
      unit2
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.35,
        source: "floor_area_external_works_allowance",
        confidence: 30
      };
    }
    if (["m", "lm", "linear.m", "lin.m"].includes(
      unit2
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
      unit2
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
  const unit2 = String(
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
  ].includes(unit2);
  const isAreaUnit = [
    "m2",
    "sqm",
    "sq.m"
  ].includes(unit2);
  const isLengthUnit = [
    "m",
    "lm",
    "lin.m",
    "linear.m",
    "linearm"
  ].includes(unit2);
  const isVolumeUnit = [
    "m3",
    "cum",
    "cu.m"
  ].includes(unit2);
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
  const valid2 = (Array.isArray(items) ? items : []).filter(
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
  if (!valid2.length) {
    return [];
  }
  const xs = valid2.map(
    (item) => Number(item.centroid.x)
  );
  const ys = valid2.map(
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
  return valid2.map(
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
    if (rawTakeoff.pdf_analysis) {
      const total = Number(rawTakeoff.total_pages || rawTakeoff.pdf_analysis.total_pages || 0);
      const analyzed = Array.isArray(rawTakeoff.page_results) ? new Set(rawTakeoff.page_results.map((p) => p.pageNumber)).size : Number(rawTakeoff.analyzed_pages || 0);
      const review = rawTakeoff.pdf_analysis.document_review_status?.status;
      if (rawTakeoff.pdf_analysis.summaryOnly || rawTakeoff.failed_pages?.length || rawTakeoff.pdf_analysis.failed_pages?.length || total > 0 && analyzed < total || ["failed", "pending"].includes(review)) {
        return NextResponse2.json({ success: false, code: "PDF_ANALYSIS_INCOMPLETE", error: `BOQ generation stopped: PDF page extraction or document review is incomplete (${analyzed}/${total || "?"} pages; review: ${review || "unavailable"}). The saved BOQ was not replaced. Recover complete source evidence before generating again.` }, { status: 409 });
      }
    }
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
            const source2 = item?.centroid?.source || "unknown";
            result[source2] = (result[source2] || 0) + 1;
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
    if (prices.length === 0 || !takeoff.pdf_analysis && rules.length === 0) {
      const fallbackBoq = takeoff.pdf_analysis ? { items: [], warnings: [] } : buildLocalBoq({
        takeoff,
        projectName,
        vatPercentage
      });
      const fallbackDwg = takeoff.pdf_analysis ? { items: [], warnings: [] } : applyDwgScheduleToBoq(fallbackBoq?.items || [], getDrawingEvidence(rawTakeoff) || {}, []);
      const fallbackPdf = retainUnboundPdfQuantities(fallbackDwg.items, takeoff);
      const fallbackPdfCompletion = annotatePdfBoqCompletion(fallbackPdf.items.map(requireBoqReview), takeoff, prices, priceLevel);
      const fallbackItems = fallbackPdfCompletion.items;
      fallbackItems.forEach((item, index) => {
        item.itemNumber = String(index + 1).padStart(2, "0");
      });
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
          pdfCompletion: fallbackPdfCompletion.summary,
          summary: { subtotal: fallbackSubtotal, vat: fallbackVat, grandTotal: fallbackSubtotal + fallbackVat },
          projectId,
          priceLevel,
          warnings: [
            `Ventra UAE BOQ database is not populated (rules: ${rules.length}, prices: ${prices.length}).`,
            takeoff.pdf_analysis ? "PDF quantities retained without rates. No allowance pricing was used." : "Starter allowance rates are being used. Review/edit rates before quotation or contract use.",
            ...fallbackPdf.warnings,
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
    const warnings = [...takeoff.pdf_analysis?.conflicts || []];
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
    const pdfCatalogPlan = takeoff.pdf_analysis ? planPdfCatalogRules(takeoff, rules, prices) : null;
    if (pdfCatalogPlan) warnings.push(...pdfCatalogPlan.warnings);
    const pdfConsumedCodes = /* @__PURE__ */ new Set();
    for (const rule of pdfCatalogPlan?.rules || rulesResult.data || []) {
      const priceItem = pricesByCode.get(
        normalizeCode(rule.item_code)
      );
      if (!priceItem) {
        warnings.push(
          `Missing price item: ${rule.item_code}`
        );
        continue;
      }
      if (!takeoff.pdf_analysis && shouldSuppressDatabaseAutoRule(
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
      const pdfCode = normalizeCode(priceItem.item_code);
      if (takeoff.pdf_analysis && pdfConsumedCodes.has(pdfCode)) continue;
      if (takeoff.pdf_analysis) pdfConsumedCodes.add(pdfCode);
      const pdfQuantity = pdfCatalogPlan?.bindings.get(pdfCode) || null;
      if (takeoff.pdf_analysis) {
        quantity = pdfQuantity?.quantity ?? 0;
        quantityEstimate = pdfQuantity;
      }
      if (!takeoff.pdf_analysis && allowProvisionalDerivation && quantity <= 0 && String(
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
          quantity = round3(
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
      if (isQuantityPending && !isManualRule && !takeoff.pdf_analysis) {
        continue;
      }
      const section = sectionsByCode.get(
        rule.section_code || priceItem.section_code
      );
      const rateResolution = takeoff.pdf_analysis ? resolvePdfCatalogRate(priceItem, priceLevel) : resolveRate(
        priceItem,
        priceLevel,
        prices
      );
      const pdfRatePending = Boolean(pdfQuantity && rateResolution.missingRate);
      if (pdfRatePending) warnings.push(`PDF catalog item ${pdfCode} has no own rate. Its measured quantity is retained without a peer or median rate.`);
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
      const amount = isQuantityPending ? 0 : round3(
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
        rate: round3(
          commercialRate,
          2
        ),
        referenceRate: round3(
          unitRate,
          2
        ),
        rateSource: isQuantityPending ? "reference_rate_not_priced_until_quantity_verified" : rateResolution.source,
        rateMissing: rateResolution.missingRate,
        amount,
        priceLevel,
        source: isQuantityPending ? "Ventra Rule Library - Quantity Pending" : isEstimatedRule ? "Ventra Rule Library - Estimated Quantity" : pdfQuantity ? "PDF schedule - requires review" : priceItem.source_name || "Ventra UAE Base Rate",
        status: isQuantityPending ? "quantity_pending" : pdfRatePending ? "measured_rate_pending" : isEstimatedRule ? "provisional_estimate" : "measured",
        verification: isQuantityPending ? "pending" : pdfRatePending ? "pending" : isEstimatedRule ? "provisional" : "verified",
        includeInCommercialTotal: !isQuantityPending && !isEstimatedRule && !pdfRatePending,
        measuredFromApsStructure: isMeasuredDerivedRule && !pdfQuantity,
        pdfEvidence: pdfQuantity ? { metricKey: pdfQuantity.metricKey, ...pdfQuantity.metricKeys ? { metricKeys: pdfQuantity.metricKeys } : {}, pages: pdfQuantity.pages, basis: pdfQuantity.evidence } : null,
        confidence: isEstimatedRule ? Math.min(
          toNumber2(
            quantityEstimate?.confidence
          ) || 35,
          65
        ) : toNumber2(
          priceItem.confidence_score
        ),
        quantityBasis: isQuantityPending ? "unavailable" : quantityEstimate?.source || (isEstimatedRule ? "derived_allowance" : "measured_takeoff"),
        quantitySource: pdfQuantity ? "pdf_schedule_evidence" : isMeasuredDerivedRule ? "aps_measured_structural_properties" : isEstimatedRule ? "derived_from_verified_project_metrics" : isQuantityPending ? "unavailable" : "measured",
        notes: [
          pdfRatePending ? "The matched catalog item has no own rate. Quantity retained; no peer or median rate borrowed." : "",
          pdfQuantity ? "Quantity transcribed from PDF evidence; scope, specification and rate require review." : rule.notes || "",
          pdfQuantity ? `PDF SCHEDULE EVIDENCE (AI; REVIEW REQUIRED): pages ${pdfQuantity.pages.join(", ")}; ${pdfQuantity.evidence}` : isEstimatedRule ? `PROVISIONAL: ${quantityEstimate?.source || "derived allowance"}. Excluded from verified commercial subtotal until replaced by measured quantity.` : isMeasuredDerivedRule ? `MEASURED FROM APS STRUCTURAL PROPERTIES: ${quantityEstimate?.source || "structural measurement"}.` : ""
        ].filter(Boolean).join(" ")
      });
    }
    const v36ColumnVolume = Number(
      takeoff?.column_volume
    ) || 0;
    const v36ColumnMeasured = takeoff?.structural_measurement_status?.columns?.volumeMeasured === true;
    if (!takeoff.pdf_analysis && v36ColumnMeasured && v36ColumnVolume > 0) {
      const v36Quantity = Math.round(
        v36ColumnVolume * 100
      ) / 100;
      const v36ConcreteCandidates = (pricesResult.data || []).filter((candidate) => {
        const unit2 = normalizeRateUnit(
          candidate?.unit
        );
        const description = String(
          candidate?.description || ""
        ).toLowerCase();
        const sectionCode = String(
          candidate?.section_code || ""
        ).trim();
        return unit2 === "m3" && /concrete/.test(
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
    const allowBoqAi = !takeoff.pdf_analysis && (String(
      process.env.VENTRA_ENABLE_BOQ_AI || ""
    ).trim().toLowerCase() === "true" || ventraMode === "production" && String(
      process.env.VENTRA_DISABLE_BOQ_AI || ""
    ).trim().toLowerCase() !== "true");
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
          const quantity = round3(
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
          const amount = round3(
            quantity * unitRate,
            2
          );
          if (roomLocalElectricalQuantity > 0 && existingItem && existingItem.status === "measured_estimated") {
            const firstMeasuredRoomForCode = !measuredRoomLocalCodes.has(
              code
            );
            existingItem.quantity = round3(
              firstMeasuredRoomForCode ? quantity : (Number(
                existingItem.quantity
              ) || 0) + quantity,
              2
            );
            existingItem.rate = round3(
              unitRate,
              2
            );
            existingItem.rateSource = rateResolution.source;
            existingItem.rateMissing = rateResolution.missingRate;
            existingItem.amount = round3(
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
            existingItem.quantity = round3(
              (Number(
                existingItem.quantity
              ) || 0) + quantity,
              2
            );
            existingItem.amount = round3(
              existingItem.quantity * unitRate,
              2
            );
            existingItem.notes = `${existingItem.notes || ""} Room ${match.room_type}: ${quantity}.`.trim();
            measuredRoomLocalCodes.add(
              code
            );
          } else if (existingItem && existingItem.status === "quantity_pending") {
            existingItem.quantity = round3(
              (Number(
                existingItem.quantity
              ) || 0) + quantity,
              2
            );
            existingItem.rate = round3(
              unitRate,
              2
            );
            existingItem.rateSource = rateResolution.source;
            existingItem.rateMissing = rateResolution.missingRate;
            existingItem.amount = round3(
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
              rate: round3(
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
            existingItem.quantity = round3(
              (Number(
                existingItem.quantity
              ) || 0) + quantity,
              2
            );
            existingItem.amount = round3(
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
    const dwgResult = takeoff.pdf_analysis ? { items: [...items], warnings: [] } : applyDwgScheduleToBoq(items, getDrawingEvidence(rawTakeoff) || {}, prices.map((price) => {
      const resolved = resolveRate(price, priceLevel, prices);
      return { ...price, resolvedRate: resolved.missingRate ? 0 : resolved.rate, resolvedSource: resolved.source };
    }));
    items.splice(0, items.length, ...dwgResult.items);
    warnings.push(...dwgResult.warnings);
    if (getDrawingEvidence(rawTakeoff)?.extractionError) warnings.push(`DWG schedule extraction: ${getDrawingEvidence(rawTakeoff).extractionError}`);
    const pdfCoverage = retainUnboundPdfQuantities(items, takeoff);
    items.splice(0, items.length, ...pdfCoverage.items);
    warnings.push(...pdfCoverage.warnings);
    items.forEach((item, index) => {
      items[index] = requireBoqReview(item);
    });
    const pdfCompletion = annotatePdfBoqCompletion(items, takeoff, prices, priceLevel);
    if (pdfCompletion.summary) {
      items.splice(0, items.length, ...pdfCompletion.items);
      warnings.push(`PDF BOQ: ${pdfCompletion.summary.unpricedMeasuredOperations} measured operations need specification/catalog-rate resolution. ${pdfCompletion.summary.catalogOptionsWithoutQuantity} zero-quantity catalog rows are options, not a count of missing project measurements. See each row's notes for required information.`);
    }
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
    const verifiedSubtotal = round3(
      items.filter(
        (item) => item.includeInCommercialTotal === true
      ).reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0
      ),
      2
    );
    const provisionalSubtotal = round3(
      items.filter(
        (item) => item.status === "provisional_estimate"
      ).reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0
      ),
      2
    );
    const pendingItems = items.filter(
      (item) => ["quantity_pending", "measured_rate_pending"].includes(item.status)
    ).length;
    const subtotal = verifiedSubtotal;
    const vatAmount = round3(
      verifiedSubtotal * (vatPercentage / 100),
      2
    );
    const grandTotal = round3(
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
        pdfCatalogAudit: pdfCatalogPlan?.catalogAudit || null,
        pdfCompletion: pdfCompletion.summary,
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
