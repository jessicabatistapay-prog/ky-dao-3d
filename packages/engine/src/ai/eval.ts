/** Hàm đánh giá. Điểm dương là có lợi cho Đỏ; `evaluate` đổi sang góc nhìn bên đi. */
import { ADVISOR, CANNON, ELEPHANT, HORSE, KING, PAWN, ROOK, Side } from '../board';
import { isAttacked } from '../moves';

export const VALUE = [0, 0, 200, 200, 430, 900, 460, 100];

// Bảng vị trí nhìn từ Đỏ, hàng 0 là phía sân đối phương.
const P_PAWN = [
   0,  3,  6,  9, 12,  9,  6,  3,  0,
  18, 36, 56, 80, 90, 80, 56, 36, 18,
  14, 26, 42, 60, 66, 60, 42, 26, 14,
  10, 20, 30, 34, 40, 34, 30, 20, 10,
   6, 12, 18, 18, 20, 18, 18, 12,  6,
   2,  0,  8,  0,  8,  0,  8,  0,  2,
   0,  0, -2,  0,  4,  0, -2,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
];
const P_HORSE = [
   4,  8, 16, 12,  4, 12, 16,  8,  4,
   4, 10, 28, 16,  8, 16, 28, 10,  4,
  12, 14, 16, 20, 18, 20, 16, 14, 12,
   8, 24, 18, 24, 20, 24, 18, 24,  8,
   6, 16, 14, 18, 16, 18, 14, 16,  6,
   4, 12, 16, 14, 12, 14, 16, 12,  4,
   2,  6,  8,  6, 10,  6,  8,  6,  2,
   4,  2,  8,  8,  4,  8,  8,  2,  4,
   0,  2,  4,  4, -2,  4,  4,  2,  0,
   0, -4,  0,  0,  0,  0,  0, -4,  0,
];
const P_ROOK = [
  14, 14, 12, 18, 16, 18, 12, 14, 14,
  16, 20, 18, 24, 26, 24, 18, 20, 16,
  12, 12, 12, 18, 18, 18, 12, 12, 12,
  12, 18, 16, 22, 22, 22, 16, 18, 12,
  12, 14, 12, 18, 18, 18, 12, 14, 12,
  12, 16, 14, 20, 20, 20, 14, 16, 12,
   6, 10,  8, 14, 14, 14,  8, 10,  6,
   4,  8,  6, 14, 12, 14,  6,  8,  4,
   8,  4,  8, 16,  8, 16,  8,  4,  8,
  -2, 10,  6, 14, 12, 14,  6, 10, -2,
];
const P_CANNON = [
   6,  4,  0, -10, -12, -10,  0,  4,  6,
   2,  2,  0,  -4, -14,  -4,  0,  2,  2,
   2,  2,  0, -10,  -8, -10,  0,  2,  2,
   0,  0, -2,   4,  10,   4, -2,  0,  0,
   0,  0,  0,   2,   8,   2,  0,  0,  0,
  -2,  0,  4,   2,   6,   2,  4,  0, -2,
   0,  0,  0,   2,   4,   2,  0,  0,  0,
   4,  0,  8,   6,  10,   6,  8,  0,  4,
   0,  2,  4,   6,   6,   6,  4,  2,  0,
   0,  0,  2,   6,   6,   6,  2,  0,  0,
];
const P_GUARD = new Array<number>(90).fill(0);
for (const [s, v] of [[85, 4], [83, 4], [75, 6], [76, 8], [83, 4], [65, 4], [85, 4]] as const) P_GUARD[s] = v;

const PST: number[][] = [[], [], P_GUARD, P_GUARD, P_HORSE, P_ROOK, P_CANNON, P_PAWN];

const mirror = (s: number): number => (9 - ((s / 9) | 0)) * 9 + s % 9;

/** Đánh giá nhanh độ cơ động của Xe/Pháo/Mã mà không sinh nước đầy đủ. */
function rayMobility(board: Int8Array, s: number): number {
  const row = (s / 9) | 0;
  const col = s % 9;
  let n = 0;
  for (let c = col - 1; c >= 0 && board[row * 9 + c] === 0; c--) n++;
  for (let c = col + 1; c < 9 && board[row * 9 + c] === 0; c++) n++;
  for (let r = row - 1; r >= 0 && board[r * 9 + col] === 0; r--) n++;
  for (let r = row + 1; r < 10 && board[r * 9 + col] === 0; r++) n++;
  return n;
}

function horseFreedom(board: Int8Array, s: number): number {
  const row = (s / 9) | 0;
  const col = s % 9;
  let n = 0;
  if (row > 0 && board[s - 9] === 0) n++;
  if (row < 9 && board[s + 9] === 0) n++;
  if (col > 0 && board[s - 1] === 0) n++;
  if (col < 8 && board[s + 1] === 0) n++;
  return n;
}

export function evaluateRed(board: Int8Array): number {
  let score = 0;
  let redGuards = 0;
  let blackGuards = 0;
  let redAttack = 0;
  let blackAttack = 0;
  let pieces = 0;
  for (let i = 0; i < 90; i++) {
    const p = board[i];
    if (p === 0) continue;
    pieces++;
    const t = p > 0 ? p : -p;
    const here = p > 0 ? i : mirror(i);
    let v = VALUE[t] + (PST[t][here] ?? 0);
    switch (t) {
      case ROOK: v += rayMobility(board, i) * 2; break;
      case CANNON: v += rayMobility(board, i); break;
      case HORSE: v += horseFreedom(board, i) * 5 - 6; break;
      case ADVISOR:
      case ELEPHANT:
        if (p > 0) redGuards++; else blackGuards++;
        break;
    }
    if (p > 0 && t !== KING && (i / 9 | 0) <= 4 && t !== PAWN && t !== ADVISOR && t !== ELEPHANT) redAttack += t === ROOK ? 3 : 2;
    if (p < 0 && t !== KING && (i / 9 | 0) >= 5 && t !== PAWN && t !== ADVISOR && t !== ELEPHANT) blackAttack += t === ROOK ? 3 : 2;
    score += p > 0 ? v : -v;
  }
  // An toàn Tướng: thiếu Sĩ/Tượng càng nguy hiểm khi đối phương đã áp sát.
  score -= (4 - redGuards) * blackAttack * 3;
  score += (4 - blackGuards) * redAttack * 3;
  // Tàn cuộc: giá trị Pháo giảm, Mã tăng nhẹ.
  if (pieces <= 12) {
    for (let i = 0; i < 90; i++) {
      const p = board[i];
      if (p === CANNON) score -= 25;
      else if (p === -CANNON) score += 25;
      else if (p === HORSE) score += 20;
      else if (p === -HORSE) score -= 20;
    }
  }
  return score;
}

/** Điểm bổ sung khá đắt, chỉ dùng cho nút lá ở chế độ đầy đủ: quân lớn bị đe dọa. */
function threatened(board: Int8Array, stm: Side): number {
  const enemy: Side = stm === 'r' ? 'b' : 'r';
  const s = stm === 'r' ? 1 : -1;
  let bonus = 0;
  for (let i = 0; i < 90; i++) {
    const p = board[i] * s;
    if (p >= 0) continue;
    const t = -p;
    if (t !== ROOK && t !== CANNON && t !== HORSE) continue;
    if (isAttacked(board, i, stm) && !isAttacked(board, i, enemy)) bonus += VALUE[t] >> 3;
  }
  return bonus;
}

export function evaluate(board: Int8Array, stm: Side, deep: boolean): number {
  const base = evaluateRed(board);
  const score = stm === 'r' ? base : -base;
  const tempo = 8;
  return score + tempo + (deep ? threatened(board, stm) : 0);
}
