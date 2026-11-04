/**
 * Ba tầng được tách rõ để không có đệ quy vòng:
 *   1. genPseudo      – nước đi theo hình di chuyển, chưa xét an toàn Tướng.
 *   2. isAttacked     – ô bị tấn công, tính trực tiếp, không gọi sinh nước.
 *   3. legalMoves     – (1) lọc bằng (2) + luật hai Tướng đối mặt.
 */
import {
  ADVISOR, CANNON, COLS, ELEPHANT, HORSE, KING, PAWN, ROOK,
  Position, Side, findKing, inPalace, onBoard, onHomeSide, other,
} from './board';

export const encodeMove = (from: number, to: number): number => from | (to << 8);
export const moveFrom = (m: number): number => m & 0xff;
export const moveTo = (m: number): number => m >> 8;

const ORTH: readonly [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG: readonly [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
/** [dRow, dCol, chân Mã dRow, chân Mã dCol] */
const HORSE_STEPS: readonly [number, number, number, number][] = [
  [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
  [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1],
];

/** Thêm vào `out` mọi nước theo hình của một quân. */
export function genPieceMoves(board: Int8Array, from: number, out: number[]): void {
  const piece = board[from];
  if (piece === 0) return;
  const s = piece > 0 ? 1 : -1;
  const side: Side = piece > 0 ? 'r' : 'b';
  const row = (from / 9) | 0;
  const col = from % 9;
  const add = (r: number, c: number) => {
    const to = r * 9 + c;
    if (board[to] * s <= 0) out.push(from | (to << 8));
  };

  switch (piece * s) {
    case KING:
      for (const [dr, dc] of ORTH) if (inPalace(side, row + dr, col + dc)) add(row + dr, col + dc);
      break;
    case ADVISOR:
      for (const [dr, dc] of DIAG) if (inPalace(side, row + dr, col + dc)) add(row + dr, col + dc);
      break;
    case ELEPHANT:
      for (const [dr, dc] of DIAG) {
        const r = row + dr * 2;
        const c = col + dc * 2;
        if (onBoard(r, c) && onHomeSide(side, r) && board[(row + dr) * 9 + col + dc] === 0) add(r, c);
      }
      break;
    case HORSE:
      for (const [dr, dc, lr, lc] of HORSE_STEPS) {
        const r = row + dr;
        const c = col + dc;
        if (onBoard(r, c) && board[(row + lr) * 9 + col + lc] === 0) add(r, c);
      }
      break;
    case ROOK:
      for (const [dr, dc] of ORTH) {
        for (let r = row + dr, c = col + dc; onBoard(r, c); r += dr, c += dc) {
          const t = board[r * 9 + c];
          if (t === 0) out.push(from | ((r * 9 + c) << 8));
          else {
            if (t * s < 0) out.push(from | ((r * 9 + c) << 8));
            break;
          }
        }
      }
      break;
    case CANNON:
      for (const [dr, dc] of ORTH) {
        let screen = false;
        for (let r = row + dr, c = col + dc; onBoard(r, c); r += dr, c += dc) {
          const t = board[r * 9 + c];
          if (!screen) {
            if (t === 0) out.push(from | ((r * 9 + c) << 8));
            else screen = true;
          } else if (t !== 0) {
            if (t * s < 0) out.push(from | ((r * 9 + c) << 8));
            break;
          }
        }
      }
      break;
    case PAWN: {
      const forward = side === 'r' ? -1 : 1;
      if (onBoard(row + forward, col)) add(row + forward, col);
      if (!onHomeSide(side, row)) {
        if (col > 0) add(row, col - 1);
        if (col < COLS - 1) add(row, col + 1);
      }
      break;
    }
  }
}

export function genPseudo(board: Int8Array, side: Side, out: number[] = []): number[] {
  const s = side === 'r' ? 1 : -1;
  for (let i = 0; i < 90; i++) if (board[i] * s > 0) genPieceMoves(board, i, out);
  return out;
}

/** Ô `target` có bị quân của `by` đánh tới hay không (không tính luật đối mặt). */
export function isAttacked(board: Int8Array, target: number, by: Side): boolean {
  const s = by === 'r' ? 1 : -1;
  const row = (target / 9) | 0;
  const col = target % 9;

  // Xe và Pháo theo bốn hướng.
  for (const [dr, dc] of ORTH) {
    let seen = 0;
    for (let r = row + dr, c = col + dc; onBoard(r, c); r += dr, c += dc) {
      const t = board[r * 9 + c];
      if (t === 0) continue;
      seen++;
      if (seen === 1) {
        if (t === s * ROOK) return true;
      } else {
        if (t === s * CANNON) return true;
        break;
      }
    }
  }
  // Mã: chân Mã nằm cạnh quân Mã, không phải cạnh ô bị đánh.
  for (const [dr, dc, lr, lc] of HORSE_STEPS) {
    const r = row - dr;
    const c = col - dc;
    if (onBoard(r, c) && board[r * 9 + c] === s * HORSE && board[(r + lr) * 9 + c + lc] === 0) return true;
  }
  // Tốt.
  const back = by === 'r' ? 1 : -1;
  if (onBoard(row + back, col) && board[(row + back) * 9 + col] === s * PAWN) return true;
  if (!onHomeSide(by, row)) {
    if (col > 0 && board[row * 9 + col - 1] === s * PAWN) return true;
    if (col < 8 && board[row * 9 + col + 1] === s * PAWN) return true;
  }
  // Tướng, Sĩ, Tượng – chỉ đánh được quanh sân nhà.
  for (const [dr, dc] of ORTH) {
    if (inPalace(by, row + dr, col + dc) && inPalace(by, row, col) && board[(row + dr) * 9 + col + dc] === s * KING) return true;
  }
  if (inPalace(by, row, col)) {
    for (const [dr, dc] of DIAG) {
      if (inPalace(by, row + dr, col + dc) && board[(row + dr) * 9 + col + dc] === s * ADVISOR) return true;
    }
  }
  if (onHomeSide(by, row)) {
    for (const [dr, dc] of DIAG) {
      const r = row + dr * 2;
      const c = col + dc * 2;
      if (onBoard(r, c) && board[r * 9 + c] === s * ELEPHANT && board[(row + dr) * 9 + col + dc] === 0) return true;
    }
  }
  return false;
}

/** Hai Tướng cùng cột và không có quân chắn. */
export function kingsFacing(board: Int8Array): boolean {
  const red = findKing(board, 'r');
  const black = findKing(board, 'b');
  if (red < 0 || black < 0 || red % 9 !== black % 9) return false;
  for (let s = black + 9; s < red; s += 9) if (board[s] !== 0) return false;
  return true;
}

export function isInCheck(board: Int8Array, side: Side): boolean {
  const king = findKing(board, side);
  return king >= 0 && isAttacked(board, king, other(side));
}

/** Tướng của `side` có đang ở thế không được phép sau khi đi xong? */
export function kingUnsafe(board: Int8Array, side: Side): boolean {
  return kingsFacing(board) || isInCheck(board, side);
}

export function isLegalPseudo(board: Int8Array, side: Side, move: number): boolean {
  const from = moveFrom(move);
  const to = moveTo(move);
  const moved = board[from];
  const captured = board[to];
  board[to] = moved;
  board[from] = 0;
  const unsafe = kingUnsafe(board, side);
  board[from] = moved;
  board[to] = captured;
  return !unsafe;
}

export function legalMoves(pos: Position): number[] {
  return genPseudo(pos.board, pos.turn).filter((m) => isLegalPseudo(pos.board, pos.turn, m));
}

export function legalTargets(pos: Position, from: number): number[] {
  const s = pos.turn === 'r' ? 1 : -1;
  if (pos.board[from] * s <= 0) return [];
  const out: number[] = [];
  genPieceMoves(pos.board, from, out);
  return out.filter((m) => isLegalPseudo(pos.board, pos.turn, m)).map(moveTo);
}

export const hasLegalMove = (pos: Position): boolean =>
  genPseudo(pos.board, pos.turn).some((m) => isLegalPseudo(pos.board, pos.turn, m));

export function applyMove(pos: Position, from: number, to: number): Position {
  const board = pos.board.slice();
  board[to] = board[from];
  board[from] = 0;
  return { board, turn: other(pos.turn) };
}
