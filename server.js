// Nạp .env (GEMINI_API_KEY...) nếu có; thiếu file thì bỏ qua, env hệ thống vẫn dùng được.
try {
  process.loadEnvFile(require("node:path").join(__dirname, ".env"));
} catch {}

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { translateEspnCommentary, looksUntranslated, logUntranslated } = require("./espn-commentary-vietnamese-translator.js");
const { translateViaCache } = require("./gemini-commentary-translation-fallback.js");
const { translateTeamNamesInText } = require("./team-names-vietnamese.js");
const { buildBongdaplusPredictions } = require("./bongdaplus-predictions.js");
const { buildMatchInsight } = require("./match-insight-builder.js");
const { recordPrediction, scoreFinishedMatches, getStats } = require("./prediction-accuracy-tracker.js");
const { initAiPredictionWorker, getAiPrediction } = require("./ai-match-prediction-generator.js");
const { initMatchStatsWorker, getMatchStats } = require("./espn-match-stats.js");

const root = __dirname;
const port = Number(process.env.PORT || 4174);
const cache = new Map();

let localSquads = { updatedAt: "", source: "", teams: [] };
let squadsByKey = new Map();

async function loadLocalSquads() {
  try {
    const raw = await fs.readFile(path.join(root, "data", "squads.json"), "utf8");
    localSquads = JSON.parse(raw);
    squadsByKey = new Map();
    for (const team of localSquads.teams || []) {
      squadsByKey.set(canonicalTeamName(team.name), team);
      if (team.fifaCode) {
        squadsByKey.set(team.fifaCode.toLowerCase(), team);
      }
    }
    console.log(`Local squads loaded: ${localSquads.teams.length} teams, ${localSquads.teams.reduce((sum, team) => sum + (team.players?.length || 0), 0)} players`);
  } catch (error) {
    console.warn(`Không nạp được data/squads.json: ${error.message}`);
  }
}

function findLocalSquad({ name = "", code = "" } = {}) {
  return (code && squadsByKey.get(String(code).toLowerCase()))
    || (name && squadsByKey.get(canonicalTeamName(name)))
    || null;
}

const SOURCE_URLS = {
  espn: "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=200",
  espnTeams: "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams",
  espnSummary: "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary",
  worldcup26Games: "https://worldcup26.ir/get/games",
  worldcup26Groups: "https://worldcup26.ir/get/groups",
  worldcup26Stadiums: "https://worldcup26.ir/get/stadiums",
  worldcup26Teams: "https://worldcup26.ir/get/teams",
  openfootball: "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function normalizeStatus(status) {
  const state = status?.type?.state;
  const name = status?.type?.name || "";
  const completed = Boolean(status?.type?.completed);

  if (completed || state === "post") {
    return "finished";
  }

  if (state === "in") {
    return name.includes("HALFTIME") ? "halftime" : "live";
  }

  return "upcoming";
}

function teamCode(team) {
  return team?.abbreviation || team?.shortDisplayName?.slice(0, 3)?.toUpperCase() || "";
}

function espnMinute(status) {
  const fromDisplay = Number.parseInt(String(status?.displayClock || ""), 10);
  if (!Number.isNaN(fromDisplay) && fromDisplay > 0) {
    return fromDisplay;
  }
  // ESPN trả clock bằng giây cho bóng đá
  return Math.round(Number(status?.clock || 0) / 60);
}

function normalizeEspnEvent(event) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const home = competitors.find((item) => item.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((item) => item.homeAway === "away") || competitors[1] || {};
  const status = normalizeStatus(event.status || competition.status);
  const kickoffUtc = event.date || competition.date || competition.startDate;

  return {
    id: `espn-${event.id}`,
    home: home.team?.displayName || home.team?.name || "TBD",
    away: away.team?.displayName || away.team?.name || "TBD",
    homeCode: teamCode(home.team),
    awayCode: teamCode(away.team),
    homeLogo: teamLogo(home.team),
    awayLogo: teamLogo(away.team),
    homeTeamId: home.team?.id || "",
    awayTeamId: away.team?.id || "",
    homeScore: Number(home.score || 0),
    awayScore: Number(away.score || 0),
    minute: espnMinute(event.status || competition.status),
    status,
    stadium: competition.venue?.fullName || event.venue?.displayName || "",
    group: event.season?.slug === "group-stage" ? "Group stage" : "World Cup",
    kickoff: kickoffUtc ? formatTime(kickoffUtc) : "",
    kickoffUtc,
    sources: ["espn"],
    confidence: 0.86,
    rawIds: { espn: event.id },
    details: (competition.details || []).map((detail) => ({ ...detail, text: translateCommentaryText(detail.text) }))
  };
}

function teamLogo(team) {
  if (!team) {
    return "";
  }

  if (team.logo) {
    return team.logo;
  }

  const logos = team.logos || [];
  return logos.find((logo) => logo.rel?.includes("default"))?.href || logos[0]?.href || "";
}

function normalizeWorldcup26Game(game, stadiumsById = new Map(), teamsById = new Map()) {
  const stadium = stadiumsById.get(String(game.stadium_id));
  const homeTeam = teamsById.get(String(game.home_team_id));
  const awayTeam = teamsById.get(String(game.away_team_id));
  const home = game.home_team_name_en || game.home_team_label || homeTeam?.name_en || `Team ${game.home_team_id || ""}`.trim();
  const away = game.away_team_name_en || game.away_team_label || awayTeam?.name_en || `Team ${game.away_team_id || ""}`.trim();
  const finished = String(game.finished).toLowerCase() === "true";
  const timeElapsed = String(game.time_elapsed || "").toLowerCase();
  const status = finished ? "finished" : (timeElapsed !== "notstarted" && timeElapsed !== "" ? "live" : "upcoming");

  const kickoffUtc = parseWorldcup26Date(game.local_date, stadium);
  return {
    id: `wc26-${game.id}`,
    home,
    away,
    homeCode: homeTeam?.fifa_code || codeFromName(home),
    awayCode: awayTeam?.fifa_code || codeFromName(away),
    homeLogo: homeTeam?.flag || "",
    awayLogo: awayTeam?.flag || "",
    homeTeamId: "",
    awayTeamId: "",
    homeWorldcup26Id: game.home_team_id || "",
    awayWorldcup26Id: game.away_team_id || "",
    homeScore: Number(game.home_score || 0),
    awayScore: Number(game.away_score || 0),
    minute: Number.parseInt(timeElapsed, 10) || 0,
    status,
    stadium: formatStadium(stadium) || game.stadium_name_en || game.stadium || "",
    group: game.group ? `Group ${game.group}` : "World Cup",
    type: game.type || "",
    kickoffUtc,
    kickoff: formatTime(kickoffUtc) || game.local_date || "",
    sources: ["worldcup26"],
    confidence: 0.68,
    rawIds: { worldcup26: game.id }
  };
}

function formatStadium(stadium) {
  if (!stadium) {
    return "";
  }

  const name = stadium.fifa_name || stadium.name_en;
  const city = stadium.city_en;
  return [name, city].filter(Boolean).join(", ");
}

function normalizeOpenfootballMatch(match, index) {
  const kickoffUtc = parseOpenfootballDateTime(match.date, match.time);
  return {
    id: `openfootball-${index}`,
    home: match.team1 || "TBD",
    away: match.team2 || "TBD",
    homeCode: codeFromName(match.team1),
    awayCode: codeFromName(match.team2),
    homeScore: Number(match.score?.ft?.[0] || 0),
    awayScore: Number(match.score?.ft?.[1] || 0),
    minute: 0,
    status: match.score ? "finished" : "upcoming",
    stadium: match.ground || "",
    group: match.group || match.round || "World Cup",
    kickoffUtc,
    kickoff: formatTime(kickoffUtc) || [match.date, match.time].filter(Boolean).join(" "),
    sources: ["openfootball"],
    confidence: 0.58,
    rawIds: { openfootball: index }
  };
}

function codeFromName(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatTime(isoValue) {
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh"
    }).format(new Date(isoValue));
  } catch {
    return "";
  }
}

function parseWorldcup26Date(value, stadium = null) {
  if (!value) {
    return "";
  }

  const parsed = parseWorldcup26LocalTime(value, stadium);
  if (parsed) {
    return parsed;
  }

  const fallback = Date.parse(value);
  return Number.isNaN(fallback) ? value : new Date(fallback).toISOString();
}

function parseWorldcup26LocalTime(value, stadium) {
  const matched = String(value || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!matched) {
    return "";
  }

  const [, month, day, year, hour, minute] = matched;
  const timeZone = timeZoneForStadium(stadium);
  if (!timeZone) {
    return "";
  }

  const utcGuess = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(utcGuess)).map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMs = zonedAsUtc - utcGuess;
  return new Date(utcGuess - offsetMs).toISOString();
}

function timeZoneForStadium(stadium) {
  const city = String(stadium?.city_en || "").toLowerCase();
  const fifaName = String(stadium?.fifa_name || "").toLowerCase();
  const combined = `${city} ${fifaName}`;

  const zones = [
    [/mexico city/, "America/Mexico_City"],
    [/monterrey/, "America/Monterrey"],
    [/guadalajara/, "America/Mexico_City"],
    [/vancouver/, "America/Vancouver"],
    [/seattle/, "America/Los_Angeles"],
    [/san francisco bay area/, "America/Los_Angeles"],
    [/san francisco/, "America/Los_Angeles"],
    [/los angeles/, "America/Los_Angeles"],
    [/houston/, "America/Chicago"],
    [/dallas/, "America/Chicago"],
    [/kansas city/, "America/Chicago"],
    [/atlanta/, "America/New_York"],
    [/miami/, "America/New_York"],
    [/boston/, "America/New_York"],
    [/philadelphia/, "America/New_York"],
    [/new york\/new jersey/, "America/New_York"],
    [/toronto/, "America/Toronto"]
  ];

  for (const [pattern, zone] of zones) {
    if (pattern.test(combined)) {
      return zone;
    }
  }

  return "";
}

function parseOpenfootballDateTime(dateValue, timeValue) {
  const dateMatch = String(dateValue || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(timeValue || "").trim().match(/^(\d{2}):(\d{2})(?:\s+UTC([+-]\d{1,2}))?$/i);
  if (!dateMatch || !timeMatch) {
    return "";
  }

  const [, year, month, day] = dateMatch;
  const [, hour, minute, offsetText] = timeMatch;
  const offsetHours = offsetText ? Number(offsetText) : 0;
  const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0) - (offsetHours * 60 * 60 * 1000);
  return new Date(utcMs).toISOString();
}

function teamPairKey(match) {
  const teams = [match.home, match.away]
    .map((name) => canonicalTeamName(name))
    .sort()
    .join("-");
  return teams;
}

function matchTimeMs(match) {
  const parsed = Date.parse(match.kickoffUtc || "");
  return Number.isNaN(parsed) ? null : parsed;
}

function canonicalTeamName(name) {
  const compact = String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases = {
    czechia: "czechrepublic",
    bosniaherzegovina: "bosniaandherzegovina",
    usa: "unitedstates",
    usmnt: "unitedstates",
    korea: "southkorea",
    republicofkorea: "southkorea"
  };
  return aliases[compact] || compact;
}

function sourcePriority(match) {
  const sources = match.sources || [];
  if (sources.includes("espn")) return 3;
  if (sources.includes("worldcup26")) return 2;
  if (sources.includes("openfootball")) return 1;
  return 0;
}

function shouldMergeMatch(existing, incoming) {
  if (teamPairKey(existing) !== teamPairKey(incoming)) {
    return false;
  }

  const existingTime = matchTimeMs(existing);
  const incomingTime = matchTimeMs(incoming);
  if (existingTime === null || incomingTime === null) {
    return true;
  }

  return Math.abs(existingTime - incomingTime) <= 36 * 60 * 60 * 1000;
}

function mergeMatchInto(existing, incoming) {
  const incomingWins = sourcePriority(incoming) > sourcePriority(existing);

  existing.sources = Array.from(new Set([...(existing.sources || []), ...(incoming.sources || [])]));
  existing.confidence = Math.min(0.98, Math.max(existing.confidence || 0, incoming.confidence || 0) + 0.08);
  existing.rawIds = { ...(existing.rawIds || {}), ...(incoming.rawIds || {}) };
  existing.homeLogo = existing.homeLogo || incoming.homeLogo || "";
  existing.awayLogo = existing.awayLogo || incoming.awayLogo || "";
  existing.homeTeamId = existing.homeTeamId || incoming.homeTeamId || "";
  existing.awayTeamId = existing.awayTeamId || incoming.awayTeamId || "";
  existing.homeWorldcup26Id = existing.homeWorldcup26Id || incoming.homeWorldcup26Id || "";
  existing.awayWorldcup26Id = existing.awayWorldcup26Id || incoming.awayWorldcup26Id || "";

  if (incomingWins) {
    Object.assign(existing, {
      id: incoming.id,
      home: incoming.home,
      away: incoming.away,
      homeCode: incoming.homeCode || existing.homeCode,
      awayCode: incoming.awayCode || existing.awayCode,
      homeScore: incoming.homeScore,
      awayScore: incoming.awayScore,
      minute: incoming.minute,
      status: incoming.status,
      kickoff: incoming.kickoff,
      kickoffUtc: incoming.kickoffUtc,
      details: incoming.details || existing.details || []
    });
  } else if (existing.status === "upcoming" && incoming.status !== "upcoming") {
    Object.assign(existing, {
      homeScore: incoming.homeScore,
      awayScore: incoming.awayScore,
      minute: incoming.minute,
      status: incoming.status
    });
  }

  if (!existing.stadium && incoming.stadium) {
    existing.stadium = incoming.stadium;
  }
  // ESPN chỉ trả "Group stage" chung chung; ưu tiên nguồn có chữ bảng cụ thể (Group A-L)
  if (incoming.group && (!existing.group || (!normalizeGroupLetter(existing.group) && normalizeGroupLetter(incoming.group)))) {
    existing.group = incoming.group;
  }
  if (!existing.type && incoming.type) {
    existing.type = incoming.type;
  }
}

function mergeMatches(sourceLists) {
  const merged = [];

  for (const sourceList of sourceLists) {
    for (const match of sourceList) {
      const existing = merged.find((item) => shouldMergeMatch(item, match));

      if (!existing) {
        merged.push(match);
        continue;
      }

      mergeMatchInto(existing, match);
    }
  }

  return merged.sort((a, b) => {
    const dateA = Date.parse(a.kickoffUtc || "") || Number.MAX_SAFE_INTEGER;
    const dateB = Date.parse(b.kickoffUtc || "") || Number.MAX_SAFE_INTEGER;
    return dateA - dateB;
  });
}

function buildTeams(matches, worldcupTeams = []) {
  const teamsByKey = new Map();
  const worldcupByName = new Map(
    worldcupTeams.map((team) => [canonicalTeamName(team.name_en), team])
  );

  for (const match of matches) {
    addTeamFromMatch(teamsByKey, worldcupByName, {
      name: match.home,
      code: match.homeCode,
      logo: match.homeLogo,
      espnId: match.homeTeamId,
      worldcup26Id: match.homeWorldcup26Id,
      group: match.group,
      source: match.sources
    });
    addTeamFromMatch(teamsByKey, worldcupByName, {
      name: match.away,
      code: match.awayCode,
      logo: match.awayLogo,
      espnId: match.awayTeamId,
      worldcup26Id: match.awayWorldcup26Id,
      group: match.group,
      source: match.sources
    });
  }

  if (!teamsByKey.size) {
    for (const squad of localSquads.teams || []) {
      const key = canonicalTeamName(squad.name);
      teamsByKey.set(key, {
        id: key,
        name: squad.name,
        code: squad.fifaCode || "",
        logo: squad.logo || "",
        flag: squad.logo || "",
        group: squad.group ? `Group ${squad.group}` : "World Cup",
        espnId: "",
        worldcup26Id: "",
        iso2: squad.iso2 || "",
        fifaRanking: squad.fifaRanking || null,
        coach: squad.coach || "",
        sources: new Set(["squads"])
      });
    }
  }

  return [...teamsByKey.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team) => ({
      ...team,
      sources: [...team.sources]
    }));
}

function addTeamFromMatch(teamsByKey, worldcupByName, input) {
  const key = canonicalTeamName(input.name);
  if (isPlaceholderTeam(input.name, input.worldcup26Id)) {
    return;
  }
  const wcTeam = worldcupByName.get(key);
  const localSquad = squadsByKey.get(key);
  const existing = teamsByKey.get(key) || {
    id: key,
    name: input.name,
    code: wcTeam?.fifa_code || localSquad?.fifaCode || input.code || "",
    logo: input.logo || wcTeam?.flag || localSquad?.logo || "",
    flag: wcTeam?.flag || input.logo || localSquad?.logo || "",
    group: wcTeam?.groups
      ? `Group ${wcTeam.groups}`
      : localSquad?.group
        ? `Group ${localSquad.group}`
        : input.group || "World Cup",
    espnId: input.espnId || "",
    worldcup26Id: input.worldcup26Id || wcTeam?.id || "",
    iso2: wcTeam?.iso2 || localSquad?.iso2 || "",
    fifaRanking: localSquad?.fifaRanking || null,
    coach: localSquad?.coach || "",
    sources: new Set()
  };

  existing.logo = existing.logo || input.logo || wcTeam?.flag || localSquad?.logo || "";
  existing.flag = existing.flag || wcTeam?.flag || input.logo || localSquad?.logo || "";
  existing.code = existing.code || wcTeam?.fifa_code || localSquad?.fifaCode || input.code || "";
  existing.espnId = existing.espnId || input.espnId || "";
  existing.worldcup26Id = existing.worldcup26Id || input.worldcup26Id || wcTeam?.id || "";
  for (const source of input.source || []) {
    existing.sources.add(source);
  }
  if (localSquad) {
    existing.sources.add("squads");
  }

  teamsByKey.set(key, existing);
}

function isPlaceholderTeam(name, worldcup26Id) {
  const normalized = String(name || "").toLowerCase();
  return worldcup26Id === "0"
    || normalized.includes("group")
    || normalized === "tbd"
    || normalized.startsWith("winner ")
    || normalized.startsWith("loser ")
    || /^[wl]\d+$/.test(normalized)
    || /^[123][a-l]$/.test(normalized)
    || /^3[a-l](\/[a-l])+$/.test(normalized);
}

function normalizeAthlete(athlete) {
  return {
    id: athlete.id,
    name: athlete.displayName || athlete.fullName || "Chưa rõ tên",
    shortName: athlete.shortName || "",
    headshot: athlete.headshot?.href || "",
    jersey: athlete.jersey || "",
    position: athlete.position?.displayName || athlete.position?.name || "",
    age: athlete.age || "",
    dateOfBirth: athlete.dateOfBirth || "",
    height: athlete.displayHeight || "",
    weight: athlete.displayWeight || "",
    citizenship: athlete.citizenship || athlete.flag?.alt || "",
    originNationality: athlete.birthPlace?.country || athlete.citizenship || athlete.flag?.alt || "",
    currentClub: "",
    marketValue: null,
    marketValueNote: "Chưa có nguồn miễn phí hợp lệ",
    profileUrl: athlete.links?.find((link) => link.rel?.includes("playercard"))?.href || "",
    source: "espn"
  };
}

function canonicalPersonName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function ageFromDateOfBirth(dateOfBirth) {
  if (!dateOfBirth) {
    return "";
  }
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) {
    return "";
  }
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

function normalizeLocalPlayer(player) {
  return {
    id: "",
    name: player.name,
    shortName: "",
    headshot: "",
    jersey: player.number ? String(player.number) : "",
    position: player.position || "",
    age: ageFromDateOfBirth(player.dateOfBirth),
    dateOfBirth: player.dateOfBirth || "",
    height: "",
    weight: "",
    citizenship: player.nationality || "",
    originNationality: player.nationality || "",
    currentClub: player.club || "",
    marketValue: null,
    marketValueNote: "Chưa có nguồn miễn phí hợp lệ",
    profileUrl: "",
    source: "squads"
  };
}

function mergePlayers(localPlayers, espnPlayers) {
  const espnByName = new Map(espnPlayers.map((player) => [canonicalPersonName(player.name), player]));
  const matchedEspn = new Set();

  const merged = localPlayers.map((player) => {
    const espn = espnByName.get(canonicalPersonName(player.name));
    if (!espn) {
      return player;
    }
    matchedEspn.add(espn);
    return {
      ...player,
      id: espn.id || player.id,
      shortName: espn.shortName || player.shortName,
      headshot: espn.headshot || player.headshot,
      height: espn.height || player.height,
      weight: espn.weight || player.weight,
      profileUrl: espn.profileUrl || player.profileUrl,
      source: "squads+espn"
    };
  });

  for (const espn of espnPlayers) {
    if (!matchedEspn.has(espn)) {
      merged.push(espn);
    }
  }

  return merged;
}

async function buildTeamPayload({ espnId = "", code = "", name = "" } = {}) {
  const key = `team:v3:${espnId || code || canonicalTeamName(name)}`;
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.createdAt < 15 * 60 * 1000) {
    return { ...cached.payload, cache: { hit: true, ttlMs: 15 * 60 * 1000 - (now - cached.createdAt) } };
  }

  const localSquad = findLocalSquad({ name, code });
  const localPlayers = (localSquad?.players || []).map(normalizeLocalPlayer);

  let roster = { name: "espn-roster", ok: false, error: espnId ? null : "Đội chưa có ESPN team id" };
  if (espnId) {
    roster = await fetchJson(
      "espn-roster",
      `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/${encodeURIComponent(espnId)}/roster`
    );
  }

  const espnPlayers = roster.ok ? (roster.data.athletes || []).map(normalizeAthlete) : [];
  const players = localPlayers.length ? mergePlayers(localPlayers, espnPlayers) : espnPlayers;

  const espnTeam = roster.ok ? normalizeRosterTeam(roster.data.team) : {};
  const espnCoach = roster.ok
    ? (roster.data.coach || []).map((coach) => `${coach.firstName || ""} ${coach.lastName || ""}`.trim()).filter(Boolean)
    : [];
  const localCoach = localSquad?.coach
    ? [localSquad.coachNationality ? `${localSquad.coach} (${localSquad.coachNationality})` : localSquad.coach]
    : [];

  const sourceNames = [
    localPlayers.length ? "squads.json (football-data.org + FIFA)" : null,
    roster.ok ? "ESPN roster" : null
  ].filter(Boolean);

  const notes = [];
  if (localPlayers.length) {
    notes.push(`Đội hình chính thức 26 cầu thủ từ dữ liệu public (cập nhật ${localSquads.updatedAt || "?"}): số áo, vị trí, CLB, ngày sinh, quốc tịch.`);
  }
  if (roster.ok) {
    notes.push("Ảnh chân dung và hồ sơ cầu thủ bổ sung từ ESPN public endpoint.");
  }
  if (!players.length) {
    notes.push("Chưa có dữ liệu cầu thủ cho đội này từ các nguồn miễn phí.");
  }
  notes.push("Giá trị cầu thủ không có trong nguồn miễn phí hợp lệ, app không scrape Transfermarkt.");

  const payload = {
    generatedAt: new Date().toISOString(),
    cache: { hit: false, ttlMs: 15 * 60 * 1000 },
    sources: [
      { name: "squads-local", ok: localPlayers.length > 0, error: localPlayers.length ? null : "Không tìm thấy đội trong data/squads.json" },
      { name: roster.name, ok: roster.ok, error: roster.error || null }
    ],
    rosterSource: sourceNames.join(" + ") || "Không có nguồn",
    team: {
      id: espnId,
      code: localSquad?.fifaCode || espnTeam.code || code,
      name: localSquad?.name || espnTeam.name || name,
      logo: espnTeam.logo || localSquad?.logo || "",
      fifaRanking: localSquad?.fifaRanking || null,
      group: localSquad?.group ? `Group ${localSquad.group}` : "",
      standingSummary: espnTeam.standingSummary || "",
      recordSummary: espnTeam.recordSummary || ""
    },
    coach: localCoach.length ? localCoach : espnCoach,
    players,
    notes
  };

  cache.set(key, { createdAt: now, payload });
  return payload;
}

function normalizeRosterTeam(team = {}) {
  return {
    id: team.id || "",
    name: team.displayName || team.name || "",
    code: team.abbreviation || "",
    logo: team.logo || "",
    color: team.color || "",
    standingSummary: team.standingSummary || "",
    recordSummary: team.recordSummary || "",
    clubhouse: team.clubhouse || ""
  };
}

function buildEvents(matches) {
  const sourceEvents = [];
  for (const match of matches) {
    for (const detail of match.details || []) {
      const players = (detail.athletesInvolved || [])
        .map((athlete) => athlete.displayName || athlete.fullName)
        .filter(Boolean)
        .join(", ");
      const eventName = detail.type?.text || detail.type?.displayName || "Sự kiện";
      sourceEvents.push({
        minute: detail.clock?.displayValue || detail.displayTime || `${match.minute || "--"}'`,
        title: `${detail.scoringPlay ? "⚽ " : ""}${eventName} — ${match.home} ${match.homeScore}-${match.awayScore} ${match.away}`,
        copy: detail.text || (players ? `Cầu thủ: ${players}.` : `Trận ${match.home} vs ${match.away}.`),
        source: "espn"
      });
    }
  }

  if (sourceEvents.length) {
    return sourceEvents.reverse();
  }

  return matches
    .filter((match) => match.status === "live" || match.status === "finished")
    .slice(0, 8)
    .map((match) => ({
      minute: match.status === "finished" ? "FT" : `${match.minute || "--"}'`,
      title: `${match.home} ${match.homeScore} - ${match.awayScore} ${match.away}`,
      copy: [match.group && match.group !== "World Cup" ? match.group : "", match.stadium || ""].filter(Boolean).join(" · ") || "World Cup 2026"
    }));
}

function buildStandings(matches, groupsFromApi, teamsById = new Map()) {
  // Thống kê tính từ kết quả trận đã merge để BXH luôn khớp phần Kết quả;
  // upstream /get/groups cập nhật chậm nên chỉ dùng làm danh sách 4 đội mỗi bảng.
  const statsByTeam = new Map();
  const groupTeamKeys = new Map();
  for (const match of matches) {
    if (match.status !== "finished") {
      continue;
    }
    const groupLetter = normalizeGroupLetter(match.group);
    if (!groupLetter) {
      continue;
    }
    recordTeamResult(statsByTeam, groupTeamKeys, groupLetter, match.home, match.homeScore, match.awayScore);
    recordTeamResult(statsByTeam, groupTeamKeys, groupLetter, match.away, match.awayScore, match.homeScore);
  }

  if (Array.isArray(groupsFromApi) && groupsFromApi.length) {
    const groups = [];
    for (const group of groupsFromApi) {
      const rows = (group.teams || []).map((team) => {
        const name = teamsById.get(String(team.team_id))?.name_en || team.name_en || `Team ${team.team_id || ""}`.trim();
        const computed = statsByTeam.get(canonicalTeamName(name));
        return computed
          ? { ...computed, team: name }
          : { team: name, played: 0, won: 0, drawn: 0, lost: 0, diff: 0, points: 0 };
      });

      if (rows.length) {
        groups.push({ group: normalizeGroupLetter(group.name) || String(group.name || ""), rows });
      }
    }
    if (groups.length) {
      return groups.sort((a, b) => a.group.localeCompare(b.group));
    }
  }

  return [...groupTeamKeys.entries()]
    .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
    .map(([group, teamKeys]) => ({
      group,
      rows: [...teamKeys].map((key) => statsByTeam.get(key)).sort(sortStandingRows)
    }));
}

function recordTeamResult(statsByTeam, groupTeamKeys, groupLetter, teamName, goalsFor, goalsAgainst) {
  const key = canonicalTeamName(teamName);
  if (!statsByTeam.has(key)) {
    statsByTeam.set(key, { team: teamName, played: 0, won: 0, drawn: 0, lost: 0, diff: 0, points: 0 });
  }
  applyResult(statsByTeam.get(key), goalsFor, goalsAgainst);
  if (!groupTeamKeys.has(groupLetter)) {
    groupTeamKeys.set(groupLetter, new Set());
  }
  groupTeamKeys.get(groupLetter).add(key);
}

function normalizeGroupLetter(value) {
  const match = String(value || "").trim().match(/^(?:group\s*)?([A-L])$/i);
  return match ? match[1].toUpperCase() : "";
}

function sortStandingRows(a, b) {
  return b.points - a.points || b.diff - a.diff || a.team.localeCompare(b.team);
}

function applyResult(row, goalsFor, goalsAgainst) {
  goalsFor = Number(goalsFor || 0);
  goalsAgainst = Number(goalsAgainst || 0);
  row.played += 1;
  row.diff += goalsFor - goalsAgainst;
  if (goalsFor > goalsAgainst) {
    row.won += 1;
    row.points += 3;
  } else if (goalsFor === goalsAgainst) {
    row.drawn += 1;
    row.points += 1;
  } else {
    row.lost += 1;
  }
}

async function fetchJson(name, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "LiveCup/1.0 (+local development)" }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return { name, ok: true, data: await response.json() };
  } catch (error) {
    return { name, ok: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildMatchTimelinePayload(espnId) {
  const key = `timeline-${espnId}`;
  const cached = cache.get(key);
  const now = Date.now();
  // TTL 9s để client refresh 10s luôn nhận dữ liệu mới
  if (cached && now - cached.createdAt < 9000) {
    return { ...cached.payload, cache: { hit: true } };
  }

  const result = await fetchJson("espn-summary", `${SOURCE_URLS.espnSummary}?event=${encodeURIComponent(espnId)}`);
  if (!result.ok) {
    throw new Error(`espn summary: ${result.error}`);
  }

  const commentary = Array.isArray(result.data.commentary) ? result.data.commentary : [];
  // Mới nhất lên đầu, giống trang tường thuật trực tiếp
  const entries = commentary.map((item) => ({
    minute: item.time?.displayValue || "",
    type: item.play?.type?.text || "",
    text: translateCommentaryText(item.text),
    scoring: Boolean(item.play?.scoringPlay)
  })).reverse();

  const payload = { generatedAt: new Date().toISOString(), espnId, entries, cache: { hit: false } };
  cache.set(key, { createdAt: now, payload });
  return payload;
}

function translateCommentaryText(text) {
  const source = String(text || "");
  const translated = translateEspnCommentary(source);
  if (!looksUntranslated(translated)) {
    return translated;
  }

  const cached = translateViaCache(source);
  if (cached) {
    return translateTeamNamesInText(cached);
  }

  logUntranslated(source);
  return translated;
}

function stripPredictionAnalysis(prediction) {
  if (!prediction) {
    return null;
  }

  const { analysis, ...lightPrediction } = prediction;
  return lightPrediction;
}

async function buildLivePayload(force = false) {
  const key = "live";
  const cached = cache.get(key);
  const now = Date.now();
  if (!force && cached && now - cached.createdAt < 10000) {
    return { ...cached.payload, cache: { hit: true, ttlMs: 10000 - (now - cached.createdAt) } };
  }

  const [espn, wcGames, wcGroups, wcStadiums, wcTeams, openfootball] = await Promise.all([
    fetchJson("espn", SOURCE_URLS.espn),
    fetchJson("worldcup26", SOURCE_URLS.worldcup26Games),
    fetchJson("worldcup26-groups", SOURCE_URLS.worldcup26Groups),
    fetchJson("worldcup26-stadiums", SOURCE_URLS.worldcup26Stadiums),
    fetchJson("worldcup26-teams", SOURCE_URLS.worldcup26Teams),
    fetchJson("openfootball", SOURCE_URLS.openfootball)
  ]);

  const stadiumList = wcStadiums.ok ? (wcStadiums.data.stadiums || wcStadiums.data || []) : [];
  const teamList = wcTeams.ok ? (wcTeams.data.teams || wcTeams.data || []) : [];
  const stadiumsById = new Map(stadiumList.map((stadium) => [String(stadium.id), stadium]));
  const teamsById = new Map(teamList.map((team) => [String(team.id), team]));
  const espnMatches = espn.ok ? (espn.data.events || []).map(normalizeEspnEvent) : [];
  const wcMatches = wcGames.ok ? (wcGames.data.games || wcGames.data || []).map((game) => normalizeWorldcup26Game(game, stadiumsById, teamsById)) : [];
  const openMatches = openfootball.ok && !espnMatches.length && !wcMatches.length
    ? (openfootball.data.matches || []).map(normalizeOpenfootballMatch)
    : [];
  const matches = mergeMatches([espnMatches, wcMatches, openMatches]);
  const predictionsByMatchId = await buildBongdaplusPredictions(matches);
  const matchesWithPredictions = matches.map((match) => ({
    ...match,
    prediction: stripPredictionAnalysis(predictionsByMatchId.get(match.id)),
    // Chỉ nhúng tỉ số AI gọn cho teaser; nhận định đầy đủ nằm ở /api/match-insight.
    aiScore: getAiPrediction(match.id)?.predictedScore || "",
    // Thông số trận đã xong (ghi bàn, cầm bóng, thẻ...) — null khi chưa fetch được.
    stats: match.status === "finished" ? getMatchStats(match.id) : null
  }));

  await Promise.all(matchesWithPredictions.map((match) => recordPrediction(match, { prediction: match.prediction })));
  await scoreFinishedMatches(matchesWithPredictions);

  const payload = {
    generatedAt: new Date().toISOString(),
    cache: { hit: false, ttlMs: 10000 },
    sources: [espn, wcGames, wcGroups, wcStadiums, wcTeams, openfootball].map((source) => ({
      name: source.name,
      ok: source.ok,
      error: source.error || null
    })),
    matches: matchesWithPredictions,
    predictionStats: getStats(),
    teams: buildTeams(matches, teamList),
    events: buildEvents(matches),
    standings: buildStandings(matches, wcGroups.ok ? (wcGroups.data.groups || wcGroups.data || []) : [], teamsById)
  };

  cache.set(key, { createdAt: now, payload });
  return payload;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(root, pathname));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      // HTML không cache để ?v= cache-busting trên asset có hiệu lực ngay sau deploy
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=300"
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/live") {
    try {
      const payload = await buildLivePayload(url.searchParams.get("refresh") === "1");
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (url.pathname === "/api/team") {
    try {
      const payload = await buildTeamPayload({
        espnId: url.searchParams.get("espnId") || "",
        code: url.searchParams.get("code") || "",
        name: url.searchParams.get("name") || ""
      });
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (url.pathname === "/api/match-insight") {
    const matchId = url.searchParams.get("matchId") || "";
    if (!/^[\w-]+$/.test(matchId)) {
      sendJson(res, 400, { error: "matchId không hợp lệ" });
      return;
    }

    try {
      const livePayload = await buildLivePayload(false);
      const match = (livePayload.matches || []).find((item) => item.id === matchId);
      if (!match) {
        sendJson(res, 404, { error: "Không tìm thấy trận đấu" });
        return;
      }

      const key = `insight-${matchId}`;
      const cached = cache.get(key);
      const now = Date.now();
      // Insight nạp theo trận, cache ngắn để odds không bị cũ quá lâu.
      if (cached && now - cached.createdAt < 5 * 60 * 1000) {
        await recordPrediction(match, cached.payload);
        sendJson(res, 200, {
          ...cached.payload,
          aiPrediction: getAiPrediction(matchId),
          cache: { hit: true, ttlMs: 5 * 60 * 1000 - (now - cached.createdAt) }
        });
        return;
      }

      const insight = await buildMatchInsight({ match, prediction: match.prediction });
      await recordPrediction(match, insight);
      const payload = {
        ...insight,
        aiPrediction: getAiPrediction(matchId),
        cache: { hit: false, ttlMs: 5 * 60 * 1000 }
      };
      cache.set(key, { createdAt: now, payload });
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (url.pathname === "/api/match-timeline") {
    const espnId = url.searchParams.get("espnId") || "";
    if (!/^\d+$/.test(espnId)) {
      sendJson(res, 400, { error: "espnId không hợp lệ" });
      return;
    }
    try {
      sendJson(res, 200, await buildMatchTimelinePayload(espnId));
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, cacheKeys: [...cache.keys()], now: new Date().toISOString() });
    return;
  }

  await serveStatic(req, res);
});

const host = process.env.HOST || "0.0.0.0";

loadLocalSquads().then(() => {
  initAiPredictionWorker({
    getLiveContext: async () => {
      const payload = await buildLivePayload(false);
      return { matches: payload.matches || [], standings: payload.standings || [] };
    },
    // Snapshot dự đoán AI vào tracker ngay khi sinh, không chờ người dùng mở modal.
    onPredictionGenerated: (match, entry) => recordPrediction(match, { aiPrediction: entry })
  });
  initMatchStatsWorker({
    getMatches: async () => (await buildLivePayload(false)).matches || []
  });
  server.listen(port, host, () => {
    console.log(`LiveCup server listening on http://${host}:${port}`);
  });
});
