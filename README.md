# LiveCup — World Cup 2026

App theo dõi World Cup 2026: tỉ số live, lịch đấu, bảng xếp hạng và đội hình 48 đội tuyển, gom từ các nguồn dữ liệu public miễn phí (ESPN hidden API, worldcup26.ir, openfootball, football-data.org + FIFA).

## Chạy local

```bash
node server.js
# mở http://localhost:4174
```

## Deploy lên Cloudflare Pages (miễn phí)

Static files ở thư mục gốc, API (`/api/live`, `/api/team`) chạy bằng Pages Functions trong thư mục `functions/`.

### Cách 1: Kết nối GitHub (khuyên dùng — tự deploy mỗi lần push)

1. Vào [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Chọn repo `trungsin/livewc2026` và nhánh muốn deploy.
3. Cấu hình build:
   - **Framework preset**: None
   - **Build command**: *(để trống)*
   - **Build output directory**: `/` (thư mục gốc)
4. Bấm **Save and Deploy**. Thư mục `functions/` được tự nhận diện, không cần cấu hình thêm.

### Cách 2: Deploy bằng CLI

```bash
npx wrangler login
npx wrangler pages deploy . --project-name livewc2026
```

### Chạy thử môi trường Pages ở local

```bash
npx wrangler pages dev .
# mở http://localhost:8788
```

## Realtime (WebSocket)

Ngoài polling, app hỗ trợ push realtime qua WebSocket bằng một Worker riêng (`worker/`) dùng Durable Objects (có trong gói free): Durable Object poll các nguồn mỗi 10s khi có client kết nối, diff bàn thắng/trạng thái trận và đẩy ngay xuống mọi client. Frontend tự kết nối `wss://<domain>/ws`, nếu thất bại sẽ fallback về polling (10-15s khi có trận live).

Deploy worker (sau khi đã deploy Pages):

```bash
npx wrangler deploy --config worker/wrangler.toml
```

Route `worldcup2026.leesun.space/ws` được khai báo sẵn trong `worker/wrangler.toml` — đổi `pattern`/`zone_name` nếu dùng domain khác. Yêu cầu domain là zone trong tài khoản Cloudflare của bạn (subdomain `*.pages.dev` không gắn route được — khi đó frontend tự dùng polling).

Chạy thử worker ở local: `npx wrangler dev --config worker/wrangler.toml --port 8787`.

## Gói miễn phí Cloudflare Pages

- Static requests: không giới hạn
- Pages Functions: 100.000 requests/ngày
- `/api/live` cache 10s và `/api/team` cache 15 phút tại edge, nên lượng request tới Functions rất thấp
- Durable Objects (worker realtime): trong hạn mức free, chỉ chạy khi có client kết nối

## Dữ liệu

- `data/squads.json`: đội hình chính thức 26 cầu thủ × 48 đội (số áo, vị trí, CLB, ngày sinh, quốc tịch), HLV, hạng FIFA — trích từ [emrbli/worldcup](https://github.com/emrbli/worldcup) (MIT), tổng hợp từ football-data.org và dữ liệu FIFA public.
- Tỉ số live và lịch đấu: ESPN hidden API, worldcup26.ir, openfootball (fallback lẫn nhau).
- Giá trị chuyển nhượng cầu thủ không có vì không có nguồn miễn phí hợp lệ.
