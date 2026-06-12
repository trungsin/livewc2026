import { buildMatchTimelinePayload, jsonResponse } from "../_shared.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const espnId = url.searchParams.get("espnId") || "";

  if (!/^\d+$/.test(espnId)) {
    return jsonResponse({ error: "espnId không hợp lệ" }, { status: 400 });
  }

  const cache = caches.default;
  const cacheKey = new Request(new URL(`/api/match-timeline?espnId=${encodeURIComponent(espnId)}`, url.origin), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const payload = await buildMatchTimelinePayload(espnId);
    const response = jsonResponse(payload, { maxAge: 9 });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 502 });
  }
}
