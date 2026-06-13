// Khối nhận định và kèo dùng chung trong modal trận đấu.

async function fetchMatchInsight(matchId) {
  const response = await fetch(`/api/match-insight?matchId=${encodeURIComponent(matchId)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

// Sinh on-demand dự đoán AI 5 tỉ số + OCR tỉ số bongdaplus (chỉ trận sắp đá ≤48h).
async function fetchMatchAiPrediction(matchId) {
  const response = await fetch(`/api/match-ai-prediction?matchId=${encodeURIComponent(matchId)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function insightValue(value, fallback = "--") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function formatAmericanOdds(value) {
  if (value === null || value === undefined || value === "") {
    return "--";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  return number > 0 ? `+${number}` : String(number);
}

function formatImpliedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }
  return `${Math.round(number * 100)}%`;
}

function renderInsightBadges(predictionStats) {
  return [
    predictionStatsBadge(predictionStats, "bongdaplus", "oneXTwo"),
    predictionStatsBadge(predictionStats, "bongdaplus", "score"),
    predictionStatsBadge(predictionStats, "oddsImplied", "oneXTwo")
  ].filter(Boolean).join("");
}

function renderBongdaplusAnalysisSections(analysis) {
  if (!Array.isArray(analysis) || !analysis.length) {
    return "";
  }
  return analysis.map((section) => `
    <div class="insight-analysis-section">
      <h5>${escapeHtml(section.heading)}</h5>
      <p>${escapeHtml(section.text)}</p>
    </div>
  `).join("");
}

function renderBongdaplusInsight(prediction, predictionStats) {
  if (!prediction) {
    return "";
  }

  const badges = renderInsightBadges({
    bongdaplus: predictionStats?.bongdaplus
  });
  const analysisHtml = renderBongdaplusAnalysisSections(prediction.analysis);
  return `
    <div class="insight-source">
      <div class="insight-source-header">
        <h4>Nhận định Bongdaplus</h4>
        ${badges ? `<div class="prediction-badges">${badges}</div>` : ""}
      </div>
      ${analysisHtml || (prediction.tip || prediction.summary || prediction.title ? `<p class="insight-tip">${escapeHtml(prediction.tip || prediction.summary || prediction.title)}</p>` : "")}
      ${prediction.score ? `<p class="insight-score">Dự đoán tỉ số: <strong>${escapeHtml(prediction.score)}</strong></p>` : ""}
      <p class="insight-source-note">Nguồn: Bongdaplus</p>
    </div>
  `;
}

function renderAiScoreTable(scores) {
  if (!Array.isArray(scores) || !scores.length) {
    return "";
  }
  const rows = scores.map((item) => `
    <tr>
      <td class="ai-score-cell">${escapeHtml(item.score)}</td>
      <td>${escapeHtml(item.reason)}</td>
    </tr>
  `).join("");
  return `
    <table class="ai-score-table">
      <thead>
        <tr><th>Tỷ số dự đoán</th><th>Lý do</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderAiPredictionBlock(aiPrediction, predictionStats) {
  if (!aiPrediction) {
    return "";
  }

  const badges = [
    predictionStatsBadge(predictionStats, "ai", "score")
  ].filter(Boolean).join("");

  return `
    <div class="insight-source ai-insight">
      <div class="insight-source-header">
        <h4>🤖 Dự đoán AI</h4>
        ${badges ? `<div class="prediction-badges">${badges}</div>` : ""}
      </div>
      ${aiPrediction.analysis ? `<p class="insight-tip">${escapeHtml(aiPrediction.analysis)}</p>` : ""}
      ${renderAiScoreTable(aiPrediction.scores)}
    </div>
  `;
}

// Dự đoán tỉ số chính xác đọc từ ảnh bài Bongdaplus (Gemini vision OCR).
function renderBongdaplusExactScore(exactScore) {
  const text = exactScore?.text ? String(exactScore.text).trim() : "";
  if (!text) {
    return "";
  }
  return `
    <div class="bdp-exact-score">
      <h5>Bongdaplus dự đoán tỉ số chính xác</h5>
      <p>${escapeHtml(text)}</p>
      <p class="insight-source-note">Đọc từ ảnh bài Bongdaplus</p>
    </div>
  `;
}

function renderBongdaplusOddsRows(odds) {
  if (!odds || (!odds.asianHandicap && !odds.europeanOdds && !odds.overUnder)) {
    return "";
  }

  return `
    <tr>
      <td>Bongdaplus</td>
      <td>Kèo châu Á</td>
      <td>${escapeHtml(insightValue(odds.asianHandicap))}</td>
    </tr>
    <tr>
      <td>Bongdaplus</td>
      <td>Kèo châu Âu</td>
      <td>${escapeHtml(insightValue(odds.europeanOdds))}</td>
    </tr>
    <tr>
      <td>Bongdaplus</td>
      <td>Tài xỉu</td>
      <td>${escapeHtml(insightValue(odds.overUnder))}</td>
    </tr>
  `;
}

function renderEspnOddsRows(espnOdds, oddsImplied, predictionStats) {
  if (!espnOdds && !oddsImplied) {
    return "";
  }

  const provider = insightValue(espnOdds?.provider, "DraftKings");
  const implied = oddsImplied?.probs || {};
  const oddsBadge = predictionStatsBadge(predictionStats, "oddsImplied", "oneXTwo");
  const impliedText = [
    `Chủ: ${formatImpliedPercent(implied.home)}`,
    `Hòa: ${formatImpliedPercent(implied.draw)}`,
    `Khách: ${formatImpliedPercent(implied.away)}`
  ].join(" · ");

  return `
    ${espnOdds ? `
      <tr>
        <td>${escapeHtml(provider)}</td>
        <td>Kèo chấp</td>
        <td>${escapeHtml(insightValue(espnOdds.details || espnOdds.spread))}</td>
      </tr>
      <tr>
        <td>${escapeHtml(provider)}</td>
        <td>Tài xỉu</td>
        <td>O/U ${escapeHtml(insightValue(espnOdds.overUnder))} · Tài ${escapeHtml(formatAmericanOdds(espnOdds.overOdds))} · Xỉu ${escapeHtml(formatAmericanOdds(espnOdds.underOdds))}</td>
      </tr>
    ` : ""}
    ${oddsImplied ? `
      <tr>
        <td>${escapeHtml(provider)}</td>
        <td>1X2 implied ${oddsBadge ? `<span class="prediction-badges inline">${oddsBadge}</span>` : ""}</td>
        <td>${escapeHtml(impliedText)}</td>
      </tr>
    ` : ""}
  `;
}

function renderOddsTable(insight, predictionStats) {
  const rows = [
    renderBongdaplusOddsRows(insight?.bongdaplusOdds),
    renderEspnOddsRows(insight?.espnOdds, insight?.oddsImplied, predictionStats)
  ].filter(Boolean).join("");

  if (!rows) {
    return "";
  }

  return `
    <div class="odds-table-wrap">
      <table class="odds-table">
        <thead>
          <tr>
            <th>Nguồn</th>
            <th>Loại kèo</th>
            <th>Thông tin</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderInsightSection(insight, predictionStats, match = null) {
  const aiBlock = renderAiPredictionBlock(insight?.aiPrediction, predictionStats);
  const predictionBlock = renderBongdaplusInsight(insight?.prediction, predictionStats);
  const oddsBlock = renderOddsTable(insight || {}, predictionStats);
  const exactScoreBlock = renderBongdaplusExactScore(insight?.bongdaplusExactScore);
  const hasContent = aiBlock || predictionBlock || oddsBlock || exactScoreBlock;

  // Slot có class cố định để modal fill AI/OCR on-demand tại chỗ khi endpoint trả về.
  return `
    <section class="match-insight-section" aria-label="Nhận định và kèo">
      <div class="insight-section-header">
        <h3>Nhận định &amp; kèo</h3>
      </div>
      <div class="ai-insight-slot">${aiBlock}</div>
      ${predictionBlock}
      ${oddsBlock}
      <div class="bdp-exact-score-slot">${exactScoreBlock}</div>
      ${hasContent ? "" : `<div class="empty-state">Chưa có dữ liệu nhận định cho trận này.</div>`}
      <p class="insight-disclaimer">Thông tin tham khảo, không phải khuyến nghị cá cược.</p>
    </section>
  `;
}
