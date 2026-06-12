// Dịch tường thuật ESPN (văn bản template tiếng Anh) sang tiếng Việt bằng luật thay thế.
// Luật áp dụng theo thứ tự: câu template trước, cụm từ sau; tên đội dịch ở bước cuối.

const fs = require("node:fs/promises");
const path = require("node:path");
const { translateTeamNamesInText } = require("./team-names-vietnamese.js");

const untranslatedLog = new Set();

const RULES = [
  // Câu template nguyên vẹn
  [/^Lineups are announced and players are warming up\.?$/i, "Đội hình ra sân được công bố, các cầu thủ đang khởi động."],
  [/^First Half begins\.?$/i, "Hiệp 1 bắt đầu."],
  [/^Second Half begins[,.]?\s*/i, "Hiệp 2 bắt đầu. "],
  [/^First period of extra time begins\.?$/i, "Hiệp phụ thứ nhất bắt đầu."],
  [/^Second period of extra time begins\.?$/i, "Hiệp phụ thứ hai bắt đầu."],
  [/^First Half ends[,.]?\s*/i, "Hết hiệp 1: "],
  [/^Second Half ends[,.]?\s*/i, "Hết hiệp 2: "],
  [/^First period of extra time ends[,.]?\s*/i, "Hết hiệp phụ thứ nhất: "],
  [/^Second period of extra time ends[,.]?\s*/i, "Hết hiệp phụ thứ hai: "],
  [/^Match ends[,.]?\s*/i, "Trận đấu kết thúc: "],
  [/^End of the first half\.?$/i, "Hết hiệp 1."],
  [/^End of the second half\.?$/i, "Hết hiệp 2."],
  [/^End of extra time\.?$/i, "Hết hiệp phụ."],
  [/^Extra Time begins\.?$/i, "Hiệp phụ bắt đầu."],
  [/^Penalty Shootout begins\.?$/i, "Loạt luân lưu bắt đầu."],
  [/^Penalty Shootout ends[,.]?\s*/i, "Loạt luân lưu kết thúc: "],
  [/^Delay over\. They are ready to continue\.?$/i, "Trận đấu tiếp tục."],
  [/^Delay in match for a drinks break\.?$/i, "Trận đấu tạm dừng — nghỉ uống nước."],
  [/^Delay in match because of an injury to (.+?)\.$/i, "Trận đấu tạm dừng do $1 chấn thương."],
  [/^(.+?) is down injured and receives medical attention\.?$/i, "$1 bị đau và cần chăm sóc y tế."],
  [/^(.+?) is down injured\.?$/i, "$1 đang nằm sân vì chấn thương."],
  [/^Delay in match\s*\((.+?)\)\.?$/i, "Trận đấu tạm dừng ($1)."],
  [/^Delay in match/i, "Trận đấu tạm dừng"],
  [/^Foul by (.+?)\.$/i, "$1 phạm lỗi."],
  [/^Hand ball by (.+?)\.$/i, "$1 để bóng chạm tay."],
  [/^Offside, (.+?)\.\s*/i, "Việt vị bên phía $1. "],
  [/^Corner,\s*(.+?)\.\s*/i, "Phạt góc cho $1. "],
  [/^Throw-in,\s*(.+?)\.\s*/i, "Ném biên cho $1. "],
  [/^Goal kick for (.+?)\.?$/i, "Phát bóng lên cho $1."],
  [/^Free kick taken by (.+?)\.?$/i, "$1 thực hiện quả đá phạt."],
  [/^Conceded by (.+?)\.$/i, "$1 là người phá bóng."],
  [/^Substitution,\s*(.+?)\.\s*/i, "Thay người ($1). "],
  [/^Penalty conceded by (.+?) after a foul in the penalty area\.?/i, "$1 phạm lỗi trong vòng cấm, trọng tài cho hưởng phạt đền!"],
  [/^Penalty saved!\s*(.+?)\s*/i, "Phạt đền bị cản phá! $1 "],
  [/^Penalty missed!\s*(.+?)\s*/i, "Phạt đền không thành công! $1 "],
  [/^Penalty Shootout - Scored:\s*(.+?)\./i, "Luân lưu thành công: $1."],
  [/^Penalty Shootout - Missed:\s*(.+?)\./i, "Luân lưu không thành công: $1."],
  [/^(.+?) scores the penalty with a (.+?) shot\.?$/i, "$1 sút phạt đền thành công bằng cú sút $2."],
  [/^(.+?) misses the penalty with a (.+?) shot\.?$/i, "$1 sút hỏng phạt đền bằng cú sút $2."],
  [/^Penalty (.+?)\.\s*/i, "Phạt đền cho $1! "],
  [/^Goal!\s*/i, "VÀO!!! "],
  [/^Own Goal by (.+?)[,.]\s*/i, "Phản lưới nhà của $1! "],
  [/^Own goal by (.+?)\.?$/i, "Phản lưới nhà của $1!"],
  [/^VAR Decision:\s*/i, "Quyết định VAR: "],
  [/^VAR Checking:\s*/i, "VAR kiểm tra: "],
  [/^VAR Review:\s*/i, "VAR xem lại: "],
  [/Goal awarded/gi, "Công nhận bàn thắng"],
  [/Goal confirmed/gi, "Xác nhận bàn thắng"],
  [/Goal cancelled/gi, "Hủy bàn thắng"],
  [/No Goal/gi, "Không có bàn thắng"],
  [/Penalty awarded/gi, "Cho hưởng phạt đền"],
  [/No Penalty/gi, "Không có phạt đền"],
  [/Decision confirmed/gi, "Giữ nguyên quyết định"],
  [/checked and confirmed/gi, "được kiểm tra và xác nhận"],
  [/^Fourth official has announced (\d+) minutes? of added time\.?$/i, "Trọng tài thứ tư thông báo bù giờ $1 phút."],

  // Dứt điểm
  [/Attempt missed\./gi, "Dứt điểm chệch mục tiêu!"],
  [/Attempt saved\./gi, "Dứt điểm bị cản phá!"],
  [/Attempt blocked\./gi, "Dứt điểm bị chặn!"],
  [/right footed shot/gi, "cú sút chân phải"],
  [/left footed shot/gi, "cú sút chân trái"],
  [/headed pass/gi, "đường chuyền bằng đầu"],
  [/header/gi, "cú đánh đầu"],
  [/converts the penalty/gi, "thực hiện thành công quả phạt đền"],
  [/misses the chance/gi, "bỏ lỡ cơ hội"],
  [/great chance/gi, "cơ hội rất tốt"],
  [/big chance missed/gi, "bỏ lỡ cơ hội lớn"],
  [/clearance off the line/gi, "phá bóng ngay trên vạch vôi"],

  // Vị trí dứt điểm
  [/from the centre of the box/gi, "từ trung lộ trong vòng cấm"],
  [/from outside the box/gi, "từ ngoài vòng cấm"],
  [/from the right side of the box/gi, "từ bên phải vòng cấm"],
  [/from the left side of the box/gi, "từ bên trái vòng cấm"],
  [/from the right side of the six yard box/gi, "từ bên phải vòng 5m50"],
  [/from the left side of the six yard box/gi, "từ bên trái vòng 5m50"],
  [/from very close range/gi, "từ cự ly rất gần"],
  [/from a difficult angle( and long range)?/gi, "từ góc hẹp"],
  [/from long range/gi, "từ xa"],
  [/from a free kick/gi, "từ quả đá phạt"],

  // Kết quả cú dứt điểm
  [/is just a bit too high/gi, "đi vọt xà trong gang tấc"],
  [/is too high/gi, "đi vọt xà"],
  [/is high and wide to the (left|right)/gi, (m, side) => `đi cao và chệch ${side === "left" ? "cột trái" : "cột phải"}`],
  [/is close, but misses to the (left|right)/gi, (m, side) => `đi sát ${side === "left" ? "cột trái" : "cột phải"}`],
  [/misses to the left/gi, "đi chệch cột trái"],
  [/misses to the right/gi, "đi chệch cột phải"],
  [/is saved in the (top|bottom) (left|right) corner/gi, (m, v, h) => `bị cản phá ở góc ${v === "top" ? "cao" : "thấp"} bên ${h === "left" ? "trái" : "phải"}`],
  [/is saved in the centre of the goal/gi, "bị cản phá ngay giữa khung thành"],
  [/is blocked/gi, "bị chặn lại"],
  [/hits the bar/gi, "dội xà ngang"],
  [/hits the crossbar/gi, "dội xà ngang"],
  [/hits the woodwork/gi, "dội khung gỗ"],
  [/hits the (left|right) post/gi, (m, side) => `dội ${side === "left" ? "cột trái" : "cột phải"}`],
  [/to the (top|bottom) (left|right) corner/gi, (m, v, h) => `vào góc ${v === "top" ? "cao" : "thấp"} bên ${h === "left" ? "trái" : "phải"}`],
  [/to the centre of the goal/gi, "vào chính giữa khung thành"],

  // Kiến tạo / nguồn gốc tình huống
  [/Assisted by/gi, "Kiến tạo bởi"],
  [/with a cross/gi, "bằng quả tạt"],
  [/with a through ball/gi, "bằng đường chọc khe"],
  [/following a corner/gi, "sau quả phạt góc"],
  [/following a set piece situation/gi, "sau tình huống cố định"],
  [/following a fast break/gi, "sau pha phản công nhanh"],
  [/following a throw in/gi, "sau quả ném biên"],

  // Đá phạt / việt vị / thẻ / thay người
  [/wins a free kick in the defensive half/gi, "được hưởng quả đá phạt bên phần sân nhà"],
  [/wins a free kick in the attacking half/gi, "được hưởng quả đá phạt bên phần sân đối phương"],
  [/wins a free kick on the right wing/gi, "được hưởng quả đá phạt ở cánh phải"],
  [/wins a free kick on the left wing/gi, "được hưởng quả đá phạt ở cánh trái"],
  [/wins a free kick/gi, "được hưởng quả đá phạt"],
  [/tries a through ball, but/gi, "chọc khe nhưng"],
  [/is caught offside/gi, "rơi vào thế việt vị"],
  [/draws a foul in the penalty area/gi, "bị phạm lỗi trong vòng cấm"],
  [/is shown the yellow card for a bad foul/gi, "nhận thẻ vàng vì pha phạm lỗi nguy hiểm"],
  [/is shown the yellow card/gi, "nhận thẻ vàng"],
  [/is shown the red card for violent conduct/gi, "nhận thẻ đỏ trực tiếp vì hành vi bạo lực"],
  [/is shown the red card for a bad foul/gi, "nhận thẻ đỏ trực tiếp vì pha phạm lỗi nguy hiểm"],
  [/is shown the red card/gi, "nhận thẻ đỏ"],
  [/straight red card/gi, "thẻ đỏ trực tiếp"],
  [/Second yellow card to/gi, "Thẻ vàng thứ hai cho"],
  [/for hand ball/gi, "vì để bóng chạm tay"],
  [/for a bad foul/gi, "vì pha phạm lỗi nguy hiểm"],
  [/replaces/gi, "vào thay"],
  [/because of an injury/gi, "do chấn thương"],
  [/Dangerous play by (.+?)\./gi, "$1 chơi nguy hiểm."],
  [/Conceded by (.+?)\./gi, "$1 là người phá bóng."],
  [/Goal kick/gi, "Phát bóng lên"],
  [/Throw-in/gi, "Ném biên"],
  [/Free kick/gi, "Đá phạt"],
  [/dominates possession/gi, "kiểm soát bóng vượt trội"],
  [/dominating possession/gi, "đang kiểm soát bóng vượt trội"],

  // Quét cuối cho các mẫu chưa khớp ở trên
  [/\sby\s/g, " bởi "]
];

const ENGLISH_MARKERS = /\b(the|is|are|has|have|wins?|shot|ball|kick|half|goal|attempt|from|with|misses?|missed|card|corner|saved|blocked|foul|penalty|offside|substitution|injury|crossbar|woodwork|chance|possession)\b/i;

function translateEspnCommentary(text) {
  let result = String(text || "");
  for (const [pattern, replacement] of RULES) {
    result = result.replace(pattern, replacement);
  }
  return translateTeamNamesInText(result);
}

function looksUntranslated(text) {
  return ENGLISH_MARKERS.test(String(text || ""));
}

function logUntranslated(text) {
  const value = String(text || "").trim();
  if (!value || untranslatedLog.has(value)) {
    return;
  }
  untranslatedLog.add(value);
  Promise.resolve().then(async () => {
    try {
      const logDir = path.join(__dirname, "logs");
      await fs.mkdir(logDir, { recursive: true });
      await fs.appendFile(path.join(logDir, "untranslated-commentary.log"), `${new Date().toISOString()}\t${value}\n`);
    } catch {
      // Ghi log là best-effort, không ảnh hưởng response.
    }
  });
}

module.exports = { translateEspnCommentary, looksUntranslated, logUntranslated };
