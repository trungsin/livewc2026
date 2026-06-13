// Render tường thuật trực tiếp kiểu bongdaplus: phút + nhãn sự kiện tiếng Việt + mô tả.
// Dùng chung cho panel Diễn biến (trang chủ) và modal timeline trận đấu.

const COMMENTARY_TYPE_LABELS = {
  "Goal": "VÀO!!!",
  "Goal - Header": "VÀO!!!",
  "Goal - Free-kick": "VÀO!!!",
  "Own Goal": "Phản lưới",
  "Penalty - Scored": "VÀO!!! (Pen)",
  "Penalty - Missed": "Hỏng pen",
  "Penalty - Saved": "Cản pen",
  "Yellow Card": "Thẻ vàng",
  "Red Card": "Thẻ đỏ",
  "Second Yellow Card": "Thẻ đỏ (2 vàng)",
  "Substitution": "Thay người",
  "Shot On Target": "Nguy hiểm",
  "Shot Off Target": "Không vào",
  "Shot Blocked": "Bị chặn",
  "Attempt Missed": "Không vào",
  "Attempt Saved": "Nguy hiểm",
  "Attempt Blocked": "Bị chặn",
  "Corner Awarded": "Phạt góc",
  "Offside": "Việt vị",
  "Foul": "Phạm lỗi",
  "Hand Ball": "Chạm tay",
  "Free Kick Won": "Đá phạt",
  "Penalty Awarded": "Phạt đền!",
  "Kickoff": "Bóng lăn",
  "Halftime": "Hết hiệp 1",
  "Start 2nd Half": "Hiệp 2",
  "End Regular Time": "Hết giờ",
  "Full Time": "FT",
  "Start Delay": "Tạm dừng",
  "End Delay": "Tiếp tục"
};

function commentaryLabel(entry) {
  if (entry.scoring) {
    return COMMENTARY_TYPE_LABELS[entry.type] || "VÀO!!!";
  }
  return COMMENTARY_TYPE_LABELS[entry.type] || "";
}

function commentaryLabelClass(entry) {
  if (entry.scoring || /^VÀO|Phản lưới/.test(commentaryLabel(entry))) {
    return "is-goal";
  }
  if (entry.type === "Yellow Card") {
    return "is-yellow";
  }
  if (/Red Card/.test(entry.type)) {
    return "is-red";
  }
  if (/Shot On Target|Attempt Saved|Penalty Awarded/.test(entry.type)) {
    return "is-danger";
  }
  return "";
}

function commentaryEntryHtml(entry) {
  const label = commentaryLabel(entry);
  return `
    <li class="commentary-item ${entry.scoring ? "is-scoring" : ""}">
      <span class="commentary-minute">${escapeHtml(entry.minute || "--")}</span>
      <div class="commentary-body">
        ${label ? `<span class="commentary-label ${commentaryLabelClass(entry)}">${entry.scoring ? "⚽ " : ""}${escapeHtml(label)}</span>` : ""}
        <p class="commentary-text">${escapeHtml(entry.text)}</p>
      </div>
    </li>
  `;
}

function renderCommentaryList(entries) {
  if (!entries.length) {
    return `<div class="empty-state">Chưa có diễn biến, tường thuật sẽ hiện khi có dữ liệu.</div>`;
  }
  return `<ul class="commentary-list">${entries.map(commentaryEntryHtml).join("")}</ul>`;
}

// Chấp nhận espnId dạng chuỗi (tường thuật live trang chủ) hoặc { espnId, matchId }.
// matchId dùng cho trận đã kết thúc → server trả bản diễn biến đã đóng băng (còn cả khi mất espnId).
async function fetchMatchTimeline(arg) {
  const { espnId = "", matchId = "" } = typeof arg === "object" && arg !== null ? arg : { espnId: arg };
  const params = new URLSearchParams();
  if (matchId) {
    params.set("matchId", matchId);
  }
  if (espnId) {
    params.set("espnId", espnId);
  }
  const response = await fetch(`/api/match-timeline?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.entries) ? payload.entries : [];
}
