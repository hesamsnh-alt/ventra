// src/lib/serverPreviewJobs.js
import { createHash as createHash2, randomBytes } from "node:crypto";

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

// src/lib/serverPreviewJobs.js
var table = "ventra_preview_jobs";
var nonceHash = (value) => createHash2("sha256").update(value).digest("hex");
async function executePreviewJob(input, run) {
  if (!/^[a-f0-9-]{36}$/i.test(input?.id || "") || !/^\w{64}$/.test(input?.nonce || "") || !/^Bearer .+$/.test(input?.authorization || "")) return;
  const db = commercialAdmin(), { data: job, error } = await db.from(table).update({ status: "running" }).eq("id", input.id).eq("status", "queued").eq("nonce_hash", nonceHash(input.nonce)).select("request_body,actor_id").maybeSingle();
  if (error) throw error;
  if (!job) return;
  let result, httpStatus = 500;
  try {
    const request = new Request("https://ventra.internal/api/ai/design-3d-preview", { method: "POST", headers: { authorization: input.authorization, "content-type": "application/json" }, body: JSON.stringify(job.request_body) });
    const user = await account(request);
    if (user.id !== job.actor_id) throw billingError("Analysis job access denied.", 403);
    const response = await run(request);
    httpStatus = response.status;
    result = await response.json();
  } catch (error2) {
    result = { error: error2.status ? error2.message : "Background analysis failed. Retry or contact support.", code: "PREVIEW_BACKGROUND_FAILED" };
    httpStatus = error2.status || 500;
  }
  const saved = await db.from(table).update({ status: httpStatus < 400 ? "completed" : "failed", http_status: httpStatus, result, request_body: null, nonce_hash: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", input.id).eq("status", "running");
  if (saved.error) throw saved.error;
}

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
import { createHash as createHash3 } from "node:crypto";

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
async function prepareImage(imageUrl) {
  if (!imageUrl) throw Object.assign(new Error("No floor-plan image URL was supplied."), { code: "PREVIEW_NO_IMAGE" });
  const response = await fetch(imageUrl, { cache: "no-store" });
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
    const imageHash = createHash3("sha256").update(prepared.buffer).digest("hex");
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

// netlify/worker/preview-background.mjs
async function handler(request) {
  const input = await request.json();
  await executePreviewJob(input, runPreviewRequest);
}
var config = { background: true };
export {
  config,
  handler as default
};
