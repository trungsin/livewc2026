const standingsGroups = document.querySelector("#standings-groups");
const standingsCount = document.querySelector("#standings-count");

function renderStandingsGroup(group) {
  const rows = Array.isArray(group.rows) ? group.rows : [];
  return `
    <article class="group-table">
      <h3>Bảng ${escapeHtml(group.group || "")}</h3>
      <table class="standings compact">
        <thead>
          <tr>
            <th>Đội</th>
            <th>Tr</th>
            <th>T</th>
            <th>H</th>
            <th>B</th>
            <th>HS</th>
            <th>Đ</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.team)}</strong></td>
              <td>${escapeHtml(row.played)}</td>
              <td>${escapeHtml(row.won)}</td>
              <td>${escapeHtml(row.drawn)}</td>
              <td>${escapeHtml(row.lost)}</td>
              <td>${escapeHtml(row.diff)}</td>
              <td><strong>${escapeHtml(row.points)}</strong></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
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
