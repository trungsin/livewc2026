// Tổng hợp AI sau trận (chạy 1 lần khi trận FT): đối chiếu các dự đoán trước trận
// (Bongdaplus / AI / kèo) với tỉ số thật, sinh nhận xét tiếng Việt, lưu bền data/match-recaps.json.
// Phần đối chiếu đúng/sai tính bằng code (chắc chắn); Gemini chỉ viết lời tóm tắt.
// Thiếu GEMINI_API_KEY vẫn lưu được phần đối chiếu (summary rỗng).

const fs = require("node:fs/promises");
const path = require("node:path");
const { displayTeamName } = require("./team-names-vietnamese.js");

const storePath = path.join(__dirname, "data", "match-recaps.json");
const GEMINI_MODEL = "gemini-2.5-flash";

const store = { version: 1, matches: {} };
let loaded = false;
let loadPromise = null;
let saveTimer = null;
const inFlight = new Map();

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
        // Store chưa có hoặc hỏng → khởi tạo rỗng.
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

const ONE_X_TWO_LABEL = { home: "Đội nhà thắng", draw: "Hòa", away: "Đội khách thắng" };

function oneXTwoFromScore(score) {
  const m = String(score || "").match(/^(\d+)-(\d+)$/);
  if (!m) {
    return null;
  }
  const [home, away] = [Number(m[1]), Number(m[2])];
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
}

// Đối chiếu từng nguồn dự đoán với kết quả thật → mảng dòng so sánh (đúng tỉ số / đúng kết cục / sai).
function buildComparisons(entry, actualScore) {
  const actual1x2 = oneXTwoFromScore(actualScore);
  const preds = entry.predictions || {};
  const rows = [];

  const addScoreSource = (label, pred) => {
    if (!pred?.score) {
      return;
    }
    const scoreHit = pred.score === actualScore;
    const oneXTwoHit = Boolean(pred.oneXTwo && actual1x2 && pred.oneXTwo === actual1x2);
    rows.push({ label, predicted: pred.score, scoreHit, oneXTwoHit });
  };

  addScoreSource("AI", preds.ai);
  addScoreSource("Bongdaplus", preds.bongdaplus);

  if (preds.oddsImplied?.oneXTwo) {
    const oneXTwoHit = Boolean(actual1x2 && preds.oddsImplied.oneXTwo === actual1x2);
    rows.push({
      label: "Kèo (1X2)",
      predicted: ONE_X_TWO_LABEL[preds.oddsImplied.oneXTwo] || preds.oddsImplied.oneXTwo,
      scoreHit: null,
      oneXTwoHit
    });
  }
  return rows;
}

function buildPrompt(match, actualScore, comparisons, scorers) {
  const home = displayTeamName(match.home);
  const away = displayTeamName(match.away);
  const lines = [
    "Bạn là bình luận viên bóng đá. Viết tóm tắt ngắn sau trận World Cup 2026.",
    `Trận: ${home} vs ${away}, kết quả chung cuộc ${actualScore}.`
  ];
  if (scorers?.length) {
    lines.push("Người ghi bàn: " + scorers.map((s) => `${s.name} ${s.minute || ""}`.trim()).join(", ") + ".");
  }
  if (comparisons.length) {
    lines.push("Các dự đoán trước trận và kết quả đối chiếu:");
    for (const row of comparisons) {
      const verdict = row.scoreHit ? "đúng tỉ số" : (row.oneXTwoHit ? "đúng kết cục" : "sai");
      lines.push(`- ${row.label} dự đoán ${row.predicted} → ${verdict}.`);
    }
  }
  lines.push(
    "Viết 80-120 từ tiếng Việt: tóm tắt diễn biến chính rồi nhận xét dự đoán nào đúng/sai so với thực tế.",
    "Trả về DUY NHẤT JSON: {\"summary\": \"...\"} (không markdown)."
  );
  return lines.join("\n");
}

async function generateSummary(match, actualScore, comparisons, scorers) {
  if (!process.env.GEMINI_API_KEY) {
    return "";
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(match, actualScore, comparisons, scorers) }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    if (!response.ok) {
      return "";
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() || "";
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    return String(JSON.parse(cleaned)?.summary || "").trim();
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function getMatchRecap(matchId) {
  return store.matches[String(matchId)] || null;
}

// Sinh recap 1 lần cho trận đã FT. predictionEntry: snapshot từ prediction-accuracy-tracker.
// scorers: danh sách ghi bàn (tùy chọn) để lời tóm tắt sinh động hơn.
async function ensureMatchRecap(match, predictionEntry, scorers = []) {
  await loadStore();
  const key = String(match?.id || "");
  if (!key || match.status !== "finished") {
    return getMatchRecap(key);
  }
  const cached = getMatchRecap(key);
  if (cached) {
    return cached;
  }

  const actualScore = `${match.homeScore}-${match.awayScore}`;
  if (!/^\d+-\d+$/.test(actualScore)) {
    return null;
  }
  const comparisons = predictionEntry ? buildComparisons(predictionEntry, actualScore) : [];
  if (!comparisons.length && !process.env.GEMINI_API_KEY) {
    return null;
  }

  if (inFlight.has(key)) {
    return inFlight.get(key);
  }
  const task = (async () => {
    const summary = await generateSummary(match, actualScore, comparisons, scorers);
    const entry = { matchId: key, actualScore, comparisons, summary, model: summary ? GEMINI_MODEL : null, generatedAt: new Date().toISOString() };
    store.matches[key] = entry;
    scheduleSave();
    return entry;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, task);
  return task;
}

loadStore();

module.exports = { getMatchRecap, ensureMatchRecap };
