/** Trạng thái online phía client. Mọi kết quả đều đến từ server; client chỉ hiển thị. */
import { create } from 'zustand';
import { Socket, io } from 'socket.io-client';
import { GameResult, Side, XiangqiGame, findKing } from '@kydao/engine';
import {
  Ack, ChatMessage, ERROR_TEXT, EndEvent, ErrorCode, GameView, MoveEvent, OfferView, RoomSettings, RoomView, Snapshot,
} from '@kydao/engine/protocol';
import { aiClient } from '../ai/aiClient';
import { clearSelection, clickSquare, showMenuBoard } from '../lib/interaction';
import { playSound } from '../lib/sound';
import { toast } from '../lib/toast';
import { director } from '../three/director';
import { useBoardView } from './boardView';
import { useLocal } from './localStore';

const TOKEN_KEY = 'kydao.session.v1';
const ROOM_KEY = 'kydao.room.v1';
const NICK_KEY = 'kydao.nick.v1';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* bỏ qua */
  }
};

export const storedRoom = () => read(ROOM_KEY);
export const storedNick = () => read(NICK_KEY) ?? '';

export type ConnStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'superseded' | 'failed';

export interface ChatItem extends ChatMessage {
  state: 'sent' | 'sending' | 'failed';
  error?: string;
}

interface ClockBase {
  r: number | null;
  b: number | null;
  running: Side | null;
  at: number;
}

interface OnlineState {
  status: ConnStatus;
  you: string;
  room: RoomView | null;
  roomAt: number;
  game: XiangqiGame | null;
  gameId: string;
  version: number;
  incrementMs: number;
  clock: ClockBase | null;
  result: GameResult | null;
  showResult: boolean;
  offer: OfferView | null;
  offerAt: number;
  chat: ChatItem[];
  unread: number;
  chatOpen: boolean;
  chatMuted: boolean;
  hideOpponent: boolean;
  checkNonce: number;
  pending: boolean;
  error: string;
  rev: number;

  connect(): void;
  disconnect(): void;
  reclaim(): void;
  create(nickname: string, settings: RoomSettings, password: string): Promise<boolean>;
  join(nickname: string, code: string, password: string): Promise<ErrorCode | null>;
  peek(code: string): Promise<Ack<{ hasPassword: boolean; full: boolean; phase: string; host: string }>>;
  updateSettings(settings: RoomSettings): void;
  setReady(ready: boolean): void;
  click(s: number): void;
  resign(): void;
  offerAction(kind: 'draw' | 'undo' | 'rematch'): void;
  respond(accept: boolean): void;
  leave(): void;
  sendChat(text: string): void;
  retryChat(item: ChatItem): void;
  setChatOpen(open: boolean): void;
  set(p: Partial<OnlineState>): void;
  mySide(): Side | null;
  readClock(side: Side): number | null;
}

let socket: Socket | null = null;
let sendSeq = 0;

function call<T extends object>(event: string, data?: unknown, timeout = 8000): Promise<Ack<T> | null> {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve(null);
    socket.timeout(timeout).emit(event, data, (err: unknown, reply: Ack<T>) => resolve(err ? null : reply));
  });
}

const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${++sendSeq}-${Math.random().toString(36).slice(2)}`);

export const useOnline = create<OnlineState>((set, get) => {
  const bump = () => set({ rev: get().rev + 1 });

  const publishView = (hard: boolean) => {
    const { game, room, you } = get();
    const side = room?.players.find((p) => p.id === you)?.side ?? null;
    const view = useBoardView.getState();
    if (!game) return;
    const last = game.moves[game.moves.length - 1];
    view.set({
      board: game.position.board,
      lastMove: last ? { from: last.from, to: last.to } : null,
      checkSquare: game.result ? -1 : game.checkedKing,
      hint: null,
      flipped: side === 'b',
      interactive: !game.result,
      onSquare: (s) => get().click(s),
      showcase: false,
    });
    if (hard) director.sync(game.position.board);
  };

  const applyGame = (g: GameView | null) => {
    if (!g) {
      set({ game: null, gameId: '', version: 0, result: null, clock: null, showResult: false });
      showMenuBoard();
      return;
    }
    const game = XiangqiGame.replay({ initialFen: g.initialFen, moves: g.moves });
    if (g.result && !game.result) game.finish(g.result);
    const changedGame = g.gameId !== get().gameId;
    clearSelection();
    set({
      game, gameId: g.gameId, version: g.version, incrementMs: g.incrementMs, result: g.result, pending: false,
      clock: { ...g.clock, at: performance.now() },
      showResult: changedGame ? false : get().showResult,
    });
    publishView(true);
  };

  const mergeChat = (list: ChatMessage[]) => {
    const known = new Map(get().chat.map((m) => [m.id, m] as const));
    const merged: ChatItem[] = get().chat.filter((m) => m.state !== 'sent' && !list.some((x) => x.clientId === m.clientId));
    const server = list.map((m) => ({ ...(known.get(m.id) ?? m), state: 'sent' as const }));
    set({ chat: [...server, ...merged].slice(-120) });
  };

  const applySnapshot = (s: Snapshot) => {
    set({ you: s.you, room: s.room, roomAt: performance.now(), offer: s.offer, offerAt: performance.now(), error: '' });
    write(ROOM_KEY, s.room.code);
    applyGame(s.game);
    mergeChat(s.chat);
    bump();
  };

  const requestSync = async () => {
    const r = await call<{ snapshot: Snapshot | null }>('game:sync');
    if (r?.ok && r.snapshot) applySnapshot(r.snapshot);
  };

  const onMoved = (e: MoveEvent) => {
    const { game, gameId, version } = get();
    if (!game || e.gameId !== gameId) return void requestSync();
    if (e.version <= version) return; // đã có rồi, ví dụ sau khi đồng bộ
    if (e.version !== version + 1) return void requestSync();
    const played = game.play(e.from, e.to);
    if (!played.ok) return void requestSync();
    clearSelection();
    set({ version: e.version, clock: { ...e.clock, at: performance.now() }, pending: false });
    director.enqueue({
      from: e.from, to: e.to, piece: played.record.piece, captured: played.record.captured,
      check: played.record.check, boardAfter: game.position.board,
    });
    publishView(false);
    if (played.record.check && !e.result) {
      window.setTimeout(() => playSound('check'), played.record.captured ? 420 : 280);
      set({ checkNonce: get().checkNonce + 1 });
    }
    bump();
  };

  const onEnded = (e: EndEvent) => {
    const { game, gameId } = get();
    if (!game || e.gameId !== gameId) return void requestSync();
    if (!game.result) game.finish(e.result);
    clearSelection();
    set({ result: e.result, version: e.version, clock: { ...e.clock, at: performance.now() } });
    useBoardView.getState().set({ interactive: false, checkSquare: -1 });
    const id = e.gameId;
    window.setTimeout(() => {
      if (get().gameId !== id) return;
      const mine = get().mySide();
      if (e.result.winner && get().game) director.victory(findKing(get().game!.position.board, e.result.winner));
      playSound(!e.result.winner ? 'draw' : e.result.winner === mine ? 'win' : 'lose');
      set({ showResult: true });
    }, director.busy ? 950 : 250);
    bump();
  };

  const onChat = (m: ChatMessage) => {
    const { chat, chatOpen, chatMuted, you, hideOpponent } = get();
    if (chat.some((x) => x.id === m.id && x.state === 'sent')) return;
    const idx = m.clientId ? chat.findIndex((x) => x.clientId === m.clientId) : -1;
    const item: ChatItem = { ...m, state: 'sent' };
    const next = idx >= 0 ? chat.map((x, i) => (i === idx ? item : x)) : [...chat, item];
    const fromOther = m.from !== null && m.from !== you;
    set({
      chat: next.slice(-120),
      unread: !chatOpen && fromOther && !hideOpponent ? get().unread + 1 : get().unread,
    });
    if (fromOther && !chatMuted && !hideOpponent) playSound('chat');
  };

  const reset = () => {
    write(ROOM_KEY, null);
    clearSelection();
    set({
      room: null, game: null, gameId: '', version: 0, result: null, showResult: false, offer: null, chat: [], unread: 0,
      clock: null, pending: false,
    });
    showMenuBoard();
  };

  const sendChatItem = async (item: ChatItem) => {
    const r = await call<{ message: ChatMessage }>('chat:send', { clientId: item.clientId, text: item.text });
    if (r?.ok) return onChat(r.message);
    const error = r ? ERROR_TEXT[r.code] : 'Chưa gửi được';
    set({ chat: get().chat.map((m) => (m.clientId === item.clientId ? { ...m, state: 'failed', error } : m)) });
  };

  const submitMove = async (from: number, to: number) => {
    const { gameId, version } = get();
    const request = { gameId, version, from, to, requestId: uid() };
    set({ pending: true });
    let reply = await call<{ version: number }>('game:move', request);
    // Cùng requestId nên gửi lại không thể tạo nước thứ hai.
    if (!reply && socket?.connected) reply = await call<{ version: number }>('game:move', request);
    set({ pending: false });
    if (!reply) return toast('Không gửi được nước đi. Đang kết nối lại.');
    if (!reply.ok) {
      toast(ERROR_TEXT[reply.code]);
      playSound('illegal');
      if (reply.code !== 'STALE_STATE') void requestSync();
    }
  };

  return {
    status: 'idle',
    you: '',
    room: null,
    roomAt: 0,
    game: null,
    gameId: '',
    version: 0,
    incrementMs: 0,
    clock: null,
    result: null,
    showResult: false,
    offer: null,
    offerAt: 0,
    chat: [],
    unread: 0,
    chatOpen: true,
    chatMuted: false,
    hideOpponent: false,
    checkNonce: 0,
    pending: false,
    error: '',
    rev: 0,

    connect() {
      if (socket) return;
      // Không để tìm kiếm của ván local trước đó chạy nền hoặc tác động vào ván này.
      aiClient.cancel();
      if (useLocal.getState().active) useLocal.getState().exit();
      set({ status: 'connecting', error: '' });
      const url = (import.meta.env.VITE_SERVER_URL as string | undefined) || undefined;
      const s = io(url as string, {
        auth: (cb) => cb({ token: read(TOKEN_KEY) ?? undefined }),
        reconnectionDelay: 500,
        reconnectionDelayMax: 3000,
        transports: ['websocket', 'polling'],
      });
      socket = s;
      s.on('connect', () => set({ error: '' }));
      s.on('session:ready', async (d: { playerId: string; token: string | null; snapshot: Snapshot | null }) => {
        if (d.token) write(TOKEN_KEY, d.token);
        set({ status: 'online', you: d.playerId });
        if (d.snapshot) return applySnapshot(d.snapshot);
        const code = read(ROOM_KEY);
        if (!code) return;
        // Phiên không còn ghế: có thể server đã khởi động lại hoặc phòng đã hết hạn.
        const wasRoom = get().room;
        const r = await call<{ snapshot: Snapshot }>('room:join', { code, nickname: storedNick() || 'Khách' });
        if (r?.ok) return applySnapshot(r.snapshot);
        reset();
        if (r) set({ error: ERROR_TEXT[r.code] });
        else if (wasRoom) set({ error: 'Không khôi phục được phòng' });
      });
      s.on('session:superseded', () => {
        s.io.opts.reconnection = false;
        set({ status: 'superseded' });
      });
      s.on('disconnect', () => {
        if (get().status !== 'superseded') set({ status: 'reconnecting' });
      });
      s.on('connect_error', () => {
        if (get().status === 'connecting') set({ status: 'failed', error: 'Không kết nối được máy chủ' });
        else if (get().status === 'failed') set({ error: 'Không kết nối được máy chủ' });
      });
      s.on('room:update', (room: RoomView) => {
        set({ room, roomAt: performance.now() });
        const side = room.players.find((p) => p.id === get().you)?.side ?? null;
        if (get().game) useBoardView.getState().set({ flipped: side === 'b' });
        bump();
      });
      s.on('room:closed', () => {
        reset();
        set({ error: ERROR_TEXT.ROOM_EXPIRED });
      });
      s.on('game:sync', (snap: Snapshot) => applySnapshot(snap));
      s.on('game:moved', onMoved);
      s.on('game:ended', onEnded);
      s.on('offer:update', (offer: OfferView | null) => {
        set({ offer, offerAt: performance.now() });
        bump();
      });
      s.on('chat:message', onChat);
    },

    disconnect() {
      socket?.disconnect();
      socket = null;
      set({ status: 'idle' });
    },

    reclaim() {
      if (!socket) return;
      socket.io.opts.reconnection = true;
      set({ status: 'reconnecting' });
      socket.connect();
    },

    async create(nickname, settings, password) {
      write(NICK_KEY, nickname);
      const r = await call<{ snapshot: Snapshot }>('room:create', { nickname, settings, password });
      if (r?.ok) {
        set({ chat: [] });
        applySnapshot(r.snapshot);
        return true;
      }
      set({ error: r ? ERROR_TEXT[r.code] : 'Kết nối thất bại. Hãy thử lại.' });
      return false;
    },

    async join(nickname, code, password) {
      write(NICK_KEY, nickname);
      const r = await call<{ snapshot: Snapshot }>('room:join', { nickname, code, password });
      if (r?.ok) {
        set({ chat: [] });
        applySnapshot(r.snapshot);
        return null;
      }
      const c: ErrorCode = r ? r.code : 'BAD_REQUEST';
      set({ error: r ? ERROR_TEXT[r.code] : 'Kết nối thất bại. Hãy thử lại.' });
      return c;
    },

    async peek(code) {
      const r = await call<{ hasPassword: boolean; full: boolean; phase: string; host: string }>('room:peek', { code });
      return r ?? { ok: false, code: 'BAD_REQUEST' };
    },

    updateSettings(settings) {
      void call('room:settings', { settings }).then((r) => {
        if (r && !r.ok) toast(ERROR_TEXT[r.code]);
      });
    },

    setReady(ready) {
      void call('room:ready', { ready }).then((r) => {
        if (r && !r.ok) toast(ERROR_TEXT[r.code]);
      });
    },

    mySide() {
      const { room, you } = get();
      return room?.players.find((p) => p.id === you)?.side ?? null;
    },

    readClock(side) {
      const c = get().clock;
      if (!c) return null;
      const base = c[side];
      if (base === null) return null;
      return Math.max(0, c.running === side ? base - (performance.now() - c.at) : base);
    },

    click(s) {
      const { game, result, pending, status } = get();
      if (!game || result || pending || status !== 'online' || director.busy) return;
      const me = get().mySide();
      clickSquare(game.position, (side) => side === me, s, (from, to) => void submitMove(from, to));
    },

    resign() {
      void call('game:resign', { gameId: get().gameId }).then((r) => {
        if (r && !r.ok) toast(ERROR_TEXT[r.code]);
      });
    },

    offerAction(kind) {
      void call('game:offer', { gameId: get().gameId, kind }).then((r) => {
        if (r && !r.ok) toast(ERROR_TEXT[r.code]);
      });
    },

    respond(accept) {
      const { offer } = get();
      if (!offer) return;
      void call('game:respond', { offerId: offer.id, accept }).then((r) => {
        if (r && !r.ok) toast(ERROR_TEXT[r.code]);
      });
    },

    leave() {
      void call('room:leave');
      reset();
    },

    sendChat(raw) {
      const text = raw.trim();
      if (!text) return;
      const { you, room } = get();
      const clientId = uid();
      const item: ChatItem = {
        id: `local-${clientId}`, from: you, name: room?.players.find((p) => p.id === you)?.nickname ?? '', text,
        at: Date.now(), clientId, state: 'sending',
      };
      set({ chat: [...get().chat, item] });
      void sendChatItem(item);
    },

    retryChat(item) {
      set({ chat: get().chat.map((m) => (m.clientId === item.clientId ? { ...m, state: 'sending' } : m)) });
      void sendChatItem(item);
    },

    setChatOpen(open) {
      set({ chatOpen: open, unread: open ? 0 : get().unread });
    },

    set: (p) => set(p),
  };
});
