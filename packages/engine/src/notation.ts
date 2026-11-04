/** Ký hiệu nước đi kiểu Việt: "Pháo 2 bình 5", "Mã 8 tiến 7", "Xe trước tiến 3". */
import { ADVISOR, ELEPHANT, HORSE, Position, Side, colOf, nameOf, rowOf, sideOf, sq, typeOf } from './board';

const fileNo = (side: Side, col: number): number => (side === 'r' ? 9 - col : col + 1);

export function moveNotation(pos: Position, from: number, to: number): string {
  const piece = pos.board[from];
  const side = sideOf(piece)!;
  const type = typeOf(piece);
  const col = colOf(from);
  const forward = side === 'r' ? rowOf(from) - rowOf(to) : rowOf(to) - rowOf(from);

  // Các quân cùng loại trên cùng cột, xếp từ trước ra sau theo hướng nhìn của bên đi.
  const same: number[] = [];
  for (let row = 0; row < 10; row++) if (pos.board[sq(row, col)] === piece) same.push(sq(row, col));
  if (side === 'b') same.reverse();

  let label: string;
  if (same.length === 1 || type === ADVISOR || type === ELEPHANT) label = `${nameOf(piece)} ${fileNo(side, col)}`;
  else if (same.length === 2) label = `${nameOf(piece)} ${same[0] === from ? 'trước' : 'sau'}`;
  else label = `${nameOf(piece)} ${same.indexOf(from) + 1}/${same.length}`;

  const toFile = fileNo(side, colOf(to));
  if (forward === 0) return `${label} bình ${toFile}`;
  const verb = forward > 0 ? 'tiến' : 'thoái';
  const diagonal = type === ADVISOR || type === ELEPHANT || type === HORSE;
  return `${label} ${verb} ${diagonal ? toFile : Math.abs(forward)}`;
}
