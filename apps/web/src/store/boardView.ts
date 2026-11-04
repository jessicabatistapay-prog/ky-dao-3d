/** Thứ mà cảnh 3D cần biết để vẽ phần phủ (chọn quân, đích đi, nước vừa đi). */
import { create } from 'zustand';

export interface BoardView {
  selected: number;
  targets: number[];
  lastMove: { from: number; to: number } | null;
  checkSquare: number;
  hint: { from: number; to: number } | null;
  flipped: boolean;
  interactive: boolean;
  /** Bàn cờ logic đang hiển thị (phục vụ tên quân và phân biệt đích ăn). */
  board: Int8Array;
  onSquare: ((s: number) => void) | null;
  cameraView: 'tilted' | 'top';
  cameraNonce: number;
  showcase: boolean;
  set(p: Partial<BoardView>): void;
}

export const useBoardView = create<BoardView>((set) => ({
  selected: -1,
  targets: [],
  lastMove: null,
  checkSquare: -1,
  hint: null,
  flipped: false,
  interactive: false,
  board: new Int8Array(90),
  onSquare: null,
  cameraView: 'tilted',
  cameraNonce: 0,
  showcase: true,
  set: (p) => set(p),
}));
