# Kỳ Đạo 3D

Cờ tướng 3D chạy trên trình duyệt desktop và mobile, giao diện tiếng Việt. Có ba chế độ: đấu với máy, hai người trên cùng thiết bị, và hai người qua Internet có phòng riêng, mời bạn và chat thời gian thực. Không cần đăng nhập.

Toàn bộ đồ họa và âm thanh được tạo bằng code (geometry, canvas texture, Web Audio). Hai font đi kèm dùng giấy phép OFL: LXGW WenKai TC (đã cắt còn đúng các chữ Hán cần dùng, 9 KB) và Noto Serif.

## Chạy thử

Cần Node.js 22.13 trở lên. SQLite dùng module `node:sqlite` có sẵn của Node nên không phải biên dịch gì, kể cả trên Windows.

```bash
npm install
npm run dev
```

Mở http://localhost:5173. Lệnh này chạy cả frontend (cổng 5173) lẫn server (cổng 3001). Nếu chỉ chơi offline: `npm run dev:web`.

Để thử online trên một máy, mở hai cửa sổ ẩn danh khác nhau (hai cửa sổ thường dùng chung phiên, tab sau sẽ giành quyền tab trước).

### Chạy bản production không dùng Docker

```bash
npm run build
cd apps/server
NODE_ENV=production STATIC_DIR=../web/dist DB_PATH=./data/kydao.sqlite PORT=3001 node dist/index.js
```

Server phục vụ luôn frontend, mở http://localhost:3001.

## Triển khai trên một VPS

```bash
cp .env.example .env     # sửa DOMAIN và ALLOWED_ORIGINS
docker compose up -d --build
```

Compose chạy hai dịch vụ: `app` (Node, SQLite trong volume `kydao-data`) và `caddy` (tự xin chứng chỉ HTTPS, chuyển tiếp WebSocket). Cần trỏ DNS của tên miền về VPS và mở cổng 80, 443.

Nếu đã có Nginx, dùng mẫu `deploy/nginx.conf`. Các dòng quan trọng là `proxy_http_version 1.1`, `Upgrade`, `Connection` để WebSocket hoạt động, và `TRUST_PROXY=1` để rate limit dùng đúng IP thật.

Kiểm tra sức khỏe: `GET /healthz` trả `{ ok, uptime, rooms }`, mã 503 nếu cơ sở dữ liệu lỗi.

Nếu frontend đặt ở tên miền khác backend: build với `VITE_SERVER_URL=https://api.example.com` và thêm origin của frontend vào `ALLOWED_ORIGINS`.

Biến môi trường xem trong `.env.example`. Khi `NODE_ENV=production` và `ALLOWED_ORIGINS` trống, server chỉ nhận trình duyệt cùng origin.

## Kiến trúc

```
packages/engine        Không phụ thuộc React, Three.js hay Node
  src/board.ts         Mô hình bàn cờ, FEN
  src/moves.ts         Ba tầng: nước theo hình → ô bị tấn công → nước hợp lệ
  src/explain.ts       Lý do nước sai ("Mã bị cản chân"...)
  src/game.ts          Ván cờ: lịch sử, undo, replay, kết quả
  src/drawPolicy.ts    Chính sách xử hòa, thay được bằng luật thi đấu sau này
  src/clock.ts         Đồng hồ theo mốc thời gian
  src/notation.ts      Ký hiệu nước đi tiếng Việt
  src/protocol.ts      Hợp đồng dữ liệu client ↔ server
  src/ai/              Alpha-beta, iterative deepening, bảng chuyển vị
apps/web               React + React Three Fiber + Zustand
  src/three/coords.ts  Phép chuyển đổi duy nhất giữa ô cờ và tọa độ 3D
  src/three/director.ts Hàng đợi animation, đối chiếu 3D với bàn logic
  src/three/vfx.ts     Hạt, vòng xung kích, vệt sáng (có pool)
  src/store/           localStore (ván local), onlineStore, boardView
  src/lib/             Lưu ván, âm thanh, cài đặt, thao tác chọn quân
  src/ai/              Web Worker và client có hủy
apps/server            Node + Socket.IO + SQLite
  src/rooms.ts         Phòng, ván, đồng hồ, đề nghị, chat
  src/storage.ts       Interface GameRepository + bản SQLite
  src/app.ts           HTTP, kiểm tra origin, nối sự kiện socket
e2e/                   Playwright, gồm kịch bản hai trình duyệt
```

Vài quyết định đáng chú ý:

- **Hình ảnh không quyết định luật.** Trạng thái ván đổi ngay khi nước đi được chấp nhận. Cảnh 3D chạy theo sau qua hàng đợi; mỗi sự kiện mang bàn cờ sau nước đi, và khi animation xong `Director` đối chiếu lại. Hoàn tác hoặc đồng bộ gọi `director.sync()`, hủy mọi hiệu ứng và đặt quân đúng tuyệt đối. Hàng đợi dài sẽ tăng tốc rồi bỏ qua để bắt kịp.
- **Đảo bàn** chỉ xoay nhóm `boardRoot` 180°. Picking đổi điểm chạm về tọa độ cục bộ của nhóm đó nên luật và tọa độ ô không đổi.
- **Vẽ theo nhu cầu.** Canvas dùng `frameloop="demand"`: bàn đứng yên thì không tốn CPU/GPU, chỉ vẽ khi có animation, thao tác hoặc camera di chuyển.
- **Hủy AI** bằng cách kết thúc worker, vì tìm kiếm chạy đồng bộ trong worker. Thêm vào đó mỗi lượt có token và ID ván nên kết quả cũ bị bỏ qua.
- **Server có quyền quyết định.** Client chỉ gửi ý định đi quân. Server kiểm tra phiên, phe, lượt, phiên bản trạng thái, luật và đồng hồ. Mỗi thao tác của một ván là một khối đồng bộ trên event loop nên luôn tuần tự. Mọi kết thúc ván đi qua `finish()`, được chặn để chỉ ghi một lần. Các mốc hết giờ, hết hạn kết nối lại được xếp theo thời gian thật nên cái nào đến trước mới có hiệu lực.
- **Reconnect token** là 32 byte ngẫu nhiên, gửi qua `auth` của Socket.IO (không nằm trong URL hay log), server chỉ lưu SHA-256. Link mời chỉ chứa mã phòng.
- **Nhiều tab:** kết nối mới nhất giành quyền; tab cũ bị ngắt, có nút để giành lại.

## Luật áp dụng: Luật chơi giải trí

Đầy đủ luật di chuyển, bắt quân, hai Tướng đối mặt, chiếu, chiếu bí. Bên đến lượt không còn nước hợp lệ bị xử thua, kể cả khi không bị chiếu.

Đây **không phải** luật thi đấu chính thức: game không xét chiếu dai, đuổi quân và các trường hợp liên quan. Xử hòa khi:

- Một thế cờ lặp lại ba lần (kể cả do chiếu liên tục).
- 60 nước mỗi bên không ăn quân.
- Cả hai bên không còn Xe, Pháo, Mã, Tốt.

Muốn áp dụng luật khác, viết một `DrawPolicy` mới trong `packages/engine/src/drawPolicy.ts`.

Đồng hồ: giờ chuyển ngay khi nước đi được chấp nhận, không bù thời gian animation. Khi đi lại, thời gian đã nghĩ không được hoàn; phần giờ cộng thêm của các nước bị hủy được thu hồi (tối thiểu còn 1 giây). Ván local khi tiếp tục từ bản lưu thì đồng hồ dừng trong thời gian rời đi.

Online: đồng hồ vẫn chạy khi mất kết nối, có 120 giây để kết nối lại. Rời phòng chủ động khi ván chưa xong là bỏ cuộc. Server khởi động lại thì ván dở được đánh dấu gián đoạn, không ai bị xử thua.

## Kiểm thử

```bash
npm test                 # engine + server (Vitest)
npm run typecheck
npx playwright install chromium   # lần đầu
npm run test:e2e         # Playwright, tự build và tự chạy server
```


## Giới hạn còn lại

- AI chưa đo Elo; mức Khó là tìm kiếm trong khoảng 2,4 giây, chưa có sách khai cuộc hay bảng tàn cuộc.
- Chưa có tài khoản, ghép trận ngẫu nhiên, bảng xếp hạng, người xem. Lịch sử ván lưu trong SQLite nhưng chưa có màn hình xem lại ván online sau khi rời phòng.
- Chưa phục hồi ván đang chạy sau khi server khởi động lại (được đánh dấu gián đoạn đúng như yêu cầu).
- Chỉ chạy một server: phòng và phiên nằm trong bộ nhớ tiến trình.
- Kéo thả quân chưa làm, chỉ có chọn rồi chọn đích.
- Hiệu năng trên GPU thật và điện thoại thật chưa đo được trong môi trường phát triển, vốn chỉ có trình kết xuất phần mềm.

## Kết quả kiểm thử lần cuối

- Vitest: 89/89 test đạt (luật cờ gồm perft 44 / 1.920 / 79.666, AI, đồng hồ, 39 test tích hợp server qua Socket.IO thật).
- Playwright: 20/20 kịch bản đạt, gồm hai browser context độc lập và một context mobile, chạy trên Chromium headless với WebGL phần mềm ở chất lượng thấp.
- `tsc` ba package không lỗi, build production thành công.
#   k y - d a o - 3 d  
 