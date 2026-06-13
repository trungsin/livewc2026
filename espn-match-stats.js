// Thông số trận đã xong (ghi bàn, cầm bóng, sút, thẻ...) từ ESPN summary.
// Stats trận FT bất biến: fetch đúng 1 lần/trận, lưu bền data/match-stats.json.
// ESPN scoreboard mặc định chỉ trả trận gần hiện tại nên trận đã qua phải
// resolve espn id qua scoreboard theo khoảng ngày (cache 1h).

const fs = require("node:fs/promises");
const path = require("node:path");
const { getArchivedTimeline, archiveFromSummary } = require("./match-timeline-archive.js");

const storePath = path.join(__dirname, "data", "match-stats.json");
const TOURNAMENT_START = "20260611";
const RANGE_CACHE_MS = 60 * 60 * 1000;
const CYCLE_MS = 5 * 60 * 1000;
const MAX_PER_CYCLE = 3;

const store = { version: 1, matches: {} };
let loaded = false;
let saveTimer = null;
let workerStarted = false;
let fetching = false;
let getMatches = null;
let translateCommentary = null;
const rangeCache = { fetchedAt: 0, events: [] };

async function loadStore() {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    const data = JSON.parse(await fs.readFile(storePath, "utf8"));
    if (data && typeof data.matches === "object") {
      store.matches = data.matches;
    }
  } catch {
    // Store chưa có hoặc hỏng → khởi tạo rỗng, server vẫn chạy bình thường.
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fs.mkdir(path.dirname(storePath), { recursive: true });
      await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);
    } catch {
      // Lỗi ghi store không được ảnh hưởng API.
    }
  }, 5000);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "LiveCup/1.0 (+local development)" }
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function foldName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Một cặp tên coi là cùng đội khi một bên chứa bên kia ("Czechia" vs "Czech Republic" thì không,
// nên ưu tiên khớp mã FIFA trước; tên chỉ là fallback).
function sameTeam(nameA, nameB) {
  const a = foldName(nameA);
  const b = foldName(nameB);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function yyyymmddUtc(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

async function loadRangeEvents() {
  const now = Date.now();
  if (now - rangeCache.fetchedAt < RANGE_CACHE_MS && rangeCache.events.length) {
    return rangeCache.events;
  }
  const today = yyyymmddUtc(new Date());
  const data = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=200&dates=${TOURNAMENT_START}-${today}`);
  const events = Array.isArray(data?.events) ? data.events : [];
  if (events.length) {
    rangeCache.fetchedAt = now;
    rangeCache.events = events;
  }
  return rangeCache.events;
}

async function resolveEspnId(match) {
  if (match.rawIds?.espn) {
    return String(match.rawIds.espn);
  }
  const kickoff = Date.parse(match.kickoffUtc || "");
  if (Number.isNaN(kickoff)) {
    return null;
  }
  const events = await loadRangeEvents();
  for (const event of events) {
    const eventTime = Date.parse(event.date || "");
    if (Number.isNaN(eventTime) || Math.abs(eventTime - kickoff) > 2 * 60 * 60 * 1000) {
      continue;
    }
    const competitors = event.competitions?.[0]?.competitors || [];
    const codes = competitors.map((c) => String(c.team?.abbreviation || "").toUpperCase());
    const matchCodes = [String(match.homeCode || "").toUpperCase(), String(match.awayCode || "").toUpperCase()];
    const codeHit = matchCodes[0] && matchCodes[1] && codes.includes(matchCodes[0]) && codes.includes(matchCodes[1]);
    const nameHit = competitors.some((c) => sameTeam(c.team?.displayName, match.home) || sameTeam(c.team?.displayName, match.away));
    if (codeHit || nameHit) {
      return String(event.id);
    }
  }
  return null;
}

function sideByTeamId(summary) {
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  const map = new Map();
  for (const competitor of competitors) {
    map.set(String(competitor.team?.id || ""), competitor.homeAway === "home" ? "home" : "away");
  }
  return map;
}

function parseScorers(summary, sides) {
  const scorers = [];
  for (const event of summary?.keyEvents || []) {
    const type = String(event.type?.text || "");
    if (!/goal|penalty - scored/i.test(type) || /missed|shootout/i.test(type)) {
      continue;
    }
    const name = event.participants?.[0]?.athlete?.displayName || "";
    if (!name) {
      continue;
    }
    scorers.push({
      name,
      minute: event.clock?.displayValue || "",
      side: sides.get(String(event.team?.id || "")) || "home",
      note: /own goal/i.test(type) ? "OG" : (/penalty/i.test(type) ? "P" : "")
    });
  }
  return scorers;
}

const STAT_KEYS = {
  possessionPct: "possession",
  totalShots: "shots",
  shotsOnTarget: "shotsOnTarget",
  wonCorners: "corners",
  foulsCommitted: "fouls",
  offsides: "offsides",
  yellowCards: "yellow",
  redCards: "red"
};

function parseTeamStats(summary) {
  const stats = {};
  for (const team of summary?.boxscore?.teams || []) {
    const side = team.homeAway === "home" ? 0 : 1;
    for (const item of team.statistics || []) {
      const key = STAT_KEYS[item.name];
      if (!key) {
        continue;
      }
      stats[key] = stats[key] || ["--", "--"];
      stats[key][side] = String(item.displayValue ?? "--");
    }
  }
  return stats;
}

// Fetch ESPN summary 1 lần rồi vừa parse thông số, vừa đóng băng diễn biến (DRY: 1 request/trận).
async function processFinishedMatch(match) {
  const matchId = String(match.id);
  const needsStats = !store.matches[matchId];
  const needsTimeline = !getArchivedTimeline(matchId);
  if (!needsStats && !needsTimeline) {
    return false;
  }
  const espnId = await resolveEspnId(match);
  if (!espnId) {
    return false;
  }
  const summary = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${encodeURIComponent(espnId)}`);
  if (!summary) {
    return false;
  }

  let changed = false;
  if (needsStats) {
    try {
      const sides = sideByTeamId(summary);
      const scorers = parseScorers(summary, sides);
      const stats = parseTeamStats(summary);
      if (scorers.length || Object.keys(stats).length) {
        store.matches[matchId] = { espnId, scorers, stats, fetchedAt: new Date().toISOString() };
        changed = true;
      }
    } catch {
      // Parse lỗi không chặn việc đóng băng diễn biến.
    }
  }
  if (needsTimeline) {
    archiveFromSummary(matchId, espnId, summary.commentary, translateCommentary);
  }
  return changed;
}

async function runStatsCycle() {
  if (fetching || typeof getMatches !== "function") {
    return;
  }
  fetching = true;
  try {
    await loadStore();
    const matches = await getMatches();
    const pending = matches
      .filter((match) => match.status === "finished"
        && (!store.matches[String(match.id)] || !getArchivedTimeline(String(match.id))))
      .slice(0, MAX_PER_CYCLE);
    let changed = false;
    for (const match of pending) {
      if (await processFinishedMatch(match)) {
        changed = true;
      }
    }
    if (changed) {
      scheduleSave();
    }
  } catch {
    // Lỗi cycle không được ảnh hưởng server; cycle sau thử lại.
  } finally {
    fetching = false;
  }
}

function getMatchStats(matchId) {
  const entry = store.matches[String(matchId)];
  return entry ? { scorers: entry.scorers, stats: entry.stats } : null;
}

function initMatchStatsWorker(options = {}) {
  getMatches = options.getMatches || null;
  translateCommentary = options.translateCommentary || translateCommentary;
  if (workerStarted) {
    return;
  }
  workerStarted = true;
  loadStore();
  setTimeout(runStatsCycle, 30 * 1000).unref?.();
  setInterval(runStatsCycle, CYCLE_MS).unref?.();
}

module.exports = { initMatchStatsWorker, getMatchStats };
