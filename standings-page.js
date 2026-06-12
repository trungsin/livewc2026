const standingsGroups = document.querySelector("#standings-groups");
const standingsCount = document.querySelector("#standings-count");

function renderStandingsGroup(group) {
  const rows = Array.isArray(group.rows) ? group.rows : [];

  return `
    <article class="standing-group">
      <div class="standing-group-head">
        <h3>Bảng ${escapeHtml(group.group || "")}</h3>
        <span class="standing-group-count">${rows.length} đội</span>
      </div>
      <div class="standing-group-body">
        ${rows.map((row, index) => `
          <div class="standing-row">
            <div class="standing-team">
              <span class="standing-rank">${index + 1}</span>
              ${imageTag(row.logo || row.flag, displayTeamName(row.team), "standing-logo")}
              <strong>${escapeHtml(displayTeamName(row.team))}</strong>
            </div>
            <div class="standing-meta" title="Trận · Thắng · Hòa · Thua · Hiệu số · Điểm">
              <span>${escapeHtml(row.played)}</span>
              <span>${escapeHtml(row.won)}</span>
              <span>${escapeHtml(row.drawn)}</span>
              <span>${escapeHtml(row.lost)}</span>
              <span>${escapeHtml(row.diff > 0 ? `+${row.diff}` : row.diff)}</span>
              <strong>${escapeHtml(row.points)}đ</strong>
            </div>
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function renderStandingsPage(standings) {
  standingsCount.textContent = `${standings.length} bảng`;

  if (!standings.length) {
    standingsGroups.innerHTML = `<div class="empty-state">Chưa có dữ liệu bảng xếp hạng.</div>`;
    return;
  }

  standingsGroups.innerHTML = standings.map(renderStandingsGroup).join("");
}

async function loadStandings() {
  try {
    const response = await fetch("/api/live", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    renderStandingsPage(Array.isArray(payload.standings) ? payload.standings : []);
  } catch (error) {
    console.warn("Không tải được bảng xếp hạng.", error);
    renderStandingsPage([]);
  }
}

loadStandings();
setInterval(loadStandings, 60000);
