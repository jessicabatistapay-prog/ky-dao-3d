/**
 * Chính sách xử hòa – tách thành module để sau này thay bằng bộ luật thi đấu
 * (xét chiếu dai, đuổi quân) mà không phải sửa luật di chuyển.
 */
import { ADVISOR, ELEPHANT, KING, typeOf } from './board';

export interface DrawContext {
  board: Int8Array;
  /** Khóa thế cờ (kể cả lượt đi) theo thứ tự thời gian, phần tử cuối là thế hiện tại. */
  history: readonly string[];
  /** Số nửa nước liên tiếp không ăn quân. */
  quietPlies: number;
}

export type DrawReason = 'repetition' | 'no-capture' | 'insufficient';

export interface DrawPolicy {
  id: string;
  label: string;
  evaluate(ctx: DrawContext): DrawReason | null;
}

export const NO_CAPTURE_LIMIT = 120;

export const casualPolicy: DrawPolicy = {
  id: 'casual-v1',
  label: 'Luật chơi giải trí',
  evaluate({ board, history, quietPlies }) {
    let attackers = 0;
    for (let i = 0; i < 90; i++) {
      const p = board[i];
      if (p === 0) continue;
      const t = typeOf(p);
      if (t !== KING && t !== ADVISOR && t !== ELEPHANT) attackers++;
    }
    if (attackers === 0) return 'insufficient';
    const current = history[history.length - 1];
    let seen = 0;
    for (const key of history) if (key === current) seen++;
    if (seen >= 3) return 'repetition';
    if (quietPlies >= NO_CAPTURE_LIMIT) return 'no-capture';
    return null;
  },
};
