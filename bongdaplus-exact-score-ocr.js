// Đọc phần "dự đoán tỉ số chính xác" trong ảnh bài nhận định bongdaplus bằng Gemini vision.
// On-demand theo trận, cache bền data/bongdaplus-score-cache.json (lưu cả kết quả rỗng).
// Không có GEMINI_API_KEY hoặc không có URL bài → no-op (trả null sạch).

const fs = require("node:fs/promises");
const path = require("node:path");

const storePath = path.join(__dirname, "data", "bongdaplus-score-cache.json");
const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_IMAGES = 3;
const MAX_TEXT_LEN = 500;
// Bump khi đổi logic OCR/hướng tỉ số → entry version cũ tự coi là stale, OCR lại.
const OCR_SCHEMA_VERSION = 2;

const store = { version: 1, matches: {} };
let loadPromise = null;
let saveTimer = null;
const inFlight = new Map();

// Shared promise: nhiều request đồng thời cùng đợi 1 lần đọc cache xong (tránh race miss cache).
function loadStore() {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const data = JSON.parse(await fs.readFile(storePath, "utf8"));
        if (data && typeof data.matches === "object") {
          store.matches = data.matches;
        }
      } catch {
        // Cache chưa có hoặc hỏng → khởi tạo rỗng.
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
      // Lỗi ghi cache không được ảnh hưởng API.
    }
  }, 5000);
}

function getBongdaplusExactScore(matchId) {
  const entry = store.matches[String(matchId)];
  // Bỏ qua entry schema cũ (chưa đảo hướng tỉ số theo đội nhà/khách) → sẽ OCR lại.
  if (!entry || entry.schema !== OCR_SCHEMA_VERSION) {
    return null;
  }
  return entry;
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

async function ocrViaGemini(imageParts, teams) {
  const homeVi = teams?.home || "";
  const awayVi = teams?.away || "";
  const orientationLine = homeVi && awayVi
    ? `QUAN TRỌNG: đội nhà là "${homeVi}", đội khách là "${awayVi}". Trong ảnh thứ tự đội có thể NGƯỢC lại; hãy đọc xem tỉ số trong ảnh thuộc đội nào rồi đảo lại sao cho mỗi tỉ số "X-Y" có X là bàn của ĐỘI NHÀ (${homeVi}), Y là bàn của ĐỘI KHÁCH (${awayVi}).`
    : "";
  const prompt = [
    "Các ảnh sau lấy từ một bài nhận định bóng đá tiếng Việt.",
    "Tìm bảng TỈ LỆ KÈO TỈ SỐ CHÍNH XÁC: một bảng liệt kê nhiều tỉ số (ví dụ 1-0, 2-1, 0-0) mỗi tỉ số kèm một con số tỉ lệ cược. Tỉ lệ càng THẤP nghĩa là tỉ số càng DỄ xảy ra.",
    orientationLine,
    "Nếu tìm thấy bảng này, trả về JSON {\"text\": \"...\"} với text là danh sách 5-6 tỉ số có tỉ lệ THẤP NHẤT (dễ xảy ra nhất), xếp từ thấp đến cao, định dạng: \"Tỉ số chính xác (tỉ lệ thấp = dễ xảy ra): 2-0 (5.7), 1-0 (7), ...\". Giữ nguyên tiếng Việt.",
    "Nếu KHÔNG có bảng tỉ số chính xác nào, trả về {\"text\": \"\"}. Chỉ trả JSON, không markdown."
  ].filter(Boolean).join("\n");

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

function makeEntry(text, sourceImages) {
  return { text, sourceImages, schema: OCR_SCHEMA_VERSION, generatedAt: new Date().toISOString() };
}

async function runOcr(matchId, articleUrl, teams) {
  const article = await fetchWithTimeout(articleUrl, {}, 8000).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  if (!article) {
    return null;
  }
  const imageUrls = extractArticleImages(article);
  if (!imageUrls.length) {
    return makeEntry("", []);
  }

  const imageParts = (await Promise.all(imageUrls.map(imageToInlineData))).filter(Boolean);
  if (!imageParts.length) {
    return makeEntry("", imageUrls);
  }

  const text = await ocrViaGemini(imageParts, teams);
  if (text === null) {
    return null;
  }
  return makeEntry(text, imageUrls);
}

// On-demand: trả cached (kể cả rỗng) nếu có; chưa + có key + có URL → OCR, cache, return.
// teams = { home, away } tên tiếng Việt để đảo hướng tỉ số khớp lịch thi đấu.
async function ensureBongdaplusExactScore(matchId, articleUrl, teams = {}) {
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
    const entry = await runOcr(key, articleUrl, teams);
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
