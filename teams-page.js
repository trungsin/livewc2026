// Trang đội tuyển: tải danh sách đội + roster một lần, không cần realtime/polling.
let teams = [];
let selectedTeamId = "";

const teamGrid = document.querySelector("#team-grid");
const teamDetail = document.querySelector("#team-detail");
const teamCount = document.querySelector("#team-count");

const positionLabels = {
  Goalkeeper: "Thủ môn",
  Defender: "Hậu vệ",
  Midfielder: "Tiền vệ",
  Forward: "Tiền đạo"
};

function positionLabel(position) {
  return positionLabels[position] || position || "Chưa rõ vị trí";
}

function renderTeams() {
  teamCount.textContent = `${teams.length} đội`;

  if (!teams.length) {
    teamGrid.innerHTML = `<div class="empty-state">Chưa tải được danh sách đội tuyển.</div>`;
    return;
  }

  teamGrid.innerHTML = teams.map((team) => `
    <button class="team-card ${selectedTeamId === team.id ? "active" : ""}" type="button" data-team-id="${escapeHtml(team.id)}">
      ${imageTag(team.logo || team.flag, displayTeamName(team.name), "team-card-logo")}
      <span>
        <strong>${escapeHtml(displayTeamName(team.name))}</strong>
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
  teamDetail.innerHTML = `<div class="empty-state">Đang tải danh sách cầu thủ ${escapeHtml(displayTeamName(team.name))}...</div>`;

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
      ${imageTag(logo, displayTeamName(team.name), "team-detail-logo")}
      <div>
        <h3>${escapeHtml(displayTeamName(detailTeam.name || team.name))}</h3>
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

async function loadTeams() {
  try {
    const response = await fetch("/api/live", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    teams = Array.isArray(payload.teams) ? payload.teams : [];
  } catch (error) {
    console.warn("Không tải được danh sách đội tuyển.", error);
    teams = [];
  }
  renderTeams();
}

loadTeams();
