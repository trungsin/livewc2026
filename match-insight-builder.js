const { parseBongdaplusPredictionArticle } = require("./bongdaplus-predictions.js");

const ESPN_SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";

function fetchJson(name, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  return fetch(url, {
    signal: controller.signal,
    headers: { "user-agent": "LiveCup/1.0 (+local development)" }
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((data) => ({ name, ok: true, data }))
    .catch((error) => ({ name, ok: false, error: error.message }))
    .finally(() => clearTimeout(timeout));
}

function fetchText(name, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  return fetch(url, {
    signal: controller.signal,
    headers: { "user-agent": "LiveCup/1.0 (+local development)" }
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.text();
    })
    .then((data) => ({ name, ok: true, data }))
    .catch((error) => ({ name, ok: false, error: error.message }))
    .finally(() => clearTimeout(timeout));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(String(value).replace(/^\+/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function americanMoneylineToProb(moneyline) {
  const value = numberOrNull(moneyline);
  if (value === null || value === 0) {
    return null;
  }
  return value < 0 ? (-value) / (-value + 100) : 100 / (value + 100);
}

function buildOddsImplied(moneylines = {}) {
  const raw = {
    home: americanMoneylineToProb(moneylines.home),
    draw: americanMoneylineToProb(moneylines.draw),
    away: americanMoneylineToProb(moneylines.away)
  };
  const available = Object.entries(raw).filter(([, value]) => value !== null);
  const total = available.reduce((sum, [, value]) => sum + value, 0);
  if (!total) {
    return null;
  }

  const probs = { home: null, draw: null, away: null };
  let favorite = null;
  let bestProb = -1;
  for (const [key, value] of available) {
    const normalized = value / total;
    probs[key] = Number(normalized.toFixed(4));
    if (normalized > bestProb) {
      bestProb = normalized;
      favorite = key;
    }
  }

  return { favorite, probs };
}

function pickMoneyline(pick, side) {
  return numberOrNull(
    pick?.[`${side}TeamOdds`]?.moneyLine
    ?? pick?.moneyline?.[side]?.close?.odds
    ?? pick?.moneyline?.[side]?.open?.odds
  );
}

function extractEspnOdds(pick) {
  if (!pick) {
    return null;
  }

  return {
    provider: pick.provider?.name || "",
    details: pick.details || "",
    spread: numberOrNull(pick.spread),
    overUnder: numberOrNull(pick.overUnder),
    overOdds: numberOrNull(pick.overOdds ?? pick.total?.over?.close?.odds),
    underOdds: numberOrNull(pick.underOdds ?? pick.total?.under?.close?.odds),
    moneylines: {
      home: pickMoneyline(pick, "home"),
      draw: numberOrNull(pick.drawOdds?.moneyLine ?? pick.moneyline?.draw?.close?.odds ?? pick.moneyline?.draw?.open?.odds),
      away: pickMoneyline(pick, "away")
    }
  };
}

function hasAnyBongdaplusOdds(odds) {
  return Boolean(odds && (odds.asianHandicap || odds.europeanOdds || odds.overUnder));
}

function hasAnyBongdaplusAnalysis(analysis) {
  return Array.isArray(analysis) && analysis.length > 0;
}

async function refreshBongdaplusPrediction(prediction) {
  if (!prediction?.url || hasAnyBongdaplusOdds(prediction.odds) && hasAnyBongdaplusAnalysis(prediction.analysis)) {
    return prediction || null;
  }

  // Bài nhận định có thể cập nhật kèo/nhận định sau cache listing, nên thử nạp tươi khi thiếu dữ liệu.
  const article = await fetchText(`bongdaplus-article:${prediction.url}`, prediction.url);
  if (!article.ok) {
    return prediction;
  }

  return parseBongdaplusPredictionArticle(article.data, {
    url: prediction.url,
    title: prediction.title,
    listingTitle: prediction.title
  });
}

async function fetchEspnOdds(espnId) {
  if (!espnId) {
    return { espnOdds: null, oddsImplied: null };
  }

  const summary = await fetchJson("espn-summary", `${ESPN_SUMMARY_URL}?event=${encodeURIComponent(espnId)}`);
  if (!summary.ok) {
    return { espnOdds: null, oddsImplied: null };
  }

  const espnOdds = extractEspnOdds((summary.data.pickcenter || [])[0]);
  return {
    espnOdds,
    oddsImplied: espnOdds ? buildOddsImplied(espnOdds.moneylines) : null
  };
}

async function buildMatchInsight({ match, prediction = match?.prediction || null }) {
  const finalPrediction = await refreshBongdaplusPrediction(prediction);
  const { espnOdds, oddsImplied } = await fetchEspnOdds(match?.rawIds?.espn);

  return {
    prediction: finalPrediction,
    bongdaplusOdds: finalPrediction?.odds || null,
    espnOdds,
    oddsImplied
  };
}

module.exports = {
  buildMatchInsight,
  americanMoneylineToProb,
  buildOddsImplied,
  extractEspnOdds
};
