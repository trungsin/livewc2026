// Fallback dịch câu bình luận lạ bằng Gemini Flash, có cache bền và không chặn response.

const fs = require("node:fs/promises");
const path = require("node:path");

const cachePath = path.join(__dirname, "data", "commentary-translation-cache.json");
// Bản lite: quota ngày cao, đủ tốt cho dịch câu ngắn.
const GEMINI_MODEL = "gemini-2.5-flash-lite";
const cache = new Map();
const pending = new Set();
let loaded = false;
let saveTimer = null;
let workerStarted = false;

async function loadCache() {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const data = JSON.parse(raw);
    for (const [source, translated] of Object.entries(data || {})) {
      if (source && translated) {
        cache.set(source, translated);
      }
    }
  } catch {
    // Cache chưa có hoặc hỏng thì bỏ qua, server vẫn chạy bình thường.
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, `${JSON.stringify(Object.fromEntries(cache), null, 2)}\n`);
    } catch {
      // Không để lỗi ghi cache làm ảnh hưởng API live.
    }
  }, 5000);
}

function translateViaCache(text) {
  const source = String(text || "").trim();
  if (!source) {
    return null;
  }
  const hit = cache.get(source);
  if (hit) {
    return hit;
  }
  if (process.env.GEMINI_API_KEY) {
    pending.add(source);
    startWorker();
  }
  return null;
}

function startWorker() {
  if (workerStarted) {
    return;
  }
  workerStarted = true;
  setInterval(processPendingBatch, 3000).unref?.();
}

async function processPendingBatch() {
  if (!process.env.GEMINI_API_KEY || !pending.size) {
    return;
  }
  const batch = [...pending].slice(0, 20);
  batch.forEach((item) => pending.delete(item));

  const translated = await requestGemini(batch);
  if (!translated) {
    return;
  }

  let changed = false;
  translated.forEach((value, index) => {
    if (typeof value === "string" && value.trim()) {
      cache.set(batch[index], value.trim());
      changed = true;
    }
  });
  if (changed) {
    scheduleSave();
  }
}

async function requestGemini(sentences) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: [
              "Dịch các câu bình luận bóng đá sau sang tiếng Việt.",
              "GIỮ NGUYÊN tên cầu thủ và tên đội.",
              "Chỉ trả về JSON array cùng số phần tử, không markdown.",
              JSON.stringify(sentences)
            ].join("\n")
          }]
        }]
      })
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) && parsed.length === sentences.length ? parsed : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

loadCache();
if (process.env.GEMINI_API_KEY) {
  startWorker();
}

module.exports = { translateViaCache };
