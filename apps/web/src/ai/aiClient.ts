/**
 * Hủy tìm kiếm bằng cách kết thúc worker: vòng lặp tìm kiếm chạy đồng bộ nên
 * không nhận được thông điệp giữa chừng. Mỗi yêu cầu có id riêng, kết quả của
 * worker cũ không thể lọt qua.
 */
import type { SearchRequest, SearchResult } from '@kydao/engine/ai';

type Pending = { id: number; resolve: (r: SearchResult | null) => void; timer: number };

class AiClient {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private seq = 0;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, ok, result } = e.data;
      if (!this.pending || this.pending.id !== id) return;
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.resolve(ok ? result : null);
    };
    w.onerror = () => this.cancel();
    this.worker = w;
    return w;
  }

  /** Trả null nếu bị hủy hoặc worker lỗi; bên gọi tự xử lý trường hợp đó. */
  request(req: SearchRequest, budgetMs: number): Promise<SearchResult | null> {
    this.cancel();
    return new Promise((resolve) => {
      const id = ++this.seq;
      const timer = window.setTimeout(() => this.cancel(), budgetMs + 4000);
      this.pending = { id, resolve, timer };
      this.ensure().postMessage({ id, req });
    });
  }

  cancel() {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve(null);
      this.pending = null;
      this.worker?.terminate();
      this.worker = null;
    }
  }
}

export const aiClient = new AiClient();
