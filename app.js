let matches = [];
let timeline = [];
let standings = [];
let schedule = [];
let teams = [];
let activeFilter = "all";
let selectedTeamId = "";
let lastPayload = null;
let realtimeSocket = null;
let realtimeConnected = false;
let realtimeEvents = [];
let pollTimer = null;

const fallbackPayload = {
  generatedAt: new Date().toISOString(),
  cache: { hit: false, ttlMs: 0 },
  sources: [{ name: "fallback", ok: true, label: "Dữ liệu dự phòng cục bộ" }],
  matches: [],
  teams: [],
  events: [],
  standings: [],
  schedule: []
};

const matchList = document.querySelector("#match-list");
const timelineList = document.querySelector("#timeline-list");
const standingsBody = document.querySelector("#standings-body");
const scheduleList = document.querySelector("#schedule-list");
const teamGrid = document.querySelector("#team-grid");
const teamDetail = document.querySelector("#team-detail");
const teamCount = document.querySelector("#team-count");
const searchInput = document.querySelector("#search-input");
const tabs = document.querySelectorAll(".tab");
const sourceSummary = document.querySelector("#source-summary");
const sourceDetail = document.querySelector("#source-detail");
const timelineStatus = document.querySelector("#timeline-status");

function formatClock(value = new Date()) {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatKickoff(isoValue) {
  if (!isoValue) {
    return "";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(isoValue));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function imageTag(src, alt, className) {
  if (!src) {
    return `<span class="${className} placeholder">${escapeHtml((alt || "?").slice(0, 3).toUpperCase())}</span>`;
  }

  return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`;
}

function matchStatus(match) {
  if (match.status === "live") {
    return `<span class="status-live">${escapeHtml(match.minute || "")}' LIVE</span>`;
  }

  if (match.status === "halftime") {
    return `<span class="status-live">Nghỉ giữa hiệp</span>`;
  }

  if (match.status === "finished") {
    return "FT";
  }

  return match.kickoff || "Sắp đấu";
}

function sourceBadge(match) {
  const names = (match.sources || []).join(" + ") || "unknown";
  const confidence = Math.round((match.confidence || 0) * 100);
  return `<span class="source-badge">${escapeHtml(names)} · ${confidence}%</span>`;
}

function filteredMatches() {
  const query = searchInput.value.trim().toLowerCase();
  return matches.filter((match) => {
    const filterMatch = activeFilter === "all" || match.status === activeFilter;
    const text = `${match.home} ${match.away} ${match.stadium} ${match.group}`.toLowerCase();
    return filterMatch && text.includes(query);
  });
}

function renderMatches() {
  const items = filteredMatches();

  if (!items.length) {
    matchList.innerHTML = `<div class="empty-state">Không có trận phù hợp với bộ lọc hiện tại.</div>`;
    return;
  }

  matchList.innerHTML = items.map((match) => `
    <article class="match-card">
      <div class="team">
        ${imageTag(match.homeLogo, match.home, "team-logo")}
        <span class="team-name">${escapeHtml(match.home)}</span>
      </div>
      <div class="score-block">
        <div class="score">${escapeHtml(match.homeScore)} - ${escapeHtml(match.awayScore)}</div>
        <div class="match-meta">${matchStatus(match)} / ${escapeHtml(match.group || "World Cup")}</div>
        <div class="match-meta">${escapeHtml(match.stadium || "")}</div>
        <div class="match-meta">${sourceBadge(match)}</div>
      </div>
      <div class="team">
        <span class="team-name">${escapeHtml(match.away)}</span>
        ${imageTag(match.awayLogo, match.away, "team-logo")}
      </div>
    </article>
  `).join("");
}

function renderTimeline() {
  const items = [...realtimeEvents, ...timeline];

  if (!items.length) {
    timelineList.innerHTML = `
      <li class="timeline-item">
        <span class="minute">--</span>
        <div>
          <p class="event-title">Chưa có diễn biến live</p>
          <p class="event-copy">Khi nguồn ESPN hoặc community trả về play-by-play, app sẽ hiển thị tại đây.</p>
        </div>
      </li>
    `;
    return;
  }

  timelineList.innerHTML = items.slice(0, 10).map((event) => `
    <li class="timeline-item">
      <span class="minute">${escapeHtml(event.minute || "--")}</span>
      <div>
        <p class="event-title">${escapeHtml(event.title)}</p>
        <p class="event-copy">${escapeHtml(event.copy)}</p>
      </div>
    </li>
  `).join("");
}

function renderStandings() {
  if (!standings.length) {
    standingsBody.innerHTML = `
      <tr>
        <td colspan="4">Bảng xếp hạng sẽ tự tính khi có kết quả đã hoàn tất.</td>
      </tr>
    `;
    return;
  }

  standingsBody.innerHTML = standings.map((row) => `
    <tr>
      <td><strong>${escapeHtml(row.team)}</strong></td>
      <td>${escapeHtml(row.played)}</td>
      <td>${escapeHtml(row.diff)}</td>
      <td><strong>${escapeHtml(row.points)}</strong></td>
    </tr>
  `).join("");
}

function renderSchedule() {
  const items = schedule.length ? schedule : matches
    .filter((match) => match.status === "upcoming")
    .slice(0, 6)
    .map((match) => ({
      time: formatKickoff(match.kickoffUtc) || match.kickoff || "--",
      title: `${match.home} vs ${match.away}`,
      stadium: match.stadium || "Chưa rõ sân"
    }));

  if (!items.length) {
    scheduleList.innerHTML = `<div class="empty-state">Chưa có lịch sắp tới từ các nguồn miễn phí.</div>`;
    return;
  }

  scheduleList.innerHTML = items.map((item) => `
    <article class="schedule-card">
      <div class="schedule-time">${escapeHtml(item.time)}</div>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.stadium)}</span>
      </div>
    </article>
  `).join("");
}

function renderTeams() {
  teamCount.textContent = `${teams.length} đội`;

  if (!teams.length) {
    teamGrid.innerHTML = `<div class="empty-state">Chưa tải được danh sách đội tuyển.</div>`;
    return;
  }

  teamGrid.innerHTML = teams.map((team) => `
    <button class="team-card ${selectedTeamId === team.id ? "active" : ""}" type="button" data-team-id="${escapeHtml(team.id)}">
      ${imageTag(team.logo || team.flag, team.name, "team-card-logo")}
      <span>
        <strong>${escapeHtml(team.name)}</strong>
        <small>${escapeHtml(team.code || "N/A")} / ${escapeHtml(team.group || "World Cup")}</small>
      </span>
    </button>
  `).join("");

  teamGrid.querySelectorAll(".team-card").forEach((button) => {
    button.addEventListener("click", () => {
      const team = teams.find((item) => item.id === button.dataset.teamId);
      if (team) {
        loadTeamDetail(team);
      }
    });
  });
}

async function loadTeamDetail(team) {
  selectedTeamId = team.id;
  renderTeams();
  teamDetail.innerHTML = `<div class="empty-state">Đang tải danh sách cầu thủ ${escapeHtml(team.name)}...</div>`;

  try {
    const params = new URLSearchParams();
    if (team.espnId) {
      params.set("espnId", team.espnId);
    }
    if (team.code) {
      params.set("code", team.code);
    }
    if (team.name) {
      params.set("name", team.name);
    }
    const response = await fetch(`/api/team?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    renderTeamDetail(team, payload);
  } catch (error) {
    teamDetail.innerHTML = `<div class="empty-state">Không tải được roster: ${escapeHtml(error.message)}</div>`;
  }
}

function renderTeamDetail(team, payload) {
  const detailTeam = payload.team || {};
  const players = payload.players || [];
  const logo = detailTeam.logo || team.logo || team.flag;
  const ranking = detailTeam.fifaRanking || team.fifaRanking;

  teamDetail.innerHTML = `
    <div class="team-detail-header">
      ${imageTag(logo, team.name, "team-detail-logo")}
      <div>
        <h3>${escapeHtml(detailTeam.name || team.name)}</h3>
        <p>${escapeHtml(team.code || detailTeam.code || "")} / ${escapeHtml(detailTeam.group || team.group || "World Cup")}${ranking ? ` / FIFA #${escapeHtml(ranking)}` : ""}</p>
        <p>${escapeHtml(detailTeam.standingSummary || detailTeam.recordSummary || "Đội hình chính thức từ dữ liệu public, ảnh cầu thủ từ ESPN.")}</p>
      </div>
    </div>
    <div class="info-strip">
      <span>HLV: ${escapeHtml((payload.coach || []).join(", ") || "Chưa có dữ liệu")}</span>
      <span>Nguồn: ${escapeHtml(payload.rosterSource || "ESPN roster")}</span>
      <span>${escapeHtml(players.length ? `${players.length} cầu thủ` : "Chưa có roster")}</span>
    </div>
    ${players.length ? renderPlayers(players) : `<div class="empty-state">Chưa có roster miễn phí cho đội này.</div>`}
  `;
}

const positionLabels = {
  Goalkeeper: "Thủ môn",
  Defender: "Hậu vệ",
  Midfielder: "Tiền vệ",
  Forward: "Tiền đạo"
};

function positionLabel(position) {
  return positionLabels[position] || position || "Chưa rõ vị trí";
}

function renderPlayers(players) {
  return `
    <div class="player-list">
      ${players.map((player) => `
        <article class="player-card">
          ${imageTag(player.headshot, player.name, "player-photo")}
          <div>
            <div class="player-title">
              <strong>${escapeHtml(player.name)}</strong>
              <span>${escapeHtml(player.jersey ? `#${player.jersey}` : "")}</span>
            </div>
            <div class="player-meta">
              <span>${escapeHtml(positionLabel(player.position))}</span>
              <span>${escapeHtml(player.age ? `${player.age} tuổi` : "Chưa rõ tuổi")}</span>
              <span>${escapeHtml(player.citizenship || "Chưa rõ quốc tịch")}</span>
            </div>
            <div class="player-meta">
              <span>CLB: ${escapeHtml(player.currentClub || "Chưa rõ CLB")}</span>
              <span>Giá trị: ${escapeHtml(player.marketValue || player.marketValueNote)}</span>
            </div>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function updateMetrics() {
  document.querySelector("#live-count").textContent = matches.filter((match) => match.status === "live").length;
  document.querySelector("#event-count").textContent = realtimeEvents.length + timeline.length;
  document.querySelector("#last-sync").textContent = lastPayload?.generatedAt ? formatClock(lastPayload.generatedAt) : formatClock();

  const okSources = (lastPayload?.sources || []).filter((source) => source.ok);
  sourceSummary.textContent = okSources.length ? okSources.map((source) => source.name).join(" + ") : "Fallback";
  sourceDetail.textContent = okSources.length
    ? `Đang dùng ${okSources.length} nguồn miễn phí, cache ${lastPayload?.cache?.hit ? "hit" : "mới"}`
    : "Không lấy được nguồn ngoài, đang dùng dữ liệu dự phòng.";
  timelineStatus.textContent = realtimeConnected
    ? "Realtime"
    : matches.some((match) => match.status === "live") ? "Live feed" : "Theo dõi";
}

function renderAll() {
  renderMatches();
  renderTimeline();
  renderTeams();
  renderStandings();
  renderSchedule();
  updateMetrics();
}

async function loadLiveData({ force = false } = {}) {
  const url = force ? "/api/live?refresh=1" : "/api/live";
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    applyPayload(payload);
  } catch (error) {
    console.warn("Không tải được dữ liệu live, dùng fallback.", error);
    applyPayload(fallbackPayload);
  }
}

function applyPayload(payload) {
  lastPayload = payload;
  matches = Array.isArray(payload.matches) ? payload.matches : [];
  timeline = Array.isArray(payload.events) ? payload.events : [];
  standings = Array.isArray(payload.standings) ? payload.standings : [];
  schedule = Array.isArray(payload.schedule) ? payload.schedule : [];
  teams = Array.isArray(payload.teams) ? payload.teams : [];
  renderAll();
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    activeFilter = tab.dataset.filter;
    renderMatches();
  });
});

searchInput.addEventListener("input", renderMatches);
document.querySelector("#refresh-button").addEventListener("click", () => loadLiveData({ force: true }));

function pollDelay() {
  if (realtimeConnected) {
    return 60000;
  }
  const hasLive = matches.some((match) => match.status === "live" || match.status === "halftime");
  return hasLive ? 10000 : 30000;
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await loadLiveData();
    schedulePoll();
  }, pollDelay());
}

function connectRealtime() {
  if (typeof WebSocket === "undefined") {
    return;
  }

  const protocol = location.protocol === "https:" ? "wss" : "ws";
  let socket;
  try {
    socket = new WebSocket(`${protocol}://${location.host}/ws`);
  } catch {
    return;
  }

  realtimeSocket = socket;

  socket.addEventListener("open", () => {
    realtimeConnected = true;
    updateMetrics();
    schedulePoll();
  });

  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type !== "live" || !message.payload) {
        return;
      }
      if (Array.isArray(message.events) && message.events.length) {
        realtimeEvents = [...message.events, ...realtimeEvents].slice(0, 20);
      }
      applyPayload(message.payload);
    } catch {
      // bỏ qua message không hợp lệ
    }
  });

  const onDisconnect = () => {
    if (realtimeSocket !== socket) {
      return;
    }
    realtimeSocket = null;
    realtimeConnected = false;
    updateMetrics();
    schedulePoll();
    setTimeout(connectRealtime, 30000);
  };

  socket.addEventListener("close", onDisconnect);
  socket.addEventListener("error", () => socket.close());
}

applyPayload({
  ...fallbackPayload,
  sources: [{ name: "loading", ok: true, label: "Đang tải dữ liệu" }]
});
loadLiveData().then(schedulePoll);
connectRealtime();
