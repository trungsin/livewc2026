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

let modalMatchId = null;

// Chuyển match.details (sự kiện chính từ scoreboard) sang shape entry của live-commentary-renderer.
function entriesFromMatchDetails(match) {
  return (match.details || []).map((detail) => {
    const players = (detail.athletesInvolved || [])
      .map((athlete) => athlete.displayName || athlete.fullName)
      .filter(Boolean)
      .join(", ");
    return {
      minute: detail.clock?.displayValue || detail.displayTime || "",
      type: detail.type?.text || detail.type?.displayName || "",
      text: detail.text || (players ? `Cầu thủ: ${players}.` : ""),
      scoring: Boolean(detail.scoringPlay)
    };
  }).reverse();
}

function matchModalStatusLabel(match) {
  if (match.status === "finished") {
    return "FT";
  }
  if (match.status === "live") {
    return `${match.minute || "--"}' LIVE`;
  }
  if (match.status === "halftime") {
    return "Nghỉ giữa hiệp";
  }
  return "Sắp đấu";
}

function modalCenterHtml(match) {
  if (match.status === "upcoming") {
    return `<span class="result-score kickoff-time">${escapeHtml(match.kickoffUtc ? formatKickoff(match.kickoffUtc) : (match.kickoff || "Sắp đấu"))}</span>`;
  }
  return `<span class="result-score">${escapeHtml(match.homeScore)} - ${escapeHtml(match.awayScore)}</span>`;
}

function openMatchTimelineModal(match, predictionStats = null) {
  const modal = ensureMatchModal();
  modalMatchId = match.id;

  modal.querySelector(".match-modal-body").innerHTML = `
    <div class="match-modal-header">
      <span class="result-team">
        ${imageTag(match.homeLogo, displayTeamName(match.home), "team-logo")}
        <span class="team-name">${escapeHtml(displayTeamName(match.home))}</span>
      </span>
      ${modalCenterHtml(match)}
      <span class="result-team away">
        <span class="team-name">${escapeHtml(displayTeamName(match.away))}</span>
        ${imageTag(match.awayLogo, displayTeamName(match.away), "team-logo")}
      </span>
    </div>
    <div class="match-meta">${escapeHtml(matchModalStatusLabel(match))} / ${escapeHtml(match.group || "World Cup")}${match.kickoffUtc ? ` / ${escapeHtml(formatKickoff(match.kickoffUtc))}` : ""}</div>
    ${match.status === "upcoming" ? "" : `<div class="match-modal-timeline"><div class="empty-state">Đang tải diễn biến…</div></div>`}
    <div class="match-modal-insight"><div class="empty-state">Đang tải nhận định &amp; kèo…</div></div>
  `;
  modal.classList.remove("hidden");

  const insightContainer = modal.querySelector(".match-modal-insight");
  fetchMatchInsight(match.id)
    .then((insight) => {
      if (modalMatchId === match.id) {
        insightContainer.innerHTML = renderInsightSection(insight, predictionStats, match);
      }
    })
    .catch(() => {
      if (modalMatchId === match.id) {
        insightContainer.innerHTML = "";
      }
    });

  if (match.status === "upcoming") {
    return;
  }

  const container = modal.querySelector(".match-modal-timeline");
  const fallbackEntries = entriesFromMatchDetails(match);
  const espnId = match.rawIds?.espn;

  if (!espnId) {
    container.innerHTML = renderCommentaryList(fallbackEntries);
    return;
  }

  fetchMatchTimeline(espnId)
    .then((entries) => {
      if (modalMatchId === match.id) {
        container.innerHTML = renderCommentaryList(entries.length ? entries : fallbackEntries);
      }
    })
    .catch(() => {
      if (modalMatchId === match.id) {
        container.innerHTML = renderCommentaryList(fallbackEntries);
      }
    });
}

function closeMatchTimelineModal() {
  matchModalElement?.classList.add("hidden");
}
