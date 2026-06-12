let matches = [];
let activeTab = new URLSearchParams(location.search).get("tab") === "results" ? "results" : "schedule";
let pollTimer = null;
let didAutoScroll = false;

const matchesContainer = document.querySelector("#matches-by-day");
const matchesCount = document.querySelector("#matches-count");
const pageTabs = document.querySelectorAll(".page-tabs .tab");

function kickoffTimestamp(match) {
  const parsed = Date.parse(match.kickoffUtc || "");
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function visibleMatches() {
  if (activeTab === "results") {
    return matches
      .filter((match) => match.status === "finished")
      .sort((a, b) => kickoffTimestamp(b) - kickoffTimestamp(a));
  }

  return matches
    .filter((match) => match.status === "upcoming" || match.status === "live" || match.status === "halftime")
    .sort((a, b) => kickoffTimestamp(a) - kickoffTimestamp(b));
}

function renderMatchesPage() {
  const items = visibleMatches();
  const groups = groupMatchesByDay(items);

  matchesCount.textContent = `${items.length} trận`;
  pageTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === activeTab));

  if (!items.length) {
    matchesContainer.innerHTML = `<div class="empty-state">Chưa có dữ liệu phù hợp.</div>`;
    return;
  }

  if (activeTab === "results") {
    groups.reverse();
  }

  matchesContainer.innerHTML = groups.map((group) => `
    <section class="day-group" id="day-${escapeHtml(group.day)}">
      <h3 class="day-heading">${escapeHtml(group.heading)}</h3>
      <div class="day-matches">
        ${group.matches.map(renderMatchRow).join("")}
      </div>
    </section>
  `).join("");

  if (!didAutoScroll && activeTab === "schedule") {
    didAutoScroll = true;
    const today = document.getElementById(`day-${vnDayKey(new Date())}`);
    if (today) {
      today.scrollIntoView({ block: "start" });
    }
  }
}

async function loadMatches() {
  try {
    const response = await fetch("/api/live", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    matches = Array.isArray(payload.matches) ? payload.matches : [];
  } catch (error) {
    console.warn("Không tải được lịch đấu.", error);
    matches = [];
  }
  renderMatchesPage();
}

function pollDelay() {
  const hasLive = matches.some((match) => match.status === "live" || match.status === "halftime");
  return hasLive ? 10000 : 30000;
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await loadMatches();
    schedulePoll();
  }, pollDelay());
}

pageTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    renderMatchesPage();
  });
});

loadMatches().then(schedulePoll);
