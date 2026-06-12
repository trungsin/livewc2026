// Worker sinh dự đoán AI (Gemini Flash) cho các trận đá trong 48h tới.
// Mỗi trận sinh đúng 1 lần, lưu bền data/ai-predictions.json; không có GEMINI_API_KEY thì no-op.

const fs = require("node:fs/promises");
const path = require("node:path");
const { displayTeamName } = require("./team-names-vietnamese.js");
const { buildMatchInsight } = require("./match-insight-builder.js");

const storePath = path.join(__dirname, "data", "ai-predictions.json");
const GEMINI_MODEL = "gemini-2.5-flash";
const KICKOFF_WINDOW_MS = 48 * 60 * 60 * 1000;
const CYCLE_MS = 30 * 60 * 1000;
const MAX_PER_CYCLE = 3;

const store = { version: 1, matches: {} };
let loaded = false;
let saveTimer = null;
let workerStarted = false;
let generating = false;
let getLiveContext = null;
let onPredictionGenerated = null;

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

function initAiPredictionWorker(options = {}) {
  getLiveContext = options.getLiveContext || null;
  onPredictionGenerated = options.onPredictionGenerated || null;
  if (workerStarted) {
    return;
  }
  workerStarted = true;
  setTimeout(runGenerationCycle, 60 * 1000).unref?.();
  setInterval(runGenerationCycle, CYCLE_MS).unref?.();
}

async function runGenerationCycle() {
  if (!process.env.GEMINI_API_KEY || generating || typeof getLiveContext !== "function") {
    return;
  }
  generating = true;
  try {
    const context = await getLiveContext();
    const matches = Array.isArray(context?.matches) ? context.matches : [];
    const now = Date.now();
    const candidates = matches.filter((match) => {
      if (match.status !== "upcoming" || getAiPrediction(match.id)) {
        return false;
      }
      const kickoff = Date.parse(match.kickoffUtc || "");
      return !Number.isNaN(kickoff) && kickoff > now && kickoff - now <= KICKOFF_WINDOW_MS;
    }).slice(0, MAX_PER_CYCLE);

    for (const match of candidates) {
      // Lấy kèo + tip mới nhất của riêng trận này làm dữ kiện cho prompt.
      const insight = await buildMatchInsight({ match }).catch(() => null);
      const entry = await generateForMatch(match, { ...context, insight });
      if (entry) {
        store.matches[match.id] = entry;
        scheduleSave();
        if (typeof onPredictionGenerated === "function") {
          await onPredictionGenerated(match, entry);
        }
      }
    }
  } catch {
    // Cycle lỗi thì chờ cycle sau, không crash server.
  } finally {
    generating = false;
  }
}

function recentResultsOf(teamName, matches) {
  return matches
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
    "Trả về DUY NHẤT một JSON object (không markdown) theo schema:",
    '{"analysis": "nhận định tiếng Việt khoảng 120-180 từ, GIỮ NGUYÊN tên đội như đề bài",',
    '"predictedScore": "X-Y" (X là bàn của đội nhà ' + match.home + '),',
    '"probs": {"home": 0.4, "draw": 0.3, "away": 0.3}, "confidence": 0.0-1.0}'
  );
  return lines.join("\n");
}

function validateAiOutput(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const analysis = String(parsed.analysis || "").trim();
  const predictedScore = String(parsed.predictedScore || "").trim();
  if (!analysis || !/^\d{1,2}-\d{1,2}$/.test(predictedScore)) {
    return null;
  }

  const rawProbs = parsed.probs || {};
  const home = Number(rawProbs.home);
  const draw = Number(rawProbs.draw);
  const away = Number(rawProbs.away);
  const total = home + draw + away;
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  return {
    analysis,
    predictedScore,
    probs: {
      home: Number((home / total).toFixed(4)),
      draw: Number((draw / total).toFixed(4)),
      away: Number((away / total).toFixed(4))
    },
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5))
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

loadStore();

module.exports = { initAiPredictionWorker, getAiPrediction };
