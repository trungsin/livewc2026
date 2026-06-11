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

## Gói miễn phí Cloudflare Pages

- Static requests: không giới hạn
- Pages Functions: 100.000 requests/ngày
- `/api/live` cache 30s và `/api/team` cache 15 phút tại edge, nên lượng request tới Functions rất thấp

## Dữ liệu

- `data/squads.json`: đội hình chính thức 26 cầu thủ × 48 đội (số áo, vị trí, CLB, ngày sinh, quốc tịch), HLV, hạng FIFA — trích từ [emrbli/worldcup](https://github.com/emrbli/worldcup) (MIT), tổng hợp từ football-data.org và dữ liệu FIFA public.
- Tỉ số live và lịch đấu: ESPN hidden API, worldcup26.ir, openfootball (fallback lẫn nhau).
- Giá trị chuyển nhượng cầu thủ không có vì không có nguồn miễn phí hợp lệ.
