// Khối nhận định và kèo dùng chung trong modal trận đấu.

async function fetchMatchInsight(matchId) {
  const response = await fetch(`/api/match-insight?matchId=${encodeURIComponent(matchId)}`, { cache: "no-store" });
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

function renderBongdaplusInsight(prediction, predictionStats) {
  if (!prediction) {
    return "";
  }

  const badges = renderInsightBadges({
    bongdaplus: predictionStats?.bongdaplus
  });
  return `
    <div class="insight-source">
      <div class="insight-source-header">
        <h4>Nhận định Bongdaplus</h4>
        ${badges ? `<div class="prediction-badges">${badges}</div>` : ""}
      </div>
      ${prediction.tip || prediction.summary || prediction.title ? `<p class="insight-tip">${escapeHtml(prediction.tip || prediction.summary || prediction.title)}</p>` : ""}
      ${prediction.score ? `<p class="insight-score">Dự đoán tỉ số: <strong>${escapeHtml(prediction.score)}</strong></p>` : ""}
      ${prediction.url ? `<a class="text-link" href="${escapeHtml(prediction.url)}" target="_blank" rel="noreferrer">Bài gốc</a>` : ""}
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

function renderInsightSection(insight, predictionStats) {
  const predictionBlock = renderBongdaplusInsight(insight?.prediction, predictionStats);
  const oddsBlock = renderOddsTable(insight || {}, predictionStats);

  return `
    <section class="match-insight-section" aria-label="Nhận định và kèo">
      <div class="insight-section-header">
        <h3>Nhận định &amp; kèo</h3>
      </div>
      ${predictionBlock || oddsBlock ? `${predictionBlock}${oddsBlock}` : `<div class="empty-state">Chưa có dữ liệu nhận định cho trận này.</div>`}
      <p class="insight-disclaimer">Thông tin tham khảo, không phải khuyến nghị cá cược.</p>
    </section>
  `;
}
