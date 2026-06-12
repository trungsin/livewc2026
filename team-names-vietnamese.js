// Tên đội tiếng Việt dùng chung client/server. Dữ liệu API vẫn giữ tên English làm khóa.

(function initTeamNamesVietnamese(root) {
  function canonicalTeamName(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  const TEAM_DEFINITIONS = [
    ["Algeria", "Algeria", ["ALG"]],
    ["Argentina", "Argentina", ["ARG"]],
    ["Australia", "Úc", ["AUS"]],
    ["Austria", "Áo", ["AUT"]],
    ["Belgium", "Bỉ", ["BEL"]],
    ["Bosnia & Herzegovina", "Bosnia và Herzegovina", ["Bosnia and Herzegovina", "Bosnia-Herzegovina", "BIH"]],
    ["Brazil", "Brazil", ["BRA"]],
    ["Canada", "Canada", ["CAN"]],
    ["Cape Verde", "Cabo Verde", ["Cabo Verde", "CPV"]],
    ["Colombia", "Colombia", ["COL"]],
    ["Croatia", "Croatia", ["CRO"]],
    ["Curaçao", "Curaçao", ["Curacao", "CUW"]],
    ["Czech Republic", "CH Séc", ["Czechia", "Czech Republic", "CZE"]],
    ["DR Congo", "CHDC Congo", ["Democratic Republic of the Congo", "Congo DR", "DRC", "COD"]],
    ["Ecuador", "Ecuador", ["ECU"]],
    ["Egypt", "Ai Cập", ["EGY"]],
    ["England", "Anh", ["ENG"]],
    ["France", "Pháp", ["FRA"]],
    ["Germany", "Đức", ["GER"]],
    ["Ghana", "Ghana", ["GHA"]],
    ["Haiti", "Haiti", ["HAI"]],
    ["Iran", "Iran", ["IRN"]],
    ["Iraq", "Iraq", ["IRQ"]],
    ["Ivory Coast", "Bờ Biển Ngà", ["Côte d'Ivoire", "Cote d'Ivoire", "CIV"]],
    ["Japan", "Nhật Bản", ["JPN"]],
    ["Jordan", "Jordan", ["JOR"]],
    ["Mexico", "Mexico", ["MEX"]],
    ["Morocco", "Ma Rốc", ["MAR"]],
    ["Netherlands", "Hà Lan", ["Holland", "NED"]],
    ["New Zealand", "New Zealand", ["NZL"]],
    ["Norway", "Na Uy", ["NOR"]],
    ["Panama", "Panama", ["PAN"]],
    ["Paraguay", "Paraguay", ["PAR"]],
    ["Portugal", "Bồ Đào Nha", ["POR"]],
    ["Qatar", "Qatar", ["QAT"]],
    ["Saudi Arabia", "Ả Rập Xê Út", ["Saudi", "KSA"]],
    ["Scotland", "Scotland", ["SCO"]],
    ["Senegal", "Senegal", ["SEN"]],
    ["South Africa", "Nam Phi", ["RSA"]],
    ["South Korea", "Hàn Quốc", ["Korea Republic", "Republic of Korea", "KOR"]],
    ["Spain", "Tây Ban Nha", ["ESP"]],
    ["Sweden", "Thụy Điển", ["SWE"]],
    ["Switzerland", "Thụy Sĩ", ["SUI"]],
    ["Tunisia", "Tunisia", ["TUN"]],
    ["Turkey", "Thổ Nhĩ Kỳ", ["Türkiye", "Turkiye", "TUR"]],
    ["USA", "Mỹ", ["United States", "United States of America", "USMNT", "USA", "US"]],
    ["Uruguay", "Uruguay", ["URU"]],
    ["Uzbekistan", "Uzbekistan", ["UZB"]]
  ];

  const TEAM_NAMES_VI = {};
  const variantToVietnamese = new Map();
  const textVariants = [];

  for (const [canonical, vi, variants] of TEAM_DEFINITIONS) {
    const allVariants = [canonical, vi, ...variants];
    TEAM_NAMES_VI[canonicalTeamName(canonical)] = { name: vi, variants: allVariants };
    for (const variant of allVariants) {
      variantToVietnamese.set(canonicalTeamName(variant), vi);
    }
    for (const variant of [canonical, ...variants]) {
      if (/^[A-Z]{2,4}$/.test(variant)) {
        continue;
      }
      textVariants.push([variant, vi]);
    }
  }

  textVariants.sort((a, b) => b[0].length - a[0].length);

  function displayTeamName(name) {
    return variantToVietnamese.get(canonicalTeamName(name)) || String(name || "");
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function translateTeamNamesInText(text) {
    let result = String(text || "");
    for (const [variant, vi] of textVariants) {
      result = result.replace(new RegExp(`\\b${escapeRegExp(variant)}\\b`, "gi"), vi);
    }
    return result;
  }

  const api = { TEAM_NAMES_VI, displayTeamName, translateTeamNamesInText, canonicalTeamName };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.TEAM_NAMES_VI = TEAM_NAMES_VI;
  root.displayTeamName = displayTeamName;
  root.translateTeamNamesInText = translateTeamNamesInText;
})(typeof globalThis !== "undefined" ? globalThis : window);
