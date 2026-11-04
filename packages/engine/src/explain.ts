/** Giải thích ngắn gọn vì sao một nước bị từ chối – dùng cho thông báo trong ván. */
import {
  ADVISOR, CANNON, ELEPHANT, HORSE, KING, PAWN, Position, ROOK, colOf, inPalace, isValidSquare,
  onHomeSide, rowOf, sideOf, typeOf,
} from './board';
import { genPieceMoves, isInCheck, kingsFacing, moveTo } from './moves';

export type IllegalCode =
  | 'BAD_SQUARE' | 'NO_PIECE' | 'WRONG_TURN' | 'OWN_PIECE' | 'BAD_SHAPE' | 'PALACE' | 'HORSE_BLOCKED'
  | 'ELEPHANT_BLOCKED' | 'ELEPHANT_RIVER' | 'PATH_BLOCKED' | 'CANNON_NO_SCREEN' | 'CANNON_MANY_SCREENS'
  | 'CANNON_NEEDS_TARGET' | 'PAWN_BACKWARD' | 'PAWN_SIDEWAYS' | 'KINGS_FACING' | 'STILL_IN_CHECK' | 'EXPOSES_KING';

export const ILLEGAL_MESSAGE: Record<IllegalCode, string> = {
  BAD_SQUARE: 'Ô không hợp lệ',
  NO_PIECE: 'Không có quân ở ô này',
  WRONG_TURN: 'Chưa đến lượt bên này',
  OWN_PIECE: 'Không thể ăn quân cùng phe',
  BAD_SHAPE: 'Quân này không đi như vậy',
  PALACE: 'Quân này không được rời cửu cung',
  HORSE_BLOCKED: 'Mã bị cản chân',
  ELEPHANT_BLOCKED: 'Tượng bị cản mắt',
  ELEPHANT_RIVER: 'Tượng không được qua sông',
  PATH_BLOCKED: 'Đường đi bị quân khác chắn',
  CANNON_NO_SCREEN: 'Pháo cần một quân làm ngòi để ăn',
  CANNON_MANY_SCREENS: 'Pháo chỉ được cách đúng một ngòi',
  CANNON_NEEDS_TARGET: 'Có ngòi thì Pháo chỉ đi được khi ăn quân',
  PAWN_BACKWARD: 'Tốt không được đi lùi',
  PAWN_SIDEWAYS: 'Tốt chỉ đi ngang sau khi qua sông',
  KINGS_FACING: 'Không thể để hai Tướng đối mặt',
  STILL_IN_CHECK: 'Tướng đang bị chiếu',
  EXPOSES_KING: 'Nước này khiến Tướng bị chiếu',
};

function between(board: Int8Array, from: number, to: number): number {
  const dr = Math.sign(rowOf(to) - rowOf(from));
  const dc = Math.sign(colOf(to) - colOf(from));
  let count = 0;
  for (let s = from + dr * 9 + dc; s !== to; s += dr * 9 + dc) if (board[s] !== 0) count++;
  return count;
}

function shapeReason(board: Int8Array, from: number, to: number): IllegalCode {
  const piece = board[from];
  const side = sideOf(piece)!;
  const dr = rowOf(to) - rowOf(from);
  const dc = colOf(to) - colOf(from);
  const adr = Math.abs(dr);
  const adc = Math.abs(dc);
  const straight = dr === 0 || dc === 0;
  switch (typeOf(piece)) {
    case KING:
      if (adr + adc !== 1) return 'BAD_SHAPE';
      return inPalace(side, rowOf(to), colOf(to)) ? 'BAD_SHAPE' : 'PALACE';
    case ADVISOR:
      if (adr !== 1 || adc !== 1) return 'BAD_SHAPE';
      return 'PALACE';
    case ELEPHANT:
      if (adr !== 2 || adc !== 2) return 'BAD_SHAPE';
      if (!onHomeSide(side, rowOf(to))) return 'ELEPHANT_RIVER';
      return board[from + (dr / 2) * 9 + dc / 2] !== 0 ? 'ELEPHANT_BLOCKED' : 'BAD_SHAPE';
    case HORSE:
      if (!((adr === 2 && adc === 1) || (adr === 1 && adc === 2))) return 'BAD_SHAPE';
      return 'HORSE_BLOCKED';
    case ROOK:
      return straight ? 'PATH_BLOCKED' : 'BAD_SHAPE';
    case CANNON: {
      if (!straight) return 'BAD_SHAPE';
      const screens = between(board, from, to);
      if (board[to] === 0) return screens > 0 ? 'CANNON_NEEDS_TARGET' : 'BAD_SHAPE';
      return screens === 0 ? 'CANNON_NO_SCREEN' : 'CANNON_MANY_SCREENS';
    }
    case PAWN: {
      const forward = side === 'r' ? -1 : 1;
      if (dr === -forward && dc === 0) return 'PAWN_BACKWARD';
      if (dr === 0 && adc === 1) return 'PAWN_SIDEWAYS';
      return 'BAD_SHAPE';
    }
  }
  return 'BAD_SHAPE';
}

/** Trả về null nếu nước đi hợp lệ, ngược lại là mã lý do. */
export function checkMove(pos: Position, from: number, to: number): IllegalCode | null {
  if (!isValidSquare(from) || !isValidSquare(to) || from === to) return 'BAD_SQUARE';
  const { board, turn } = pos;
  const piece = board[from];
  if (piece === 0) return 'NO_PIECE';
  if (sideOf(piece) !== turn) return 'WRONG_TURN';
  if (sideOf(board[to]) === turn) return 'OWN_PIECE';

  const options: number[] = [];
  genPieceMoves(board, from, options);
  if (!options.some((m) => moveTo(m) === to)) return shapeReason(board, from, to);

  const wasInCheck = isInCheck(board, turn);
  const captured = board[to];
  board[to] = piece;
  board[from] = 0;
  const facing = kingsFacing(board);
  const inCheck = isInCheck(board, turn);
  board[from] = piece;
  board[to] = captured;
  if (facing) return 'KINGS_FACING';
  if (inCheck) return wasInCheck ? 'STILL_IN_CHECK' : 'EXPOSES_KING';
  return null;
}
