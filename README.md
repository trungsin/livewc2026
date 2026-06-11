# LiveCup — World Cup 2026

App theo dõi World Cup 2026: tỉ số live, lịch đấu, bảng xếp hạng và đội hình 48 đội tuyển, gom từ các nguồn dữ liệu public miễn phí (ESPN hidden API, worldcup26.ir, openfootball, football-data.org + FIFA).

## Chạy local

```bash
node server.js
# mở http://localhost:4174
```

Hoặc mô phỏng đúng môi trường Cloudflare (có cả WebSocket realtime):

```bash
npx wrangler dev --persist-to /tmp/wstate
# mở http://localhost:8787
```

## Deploy lên Cloudflare Workers (miễn phí)

Toàn bộ app là **một Worker duy nhất** (cấu hình ở `wrangler.toml` gốc): static assets serve trực tiếp tại edge, `worker/index.js` xử lý `/api/live`, `/api/team` và WebSocket `/ws` (Durable Object). File không công khai được loại khỏi assets bằng `.assetsignore`.

### Cách 1: Workers Builds — kết nối GitHub (tự deploy mỗi lần push)

1. Vào [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Workers** → **Connect to Git** (Import a repository).
2. Chọn repo `trungsin/livewc2026` và nhánh muốn deploy.
3. Để nguyên build/deploy command mặc định (`npx wrangler deploy`) — cấu hình đọc từ `wrangler.toml`. Lưu ý tên project phải là `livewc2026` (trùng `name` trong `wrangler.toml`).
4. Gắn custom domain trong **Settings → Domains & Routes** của worker.

### Cách 2: Deploy bằng CLI

```bash
npx wrangler login
npx wrangler deploy
```

## Realtime (WebSocket)

Frontend tự kết nối `wss://<domain>/ws`. Durable Object `LiveHub` (có trong gói free, dùng SQLite class) poll các nguồn mỗi 10s khi có client kết nối, diff bàn thắng/trạng thái trận (bắt đầu, nghỉ giữa hiệp, kết thúc) và đẩy ngay xuống mọi client. Khi không còn ai xem, nó tự ngừng poll. Nếu WebSocket không kết nối được, frontend fallback về polling thích ứng (10s khi có trận live, 30s khi không).

Thư mục `functions/` (Pages Functions) được giữ lại để ai muốn deploy kiểu Cloudflare Pages vẫn dùng được — Worker tái sử dụng chính các handler này.

## Gói miễn phí Cloudflare Workers

- Static assets: không giới hạn request
- Worker requests (API + WS): 100.000 requests/ngày
- `/api/live` cache 10s và `/api/team` cache 15 phút tại edge, nên lượng request thực tế rất thấp
- Durable Objects: trong hạn mức free, chỉ chạy khi có client kết nối

## Dữ liệu

- `data/squads.json`: đội hình chính thức 26 cầu thủ × 48 đội (số áo, vị trí, CLB, ngày sinh, quốc tịch), HLV, hạng FIFA — trích từ [emrbli/worldcup](https://github.com/emrbli/worldcup) (MIT), tổng hợp từ football-data.org và dữ liệu FIFA public.
- Tỉ số live và lịch đấu: ESPN hidden API, worldcup26.ir, openfootball (fallback lẫn nhau).
- Giá trị chuyển nhượng cầu thủ không có vì không có nguồn miễn phí hợp lệ.
