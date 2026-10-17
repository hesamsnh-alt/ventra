const endpoint = '/api/ai/analyze-drawing';

function connectionError(message, code, cause, requestId) {
  return Object.assign(new Error(message, {cause}), {code, requestId});
}

// GET is an existing, read-only health check. Never replay an analysis POST:
// a missing response does not tell us whether the server already ran the model.
export async function submitDrawingAnalysis(options, fetchRequest) {
  const requestId = new Headers(options.headers).get('X-Ventra-Request-Id') || '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const health = await fetchRequest(endpoint, {
      method: 'GET', cache: 'no-store', headers: {Accept: 'application/json'}, signal: controller.signal,
    });
    const payload = await health.json();
    if (!health.ok || payload?.success !== true) throw new Error('Analysis endpoint unavailable.');
  } catch (cause) {
    throw connectionError('Cannot reach the drawing analysis service. No analysis POST was sent. Keep the dev server running and check the service connection before trying again.',
      'DRAWING_CONNECTION_CHECK_FAILED', cause, requestId);
  } finally {
    clearTimeout(timer);
  }

  let response;
  try {
    response = await fetchRequest(endpoint, options);
  } catch (cause) {
    throw connectionError(`Connection lost while submitting analysis. The server outcome is unknown; the request was not retried automatically. Check the server log and saved PDF report before submitting again. Request: ${requestId}`,
      'DRAWING_ANALYSIS_OUTCOME_UNKNOWN', cause, requestId);
  }
  try {
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    return {response, payload};
  } catch (cause) {
    throw connectionError(`Could not read the analysis response (HTTP ${response.status}). The result is unknown; the request was not retried automatically. Check the server log and saved PDF report before submitting again. Request: ${requestId}`,
      'DRAWING_ANALYSIS_RESPONSE_UNREADABLE', cause, requestId);
  }
}
