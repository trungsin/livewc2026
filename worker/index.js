// Worker chính của LiveCup: serve static assets (qua [assets] trong wrangler.toml),
// API /api/live + /api/team, và realtime /ws bằng Durable Object — DO poll các nguồn
// public mỗi 10s trong lúc có client kết nối, diff tỉ số/trạng thái và push qua WebSocket.
// Deploy: npx wrangler deploy

import { buildLivePayload, ensureLocalSquads } from "../functions/_shared.js";
import { onRequestGet as handleLive } from "../functions/api/live.js";
import { onRequestGet as handleTeam } from "../functions/api/team.js";

const POLL_INTERVAL_MS = 10000;
const SNAPSHOT_KEY = "snapshot";

function compactMatches(payload) {
  const compact = {};
  for (const match of payload?.matches || []) {
    compact[match.id] = {
      home: match.home,
      away: match.away,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status
    };
  }
  return compact;
}

function diffEvents(previous, payload) {
  if (!previous) {
    return [];
  }

  const events = [];
  const now = new Date().toISOString();

  for (const match of payload.matches || []) {
    const before = previous[match.id];
    if (!before) {
      continue;
    }

    if (match.homeScore > before.homeScore) {
      events.push({
        minute: `${match.minute || "--"}'`,
        title: `⚽ BÀN THẮNG! ${match.home} ${match.homeScore} - ${match.awayScore} ${match.away}`,
        copy: `${match.home} vừa ghi bàn. Nguồn: ${(match.sources || []).join(" + ")}.`,
        at: now
      });
    }
    if (match.awayScore > before.awayScore) {
      events.push({
        minute: `${match.minute || "--"}'`,
        title: `⚽ BÀN THẮNG! ${match.home} ${match.homeScore} - ${match.awayScore} ${match.away}`,
        copy: `${match.away} vừa ghi bàn. Nguồn: ${(match.sources || []).join(" + ")}.`,
        at: now
      });
    }

    if (match.status !== before.status) {
      const statusCopy = {
        live: "Trận đấu bắt đầu / tiếp tục.",
        halftime: "Nghỉ giữa hiệp.",
        finished: "Trận đấu kết thúc."
      }[match.status];
      if (statusCopy) {
        events.push({
          minute: match.status === "finished" ? "FT" : `${match.minute || "--"}'`,
          title: `${match.home} ${match.homeScore} - ${match.awayScore} ${match.away}`,
          copy: statusCopy,
          at: now
        });
      }
    }
  }

  return events;
}

export class LiveHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.lastPayload = null;
  }

  async fetch(request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    await ensureLocalSquads({ request, env: this.env });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    if (this.lastPayload) {
      server.send(JSON.stringify({ type: "live", payload: this.lastPayload, events: [] }));
    }

    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null) {
      await this.ctx.storage.setAlarm(Date.now());
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm() {
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) {
      // không còn client — ngừng poll, alarm sẽ được bật lại ở lần kết nối sau
      return;
    }

    try {
      const payload = await buildLivePayload();
      const previous = await this.ctx.storage.get(SNAPSHOT_KEY);
      const events = diffEvents(previous, payload);

      this.lastPayload = payload;
      await this.ctx.storage.put(SNAPSHOT_KEY, compactMatches(payload));

      const message = JSON.stringify({ type: "live", payload, events });
      for (const socket of sockets) {
        try {
          socket.send(message);
        } catch {
          // socket vừa đóng giữa chừng — bỏ qua
        }
      }
    } catch (error) {
      console.warn(`Poll thất bại: ${error.message}`);
    }

    await this.ctx.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
  }

  webSocketMessage(ws, message) {
    if (message === "ping") {
      ws.send("pong");
    }
  }

  webSocketClose(ws) {
    try {
      ws.close();
    } catch {
      // đã đóng
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pagesContext = {
      request,
      env,
      waitUntil: ctx.waitUntil.bind(ctx)
    };

    if (url.pathname === "/ws") {
      const id = env.LIVE_HUB.idFromName("global");
      return env.LIVE_HUB.get(id).fetch(request);
    }

    if (url.pathname === "/api/live") {
      return handleLive(pagesContext);
    }

    if (url.pathname === "/api/team") {
      return handleTeam(pagesContext);
    }

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ ok: true, now: new Date().toISOString() }), {
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    // Các đường dẫn còn lại do static assets xử lý
    return env.ASSETS.fetch(request);
  }
};
