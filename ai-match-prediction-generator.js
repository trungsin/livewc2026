// Dự đoán AI (Gemini Flash) cho trận sắp đá: sinh on-demand khi người dùng mở trận
// upcoming trong 48h tới, lưu bền data/ai-predictions.json, lần sau dùng lại.
// Không có GEMINI_API_KEY thì no-op (trả null sạch).

const fs = require("node:fs/promises");
const path = require("node:path");
const { displayTeamName } = require("./team-names-vietnamese.js");

const storePath = path.join(__dirname, "data", "ai-predictions.json");
const GEMINI_MODEL = "gemini-2.5-flash";
const KICKOFF_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_SCORES = 5;

const store = { version: 1, matches: {} };
let loaded = false;
let saveTimer = null;
// Chống sinh trùng khi nhiều request cùng tới cho một trận.
const inFlight = new Map();

async function loadStore() {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    const data = JSON.parse(await fs.readFile(storePath, "utf8"));
    if (data && typeof data.matches === "object") {
      store.matches = data.matches;
    }
  } catch {
    // Store chưa có hoặc hỏng → khởi tạo rỗng, server vẫn chạy bình thường.
  }
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
}

function getAiPrediction(matchId) {
  return store.matches[String(matchId)] || null;
}

function recentResultsOf(teamName, matches) {
  return (matches || [])
    .filter((match) => match.status === "finished" && (match.home === teamName || match.away === teamName))
    .slice(-3)
    .map((match) => `${match.home} ${match.homeScore}-${match.awayScore} ${match.away}`);
}

function standingsRowsOf(match, standings) {
  const rows = [];
  for (const group of standings || []) {
    for (const row of group.rows || []) {
      if (row.team === match.home || row.team === match.away) {
        rows.push(`Bảng ${group.group}: ${row.team} — ${row.played} trận, ${row.points} điểm, hiệu số ${row.diff}`);
      }
    }
  }
  return rows;
}

function buildPrompt(match, context) {
  const homeVi = displayTeamName(match.home);
  const awayVi = displayTeamName(match.away);
  const lines = [
    "Bạn là chuyên gia phân tích bóng đá. Dự đoán trận World Cup 2026 sau:",
    `Trận: ${match.home} (${homeVi}) vs ${match.away} (${awayVi}), bảng ${match.group || "?"}, sân ${match.stadium || "?"}.`
  ];

  const standingsRows = standingsRowsOf(match, context.standings);
  if (standingsRows.length) {
    lines.push("Bảng xếp hạng hiện tại:", ...standingsRows);
  }
  const homeResults = recentResultsOf(match.home, context.matches);
  const awayResults = recentResultsOf(match.away, context.matches);
  if (homeResults.length || awayResults.length) {
    lines.push("Kết quả gần đây:", ...homeResults, ...awayResults);
  }
  if (context.insight?.espnOdds) {
    const odds = context.insight.espnOdds;
    lines.push(`Kèo ${odds.provider}: chấp ${odds.details || odds.spread}, tài xỉu ${odds.overUnder}.`);
  }
  if (context.insight?.oddsImplied?.probs) {
    const probs = context.insight.oddsImplied.probs;
    lines.push(`Xác suất từ kèo: chủ nhà ${probs.home}, hòa ${probs.draw}, khách ${probs.away}.`);
  }
  if (context.insight?.prediction?.tip) {
    lines.push(`Nhận định báo chí: ${context.insight.prediction.tip.slice(0, 300)}`);
  }

  lines.push(
    "Dựa vào phong độ hiện tại, dự đoán 5 tỉ số CÓ THỂ XẢY RA, xếp theo khả năng giảm dần.",
    "Trả về DUY NHẤT một JSON object (không markdown) theo schema:",
    '{"analysis": "nhận định tiếng Việt khoảng 120-180 từ, GIỮ NGUYÊN tên đội như đề bài",',
    `"scores": [{"score": "X-Y", "reason": "lý do ngắn tiếng Việt"} ... đúng 5 phần tử, X là bàn của đội nhà ${match.home}, xếp khả năng giảm dần]}`
  );
  return lines.join("\n");
}

function validateAiOutput(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const analysis = String(parsed.analysis || "").trim();
  if (!analysis || !Array.isArray(parsed.scores)) {
    return null;
  }

  const scores = [];
  for (const item of parsed.scores) {
    const score = String(item?.score || "").replace(/\s+/g, "").trim();
    const reason = String(item?.reason || "").trim();
    if (/^\d{1,2}-\d{1,2}$/.test(score) && reason) {
      scores.push({ score, reason });
    }
    if (scores.length >= MAX_SCORES) {
      break;
    }
  }
  if (!scores.length) {
    return null;
  }

  return {
    analysis,
    scores,
    predictedScore: scores[0].score
  };
}

async function generateForMatch(match, context) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(match, context) }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const validated = validateAiOutput(JSON.parse(cleaned));
    if (!validated) {
      return null;
    }
    return {
      ...validated,
      model: GEMINI_MODEL,
      generatedAt: new Date().toISOString()
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isWithinPredictionWindow(match) {
  if (!match || match.status !== "upcoming") {
    return false;
  }
  const kickoff = Date.parse(match.kickoffUtc || "");
  const now = Date.now();
  return !Number.isNaN(kickoff) && kickoff > now && kickoff - now <= KICKOFF_WINDOW_MS;
}

// Sinh on-demand: trả cached nếu có; nếu chưa + đủ điều kiện + có key → gọi Gemini,
// lưu store, trả entry. Thiếu key / ngoài cửa sổ 48h / không phải trận sắp đá → null.
async function ensureAiPrediction(match, context = {}) {
  await loadStore();
  const cached = getAiPrediction(match?.id);
  if (cached) {
    return cached;
  }
  if (!process.env.GEMINI_API_KEY || !isWithinPredictionWindow(match)) {
    return null;
  }

  const key = String(match.id);
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const task = (async () => {
    const entry = await generateForMatch(match, context);
    if (entry) {
      store.matches[key] = entry;
      scheduleSave();
    }
    return entry;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, task);
  return task;
}

loadStore();

module.exports = { getAiPrediction, ensureAiPrediction };
