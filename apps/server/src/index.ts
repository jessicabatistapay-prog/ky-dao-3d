import { createApp } from './app';
import { loadConfig } from './config';
import { SqliteRepository } from './storage';

const cfg = loadConfig();
const repo = new SqliteRepository(cfg.dbPath);

const interrupted = repo.markActiveInterrupted(Date.now());
if (interrupted) console.log(`Đánh dấu ${interrupted} ván gián đoạn sau khi khởi động lại`);

if (cfg.production && cfg.allowedOrigins.length === 0) {
  console.log('ALLOWED_ORIGINS trống: chỉ chấp nhận trình duyệt cùng origin với server');
}

const app = createApp(cfg, repo);
app.http.listen(cfg.port, cfg.host, () => console.log(`Kỳ Đạo server chạy ở cổng ${cfg.port}`));

const stop = async () => {
  await app.close();
  repo.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
