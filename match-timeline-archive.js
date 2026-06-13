// Đóng băng diễn biến (commentary) trận đã kết thúc, lưu bền data/match-timelines.json theo matchId.
// Dữ liệu lấy từ ESPN summary mà stats worker đã fetch sẵn (không fetch thêm lần nữa) rồi dịch 1 lần.
// Sau khi đóng băng, timeline trận đó KHÔNG fetch lại nữa — tránh poll làm mất/đổi nội dung khi đã xong,
// và giữ được diễn biến kể cả khi trận đã rớt khỏi ESPN scoreboard (mất rawIds.espn).

const fs = require("node:fs/promises");
const path = require("node:path");

const storePath = path.join(__dirname, "data", "match-timelines.json");

const store = { version: 1, matches: {} };
let loaded = false;
let loadPromise = null;
let saveTimer = null;

function loadStore() {
  if (loaded) {
    return Promise.resolve();
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const data = JSON.parse(await fs.readFile(storePath, "utf8"));
        if (data && typeof data.matches === "object") {
          store.matches = data.matches;
        }
      } catch {
        // Store chưa có hoặc hỏng → khởi tạo rỗng, server vẫn chạy bình thường.
      } finally {
        loaded = true;
      }
    })();
  }
  return loadPromise;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fs.mkdir(path.dirname(storePath), { recursive: true });
      await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);
    } catch {
      // Lỗi ghi store không được ảnh hưởng API.
    }
  }, 5000);
  saveTimer.unref?.();
}

function getArchivedTimeline(matchId) {
  const entry = store.matches[String(matchId)];
  return entry && Array.isArray(entry.entries) && entry.entries.length ? entry.entries : null;
}

// Đóng băng từ mảng commentary ESPN có sẵn (idempotent). translate: hàm dịch text commentary.
function archiveFromSummary(matchId, espnId, commentary, translate) {
  const key = String(matchId);
  if (getArchivedTimeline(key) || !Array.isArray(commentary) || !commentary.length) {
    return;
  }
  // Mới nhất lên đầu, giống trang tường thuật trực tiếp.
  const entries = commentary.map((item) => ({
    minute: item.time?.displayValue || "",
    type: item.play?.type?.text || "",
    text: typeof translate === "function" ? translate(item.text) : String(item.text || ""),
    scoring: Boolean(item.play?.scoringPlay)
  })).reverse();

  store.matches[key] = { matchId: key, espnId: String(espnId || ""), entries, archivedAt: new Date().toISOString() };
  scheduleSave();
}

loadStore();

module.exports = { loadStore, getArchivedTimeline, archiveFromSummary };
