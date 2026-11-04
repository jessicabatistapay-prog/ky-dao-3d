/**
 * Mô hình bàn cờ thuần dữ liệu. Không biết gì về React hay Three.js.
 *
 * Ô = row * 9 + col. Hàng 0 là hàng cuối của Đen (trên cùng trong FEN),
 * hàng 9 là hàng cuối của Đỏ. Quân Đỏ là số dương, quân Đen là số âm.
 */
export const COLS = 9;
export const ROWS = 10;
export const SQUARES = 90;

export type Side = 'r' | 'b';

export const KING = 1;
export const ADVISOR = 2;
export const ELEPHANT = 3;
export const HORSE = 4;
export const ROOK = 5;
export const CANNON = 6;
export const PAWN = 7;
export type PieceType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

export interface Position {
  board: Int8Array;
  turn: Side;
}

export const sq = (row: number, col: number): number => row * COLS + col;
export const rowOf = (s: number): number => (s / COLS) | 0;
export const colOf = (s: number): number => s % COLS;
export const onBoard = (row: number, col: number): boolean =>
  row >= 0 && row < ROWS && col >= 0 && col < COLS;
export const isValidSquare = (s: unknown): s is number =>
  typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < SQUARES;

export const other = (side: Side): Side => (side === 'r' ? 'b' : 'r');
export const sideOf = (piece: number): Side | null => (piece > 0 ? 'r' : piece < 0 ? 'b' : null);
export const typeOf = (piece: number): PieceType => Math.abs(piece) as PieceType;
export const sign = (side: Side): 1 | -1 => (side === 'r' ? 1 : -1);

export const inPalace = (side: Side, row: number, col: number): boolean =>
  col >= 3 && col <= 5 && (side === 'r' ? row >= 7 && row <= 9 : row >= 0 && row <= 2);

/** Quân của `side` đang đứng trên phần sân của chính mình? */
export const onHomeSide = (side: Side, row: number): boolean => (side === 'r' ? row >= 5 : row <= 4);

const FEN_LETTERS: Record<string, PieceType> = { k: 1, a: 2, b: 3, e: 3, n: 4, h: 4, r: 5, c: 6, p: 7 };
const LETTER_OF = ['', 'k', 'a', 'b', 'n', 'r', 'c', 'p'];

export class FenError extends Error {}

export function parseFen(fen: string): Position {
  if (typeof fen !== 'string' || fen.length > 120) throw new FenError('FEN không hợp lệ');
  const [placement, turnChar] = fen.trim().split(/\s+/);
  const rows = (placement ?? '').split('/');
  if (rows.length !== ROWS) throw new FenError('FEN phải có 10 hàng');
  const board = new Int8Array(SQUARES);
  rows.forEach((text, row) => {
    let col = 0;
    for (const ch of text) {
      if (ch >= '1' && ch <= '9') {
        col += Number(ch);
        continue;
      }
      const type = FEN_LETTERS[ch.toLowerCase()];
      if (!type || col >= COLS) throw new FenError(`Ký tự FEN sai: ${ch}`);
      board[sq(row, col)] = ch === ch.toUpperCase() ? type : -type;
      col++;
    }
    if (col !== COLS) throw new FenError(`Hàng ${row} không đủ 9 cột`);
  });
  if (turnChar !== undefined && !['w', 'r', 'b'].includes(turnChar)) throw new FenError('Lượt đi sai');
  return { board, turn: turnChar === 'b' ? 'b' : 'r' };
}

export function toFen(pos: Position): string {
  const rows: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    let text = '';
    let empty = 0;
    for (let col = 0; col < COLS; col++) {
      const p = pos.board[sq(row, col)];
      if (p === 0) {
        empty++;
        continue;
      }
      if (empty) text += empty;
      empty = 0;
      const letter = LETTER_OF[Math.abs(p)];
      text += p > 0 ? letter.toUpperCase() : letter;
    }
    if (empty) text += empty;
    rows.push(text);
  }
  return `${rows.join('/')} ${pos.turn === 'r' ? 'w' : 'b'}`;
}

export const clonePosition = (pos: Position): Position => ({ board: pos.board.slice(), turn: pos.turn });

export function findKing(board: Int8Array, side: Side): number {
  const target = side === 'r' ? KING : -KING;
  // Tướng luôn ở trong cửu cung nên chỉ cần quét đúng 9 ô đó.
  const start = side === 'r' ? 7 : 0;
  for (let row = start; row < start + 3; row++) {
    for (let col = 3; col <= 5; col++) if (board[row * 9 + col] === target) return row * 9 + col;
  }
  return -1;
}

const HAN: Record<Side, string[]> = {
  r: ['', '帥', '仕', '相', '傌', '俥', '炮', '兵'],
  b: ['', '將', '士', '象', '馬', '車', '砲', '卒'],
};
export const hanOf = (piece: number): string => HAN[piece > 0 ? 'r' : 'b'][Math.abs(piece)] ?? '';

const NAMES = ['', 'Tướng', 'Sĩ', 'Tượng', 'Mã', 'Xe', 'Pháo', 'Tốt'];
export const nameOf = (piece: number): string => NAMES[Math.abs(piece)] ?? '';
export const SIDE_NAME: Record<Side, string> = { r: 'Đỏ', b: 'Đen' };
