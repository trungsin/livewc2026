const { displayTeamName } = require("./team-names-vietnamese.js");

const BONGDAPLUS_PREDICTIONS_URL = "https://bongdaplus.vn/nhan-dinh-bong-da-tags";
const cache = new Map();

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

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function decodeOddsHtmlEntities(value) {
  const named = {
    aacute: "á",
    agrave: "à",
    acirc: "â",
    atilde: "ã",
    eacute: "é",
    egrave: "è",
    ecirc: "ê",
    iacute: "í",
    igrave: "ì",
    itilde: "ĩ",
    oacute: "ó",
    ograve: "ò",
    ocirc: "ô",
    otilde: "õ",
    uacute: "ú",
    ugrave: "ù",
    utilde: "ũ",
    yacute: "ý",
    ytilde: "ỹ",
    Aacute: "Á",
    Agrave: "À",
    Acirc: "Â",
    Atilde: "Ã",
    Eacute: "É",
    Egrave: "È",
    Ecirc: "Ê",
    Iacute: "Í",
    Igrave: "Ì",
    Itilde: "Ĩ",
    Oacute: "Ó",
    Ograve: "Ò",
    Ocirc: "Ô",
    Otilde: "Õ",
    Uacute: "Ú",
    Ugrave: "Ù",
    Utilde: "Ũ",
    Yacute: "Ý",
    Ytilde: "Ỹ",
    ndash: "-",
    mdash: "-",
    hellip: "…",
    lsquo: "'",
    rsquo: "'",
    ldquo: "\"",
    rdquo: "\""
  };

  return decodeHtmlEntities(value).replace(/&([A-Za-z]+);/g, (entity, name) => named[name] || entity);
}

function stripHtmlTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function collapseSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function foldLooseText(value) {
  return collapseSpaces(decodeHtmlEntities(value))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function vnDayKey(isoValue) {
  if (!isoValue) {
    return "unknown";
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(date);
}

function parseBongdaplusListingTitle(value) {
  const text = collapseSpaces(decodeHtmlEntities(stripHtmlTags(value)));
  const match = text.match(/^(\d{1,2})h(\d{2}) ngày (\d{1,2})\/(\d{1,2}):\s*(.+?)\s+vs\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const [, hour, minute, day, month, home, away] = match;
  return {
    title: text,
    timeKey: `${hour.padStart(2, "0")}:${minute}`,
    dateKey: `${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
    home: collapseSpaces(home),
    away: collapseSpaces(away),
    searchKey: foldLooseText(text)
  };
}

function parseBongdaplusPredictionListings(html) {
  const items = [];
  const blocks = String(html || "").match(/<li class="news">[\s\S]*?<\/li>/g) || [];
  for (const block of blocks) {
    if (!/\/world-cup\/nhan-dinh-bong-da-/i.test(block)) {
      continue;
    }
    const href = decodeHtmlEntities((block.match(/<a class="title" href="([^"]+)">/i) || [])[1] || "");
    const title = decodeHtmlEntities((block.match(/<a class="title" href="[^"]+">\s*([\s\S]*?)\s*<\/a>/i) || [])[1] || "");
    const fullTitle = decodeHtmlEntities((block.match(/<a class="thumb"[^>]*><img alt="([^"]+)"/i) || [])[1] || "");
    const parsed = parseBongdaplusListingTitle(title);
    if (!href || !parsed) {
      continue;
    }
    items.push({
      url: new URL(href, BONGDAPLUS_PREDICTIONS_URL).toString(),
      title: fullTitle || `Nhận định bóng đá ${parsed.home} vs ${parsed.away}`,
      listingTitle: parsed.title,
      dateKey: parsed.dateKey,
      timeKey: parsed.timeKey,
      home: parsed.home,
      away: parsed.away,
      searchKey: parsed.searchKey,
      matchKey: `${parsed.dateKey}::${parsed.searchKey}`
    });
  }
  return items;
}

function defaultOdds() {
  return {
    asianHandicap: null,
    europeanOdds: null,
    overUnder: null
  };
}

function textFromHtml(value) {
  return collapseSpaces(decodeOddsHtmlEntities(stripHtmlTags(value)));
}

function extractPostContent(html) {
  const source = String(html || "");
  const content = (source.match(/<div id="postContent"[^>]*>([\s\S]*?)(?:<div class="clx"><\/div>|<div class="editor"|<div class="hash-tags"|<\/main>)/i) || [])[1];
  if (content) {
    return content;
  }

  const start = source.search(/<div id="postContent"[^>]*>/i);
  return start >= 0 ? source.slice(start) : "";
}

function sectionTextAfterOddsHeading(content) {
  const headingPattern = /<(h[2-4])[^>]*>[\s\S]*?<\/\1>/gi;
  let headingMatch;
  while ((headingMatch = headingPattern.exec(content))) {
    const headingKey = foldLooseText(decodeOddsHtmlEntities(stripHtmlTags(headingMatch[0])));
    if (headingKey.includes("tylekeo") || headingKey.includes("tilekeo") || headingKey.includes("thongtinkeo")) {
      const rest = content.slice(headingMatch.index + headingMatch[0].length);
      const sectionHtml = (rest.match(/^([\s\S]*?)(?=<h[2-4][^>]*>|<div class="(?:editor|hash-tags|clx)")/i) || [])[1] || rest;
      return textFromHtml(sectionHtml);
    }
  }

  return "";
}

function valueAfterLabel(text, labels) {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const nextLabel = "Kèo châu Á|Châu Á|Kèo châu Âu|Châu Âu|Tài xỉu|Tổng bàn thắng|Over/Under|OU";
  const match = text.match(new RegExp(`(?:${escapedLabels})\\s*[:：-]\\s*(.*?)(?=(?:${nextLabel})\\s*[:：-]|$)`, "i"));
  return match ? collapseSpaces(match[1]) || null : null;
}

function parseBongdaplusOdds(html) {
  try {
    const content = extractPostContent(html);
    const sectionText = sectionTextAfterOddsHeading(content);
    if (!sectionText) {
      return defaultOdds();
    }

    return {
      asianHandicap: valueAfterLabel(sectionText, ["Kèo châu Á", "Châu Á"]),
      europeanOdds: valueAfterLabel(sectionText, ["Kèo châu Âu", "Châu Âu"]),
      overUnder: valueAfterLabel(sectionText, ["Tài xỉu", "Tổng bàn thắng", "Over/Under", "OU"])
    };
  } catch (error) {
    return defaultOdds();
  }
}

const BONGDAPLUS_ANALYSIS_HEADINGS = [
  { key: "phantichphongdo", label: "Phân tích phong độ" },
  { key: "thongtinlucluong", label: "Thông tin lực lượng" },
  { key: "doihinhdukien", label: "Đội hình dự kiến" },
  { key: "phantichdulieuchuyensau", label: "Phân tích dữ liệu chuyên sâu" },
  { key: "bongdaplusdudoantyso", label: "BONGDAPLUS dự đoán tỷ số" },
  { key: "bongdaplusdudoantiso", label: "BONGDAPLUS dự đoán tỷ số" },
  { key: "dudoantyso", label: "BONGDAPLUS dự đoán tỷ số" },
  { key: "dudoantiso", label: "BONGDAPLUS dự đoán tỷ số" }
];

function normalizeBongdaplusHeading(value) {
  const key = foldLooseText(decodeOddsHtmlEntities(stripHtmlTags(value)));
  return BONGDAPLUS_ANALYSIS_HEADINGS.find((heading) => key.includes(heading.key)) || null;
}

function truncateAtSentenceBoundary(value, maxLength = 600) {
  const text = collapseSpaces(value);
  if (text.length <= maxLength) {
    return text;
  }

  const limit = Math.max(1, maxLength - 1);
  const slice = text.slice(0, limit);
  const boundary = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("; ")
  );
  const trimmed = (boundary >= 180 ? slice.slice(0, boundary + 1) : slice).trim();
  return `${trimmed}…`;
}

function parseBongdaplusAnalysisSections(html) {
  try {
    const content = extractPostContent(html);
    if (!content) {
      return [];
    }

    const headings = [];
    const headingPattern = /<(h[2-4])[^>]*>[\s\S]*?<\/\1>|<strong[^>]*>[\s\S]*?<\/strong>/gi;
    let headingMatch;
    while ((headingMatch = headingPattern.exec(content))) {
      const normalized = normalizeBongdaplusHeading(headingMatch[0]);
      if (!normalized) {
        continue;
      }
      headings.push({
        index: headingMatch.index,
        end: headingMatch.index + headingMatch[0].length,
        heading: normalized.label
      });
    }

    const sections = [];
    const seen = new Set();
    for (let index = 0; index < headings.length; index += 1) {
      const current = headings[index];
      if (seen.has(current.heading)) {
        continue;
      }
      const next = headings[index + 1];
      const sectionHtml = content.slice(current.end, next ? next.index : content.length);
      const text = truncateAtSentenceBoundary(textFromHtml(sectionHtml));
      if (!text) {
        continue;
      }
      seen.add(current.heading);
      sections.push({ heading: current.heading, text });
    }

    return sections;
  } catch (error) {
    return [];
  }
}

function parseBongdaplusPredictionArticle(html, item) {
  const title = decodeHtmlEntities((String(html || "").match(/<h1>([\s\S]*?)<\/h1>/i) || [])[1] || item.title || item.listingTitle || "");
  const summary = decodeHtmlEntities(
    (String(html || "").match(/<div class="summary bdr"><b>([\s\S]*?)<\/b>/i) || [])[1]
    || (String(html || "").match(/<meta property="og:description" content="([^"]+)"/i) || [])[1]
    || ""
  );
  const text = collapseSpaces(decodeHtmlEntities(stripHtmlTags(html)));
  const sectionStart = text.indexOf("BONGDAPLUS dự đoán tỉ số");
  let tip = summary;
  let score = "";

  if (sectionStart >= 0) {
    const section = text.slice(sectionStart);
    const scoreMatch = section.match(/Dự đoán:\s*([0-9]{1,2}\s*-\s*[0-9]{1,2})/i);
    if (scoreMatch) {
      score = scoreMatch[1].replace(/\s+/g, "");
    }
    const tipText = section
      .split(/Dự đoán:/i)[0]
      .replace(/^BONGDAPLUS dự đoán tỉ số[^.]*\.?\s*/i, "")
      .trim();
    if (tipText) {
      tip = tipText;
    }
  }

  return {
    source: "bongdaplus",
    url: item.url,
    title,
    summary,
    tip,
    score,
    odds: parseBongdaplusOdds(html),
    analysis: parseBongdaplusAnalysisSections(html)
  };
}

function matchPredictionItem(match, items) {
  const dayKey = vnDayKey(match.kickoffUtc);
  const matchDateKey = dayKey === "unknown" ? "" : dayKey.slice(5);
  const homeName = foldLooseText(displayTeamName(match.home));
  const awayName = foldLooseText(displayTeamName(match.away));
  const reverseKey = `${matchDateKey}::${awayName}${homeName}`;
  const forwardKey = `${matchDateKey}::${homeName}${awayName}`;

  return items.find((item) => {
    if (item.dateKey !== matchDateKey) {
      return false;
    }
    const key = item.searchKey;
    return key.includes(homeName) && key.includes(awayName) || item.matchKey === forwardKey || item.matchKey === reverseKey;
  }) || null;
}

async function buildBongdaplusPredictions(matches) {
  const cacheKey = "bongdaplus-predictions";
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.createdAt < 6 * 60 * 60 * 1000) {
    return cached.payload;
  }

  const listing = await fetchText("bongdaplus-listing", BONGDAPLUS_PREDICTIONS_URL);
  if (!listing.ok) {
    return new Map();
  }

  const items = parseBongdaplusPredictionListings(listing.data);
  const matchedItems = new Map();
  const matchedKeys = new Map();

  for (const match of matches) {
    const item = matchPredictionItem(match, items);
    if (!item) {
      continue;
    }
    matchedItems.set(item.url, item);
    matchedKeys.set(match.id, item.url);
  }

  const predictionsByUrl = new Map();
  await Promise.all([...matchedItems.values()].map(async (item) => {
    const article = await fetchText(`bongdaplus-article:${item.url}`, item.url);
    if (!article.ok) {
      return;
    }
    predictionsByUrl.set(item.url, parseBongdaplusPredictionArticle(article.data, item));
  }));

  const predictionsByMatchId = new Map();
  for (const [matchId, url] of matchedKeys.entries()) {
    const prediction = predictionsByUrl.get(url);
    if (prediction) {
      predictionsByMatchId.set(matchId, prediction);
    }
  }

  cache.set(cacheKey, { createdAt: now, payload: predictionsByMatchId });
  return predictionsByMatchId;
}

module.exports = {
  buildBongdaplusPredictions,
  parseBongdaplusAnalysisSections,
  parseBongdaplusOdds,
  parseBongdaplusPredictionArticle,
  parseBongdaplusPredictionListings,
  parseBongdaplusListingTitle,
  matchPredictionItem
};
