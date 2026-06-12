// Modal xem diễn biến (timeline) của một trận, mở khi click vào thẻ kết quả.
// Dùng chung escapeHtml/imageTag/formatKickoff từ ui-render-helpers.js.

let matchModalElement = null;

function ensureMatchModal() {
  if (matchModalElement) {
    return matchModalElement;
  }

  matchModalElement = document.createElement("div");
  matchModalElement.className = "match-modal hidden";
  matchModalElement.innerHTML = `
    <div class="match-modal-backdrop" data-close-modal></div>
    <div class="match-modal-card" role="dialog" aria-modal="true" aria-label="Diễn biến trận đấu">
      <button class="match-modal-close" type="button" data-close-modal aria-label="Đóng">&times;</button>
      <div class="match-modal-body"></div>
    </div>
  `;
  document.body.appendChild(matchModalElement);

  matchModalElement.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-modal]")) {
      closeMatchTimelineModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMatchTimelineModal();
    }
  });

  return matchModalElement;
}

function timelineEventItem(detail) {
  const players = (detail.athletesInvolved || [])
    .map((athlete) => athlete.displayName || athlete.fullName)
    .filter(Boolean)
    .join(", ");
  const eventName = detail.type?.text || detail.type?.displayName || "Sự kiện";
  const copy = detail.text || (players ? `Cầu thủ: ${players}.` : "");

  return `
    <li class="timeline-item">
      <span class="minute">${escapeHtml(detail.clock?.displayValue || detail.displayTime || "--")}</span>
      <div>
        <p class="event-title">${detail.scoringPlay ? "⚽ " : ""}${escapeHtml(eventName)}</p>
        ${copy ? `<p class="event-copy">${escapeHtml(copy)}</p>` : ""}
      </div>
    </li>
  `;
}

function openMatchTimelineModal(match) {
  const modal = ensureMatchModal();
  const details = match.details || [];
  const timelineHtml = details.length
    ? `<ul class="timeline">${details.map(timelineEventItem).join("")}</ul>`
    : `<div class="empty-state">Chưa có dữ liệu diễn biến cho trận này.</div>`;

  modal.querySelector(".match-modal-body").innerHTML = `
    <div class="match-modal-header">
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
    ${timelineHtml}
  `;
  modal.classList.remove("hidden");
}

function closeMatchTimelineModal() {
  matchModalElement?.classList.add("hidden");
}
