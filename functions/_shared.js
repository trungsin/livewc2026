// Logic dùng chung cho Cloudflare Pages Functions — port từ server.js.
// server.js vẫn dùng cho local dev (node server.js); thư mục functions/ chỉ chạy trên Cloudflare.

export const SOURCE_URLS = {
  espn: "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=200",
  espnSummary: "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary",
  worldcup26Games: "https://worldcup26.ir/get/games",
  worldcup26Groups: "https://worldcup26.ir/get/groups",
  worldcup26Stadiums: "https://worldcup26.ir/get/stadiums",
  worldcup26Teams: "https://worldcup26.ir/get/teams",
  openfootball: "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"
};

let localSquads = { updatedAt: "", source: "", teams: [] };
let squadsByKey = new Map();
let squadsLoaded = false;

export async function ensureLocalSquads(context) {
  if (squadsLoaded) {
    return;
  }
  try {
    const assetUrl = new URL("/data/squads.json", context.request.url);
    const response = await context.env.ASSETS.fetch(new Request(assetUrl));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    localSquads = await response.json();
    squadsByKey = new Map();
    for (const team of localSquads.teams || []) {
      squadsByKey.set(canonicalTeamName(team.name), team);
      if (team.fifaCode) {
        squadsByKey.set(team.fifaCode.toLowerCase(), team);
      }
    }
    squadsLoaded = true;
  } catch (error) {
    console.warn(`Không nạp được data/squads.json: ${error.message}`);
  }
}

function findLocalSquad({ name = "", code = "" } = {}) {
  return (code && squadsByKey.get(String(code).toLowerCase()))
    || (name && squadsByKey.get(canonicalTeamName(name)))
    || null;
}

export function jsonResponse(payload, { status = 200, maxAge = 0 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, s-maxage=${maxAge}` : "no-store"
    }
  });
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
    details: competition.details || []
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
  const home = game.home_team_name_en || game.home_team_label || `Team ${game.home_team_id || ""}`.trim();
  const away = game.away_team_name_en || game.away_team_label || `Team ${game.away_team_id || ""}`.trim();
  const stadium = stadiumsById.get(String(game.stadium_id));
  const homeTeam = teamsById.get(String(game.home_team_id));
  const awayTeam = teamsById.get(String(game.away_team_id));
  const finished = String(game.finished).toLowerCase() === "true";
  const timeElapsed = String(game.time_elapsed || "").toLowerCase();
  const status = finished ? "finished" : (timeElapsed !== "notstarted" && timeElapsed !== "" ? "live" : "upcoming");

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
    kickoffUtc: parseWorldcup26Date(game.local_date),
    kickoff: formatTime(parseWorldcup26Date(game.local_date)) || game.local_date || "",
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
  const kickoffUtc = match.date || "";
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

function parseWorldcup26Date(value) {
  if (!value) {
    return "";
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
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
  if (incoming.group && (!existing.group || existing.group === "World Cup" || existing.group === "Group stage")) {
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
      copy: `Nguồn: ${(match.sources || []).join(" + ")}. Độ tin cậy ${Math.round((match.confidence || 0) * 100)}%.`
    }));
}

function buildSchedule(matches) {
  return matches
    .filter((match) => match.status === "upcoming")
    .slice(0, 6)
    .map((match) => ({
      time: formatTime(match.kickoffUtc) || match.kickoff || "--",
      title: `${match.home} vs ${match.away}`,
      stadium: match.stadium || "Chưa rõ sân"
    }));
}

function buildStandings(matches, groupsFromApi) {
  if (Array.isArray(groupsFromApi) && groupsFromApi.length) {
    const rows = [];
    for (const group of groupsFromApi) {
      for (const team of group.teams || []) {
        rows.push({
          team: team.team_name_en || team.name_en || team.team_id || "TBD",
          played: Number(team.mp || team.played || 0),
          diff: Number(team.gd || (Number(team.gf || 0) - Number(team.ga || 0))),
          points: Number(team.pts || team.points || 0)
        });
      }
    }
    if (rows.length) {
      return rows.slice(0, 12);
    }
  }

  const table = new Map();
  const completed = matches.filter((match) => match.status === "finished");
  for (const match of completed) {
    ensureTeam(table, match.home);
    ensureTeam(table, match.away);
    applyResult(table.get(match.home), match.homeScore, match.awayScore);
    applyResult(table.get(match.away), match.awayScore, match.homeScore);
  }

  return [...table.values()]
    .sort((a, b) => b.points - a.points || b.diff - a.diff)
    .slice(0, 12);
}

function ensureTeam(table, team) {
  if (!table.has(team)) {
    table.set(team, { team, played: 0, diff: 0, points: 0 });
  }
}

function applyResult(row, goalsFor, goalsAgainst) {
  row.played += 1;
  row.diff += goalsFor - goalsAgainst;
  row.points += goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0;
}

async function fetchJson(name, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "LiveCup/1.0 (+cloudflare pages)" }
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

export async function buildLivePayload() {
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

  return {
    generatedAt: new Date().toISOString(),
    cache: { hit: false, ttlMs: 30000 },
    sources: [espn, wcGames, wcGroups, wcStadiums, wcTeams, openfootball].map((source) => ({
      name: source.name,
      ok: source.ok,
      error: source.error || null
    })),
    matches,
    teams: buildTeams(matches, teamList),
    events: buildEvents(matches),
    standings: buildStandings(matches, wcGroups.ok ? (wcGroups.data.groups || wcGroups.data || []) : []),
    schedule: buildSchedule(matches)
  };
}

export async function buildMatchTimelinePayload(espnId) {
  const result = await fetchJson("espn-summary", `${SOURCE_URLS.espnSummary}?event=${encodeURIComponent(espnId)}`);
  if (!result.ok) {
    throw new Error(`espn summary: ${result.error}`);
  }

  const commentary = Array.isArray(result.data.commentary) ? result.data.commentary : [];
  const entries = commentary.map((item) => ({
    minute: item.time?.displayValue || "",
    type: item.play?.type?.text || "",
    text: item.text || "",
    scoring: Boolean(item.play?.scoringPlay)
  })).reverse();

  return {
    generatedAt: new Date().toISOString(),
    espnId,
    entries,
    cache: { hit: false }
  };
}

export async function buildTeamPayload({ espnId = "", code = "", name = "" } = {}) {
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

  return {
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
}
