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

  return escapeHtml(match.kickoff || "Sắp đấu");
}

function sourceBadge(match) {
  const names = (match.sources || []).join(" + ") || "unknown";
  const confidence = Math.round((match.confidence || 0) * 100);
  return `<span class="source-badge">${escapeHtml(names)} · ${confidence}%</span>`;
}

function filteredMatches() {
  const query = searchInput.value.trim().toLowerCase();
  return homeMatches().filter((match) => {
    const filterMatch = activeFilter === "all"
      || match.status === activeFilter
      || (activeFilter === "live" && match.status === "halftime");
    const text = `${match.home} ${match.away} ${match.stadium} ${match.group}`.toLowerCase();
    return filterMatch && text.includes(query);
  });
}

// Trận FT chỉ ở lại khu live ~10 phút sau mãn cuộc rồi nhường chỗ (vẫn xem được ở Kết quả mới nhất).
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

function homeMatches() {
  const today = vnDayKey(new Date());
  const now = Date.now();
  return matches.filter((match) => {
    const isLive = match.status === "live" || match.status === "halftime";
    if (isLive) {
      return true;
    }
    if (vnDayKey(match.kickoffUtc) !== today) {
      return false;
    }
    return match.status === "finished" ? finishedStillInLiveSection(match, now) : true;
  });
}

function renderMatches() {
  const items = filteredMatches();

  if (!items.length) {
    matchList.innerHTML = `<div class="empty-state">Hôm nay không có trận phù hợp - <a class="text-link" href="./matches.html">xem lịch đầy đủ</a>.</div>`;
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
          ${imageTag(match.homeLogo, match.home, "team-logo")}
          <span class="team-name">${escapeHtml(match.home)}</span>
        </span>
        <span class="result-score">${escapeHtml(match.homeScore)} - ${escapeHtml(match.awayScore)}</span>
        <span class="result-team away">
          <span class="team-name">${escapeHtml(match.away)}</span>
          ${imageTag(match.awayLogo, match.away, "team-logo")}
        </span>
      </div>
      <div class="match-meta">FT / ${escapeHtml(match.group || "World Cup")}${match.kickoffUtc ? ` / ${escapeHtml(formatKickoff(match.kickoffUtc))}` : ""}</div>
      <div class="match-meta">${escapeHtml(match.stadium || "")}</div>
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

  scheduleList.innerHTML = groupMatchesByDay(items).map((group) => `
    <section class="day-group compact">
      <h3 class="day-heading">${escapeHtml(group.heading)}</h3>
      <div class="day-matches">
        ${group.matches.map(renderMatchRow).join("")}
      </div>
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
  renderAll();
}

resultsList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-match-id]");
  if (!card) {
    return;
  }
  const match = matches.find((item) => String(item.id) === card.dataset.matchId);
  if (match) {
    openMatchTimelineModal(match);
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
