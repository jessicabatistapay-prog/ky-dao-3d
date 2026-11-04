/** Ván chơi trên máy này: đấu với máy hoặc hai người cùng thiết bị. */
import { create } from 'zustand';
import { GameClock, GameResult, START_FEN, Side, XiangqiGame, findKing, other, legalMoves } from '@kydao/engine';
import { LEVELS } from '@kydao/engine/ai';
import { aiClient } from '../ai/aiClient';
import { LocalConfig, clearSave, loadSave, writeSave } from '../lib/save';
import { clearSelection, clickSquare } from '../lib/interaction';
import { playSound } from '../lib/sound';
import { toast } from '../lib/toast';
import { director } from '../three/director';
import { useBoardView } from './boardView';

const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

interface LocalState {
  active: boolean;
  config: LocalConfig;
  game: XiangqiGame | null;
  /** Tăng mỗi khi trạng thái ván đổi; giao diện đăng ký theo số này. */
  rev: number;
  gameId: string;
  thinking: boolean;
  hinting: boolean;
  result: GameResult | null;
  showResult: boolean;
  checkNonce: number;
  /** ply đang xem khi xem lại; null là đang chơi. */
  reviewPly: number | null;
  autoplay: boolean;
  clock: GameClock | null;

  start(config: LocalConfig): void;
  resume(): boolean;
  click(s: number): void;
  undo(): void;
  hint(): void;
  resign(): void;
  rematch(): void;
  exit(): void;
  review(ply: number): void;
  reviewStep(delta: number): void;
  toggleAutoplay(): void;
  closeResult(): void;
  tick(): void;
  persist(): void;
}

let turnToken = 0;
let autoTimer = 0;

const defaultConfig: LocalConfig = { mode: 'ai', humanSide: 'r', level: 'medium', baseMs: null, incMs: 0 };

export const useLocal = create<LocalState>((set, get) => {
  const bump = () => set({ rev: get().rev + 1 });

  /** Đẩy trạng thái logic hiện tại ra cảnh 3D. */
  const publishView = (hard: boolean) => {
    const { game, config } = get();
    if (!game) return;
    const last = game.moves[game.moves.length - 1];
    useBoardView.getState().set({
      board: game.position.board,
      lastMove: last ? { from: last.from, to: last.to } : null,
      checkSquare: game.checkedKing,
      hint: null,
      flipped: config.mode === 'ai' && config.humanSide === 'b',
      interactive: true,
      onSquare: (s) => get().click(s),
      showcase: false,
    });
    if (hard) director.sync(game.position.board);
  };

  const finish = (result: GameResult) => {
    const { clock, config } = get();
    clock?.stop();
    aiClient.cancel();
    turnToken++;
    clearSelection();
    clearSave();
    set({ result, thinking: false, hinting: false });
    useBoardView.getState().set({ interactive: false });
    // Chờ animation nước cuối rồi mới công bố kết quả.
    const delay = director.busy ? 950 : 300;
    const id = get().gameId;
    window.setTimeout(() => {
      if (get().gameId !== id || !get().result) return;
      if (result.winner) director.victory(findKing(get().game!.position.board, result.winner));
      if (!result.winner) playSound('draw');
      else if (config.mode === 'local' || result.winner === config.humanSide) playSound('win');
      else playSound('lose');
      set({ showResult: true });
    }, delay);
    bump();
  };

  const commit = (from: number, to: number) => {
    const { game, clock } = get();
    if (!game || game.result) return;
    const mover = game.turn;
    const played = game.play(from, to);
    if (!played.ok) return;
    clock?.press(mover);
    director.enqueue({
      from, to, piece: played.record.piece, captured: played.record.captured,
      check: played.record.check, boardAfter: game.position.board,
    });
    publishView(false);
    if (played.record.check && !played.result) {
      playSoundLater('check', played.record.captured ? 420 : 280);
      set({ checkNonce: get().checkNonce + 1 });
    }
    if (played.result) finish(played.result);
    else {
      get().persist();
      bump();
      maybeAi();
    }
  };

  const playSoundLater = (n: 'check', ms: number) => window.setTimeout(() => playSound(n), ms);

  const maybeAi = () => {
    const { game, config } = get();
    if (!game || game.result || config.mode !== 'ai' || game.turn === config.humanSide) return;
    const token = ++turnToken;
    const id = get().gameId;
    set({ thinking: true });
    const budget = LEVELS[config.level].timeMs;
    void aiClient.request({ ...game.serialize(), level: config.level }, budget).then((res) => {
      if (token !== turnToken || id !== get().gameId) return; // kết quả đã lỗi thời
      set({ thinking: false });
      const g = get().game;
      if (!g || g.result) return;
      if (res && g.position.board[res.from] !== 0) commit(res.from, res.to);
      else {
        // Worker gặp sự cố: vẫn phải đi để ván không bị kẹt.
        const moves = legalMoves(g.position);
        const m = moves[Math.floor(Math.random() * moves.length)];
        commit(m & 255, m >> 8);
      }
    });
  };

  const cancelAi = () => {
    turnToken++;
    aiClient.cancel();
    set({ thinking: false, hinting: false });
  };

  const makeClock = (config: LocalConfig, turn: Side, initial?: { r: number; b: number } | null) => {
    if (config.baseMs === null) return null;
    const c = new GameClock(config.baseMs, config.incMs, () => performance.now(), initial ?? undefined);
    c.start(turn);
    return c;
  };

  const begin = (game: XiangqiGame, config: LocalConfig, gameId: string, clock: GameClock | null) => {
    window.clearTimeout(autoTimer);
    cancelAi();
    clearSelection();
    set({
      active: true, game, config, gameId, clock, result: null, showResult: false, reviewPly: null, autoplay: false,
    });
    publishView(true);
    get().persist();
    bump();
    maybeAi();
  };

  return {
    active: false,
    config: defaultConfig,
    game: null,
    rev: 0,
    gameId: '',
    thinking: false,
    hinting: false,
    result: null,
    showResult: false,
    checkNonce: 0,
    reviewPly: null,
    autoplay: false,
    clock: null,

    start(config) {
      const game = new XiangqiGame(START_FEN);
      begin(game, config, newId(), makeClock(config, game.turn));
    },

    resume() {
      const loaded = loadSave();
      if (loaded.status === 'corrupt') {
        toast('Không đọc được ván đã lưu, dữ liệu đã được xóa');
        return false;
      }
      if (loaded.status !== 'ok') return false;
      const { data, game } = loaded;
      begin(game, data.config, data.gameId, makeClock(data.config, game.turn, data.clock));
      return true;
    },

    click(s) {
      const { game, config, thinking, result, reviewPly } = get();
      if (!game || result || thinking || reviewPly !== null) return;
      if (director.busy) return; // khóa thao tác trong lúc animation
      clickSquare(
        game.position,
        (side) => config.mode === 'local' || side === config.humanSide,
        s,
        commit,
      );
    },

    undo() {
      const { game, config, clock, result } = get();
      if (!game || result || game.ply === 0) return;
      cancelAi();
      clearSelection();
      let plies = 1;
      if (config.mode === 'ai') {
        // Luôn đưa người chơi về đúng lượt của mình.
        plies = game.turn === config.humanSide ? 2 : 1;
        if (game.ply < plies) plies = game.ply;
      }
      const undone: Side[] = [];
      let side = other(game.turn);
      for (let i = 0; i < plies; i++) {
        undone.push(side);
        side = other(side);
      }
      game.undo(plies);
      clock?.rewind(undone, game.turn);
      publishView(true);
      get().persist();
      bump();
      maybeAi(); // máy đi trước mà người chơi cầm Đen và đã lùi hết
    },

    hint() {
      const { game, config, thinking, hinting, result } = get();
      if (!game || config.mode !== 'ai' || thinking || hinting || result || game.turn !== config.humanSide) return;
      const id = get().gameId;
      const ply = game.ply;
      set({ hinting: true });
      void aiClient.request({ ...game.serialize(), level: 'hard', timeMs: 900 }, 900).then((r) => {
        if (id !== get().gameId) return;
        set({ hinting: false });
        if (r && get().game?.ply === ply) useBoardView.getState().set({ hint: { from: r.from, to: r.to } });
      });
    },

    resign() {
      const { game, config } = get();
      if (!game || game.result) return;
      const loser = config.mode === 'ai' ? config.humanSide : game.turn;
      const result: GameResult = { winner: other(loser), reason: 'resign' };
      game.finish(result);
      finish(result);
    },

    rematch() {
      get().start(get().config);
    },

    exit() {
      window.clearTimeout(autoTimer);
      get().persist();
      cancelAi();
      clearSelection();
      set({ active: false, game: null, clock: null, result: null, showResult: false, reviewPly: null, gameId: '' });
      bump();
    },

    review(ply) {
      const { game } = get();
      if (!game) return;
      const p = Math.max(0, Math.min(ply, game.ply));
      const prior = get().reviewPly;
      const position = game.positionAt(p);
      const move = p > 0 ? game.moves[p - 1] : null;
      useBoardView.getState().set({
        board: position.board,
        lastMove: move ? { from: move.from, to: move.to } : null,
        checkSquare: -1,
        interactive: false,
        hint: null,
      });
      if (prior !== null && p === prior + 1 && move) {
        director.enqueue({ from: move.from, to: move.to, piece: move.piece, captured: move.captured, check: move.check, boardAfter: position.board });
      } else {
        director.sync(position.board);
      }
      set({ reviewPly: p, showResult: false });
      bump();
    },

    reviewStep(delta) {
      const { reviewPly, game } = get();
      if (reviewPly === null || !game) return;
      set({ autoplay: false });
      window.clearTimeout(autoTimer);
      get().review(reviewPly + delta);
    },

    toggleAutoplay() {
      const on = !get().autoplay;
      set({ autoplay: on });
      window.clearTimeout(autoTimer);
      if (!on) return;
      const step = () => {
        const { reviewPly, game, autoplay } = get();
        if (!autoplay || reviewPly === null || !game) return;
        if (reviewPly >= game.ply) return set({ autoplay: false });
        get().review(reviewPly + 1);
        autoTimer = window.setTimeout(step, 1100);
      };
      step();
    },

    closeResult: () => set({ showResult: false }),

    tick() {
      const { clock, game, result } = get();
      if (!clock || !game || result) return;
      const side = clock.expired();
      if (side) {
        const r: GameResult = { winner: other(side), reason: 'timeout' };
        game.finish(r);
        finish(r);
      }
    },

    persist() {
      const { game, config, clock, gameId, result } = get();
      if (!game || result || game.result) return;
      writeSave({
        v: 1, gameId, config, game: game.serialize(),
        clock: clock ? { r: clock.read('r'), b: clock.read('b') } : null,
        savedAt: Date.now(),
      });
    },
  };
});
