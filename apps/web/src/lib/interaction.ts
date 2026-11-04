/** Chọn quân và chọn đích – dùng chung cho ván local và online. */
import { ILLEGAL_MESSAGE, Position, START_FEN, Side, checkMove, legalTargets, parseFen, sideOf } from '@kydao/engine';
import { useBoardView } from '../store/boardView';
import { director } from '../three/director';
import { playSound } from './sound';
import { toast } from './toast';

export function clearSelection() {
  useBoardView.getState().set({ selected: -1, targets: [] });
  director.setSelected(-1);
}

/** Bàn cờ trưng bày ở trình đơn: thế khai cuộc, không còn dấu vết ván trước. */
export function showMenuBoard() {
  const board = parseFen(START_FEN).board;
  clearSelection();
  useBoardView.getState().set({
    board, showcase: true, interactive: false, onSquare: null, lastMove: null, checkSquare: -1, hint: null, flipped: false,
  });
  director.sync(board);
}

function select(pos: Position, s: number) {
  const targets = legalTargets(pos, s);
  useBoardView.getState().set({ selected: s, targets });
  director.setSelected(s);
  playSound('select');
  if (targets.length === 0) toast('Quân này chưa có nước đi hợp lệ');
}

export function clickSquare(
  pos: Position,
  canControl: (side: Side) => boolean,
  s: number,
  submit: (from: number, to: number) => void,
) {
  const { selected, targets } = useBoardView.getState();
  const piece = pos.board[s];
  const mine = piece !== 0 && sideOf(piece) === pos.turn && canControl(pos.turn);
  if (selected >= 0) {
    if (s === selected) return clearSelection();
    if (targets.includes(s)) {
      clearSelection();
      return submit(selected, s);
    }
    if (mine) return select(pos, s);
    const code = checkMove(pos, selected, s);
    if (code) toast(ILLEGAL_MESSAGE[code]);
    playSound('illegal');
    return;
  }
  if (mine) select(pos, s);
  else if (piece !== 0 && canControl(pos.turn)) toast('Đây là quân đối phương');
}
