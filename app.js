let matches = [];
let timeline = [];
let activeFilter = "all";
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
  events: [],
  standings: []
};

const matchList = document.querySelector("#match-list");
const timelineList = document.querySelector("#timeline-list");
const scheduleList = document.querySelector("#schedule-list");
const resultsList = document.querySelector("#results-list");
const resultsCount = document.querySelector("#results-count");
const searchInput = document.querySelector("#search-input");
const tabs = document.querySelectorAll(".tab");
const timelineStatus = document.querySelector("#timeline-status");
const timelineTitle = document.querySelector("#timeline-title");

function formatClock(value = new Date()) {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
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

  return escapeHtml(match.kickoffUtc ? formatKickoff(match.kickoffUtc) : (match.kickoff || "Sắp đấu"));
}

function sourceBadge(match) {
  const names = (match.sources || []).join(" + ") || "unknown";
  const confidence = Math.round((match.confidence || 0) * 100);
  return `<span class="source-badge">${escapeHtml(names)} · ${confidence}%</span>`;
}

function kickoffTimestamp(match) {
  const parsed = Date.parse(match.kickoffUtc || "");
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function filteredMatches() {
  const query = searchInput.value.trim().toLowerCase();
  return homeMatchesForActiveTab().filter((match) => {
    const text = [
      match.home,
      match.away,
      displayTeamName(match.home),
      displayTeamName(match.away),
      match.stadium,
      match.group
    ].join(" ").toLowerCase();
    return text.includes(query);
  });
}

// Trận FT chỉ ở lại tab "Tất cả" ~10 phút sau mãn cuộc rồi nhường chỗ (vẫn xem được ở tab Kết quả).
const FT_LINGER_MS = 10 * 60 * 1000;
// Khi không bắt được khoảnh khắc FT (mở trang sau khi trận đã xong), ước lượng từ giờ bóng lăn:
// 90' + nghỉ giữa hiệp + bù giờ ≈ 120', cộng 10 phút hiển thị.
const FT_LINGER_FROM_KICKOFF_MS = 130 * 60 * 1000;
const ftSeenAt = new Map();
const lastStatusById = new Map();

function trackFinishedTransitions(list) {
  const now = Date.now();
  for (const match of list) {
    const previous = lastStatusById.get(match.id);
    if (match.status === "finished" && previous && previous !== "finished" && !ftSeenAt.has(match.id)) {
      ftSeenAt.set(match.id, now);
    }
    lastStatusById.set(match.id, match.status);
  }
}

function finishedStillInLiveSection(match, now) {
  if (ftSeenAt.has(match.id)) {
    return now - ftSeenAt.get(match.id) < FT_LINGER_MS;
  }
  const kickoff = Date.parse(match.kickoffUtc || "");
  return !Number.isNaN(kickoff) && now - kickoff < FT_LINGER_FROM_KICKOFF_MS;
}

function homeMatchesForActiveTab() {
  const today = vnDayKey(new Date());

  if (activeFilter === "finished") {
    return matches
      .filter((match) => match.status === "finished")
      .sort((a, b) => kickoffTimestamp(b) - kickoffTimestamp(a));
  }

  if (activeFilter === "upcoming") {
    return matches
      .filter((match) => match.status === "upcoming" && vnDayKey(match.kickoffUtc) === today)
      .sort((a, b) => kickoffTimestamp(a) - kickoffTimestamp(b));
  }

  if (activeFilter === "live") {
    return matches
      .filter((match) => match.status === "live" || match.status === "halftime")
      .sort((a, b) => kickoffTimestamp(a) - kickoffTimestamp(b));
  }

  const now = Date.now();
  return matches.filter((match) => {
    const isLive = match.status === "live" || match.status === "halftime";
    if (isLive) {
      return true;
    }
    if (vnDayKey(match.kickoffUtc) !== today) {
      return false;
    }
    if (match.status === "finished") {
      return finishedStillInLiveSection(match, now);
    }
    return match.status === "upcoming";
  });
}

function renderMatches() {
  const items = filteredMatches();

  if (!items.length) {
    matchList.innerHTML = `<div class="empty-state">Không có trận phù hợp - <a class="text-link" href="./matches.html">xem lịch đầy đủ</a>.</div>`;
    return;
  }

  matchList.innerHTML = items.map((match) => `
    <article class="match-card clickable"
      data-match-id="${escapeHtml(match.id)}"
      ${match.status === "live" || match.status === "halftime" ? `data-live-id="${escapeHtml(match.id)}" title="Xem tường thuật trực tiếp"` : `title="Xem diễn biến trận đấu"`}>
      <div class="team">
        ${imageTag(match.homeLogo, displayTeamName(match.home), "team-logo")}
        <span class="team-name">${escapeHtml(displayTeamName(match.home))}</span>
      </div>
      <div class="score-block">
        ${match.status === "live" || match.status === "halftime" ? `<button class="match-info-button" type="button" data-open-match-modal="${escapeHtml(match.id)}" aria-label="Mở nhận định và kèo" title="Mở nhận định và kèo">ⓘ</button>` : ""}
        <div class="score">${escapeHtml(match.homeScore)} - ${escapeHtml(match.awayScore)}</div>
        <div class="match-meta">${matchStatus(match)} / ${escapeHtml(match.group || "World Cup")}</div>
        <div class="match-meta">${escapeHtml(match.stadium || "")}</div>
        <div class="match-meta">${sourceBadge(match)}</div>
        ${renderPredictionLine(match, { compact: true })}
      </div>
      <div class="team">
        <span class="team-name">${escapeHtml(displayTeamName(match.away))}</span>
        ${imageTag(match.awayLogo, displayTeamName(match.away), "team-logo")}
      </div>
    </article>
  `).join("");
}

// Tường thuật trực tiếp per-trận (kiểu bongdaplus): bám theo một trận live, click thẻ trận để đổi.
const liveCommentary = { matchId: null, entries: [], lastFetchAt: 0 };

function selectedLiveMatch() {
  const match = matches.find((item) => item.id === liveCommentary.matchId);
  return match && (match.status === "live" || match.status === "halftime") ? match : null;
}

function syncLiveCommentary() {
  if (!selectedLiveMatch()) {
    const fallback = matches.find((item) => (item.status === "live" || item.status === "halftime") && item.rawIds?.espn);
    liveCommentary.matchId = fallback ? fallback.id : null;
    liveCommentary.entries = [];
  }
  refreshLiveCommentary();
}

async function refreshLiveCommentary(force = false) {
  const match = selectedLiveMatch();
  const espnId = match?.rawIds?.espn;
  if (!espnId) {
    return;
  }
  const now = Date.now();
  if (!force && now - liveCommentary.lastFetchAt < 8000) {
    return;
  }
  liveCommentary.lastFetchAt = now;
  try {
    const entries = await fetchMatchTimeline(espnId);
    if (selectedLiveMatch()?.rawIds?.espn === espnId) {
      liveCommentary.entries = entries;
      renderTimeline();
    }
  } catch {
    // giữ tường thuật cũ, lần poll sau thử lại
  }
}

function renderTimeline() {
  const liveMatch = selectedLiveMatch();

  if (liveMatch) {
    timelineTitle.textContent = `${displayTeamName(liveMatch.home)} ${liveMatch.homeScore} - ${liveMatch.awayScore} ${displayTeamName(liveMatch.away)}`;
    timelineList.innerHTML = liveCommentary.entries.length
      ? liveCommentary.entries.map(commentaryEntryHtml).join("")
      : `
        <li class="timeline-item">
          <span class="minute">--</span>
          <div>
            <p class="event-title">Đang tải tường thuật…</p>
            <p class="event-copy">Diễn biến trận đấu sẽ hiện tại đây trong giây lát.</p>
          </div>
        </li>
      `;
    return;
  }

  timelineTitle.textContent = "Diễn biến nổi bật";
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
        <p class="event-title">${escapeHtml(translateTeamNamesInText(event.title))}</p>
        <p class="event-copy">${escapeHtml(translateTeamNamesInText(event.copy))}</p>
      </div>
    </li>
  `).join("");
}

function kickoffTimestamp(match) {
  const parsed = Date.parse(match.kickoffUtc || "");
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function renderResults() {
  const finished = matches
    .filter((match) => match.status === "finished")
    .sort((a, b) => kickoffTimestamp(b) - kickoffTimestamp(a));

  resultsCount.textContent = `${finished.length} trận`;

  if (!finished.length) {
    resultsList.innerHTML = `<div class="empty-state">Chưa có trận nào kết thúc. Kết quả sẽ hiện tại đây ngay khi trọng tài nổi còi mãn cuộc.</div>`;
    return;
  }

  resultsList.innerHTML = finished.slice(0, 6).map((match) => `
    <article class="result-card clickable" data-match-id="${escapeHtml(match.id)}" title="Xem diễn biến trận đấu">
      <div class="result-teams">
        <span class="result-team">
          ${imageTag(match.homeLogo, displayTeamName(match.home), "team-logo")}
          <span class="team-name">${escapeHtml(displayTeamName(match.home))}</span>
        </span>
        <span class="result-score">${escapeHtml(match.homeScore)} - ${escapeHtml(match.awayScore)}</span>
        <span class="result-team away">
          <span class="team-name">${escapeHtml(displayTeamName(match.away))}</span>
          ${imageTag(match.awayLogo, displayTeamName(match.away), "team-logo")}
        </span>
      </div>
      <div class="match-meta">FT / ${escapeHtml(match.group || "World Cup")}${match.kickoffUtc ? ` / ${escapeHtml(formatKickoff(match.kickoffUtc))}` : ""}</div>
      <div class="match-meta">${escapeHtml(match.stadium || "")}</div>
      ${renderPredictionLine(match, { compact: true })}
    </article>
  `).join("");
}

function renderSchedule() {
  const today = vnDayKey(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = vnDayKey(tomorrowDate);
  const items = matches
    .filter((match) => match.status === "upcoming")
    .filter((match) => {
      const day = vnDayKey(match.kickoffUtc);
      return day === today || day === tomorrow;
    });

  if (!items.length) {
    scheduleList.innerHTML = `<div class="empty-state">Không có trận trong 2 ngày tới - <a class="text-link" href="./matches.html">xem lịch đầy đủ</a>.</div>`;
    return;
  }

  scheduleList.innerHTML = groupMatchesByStageAndDay(items).map((stage) => `
    <section class="stage-group">
      <h3 class="stage-heading">${escapeHtml(stage.label)}</h3>
      ${stage.days.map((group) => `
        <section class="day-group compact" data-day="${escapeHtml(group.day)}">
          <h4 class="day-heading">${escapeHtml(group.heading)}</h4>
          <div class="day-matches">
            ${group.matches.map(renderMatchRow).join("")}
          </div>
        </section>
      `).join("")}
    </section>
  `).join("");
}

function updateMetrics() {
  document.querySelector("#live-count").textContent = matches.filter((match) => match.status === "live" || match.status === "halftime").length;
  document.querySelector("#event-count").textContent = realtimeEvents.length + timeline.length;
  document.querySelector("#last-sync").textContent = lastPayload?.generatedAt ? formatClock(lastPayload.generatedAt) : formatClock();

  timelineStatus.textContent = realtimeConnected
    ? "Realtime"
    : matches.some((match) => match.status === "live" || match.status === "halftime") ? "Live feed" : "Theo dõi";
}

function renderAll() {
  renderMatches();
  renderTimeline();
  renderResults();
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
  trackFinishedTransitions(matches);
  syncLiveCommentary();
  renderAll();
}

matchList.addEventListener("click", (event) => {
  const infoButton = event.target.closest("[data-open-match-modal]");
  if (!infoButton) {
    return;
  }
  event.stopPropagation();
  event.stopImmediatePropagation();
  const match = matches.find((item) => String(item.id) === infoButton.dataset.openMatchModal);
  if (match) {
    openMatchTimelineModal(match, lastPayload?.predictionStats);
  }
});

matchList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-live-id]");
  if (!card) {
    return;
  }
  if (card.dataset.liveId === liveCommentary.matchId) {
    document.querySelector("#events")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  liveCommentary.matchId = card.dataset.liveId;
  liveCommentary.entries = [];
  renderTimeline();
  refreshLiveCommentary(true);
  document.querySelector("#events")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

matchList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-match-id]:not([data-live-id])");
  if (!card) {
    return;
  }
  const match = matches.find((item) => String(item.id) === card.dataset.matchId);
  if (match) {
    openMatchTimelineModal(match, lastPayload?.predictionStats);
  }
});

resultsList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-match-id]");
  if (!card) {
    return;
  }
  const match = matches.find((item) => String(item.id) === card.dataset.matchId);
  if (match) {
    openMatchTimelineModal(match, lastPayload?.predictionStats);
  }
});

scheduleList.addEventListener("click", (event) => {
  const row = event.target.closest("[data-match-id]");
  if (!row) {
    return;
  }
  const match = matches.find((item) => String(item.id) === row.dataset.matchId);
  if (match) {
    openMatchTimelineModal(match, lastPayload?.predictionStats);
  }
});

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
// Tường thuật trực tiếp refresh mỗi 10s, độc lập với chu kỳ poll dữ liệu trận
setInterval(() => refreshLiveCommentary(true), 10000);
