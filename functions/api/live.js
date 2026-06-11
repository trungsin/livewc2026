import { ensureLocalSquads, buildLivePayload, jsonResponse } from "../_shared.js";

export async function onRequestGet(context) {
  await ensureLocalSquads(context);

  const url = new URL(context.request.url);
  const force = url.searchParams.get("refresh") === "1";
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/live", url.origin), { method: "GET" });

  if (!force) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }
  }

  try {
    const payload = await buildLivePayload();
    const response = jsonResponse(payload, { maxAge: 10 });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
}
