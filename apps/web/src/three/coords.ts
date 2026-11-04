/**
 * Phép chuyển đổi duy nhất giữa tọa độ bàn cờ và tọa độ 3D.
 * Mọi tọa độ dưới đây là tọa độ cục bộ của nhóm `boardRoot`; khi đảo bàn, chỉ
 * nhóm đó quay 180° quanh trục Y nên luật cờ không hề biết tới việc đảo bàn.
 *   cột 0..8  ↦ x = -4..4 (mỗi ô 1 đơn vị)
 *   hàng 0..9 ↦ z = -4.5..4.5
 */
import { colOf, rowOf, sq } from '@kydao/engine';

export const CELL = 1;
export const PIECE_RADIUS = 0.44;
export const PIECE_HEIGHT = 0.2;
export const BOARD_W = 9.6;
export const BOARD_D = 10.6;

export const sqX = (s: number): number => (colOf(s) - 4) * CELL;
export const sqZ = (s: number): number => (rowOf(s) - 4.5) * CELL;

/** Điểm cục bộ → ô gần nhất; -1 nếu nằm ngoài vùng chạm (0.55 ô quanh giao điểm). */
export function localToSquare(x: number, z: number): number {
  const col = Math.round(x / CELL + 4);
  const row = Math.round(z / CELL + 4.5);
  if (col < 0 || col > 8 || row < 0 || row > 9) return -1;
  const dx = x - (col - 4) * CELL;
  const dz = z - (row - 4.5) * CELL;
  return dx * dx + dz * dz <= 0.3025 ? sq(row, col) : -1;
}
