// Dịch tường thuật ESPN (văn bản template tiếng Anh) sang tiếng Việt bằng luật thay thế.
// Tên cầu thủ/đội giữ nguyên. Luật áp dụng theo thứ tự: câu template trước, cụm từ sau.

const RULES = [
  // Câu template nguyên vẹn
  [/^Lineups are announced and players are warming up\.?$/i, "Đội hình ra sân được công bố, các cầu thủ đang khởi động."],
  [/^First Half begins\.?$/i, "Hiệp 1 bắt đầu."],
  [/^Second Half begins[,.]?\s*/i, "Hiệp 2 bắt đầu. "],
  [/^First Half ends[,.]?\s*/i, "Hết hiệp 1: "],
  [/^Second Half ends[,.]?\s*/i, "Hết hiệp 2: "],
  [/^Match ends[,.]?\s*/i, "Trận đấu kết thúc: "],
  [/^Delay over\. They are ready to continue\.?$/i, "Trận đấu tiếp tục."],
  [/^Delay in match for a drinks break\.?$/i, "Trận đấu tạm dừng — nghỉ uống nước."],
  [/^Delay in match\s*\((.+?)\)\.?$/i, "Trận đấu tạm dừng ($1)."],
  [/^Delay in match/i, "Trận đấu tạm dừng"],
  [/^Foul by (.+?)\.$/i, "$1 phạm lỗi."],
  [/^Hand ball by (.+?)\.$/i, "$1 để bóng chạm tay."],
  [/^Offside, (.+?)\.\s*/i, "Việt vị bên phía $1. "],
  [/^Corner,\s*(.+?)\.\s*/i, "Phạt góc cho $1. "],
  [/^Conceded by (.+?)\.$/i, "$1 là người phá bóng."],
  [/^Substitution,\s*(.+?)\.\s*/i, "Thay người ($1). "],
  [/^Penalty conceded by (.+?) after a foul in the penalty area\.?/i, "$1 phạm lỗi trong vòng cấm, trọng tài cho hưởng phạt đền!"],
  [/^Penalty (.+?)\.\s*/i, "Phạt đền cho $1! "],
  [/^Goal!\s*/i, "VÀO!!! "],
  [/^Own Goal by (.+?)[,.]\s*/i, "Phản lưới nhà của $1! "],
  [/^VAR Decision:\s*/i, "Quyết định VAR: "],
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
  [/is shown the red card/gi, "nhận thẻ đỏ"],
  [/Second yellow card to/gi, "Thẻ vàng thứ hai cho"],
  [/for hand ball/gi, "vì để bóng chạm tay"],
  [/replaces/gi, "vào thay"],
  [/because of an injury/gi, "do chấn thương"],
  [/Dangerous play by (.+?)\./gi, "$1 chơi nguy hiểm."],
  [/Conceded by (.+?)\./gi, "$1 là người phá bóng."],

  // Quét cuối cho các mẫu chưa khớp ở trên
  [/\sby\s/g, " bởi "]
];

function translateEspnCommentary(text) {
  let result = String(text || "");
  for (const [pattern, replacement] of RULES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

module.exports = { translateEspnCommentary };
