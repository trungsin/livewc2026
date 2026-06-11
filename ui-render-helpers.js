// Helpers render dùng chung cho trang home (app.js) và trang đội tuyển (teams-page.js)

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function imageTag(src, alt, className) {
  if (!src) {
    return `<span class="${className} placeholder">${escapeHtml((alt || "?").slice(0, 3).toUpperCase())}</span>`;
  }

  return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`;
}

function formatKickoff(isoValue) {
  if (!isoValue) {
    return "";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(isoValue));
}
