import { ensureLocalSquads, buildTeamPayload, jsonResponse } from "../_shared.js";

export async function onRequestGet(context) {
  await ensureLocalSquads(context);

  const url = new URL(context.request.url);
  const params = {
    espnId: url.searchParams.get("espnId") || "",
    code: url.searchParams.get("code") || "",
    name: url.searchParams.get("name") || ""
  };

  const cache = caches.default;
  const normalized = new URL("/api/team", url.origin);
  normalized.searchParams.set("espnId", params.espnId);
  normalized.searchParams.set("code", params.code);
  normalized.searchParams.set("name", params.name);
  const cacheKey = new Request(normalized, { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const payload = await buildTeamPayload(params);
    const response = jsonResponse(payload, { maxAge: 900 });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
}
