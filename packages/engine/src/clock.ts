/**
 * Đồng hồ dựa trên mốc thời gian thực, không đếm nhịp setInterval.
 * Thời điểm chuyển lượt là lúc nước đi được chấp nhận, độc lập với animation.
 */
import { Side, other } from './board';

export interface ClockSnapshot {
  r: number | null;
  b: number | null;
  running: Side | null;
}

export class GameClock {
  remaining: Record<Side, number>;
  running: Side | null = null;
  private since = 0;

  constructor(
    readonly baseMs: number | null,
    readonly incrementMs: number,
    private readonly now: () => number,
    initial?: { r: number; b: number },
  ) {
    const base = baseMs ?? Number.POSITIVE_INFINITY;
    this.remaining = initial ? { r: initial.r, b: initial.b } : { r: base, b: base };
  }

  get limited(): boolean {
    return this.baseMs !== null;
  }

  start(side: Side): void {
    this.running = side;
    this.since = this.now();
  }

  /** Trừ thời gian đã dùng vào bên đang chạy và dừng lại. */
  stop(): void {
    if (!this.running) return;
    this.remaining[this.running] -= this.now() - this.since;
    this.running = null;
  }

  read(side: Side): number {
    const base = this.remaining[side];
    return this.running === side ? base - (this.now() - this.since) : base;
  }

  /** Mili-giây tới khi bên đang chạy hết giờ; Infinity nếu không giới hạn. */
  msToExpiry(): number {
    if (!this.running || !this.limited) return Number.POSITIVE_INFINITY;
    return this.read(this.running);
  }

  expired(): Side | null {
    return this.running && this.limited && this.read(this.running) <= 0 ? this.running : null;
  }

  /** Bên `mover` vừa đi xong: chốt giờ, cộng thêm giờ, chuyển sang đối phương. */
  press(mover: Side): void {
    this.stop();
    if (this.limited) this.remaining[mover] += this.incrementMs;
    this.start(other(mover));
  }

  /** Hoàn tác: không trả lại thời gian đã nghĩ, chỉ thu hồi phần cộng thêm của các nước bị hủy. */
  rewind(undone: Side[], turn: Side, floorMs = 1000): void {
    this.stop();
    if (this.limited) {
      for (const side of undone) {
        this.remaining[side] = Math.max(floorMs, this.remaining[side] - this.incrementMs);
      }
    }
    this.start(turn);
  }

  snapshot(): ClockSnapshot {
    return {
      r: this.limited ? Math.max(0, this.read('r')) : null,
      b: this.limited ? Math.max(0, this.read('b')) : null,
      running: this.running,
    };
  }
}
