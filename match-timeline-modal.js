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

// Bảng thông số đầy đủ cho trận đã xong (data nhúng sẵn trong payload live).
const MATCH_STAT_LABELS = [
  ["possession", "Cầm bóng (%)"],
  ["shots", "Sút"],
  ["shotsOnTarget", "Sút trúng đích"],
  ["corners", "Phạt góc"],
  ["fouls", "Phạm lỗi"],
  ["offsides", "Việt vị"],
  ["yellow", "Thẻ vàng"],
  ["red", "Thẻ đỏ"]
];

function renderMatchStatsTable(match) {
  const stats = match?.stats?.stats || null;
  if (match?.status !== "finished" || !stats) {
    return "";
  }
  const rows = MATCH_STAT_LABELS
    .filter(([key]) => stats[key])
    .map(([key, label]) => `
      <tr>
        <td>${escapeHtml(stats[key][0])}</td>
        <th>${escapeHtml(label)}</th>
        <td>${escapeHtml(stats[key][1])}</td>
      </tr>
    `).join("");
  if (!rows) {
    return "";
  }
  return `
    <div class="match-stats-table-wrap">
      <h3>Thông số trận đấu</h3>
      <table class="match-stats-table">
        <thead>
          <tr>
            <th>${escapeHtml(displayTeamName(match.home))}</th>
            <th></th>
            <th>${escapeHtml(displayTeamName(match.away))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
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
    ${renderFinishedStatsLines(match)}
    ${renderMatchStatsTable(match)}
    ${match.status === "upcoming" ? "" : `<div class="match-modal-timeline"><div class="empty-state">Đang tải diễn biến…</div></div>`}
    <div class="match-modal-insight"><div class="empty-state">Đang tải nhận định &amp; kèo…</div></div>
  `;
  modal.classList.remove("hidden");

  const insightContainer = modal.querySelector(".match-modal-insight");
  fetchMatchInsight(match.id)
    .then((insight) => {
      if (modalMatchId === match.id) {
        insightContainer.innerHTML = renderInsightSection(insight, predictionStats, match);
        maybeGenerateAiPrediction(match, insight, insightContainer, predictionStats);
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

// Cửa sổ sinh AI: chỉ trận sắp đá trong 48h tới (khớp gate phía server).
const AI_PREDICTION_WINDOW_MS = 48 * 60 * 60 * 1000;

function isWithinAiPredictionWindow(match) {
  if (match.status !== "upcoming") {
    return false;
  }
  const kickoff = Date.parse(match.kickoffUtc || "");
  const now = Date.now();
  return !Number.isNaN(kickoff) && kickoff > now && kickoff - now <= AI_PREDICTION_WINDOW_MS;
}

// Trận sắp đá ≤48h mà chưa có dự đoán AI → hiện placeholder rồi gọi endpoint sinh on-demand,
// fill khối AI + tỉ số bongdaplus tại chỗ khi xong. Trận live/finished/ngoài cửa sổ: bỏ qua.
function maybeGenerateAiPrediction(match, insight, insightContainer, predictionStats) {
  if (insight?.aiPrediction || !isWithinAiPredictionWindow(match)) {
    return;
  }

  const aiSlot = insightContainer.querySelector(".ai-insight-slot");
  if (aiSlot) {
    aiSlot.innerHTML = `<div class="insight-source ai-insight"><div class="empty-state">🤖 AI đang phân tích trận đấu…</div></div>`;
  }

  fetchMatchAiPrediction(match.id)
    .then((result) => {
      if (modalMatchId !== match.id) {
        return;
      }
      const slot = insightContainer.querySelector(".ai-insight-slot");
      if (slot) {
        slot.innerHTML = result.aiPrediction
          ? renderAiPredictionBlock(result.aiPrediction, predictionStats)
          : `<div class="insight-source ai-insight"><div class="empty-state">Chưa tạo được dự đoán AI cho trận này.</div></div>`;
      }
      const scoreSlot = insightContainer.querySelector(".bdp-exact-score-slot");
      if (scoreSlot && result.bongdaplusExactScore) {
        scoreSlot.innerHTML = renderBongdaplusExactScore(result.bongdaplusExactScore);
      }
    })
    .catch(() => {
      if (modalMatchId !== match.id) {
        return;
      }
      const slot = insightContainer.querySelector(".ai-insight-slot");
      if (slot) {
        slot.innerHTML = `<div class="insight-source ai-insight"><div class="empty-state">Chưa tạo được dự đoán AI cho trận này.</div></div>`;
      }
    });
}

function closeMatchTimelineModal() {
  matchModalElement?.classList.add("hidden");
}
