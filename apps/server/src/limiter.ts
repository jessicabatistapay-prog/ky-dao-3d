/** Giới hạn tần suất cửa sổ trượt trong bộ nhớ – đủ cho một server. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now: () => number = Date.now) {}

  private alive(key: string): number[] {
    const cut = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cut);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Ghi nhận một lần và cho biết còn trong giới hạn hay không. */
  take(key: string): boolean {
    const list = this.alive(key);
    if (list.length >= this.limit) return false;
    list.push(this.now());
    this.hits.set(key, list);
    return true;
  }

  blocked(key: string): boolean {
    return this.alive(key).length >= this.limit;
  }

  sweep() {
    for (const key of [...this.hits.keys()]) this.alive(key);
  }
}
