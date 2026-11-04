/** Tìm kiếm alpha-beta có iterative deepening, bảng chuyển vị và sắp xếp nước. */
import { Position, START_FEN, Side, other, parseFen } from '../board';
import { genPseudo, isInCheck, isLegalPseudo, legalMoves, moveFrom, moveTo } from '../moves';
import { VALUE, evaluate } from './eval';

export type AiLevel = 'easy' | 'medium' | 'hard';

export interface LevelConfig {
  maxDepth: number;
  timeMs: number;
  /** Biên độ nhiễu cộng vào điểm nước gốc. */
  noise: number;
  /** Xác suất đi hẳn một nước ngẫu nhiên trong nhóm khá. */
  blunder: number;
  deepEval: boolean;
}

export const LEVELS: Record<AiLevel, LevelConfig> = {
  easy: { maxDepth: 2, timeMs: 350, noise: 90, blunder: 0.15, deepEval: false },
  medium: { maxDepth: 4, timeMs: 900, noise: 14, blunder: 0, deepEval: true },
  hard: { maxDepth: 24, timeMs: 2400, noise: 0, blunder: 0, deepEval: true },
};

export interface SearchRequest {
  initialFen?: string;
  moves?: [number, number][];
  fen?: string;
  level: AiLevel;
  timeMs?: number;
  seed?: number;
}

export interface SearchResult {
  from: number;
  to: number;
  score: number;
  depth: number;
  nodes: number;
  timeMs: number;
}

const MATE = 30000;
const MATE_NEAR = 29000;
const INF = 32000;
const MAX_PLY = 64;

// Zobrist: 2 từ 32 bit để giảm va chạm.
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
const ZR = mulberry(20260611);
const ZA = new Int32Array(15 * 90);
const ZB = new Int32Array(15 * 90);
for (let i = 0; i < ZA.length; i++) {
  ZA[i] = ZR() | 0;
  ZB[i] = ZR() | 0;
}
const SIDE_A = ZR() | 0;
const SIDE_B = ZR() | 0;
const zIndex = (p: number, s: number): number => (p + 7) * 90 + s;

const TT_BITS = 19;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const FLAG_EXACT = 1;
const FLAG_LOWER = 2;
const FLAG_UPPER = 3;

class Abort extends Error {}

export class Searcher {
  private ttKey = new Int32Array(TT_SIZE);
  private ttVal = new Int32Array(TT_SIZE); // score<<16 | move (16 bit)
  private ttMeta = new Int8Array(TT_SIZE * 2); // depth, flag
  private board = new Int8Array(90);
  private turn: Side = 'r';
  private hashA = 0;
  private hashB = 0;
  private stack = new Int32Array(1024);
  private stackLen = 0;
  private killers = new Int32Array(MAX_PLY * 2);
  private history = new Int32Array(90 * 90);
  private nodes = 0;
  private deadline = 0;
  private deepEval = true;
  private capsBuf: number[][] = [];
  private qBuf: number[][] = [];

  private hashFull(): void {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 90; i++) {
      const p = this.board[i];
      if (p) {
        a ^= ZA[zIndex(p, i)];
        b ^= ZB[zIndex(p, i)];
      }
    }
    if (this.turn === 'b') {
      a ^= SIDE_A;
      b ^= SIDE_B;
    }
    this.hashA = a;
    this.hashB = b;
  }

  private make(m: number): number {
    const from = m & 255;
    const to = m >> 8;
    const board = this.board;
    const p = board[from];
    const c = board[to];
    let a = this.hashA ^ ZA[zIndex(p, from)] ^ ZA[zIndex(p, to)] ^ SIDE_A;
    let b = this.hashB ^ ZB[zIndex(p, from)] ^ ZB[zIndex(p, to)] ^ SIDE_B;
    if (c) {
      a ^= ZA[zIndex(c, to)];
      b ^= ZB[zIndex(c, to)];
    }
    board[to] = p;
    board[from] = 0;
    this.stack[this.stackLen++] = this.hashA;
    this.hashA = a;
    this.hashB = b;
    this.turn = this.turn === 'r' ? 'b' : 'r';
    return c;
  }

  private unmake(m: number, c: number, savedB: number): void {
    const from = m & 255;
    const to = m >> 8;
    this.board[from] = this.board[to];
    this.board[to] = c;
    this.hashA = this.stack[--this.stackLen];
    this.hashB = savedB;
    this.turn = this.turn === 'r' ? 'b' : 'r';
  }

  private repeated(): boolean {
    const n = this.stackLen;
    for (let i = n - 2; i >= 0 && i >= n - 60; i -= 2) if (this.stack[i] === this.hashA) return true;
    return false;
  }

  private checkTime(): void {
    if ((++this.nodes & 2047) === 0 && Date.now() > this.deadline) throw new Abort();
  }

  private store(depth: number, score: number, flag: number, move: number, ply: number): void {
    const i = this.hashA & TT_MASK;
    if (this.ttMeta[i * 2] > depth && this.ttKey[i] !== this.hashB) return;
    if (score > MATE_NEAR) score += ply;
    else if (score < -MATE_NEAR) score -= ply;
    this.ttKey[i] = this.hashB;
    this.ttVal[i] = (score << 16) | (move & 0xffff);
    this.ttMeta[i * 2] = depth;
    this.ttMeta[i * 2 + 1] = flag;
  }

  private ordered(moves: number[], ttMove: number, ply: number): void {
    const board = this.board;
    const k1 = this.killers[ply * 2];
    const k2 = this.killers[ply * 2 + 1];
    const score = new Map<number, number>();
    for (const m of moves) {
      const from = m & 255;
      const to = m >> 8;
      let s: number;
      if (m === ttMove) s = 1 << 28;
      else if (board[to]) s = (1 << 24) + VALUE[Math.abs(board[to])] * 16 - VALUE[Math.abs(board[from])];
      else if (m === k1) s = 1 << 23;
      else if (m === k2) s = (1 << 23) - 1;
      else s = this.history[from * 90 + to];
      score.set(m, s);
    }
    moves.sort((a, b) => score.get(b)! - score.get(a)!);
  }

  private quiesce(alpha: number, beta: number, ply: number, qd: number): number {
    this.checkTime();
    const stm = this.turn;
    const inCheck = isInCheck(this.board, stm);
    if (!inCheck) {
      const stand = evaluate(this.board, stm, this.deepEval && qd === 0);
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      if (qd >= 6) return alpha;
    } else if (qd >= 8) return evaluate(this.board, stm, false);

    const buf = this.qBuf[qd] ?? (this.qBuf[qd] = []);
    buf.length = 0;
    genPseudo(this.board, stm, buf);
    let moves = buf;
    if (!inCheck) moves = buf.filter((m) => this.board[m >> 8] !== 0);
    this.ordered(moves, 0, Math.min(ply, MAX_PLY - 1));
    let any = false;
    for (const m of moves) {
      if (!isLegalPseudo(this.board, stm, m)) continue;
      any = true;
      const savedB = this.hashB;
      const c = this.make(m);
      const score = -this.quiesce(-beta, -alpha, ply + 1, qd + 1);
      this.unmake(m, c, savedB);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    if (inCheck && !any) return -MATE + ply;
    return alpha;
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number, canNull: boolean): number {
    if (ply > 0 && this.repeated()) return 0;
    if (ply >= MAX_PLY - 1) return evaluate(this.board, this.turn, false);
    const stm = this.turn;
    const inCheck = isInCheck(this.board, stm);
    if (inCheck) depth++;
    if (depth <= 0) return this.quiesce(alpha, beta, ply, 0);
    this.checkTime();

    const i = this.hashA & TT_MASK;
    let ttMove = 0;
    if (this.ttKey[i] === this.hashB && this.ttMeta[i * 2 + 1] !== 0) {
      const v = this.ttVal[i];
      ttMove = v & 0xffff;
      if (this.ttMeta[i * 2] >= depth && ply > 0) {
        let sc = v >> 16;
        if (sc > MATE_NEAR) sc -= ply;
        else if (sc < -MATE_NEAR) sc += ply;
        const flag = this.ttMeta[i * 2 + 1];
        if (flag === FLAG_EXACT) return sc;
        if (flag === FLAG_LOWER && sc >= beta) return sc;
        if (flag === FLAG_UPPER && sc <= alpha) return sc;
      }
    }

    // Null-move: bỏ qua khi bị chiếu hoặc ở tàn cuộc dễ gặp thế bí nước.
    if (canNull && !inCheck && depth >= 3 && ply > 0 && beta < MATE_NEAR && this.heavyCount(stm) >= 2) {
      const a = this.hashA;
      const b = this.hashB;
      this.hashA ^= SIDE_A;
      this.hashB ^= SIDE_B;
      this.turn = other(stm);
      const sc = -this.negamax(depth - 3, -beta, -beta + 1, ply + 1, false);
      this.turn = stm;
      this.hashA = a;
      this.hashB = b;
      if (sc >= beta && sc < MATE_NEAR) return beta;
    }

    const buf = this.capsBuf[ply] ?? (this.capsBuf[ply] = []);
    buf.length = 0;
    genPseudo(this.board, stm, buf);
    this.ordered(buf, ttMove, ply);

    let best = -INF;
    let bestMove = 0;
    let legal = 0;
    const startAlpha = alpha;
    for (let idx = 0; idx < buf.length; idx++) {
      const m = buf[idx];
      if (!isLegalPseudo(this.board, stm, m)) continue;
      legal++;
      const quiet = this.board[m >> 8] === 0;
      const savedB = this.hashB;
      const c = this.make(m);
      let score: number;
      if (legal === 1) {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        const reduce = quiet && !inCheck && depth >= 3 && legal > 4 ? (legal > 12 ? 2 : 1) : 0;
        score = -this.negamax(depth - 1 - reduce, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && (reduce > 0 || score < beta)) {
          score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
        }
      }
      this.unmake(m, c, savedB);
      if (score > best) {
        best = score;
        bestMove = m;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (quiet) {
          const k = ply * 2;
          if (this.killers[k] !== m) {
            this.killers[k + 1] = this.killers[k];
            this.killers[k] = m;
          }
          this.history[(m & 255) * 90 + (m >> 8)] += depth * depth;
        }
        break;
      }
    }
    if (legal === 0) return -MATE + ply; // chiếu bí và hết nước đều là thua
    this.store(depth, best, best >= beta ? FLAG_LOWER : best > startAlpha ? FLAG_EXACT : FLAG_UPPER, bestMove, ply);
    return best;
  }

  private heavyCount(side: Side): number {
    const s = side === 'r' ? 1 : -1;
    let n = 0;
    for (let i = 0; i < 90; i++) {
      const t = this.board[i] * s;
      if (t >= 4 && t <= 6) n++;
    }
    return n;
  }

  private rootSearch(depth: number, moves: { m: number; score: number }[], noise: (m: number) => number): number {
    let alpha = -INF;
    for (let idx = 0; idx < moves.length; idx++) {
      const item = moves[idx];
      const savedB = this.hashB;
      const c = this.make(item.m);
      let score: number;
      const useFull = noise(item.m) !== 0 || idx === 0;
      if (useFull) score = -this.negamax(depth - 1, -INF, INF, 1, true);
      else {
        score = -this.negamax(depth - 1, -alpha - 1, -alpha, 1, true);
        if (score > alpha) score = -this.negamax(depth - 1, -INF, INF, 1, true);
      }
      this.unmake(item.m, c, savedB);
      item.score = score + noise(item.m);
      if (item.score > alpha) alpha = item.score;
    }
    moves.sort((a, b) => b.score - a.score);
    return moves[0].score;
  }

  search(req: SearchRequest): SearchResult {
    const started = Date.now();
    const cfg = LEVELS[req.level];
    const timeMs = req.timeMs ?? cfg.timeMs;
    const rnd = mulberry(req.seed ?? (Date.now() & 0xffffff));
    const { pos, seen } = reconstruct(req);
    const rootMoves = legalMoves(pos);
    if (rootMoves.length === 0) throw new Error('Không còn nước đi hợp lệ');

    this.board = pos.board.slice();
    this.turn = pos.turn;
    this.hashFull();
    this.stackLen = 0;
    this.nodes = 0;
    this.deepEval = cfg.deepEval;
    this.killers.fill(0);
    this.history.fill(0);
    this.deadline = started + timeMs;

    // Thế đã xuất hiện trong ván: đặt vào stack để `repeated` nhìn thấy.
    for (const key of seen) this.stack[this.stackLen++] = key;

    const noiseMap = new Map<number, number>();
    if (cfg.noise) for (const m of rootMoves) noiseMap.set(m, Math.round((rnd() / 0xffffffff - 0.5) * cfg.noise * 2) || 1);
    const noise = (m: number) => noiseMap.get(m) ?? 0;

    const list = rootMoves.map((m) => ({ m, score: 0 }));
    // Xáo nhẹ để khai cuộc không lặp y hệt giữa các ván.
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor((rnd() / 0xffffffff) * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    let best = list[0];
    let bestScore = 0;
    let bestDepth = 0;
    let bestSnapshot = list.map((x) => ({ ...x }));
    for (let depth = 1; depth <= cfg.maxDepth; depth++) {
      try {
        this.rootSearch(depth, list, noise);
      } catch (e) {
        if (e instanceof Abort) {
          // Khôi phục từ thế gốc – chỉ dùng kết quả của vòng đã hoàn tất.
          break;
        }
        throw e;
      }
      best = list[0];
      bestScore = best.score;
      bestDepth = depth;
      bestSnapshot = list.map((x) => ({ ...x }));
      if (Math.abs(bestScore) > MATE_NEAR || rootMoves.length === 1) break;
      // Không bắt đầu vòng mới nếu gần chắc không kịp xong.
      if (Date.now() - started > timeMs * 0.55) break;
    }

    let chosen = bestSnapshot[0] ?? best;
    if (cfg.blunder && rnd() / 0xffffffff < cfg.blunder) {
      const pool = bestSnapshot.slice(0, Math.min(6, bestSnapshot.length));
      chosen = pool[Math.floor((rnd() / 0xffffffff) * pool.length)];
    }
    if (!rootMoves.includes(chosen.m)) chosen = { m: rootMoves[0], score: 0 };
    return {
      from: moveFrom(chosen.m), to: moveTo(chosen.m), score: chosen.score, depth: bestDepth,
      nodes: this.nodes, timeMs: Date.now() - started,
    };
  }
}

function reconstruct(req: SearchRequest): { pos: Position; seen: number[] } {
  const s = new Searcher0();
  let pos = parseFen(req.fen ?? req.initialFen ?? START_FEN);
  const seen: number[] = [s.hash(pos)];
  for (const [from, to] of req.moves ?? []) {
    const board = pos.board.slice();
    board[to] = board[from];
    board[from] = 0;
    pos = { board, turn: other(pos.turn) };
    seen.push(s.hash(pos));
  }
  seen.pop(); // thế hiện tại sẽ được so bởi hashA
  return { pos, seen: seen.slice(-64) };
}

class Searcher0 {
  hash(pos: Position): number {
    let a = 0;
    for (let i = 0; i < 90; i++) if (pos.board[i]) a ^= ZA[zIndex(pos.board[i], i)];
    if (pos.turn === 'b') a ^= SIDE_A;
    return a;
  }
}

