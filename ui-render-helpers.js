// Helpers render dùng chung cho các trang tĩnh LiveCup.

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
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(new Date(isoValue));
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

function formatDayHeading(dayKey) {
  if (!dayKey || dayKey === "unknown") {
    return "Chưa rõ ngày";
  }

  const date = new Date(`${dayKey}T00:00:00+07:00`);
  const weekday = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(date);
  const dayMonth = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(date);

  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dayMonth}`;
}

function matchTimestamp(match) {
  const parsed = Date.parse(match.kickoffUtc || "");
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function groupMatchesByDay(list) {
  const byDay = new Map();
  for (const match of list || []) {
    const day = vnDayKey(match.kickoffUtc);
    if (!byDay.has(day)) {
      byDay.set(day, []);
    }
    byDay.get(day).push(match);
  }

  return [...byDay.entries()]
    .sort(([dayA], [dayB]) => {
      if (dayA === "unknown") return 1;
      if (dayB === "unknown") return -1;
      return dayA.localeCompare(dayB);
    })
    .map(([day, dayMatches]) => ({
      day,
      heading: formatDayHeading(day),
      matches: dayMatches.sort((a, b) => matchTimestamp(a) - matchTimestamp(b))
    }));
}

function matchTime(match) {
  if (!match.kickoffUtc) {
    return match.kickoff || "--";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(new Date(match.kickoffUtc));
}

function matchClickableAttributes(match) {
  return `data-match-id="${escapeHtml(match.id)}" title="Xem diễn biến trận đấu"`;
}

function matchCenterText(match) {
  if (match.status === "finished") {
    return `<span class="match-row-score">${escapeHtml(match.homeScore)} - ${escapeHtml(match.awayScore)}</span><span class="match-row-state">FT</span>`;
  }
  if (match.status === "live") {
    return `<span class="match-row-live">${escapeHtml(match.minute || "--")}'</span>`;
  }
  if (match.status === "halftime") {
    return `<span class="match-row-live">HT</span>`;
  }
  return `<span class="match-row-score">&ndash;</span>`;
}

function renderMatchRow(match) {
  const phase = match.group && match.group !== "World Cup" ? match.group : match.type || match.group || "World Cup";
  const meta = [phase, match.stadium || ""].filter(Boolean).join(" · ");
  const homeName = displayTeamName(match.home);
  const awayName = displayTeamName(match.away);
  return `
    <article class="match-row clickable ${match.status === "live" || match.status === "halftime" ? "is-live" : ""}" ${matchClickableAttributes(match)}>
      <div class="match-row-time">${escapeHtml(matchTime(match))}</div>
      <div class="match-row-team">
        ${imageTag(match.homeLogo, homeName, "team-logo")}
        <span class="team-name">${escapeHtml(homeName)}</span>
      </div>
      <div class="match-row-center">${matchCenterText(match)}</div>
      <div class="match-row-team away">
        <span class="team-name">${escapeHtml(awayName)}</span>
        ${imageTag(match.awayLogo, awayName, "team-logo")}
      </div>
      <div class="match-row-meta">${escapeHtml(meta)}</div>
    </article>
  `;
}
