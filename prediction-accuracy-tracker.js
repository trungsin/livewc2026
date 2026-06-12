// Theo dõi độ chính xác dự đoán trước trận bằng file bền, không chặn API live.

const fs = require("node:fs/promises");
const path = require("node:path");

const trackingPath = path.join(__dirname, "data", "prediction-tracking.json");
const data = { version: 1, matches: {} };
let loaded = false;
let loadPromise = null;
let saveTimer = null;

async function loadTracking() {
  if (loaded) {
    return;
  }
  if (loadPromise) {
    await loadPromise;
    return;
  }
  loadPromise = (async () => {
    try {
      const raw = await fs.readFile(trackingPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && parsed.matches && typeof parsed.matches === "object") {
        data.matches = parsed.matches;
      }
    } catch {
      // File chưa có hoặc hỏng thì khởi tạo rỗng để server vẫn chạy bình thường.
    } finally {
      loaded = true;
    }
  })();
  await loadPromise;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fs.mkdir(path.dirname(trackingPath), { recursive: true });
      await fs.writeFile(trackingPath, `${JSON.stringify(data, null, 2)}\n`);
    } catch {
      // Không để lỗi ghi tracking làm ảnh hưởng API live.
    }
  }, 5000);
  saveTimer.unref?.();
}

function normalizeScore(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  return match ? `${Number(match[1])}-${Number(match[2])}` : "";
}

function oneXTwoFromScore(score) {
  const normalized = normalizeScore(score);
  if (!normalized) {
    return null;
  }
  const [home, away] = normalized.split("-").map(Number);
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
}

function oneXTwoFromFavorite(favorite) {
  return ["home", "draw", "away"].includes(favorite) ? favorite : null;
}

function buildEmptyEntry(match) {
  return {
    kickoffUtc: match.kickoffUtc || "",
    predictions: {
      bongdaplus: null,
      oddsImplied: null
    },
    actual: null,
    scored: false
  };
}

function hasKickedOff(match) {
  const kickoffMs = Date.parse(match.kickoffUtc || "");
  return Number.isFinite(kickoffMs) && kickoffMs <= Date.now();
}

async function recordPrediction(match, insight = {}) {
  await loadTracking();
  if (!match?.id || match.status !== "upcoming" || hasKickedOff(match)) {
    return;
  }

  const prediction = insight.prediction || match.prediction || null;
  const bongdaplusScore = normalizeScore(prediction?.score);
  const bongdaplusOneXTwo = oneXTwoFromScore(bongdaplusScore);
  const oddsImpliedOneXTwo = oneXTwoFromFavorite(insight.oddsImplied?.favorite);
  const aiScore = normalizeScore(insight.aiPrediction?.predictedScore);
  const aiOneXTwo = oneXTwoFromScore(aiScore);

  if (!bongdaplusScore && !oddsImpliedOneXTwo && !aiScore) {
    return;
  }

  const entry = data.matches[match.id] || buildEmptyEntry(match);
  let changed = false;

  if (!data.matches[match.id]) {
    data.matches[match.id] = entry;
    changed = true;
  }

  if (!entry.kickoffUtc && match.kickoffUtc) {
    entry.kickoffUtc = match.kickoffUtc;
    changed = true;
  }

  if (!entry.predictions) {
    entry.predictions = { bongdaplus: null, oddsImplied: null };
    changed = true;
  }

  if (!entry.predictions.bongdaplus && bongdaplusScore) {
    entry.predictions.bongdaplus = {
      score: bongdaplusScore,
      oneXTwo: bongdaplusOneXTwo
    };
    changed = true;
  }

  if (!entry.predictions.oddsImplied && oddsImpliedOneXTwo) {
    entry.predictions.oddsImplied = {
      oneXTwo: oddsImpliedOneXTwo
    };
    changed = true;
  }

  if (!entry.predictions.ai && aiScore) {
    entry.predictions.ai = {
      score: aiScore,
      oneXTwo: aiOneXTwo
    };
    changed = true;
  }

  if (changed) {
    scheduleSave();
  }
}

function actualScore(match) {
  const homeScore = Number(match?.homeScore);
  const awayScore = Number(match?.awayScore);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
    return "";
  }
  return `${homeScore}-${awayScore}`;
}

async function scoreFinishedMatches(matches = []) {
  await loadTracking();
  let changed = false;

  for (const match of matches) {
    if (!match?.id || match.status !== "finished") {
      continue;
    }

    const entry = data.matches[match.id];
    if (!entry || entry.scored) {
      continue;
    }

    const hasSnapshot = entry.predictions?.bongdaplus || entry.predictions?.oddsImplied || entry.predictions?.ai;
    const finalScore = actualScore(match);
    if (!hasSnapshot || !finalScore) {
      continue;
    }

    entry.actual = finalScore;
    entry.scored = true;
    changed = true;
  }

  if (changed) {
    scheduleSave();
  }
}

function emptyStats() {
  return {
    bongdaplus: {
      score: { correct: 0, total: 0 },
      oneXTwo: { correct: 0, total: 0 }
    },
    oddsImplied: {
      oneXTwo: { correct: 0, total: 0 }
    },
    ai: {
      score: { correct: 0, total: 0 },
      oneXTwo: { correct: 0, total: 0 }
    }
  };
}

function getStats() {
  const stats = emptyStats();

  for (const entry of Object.values(data.matches || {})) {
    if (!entry?.scored || !entry.actual) {
      continue;
    }

    const actual = normalizeScore(entry.actual);
    const actualOneXTwo = oneXTwoFromScore(actual);
    const bongdaplus = entry.predictions?.bongdaplus;
    const oddsImplied = entry.predictions?.oddsImplied;

    if (bongdaplus?.score) {
      stats.bongdaplus.score.total += 1;
      if (normalizeScore(bongdaplus.score) === actual) {
        stats.bongdaplus.score.correct += 1;
      }
    }

    if (bongdaplus?.oneXTwo && actualOneXTwo) {
      stats.bongdaplus.oneXTwo.total += 1;
      if (bongdaplus.oneXTwo === actualOneXTwo) {
        stats.bongdaplus.oneXTwo.correct += 1;
      }
    }

    if (oddsImplied?.oneXTwo && actualOneXTwo) {
      stats.oddsImplied.oneXTwo.total += 1;
      if (oddsImplied.oneXTwo === actualOneXTwo) {
        stats.oddsImplied.oneXTwo.correct += 1;
      }
    }

    const ai = entry.predictions?.ai;
    if (ai?.score) {
      stats.ai.score.total += 1;
      if (normalizeScore(ai.score) === actual) {
        stats.ai.score.correct += 1;
      }
    }
    if (ai?.oneXTwo && actualOneXTwo) {
      stats.ai.oneXTwo.total += 1;
      if (ai.oneXTwo === actualOneXTwo) {
        stats.ai.oneXTwo.correct += 1;
      }
    }
  }

  return stats;
}

loadTracking();

module.exports = {
  recordPrediction,
  scoreFinishedMatches,
  getStats
};
