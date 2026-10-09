// Request lifecycle for image tracing only; other OpenAI callers are unchanged.
// A single bounded correction pass is allowed after a completed but invalid
// geometry trace. Transport/provider failures are never retried here.
export const RASTER_RETRYABLE_GEOMETRY_CODES = Object.freeze([
  "CONFLICTING_SCALE",
  "CONFLICTING_DIMENSIONS",
  "TRACE_IMAGE_MISMATCH",
  "UNSUPPORTED_ROOM_BOUNDARY",
  "WALL_CROSSES_ROOM",
  "ROOM_OVERLAP",
  "OVERLAPPING_ROOMS",
  "ROOM_NOT_CONTAINED",
  "SELF_INTERSECTING_POLYGON",
  "INVALID_POLYGON",
  "INVALID_WALL",
  "INCOMPLETE_TRACE",
  "DUPLICATE_OR_MISSING_ID",
  "INVALID_OPENING",
  "OPENING_OFF_WALL",
  "OPENING_OUTSIDE_WALL",
  "OPENING_WALL_MISSING",
  "OVERLAPPING_OPENINGS",
]);

export function shouldRetryRasterGeometry(error) {
  return RASTER_RETRYABLE_GEOMETRY_CODES.includes(String(error?.code || ""));
}

export async function requestRasterVision(create, payload, timeoutMs = 240000) {
  const controller = new AbortController();
  let timer;
  const timeoutError = () => Object.assign(new Error("Image analysis exceeded its time limit. No new 3D scene was saved."), { code: "RASTER_VISION_TIMEOUT", status: 504 });
  try {
    return await Promise.race([
      Promise.resolve().then(() => create(payload, { signal: controller.signal, timeout: timeoutMs, maxRetries: 0 })),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(timeoutError());
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (controller.signal.aborted || error?.name === "APIConnectionTimeoutError") throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Observe the single Vision request without adding any AI passes. Only final
// structured output is returned; partial JSON must never become a scene.
export async function consumeRasterVisionStream(create, payload, options, progress, notify = () => {}) {
  const started = Date.now();
  const stage = (name) => {
    progress.stage = name;
    progress.elapsedMs = Date.now() - started;
    notify({ stage: name, elapsedMs: progress.elapsedMs, responseId: progress.responseId || null });
  };
  progress.maxOutputTokens = payload.max_output_tokens ?? null;
  progress.reasoningEffort = payload.reasoning?.effort ?? null;
  progress.eventCount = 0;
  progress.outputCharacters = 0;
  stage('request_sent');
  try {
    const stream = await create({ ...payload, stream: true }, options);
    progress.headersMs = Date.now() - started;
    stage('stream_open');
    for await (const event of stream) {
      progress.eventCount++;
      progress.lastEventMs = Date.now() - started;
      if (progress.firstEventMs == null) progress.firstEventMs = progress.lastEventMs;
      if (event.type === 'response.created') {
        progress.responseId = event.response?.id || null;
        stage('response_created');
      }
      if (event.type === 'response.output_text.delta') {
        if (progress.firstTextMs == null) {
          progress.firstTextMs = Date.now() - started;
          stage('output_started');
        }
        progress.outputCharacters += typeof event.delta === 'string' ? event.delta.length : 0;
      }
      if (event.type === 'response.completed') {
        const response = event.response;
        if (response?.status !== 'completed') throw Object.assign(new Error('Vision returned an invalid completion event.'), { code: 'RASTER_VISION_STREAM_ERROR', status: 502 });
        const outputText = (response.output || []).filter(item => item.type === 'message')
          .flatMap(item => item.content || []).filter(part => part.type === 'output_text').map(part => part.text).join('');
        progress.usage = response.usage || null;
        stage('response_completed');
        return { ...response, output_text: outputText };
      }
      if (event.type === 'response.incomplete' || event.type === 'response.failed' || event.type === 'error') {
        progress.providerStatus = event.response?.status || 'error';
        progress.incompleteReason = event.response?.incomplete_details?.reason || null;
        progress.usage = event.response?.usage || null;
        progress.responseId = event.response?.id || progress.responseId || null;
        stage(event.type.replace('.', '_'));
        const outputLimit = progress.incompleteReason === 'max_output_tokens';
        const failed = event.type !== 'response.incomplete';
        const code = outputLimit ? 'RASTER_VISION_OUTPUT_LIMIT' : failed ? 'RASTER_VISION_PROVIDER_FAILED' : 'RASTER_VISION_INCOMPLETE';
        const message = outputLimit
          ? 'Vision reached its output token limit before completing the geometry. No new 3D scene was saved.'
          : failed ? 'The Vision provider failed before completing the geometry. No new 3D scene was saved.'
          : 'Vision did not complete its structured trace. No partial geometry was accepted.';
        throw Object.assign(new Error(message), { code, status: 502 });
      }
    }
    throw Object.assign(new Error('Vision stream ended before a completed response was received.'), { code: 'RASTER_VISION_STREAM_ENDED', status: 502 });
  } catch (error) {
    progress.elapsedMs = Date.now() - started;
    progress.transportError = error?.name || 'Error';
    throw error;
  }
}
