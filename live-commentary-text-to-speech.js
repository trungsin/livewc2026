// Đọc to sự kiện chính của trận live bằng Web Speech API (giọng vi-VN, client-side).
// Bật/tắt theo từng trận qua nút 🔊 trên match card; chỉ 1 trận được nghe tại một thời điểm.
// Dùng chung commentaryLabel từ live-commentary-renderer.js.

const liveSpeech = {
  matchId: null,
  seenKeys: new Set(),
  primed: false
};

// Sự kiện chính được đọc (ngoài entry.scoring): tình huống bước ngoặt + mốc hiệp đấu.
const LIVE_SPEECH_KEY_TYPES = new Set([
  "Penalty Awarded",
  "Penalty - Missed",
  "Penalty - Saved",
  "Red Card",
  "Second Yellow Card",
  "Kickoff",
  "Halftime",
  "Start 2nd Half",
  "End Regular Time",
  "Full Time"
]);

function speechSynthesisAvailable() {
  return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
}

// Chrome load danh sách voice bất đồng bộ: getVoices() có thể rỗng lúc đầu,
// nên cache lại khi voiceschanged bắn và re-check mỗi lần toggle.
let cachedVietnameseVoice = null;

function findVietnameseVoice() {
  if (!speechSynthesisAvailable()) {
    return null;
  }
  if (cachedVietnameseVoice) {
    return cachedVietnameseVoice;
  }
  cachedVietnameseVoice = speechSynthesis.getVoices()
    .find((voice) => /^vi([-_]|$)/i.test(voice.lang)) || null;
  return cachedVietnameseVoice;
}

if (typeof speechSynthesis !== "undefined" && typeof speechSynthesis.addEventListener === "function") {
  speechSynthesis.addEventListener("voiceschanged", () => {
    cachedVietnameseVoice = null;
    findVietnameseVoice();
  });
}

function liveSpeechActiveMatchId() {
  return liveSpeech.matchId;
}

// Ngừng nhận entry mới nhưng để câu đang đọc/đã xếp hàng đọc nốt
// (dùng khi trận kết thúc tự nhiên — không cắt ngang câu thông báo bàn thắng/FT).
function releaseLiveSpeech() {
  liveSpeech.matchId = null;
  liveSpeech.seenKeys.clear();
  liveSpeech.primed = false;
}

// Tắt hẳn: dừng nhận entry + cắt ngay hàng đợi đọc (user chủ động tắt/chuyển trận).
function stopLiveSpeech() {
  releaseLiveSpeech();
  if (speechSynthesisAvailable()) {
    speechSynthesis.cancel();
  }
}

// Bật nghe trận matchId / tắt nếu đang nghe chính nó / chuyển nếu đang nghe trận khác.
// Trả về { active, reason } — active là trạng thái sau toggle, reason chỉ có khi từ chối bật.
// matchId lưu dạng string để khớp với dataset attribute từ DOM.
function toggleLiveSpeech(matchId) {
  if (liveSpeech.matchId === String(matchId)) {
    stopLiveSpeech();
    return { active: false };
  }
  if (!speechSynthesisAvailable()) {
    return { active: false, reason: "Trình duyệt không hỗ trợ đọc giọng nói." };
  }
  if (!findVietnameseVoice()) {
    return { active: false, reason: "Thiết bị không có giọng đọc tiếng Việt." };
  }
  stopLiveSpeech();
  liveSpeech.matchId = String(matchId);
  return { active: true };
}

function liveSpeechEntryKey(entry) {
  return `${entry.minute || ""}|${entry.text || ""}`;
}

function isKeyLiveSpeechEntry(entry) {
  return Boolean(entry.scoring) || LIVE_SPEECH_KEY_TYPES.has(entry.type);
}

function speakLiveSpeechEntry(entry) {
  const label = commentaryLabel(entry);
  const parts = [];
  if (label) {
    parts.push(label);
  }
  if (entry.minute) {
    parts.push(`Phút ${entry.minute}`);
  }
  if (entry.text) {
    parts.push(entry.text);
  }
  const utterance = new SpeechSynthesisUtterance(parts.join(". "));
  utterance.lang = "vi-VN";
  const voice = findVietnameseVoice();
  if (voice) {
    utterance.voice = voice;
  }
  // speechSynthesis queue chạy tuần tự sẵn — cứ push, không cần tự quản hàng đợi.
  speechSynthesis.speak(utterance);
}

// Hook gọi sau mỗi lần fetch tường thuật. Lần feed đầu sau khi bật chỉ đánh dấu
// toàn bộ entries là đã thấy (không đọc backlog); từ lần sau chỉ đọc entry mới.
// Set seen không cần cap: chỉ nghe 1 trận tại 1 thời điểm (~vài trăm key) và
// được clear khi tắt/đổi trận — cap kèm eviction từng gây đọc lại dây chuyền.
function feedLiveSpeechEntries(matchId, entries) {
  if (liveSpeech.matchId !== String(matchId) || !Array.isArray(entries)) {
    return;
  }

  if (!liveSpeech.primed) {
    for (const entry of entries) {
      liveSpeech.seenKeys.add(liveSpeechEntryKey(entry));
    }
    liveSpeech.primed = true;
    return;
  }

  // Entries trả về mới nhất trước; đảo lại để đọc theo thứ tự thời gian.
  for (const entry of [...entries].reverse()) {
    const key = liveSpeechEntryKey(entry);
    if (liveSpeech.seenKeys.has(key)) {
      continue;
    }
    liveSpeech.seenKeys.add(key);
    if (isKeyLiveSpeechEntry(entry)) {
      speakLiveSpeechEntry(entry);
    }
  }
}
