// Đọc phần "dự đoán tỉ số chính xác" trong ảnh bài nhận định bongdaplus bằng Gemini vision.
// On-demand theo trận, cache bền data/bongdaplus-score-cache.json (lưu cả kết quả rỗng).
// Không có GEMINI_API_KEY hoặc không có URL bài → no-op (trả null sạch).

const fs = require("node:fs/promises");
const path = require("node:path");

const storePath = path.join(__dirname, "data", "bongdaplus-score-cache.json");
const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_IMAGES = 3;
const MAX_TEXT_LEN = 500;

const store = { version: 1, matches: {} };
let loaded = false;
let saveTimer = null;
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
    // Cache chưa có hoặc hỏng → khởi tạo rỗng.
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fs.mkdir(path.dirname(storePath), { recursive: true });
      await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);
    } catch {
      // Lỗi ghi cache không được ảnh hưởng API.
    }
  }, 5000);
}

function getBongdaplusExactScore(matchId) {
  return store.matches[String(matchId)] || null;
}

function fetchWithTimeout(url, options = {}, ms = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return fetch(url, {
    ...options,
    signal: controller.signal,
    headers: { "user-agent": "LiveCup/1.0 (+local development)", ...(options.headers || {}) }
  }).finally(() => clearTimeout(timeout));
}

// Cắt phần "tin liên quan" cuối bài rồi lấy các ảnh CDN bongdaplus đầu tiên (graphic dự đoán
// nằm đầu bài, thumbnail tin liên quan nằm sau). Cap MAX_IMAGES để tiết kiệm payload/quota.
function extractArticleImages(html) {
  const relatedMarker = html.search(/tin\s+li[êe]n\s+quan|b[àa]i\s+vi[êe]t\s+kh[áa]c|news-relate/i);
  const scope = relatedMarker > 0 ? html.slice(0, relatedMarker) : html;
  const images = [];
  const pattern = /<img[^>]+src="(https:\/\/cdn\.bongdaplus\.vn\/[^"]+\.(?:jpg|jpeg|png))"/gi;
  let match;
  while ((match = pattern.exec(scope)) && images.length < MAX_IMAGES) {
    if (!images.includes(match[1])) {
      images.push(match[1]);
    }
  }
  return images;
}

async function imageToInlineData(url) {
  try {
    const response = await fetchWithTimeout(url, {}, 8000);
    if (!response.ok) {
      return null;
    }
    const mimeType = response.headers.get("content-type") || "image/jpeg";
    if (!/^image\//i.test(mimeType)) {
      return null;
    }
    const base64 = Buffer.from(await response.arrayBuffer()).toString("base64");
    return { inlineData: { mimeType, data: base64 } };
  } catch {
    return null;
  }
}

async function ocrViaGemini(imageParts) {
  const prompt = [
    "Các ảnh sau lấy từ một bài nhận định bóng đá tiếng Việt.",
    "Tìm bảng TỈ LỆ KÈO TỈ SỐ CHÍNH XÁC: một bảng liệt kê nhiều tỉ số (ví dụ 1-0, 2-1, 0-0) mỗi tỉ số kèm một con số tỉ lệ cược. Tỉ lệ càng THẤP nghĩa là tỉ số càng DỄ xảy ra.",
    "Nếu tìm thấy bảng này, trả về JSON {\"text\": \"...\"} với text là danh sách 5-6 tỉ số có tỉ lệ THẤP NHẤT (dễ xảy ra nhất), xếp từ thấp đến cao, định dạng: \"Tỉ số chính xác (tỉ lệ thấp = dễ xảy ra): 2-0 (5.7), 1-0 (7), ...\". Giữ nguyên tiếng Việt.",
    "Nếu KHÔNG có bảng tỉ số chính xác nào, trả về {\"text\": \"\"}. Chỉ trả JSON, không markdown."
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, ...imageParts] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    return String(parsed?.text || "").trim().slice(0, MAX_TEXT_LEN);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function runOcr(matchId, articleUrl) {
  const article = await fetchWithTimeout(articleUrl, {}, 8000).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  if (!article) {
    return null;
  }
  const imageUrls = extractArticleImages(article);
  if (!imageUrls.length) {
    return { text: "", sourceImages: [], generatedAt: new Date().toISOString() };
  }

  const imageParts = (await Promise.all(imageUrls.map(imageToInlineData))).filter(Boolean);
  if (!imageParts.length) {
    return { text: "", sourceImages: imageUrls, generatedAt: new Date().toISOString() };
  }

  const text = await ocrViaGemini(imageParts);
  if (text === null) {
    return null;
  }
  return { text, sourceImages: imageUrls, generatedAt: new Date().toISOString() };
}

// On-demand: trả cached (kể cả rỗng) nếu có; chưa + có key + có URL → OCR, cache, return.
async function ensureBongdaplusExactScore(matchId, articleUrl) {
  await loadStore();
  const cached = getBongdaplusExactScore(matchId);
  if (cached) {
    return cached;
  }
  if (!process.env.GEMINI_API_KEY || !articleUrl) {
    return null;
  }

  const key = String(matchId);
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const task = (async () => {
    const entry = await runOcr(key, articleUrl);
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

module.exports = { getBongdaplusExactScore, ensureBongdaplusExactScore };
