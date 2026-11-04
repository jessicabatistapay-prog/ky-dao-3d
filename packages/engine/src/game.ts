/** Một ván cờ: danh sách nước + thế hiện tại. Dùng chung cho client và server. */
import { Position, START_FEN, Side, clonePosition, findKing, isValidSquare, other, parseFen, toFen } from './board';
import { DrawPolicy, casualPolicy } from './drawPolicy';
import { IllegalCode, checkMove } from './explain';
import { applyMove, hasLegalMove, isInCheck } from './moves';
import { moveNotation } from './notation';

export type EndReason =
  | 'checkmate' | 'stalemate' | 'timeout' | 'resign' | 'abandon' | 'agreement'
  | 'repetition' | 'no-capture' | 'insufficient' | 'interrupted';

export interface GameResult {
  winner: Side | null;
  reason: EndReason;
}

export const END_REASON_TEXT: Record<EndReason, string> = {
  checkmate: 'Chiếu bí',
  stalemate: 'Hết nước đi hợp lệ',
  timeout: 'Hết giờ',
  resign: 'Đầu hàng',
  abandon: 'Bỏ cuộc do không kết nối lại kịp',
  agreement: 'Hai bên đồng ý hòa',
  repetition: 'Lặp lại thế cờ ba lần',
  'no-capture': '60 nước mỗi bên không ăn quân',
  insufficient: 'Hai bên không còn quân tấn công',
  interrupted: 'Ván bị gián đoạn do máy chủ khởi động lại',
};

export interface MoveRecord {
  from: number;
  to: number;
  piece: number;
  captured: number;
  notation: string;
  check: boolean;
}

export interface SerializedGame {
  initialFen: string;
  moves: [number, number][];
}

export type PlayResult =
  | { ok: true; record: MoveRecord; result: GameResult | null }
  | { ok: false; code: IllegalCode };

export class XiangqiGame {
  readonly initialFen: string;
  position: Position;
  moves: MoveRecord[] = [];
  /** Khóa thế cờ, phần tử 0 là thế ban đầu. */
  private keys: string[];
  private quiet: number[] = [0];
  result: GameResult | null = null;

  constructor(initialFen: string = START_FEN, private readonly policy: DrawPolicy = casualPolicy) {
    this.initialFen = initialFen;
    this.position = parseFen(initialFen);
    this.keys = [toFen(this.position)];
    this.result = this.computeResult();
  }

  get turn(): Side {
    return this.position.turn;
  }
  get fen(): string {
    return this.keys[this.keys.length - 1];
  }
  get ply(): number {
    return this.moves.length;
  }
  get inCheck(): boolean {
    return isInCheck(this.position.board, this.position.turn);
  }
  /** Ô của Tướng đang bị chiếu, -1 nếu không có. */
  get checkedKing(): number {
    return this.inCheck ? findKing(this.position.board, this.position.turn) : -1;
  }

  private computeResult(): GameResult | null {
    if (!hasLegalMove(this.position)) {
      const loser = this.position.turn;
      return { winner: other(loser), reason: isInCheck(this.position.board, loser) ? 'checkmate' : 'stalemate' };
    }
    const draw = this.policy.evaluate({
      board: this.position.board,
      history: this.keys,
      quietPlies: this.quiet[this.quiet.length - 1],
    });
    return draw ? { winner: null, reason: draw } : null;
  }

  play(from: number, to: number): PlayResult {
    if (this.result) return { ok: false, code: 'WRONG_TURN' };
    const code = checkMove(this.position, from, to);
    if (code) return { ok: false, code };
    const before = this.position;
    const piece = before.board[from];
    const captured = before.board[to];
    const notation = moveNotation(before, from, to);
    this.position = applyMove(before, from, to);
    this.keys.push(toFen(this.position));
    this.quiet.push(captured ? 0 : this.quiet[this.quiet.length - 1] + 1);
    const record: MoveRecord = {
      from, to, piece, captured, notation, check: isInCheck(this.position.board, this.position.turn),
    };
    this.moves.push(record);
    this.result = this.computeResult();
    return { ok: true, record, result: this.result };
  }

  /** Hoàn tác n nửa nước; xóa cả kết quả nếu có. Trả về số nửa nước đã hoàn tác. */
  undo(plies = 1): number {
    const n = Math.min(plies, this.moves.length);
    if (n === 0) return 0;
    this.moves.length -= n;
    this.keys.length -= n;
    this.quiet.length -= n;
    this.position = parseFen(this.keys[this.keys.length - 1]);
    this.result = this.computeResult();
    return n;
  }

  /** Kết thúc ván bởi nguyên nhân ngoài bàn cờ. Chỉ có tác dụng một lần. */
  finish(result: GameResult): boolean {
    if (this.result) return false;
    this.result = result;
    return true;
  }

  /** Thế cờ sau `ply` nửa nước, dùng cho xem lại. */
  positionAt(ply: number): Position {
    return parseFen(this.keys[Math.max(0, Math.min(ply, this.moves.length))]);
  }

  serialize(): SerializedGame {
    return { initialFen: this.initialFen, moves: this.moves.map((m) => [m.from, m.to]) };
  }

  snapshotPosition(): Position {
    return clonePosition(this.position);
  }

  /** Dựng lại ván bằng cách đi lại từng nước – dữ liệu sai sẽ ném lỗi. */
  static replay(data: SerializedGame): XiangqiGame {
    if (!data || typeof data.initialFen !== 'string' || !Array.isArray(data.moves) || data.moves.length > 5000) {
      throw new Error('Dữ liệu ván không hợp lệ');
    }
    const game = new XiangqiGame(data.initialFen);
    for (const pair of data.moves) {
      if (!Array.isArray(pair) || !isValidSquare(pair[0]) || !isValidSquare(pair[1])) {
        throw new Error('Nước đi trong dữ liệu không hợp lệ');
      }
      const played = game.play(pair[0], pair[1]);
      if (!played.ok) throw new Error(`Nước đi không hợp lệ: ${played.code}`);
    }
    return game;
  }
}
