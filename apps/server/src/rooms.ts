/**
 * Toàn bộ logic phòng và ván online. Mỗi thao tác là một khối đồng bộ trên
 * event loop nên các thay đổi của cùng một ván luôn tuần tự; riêng kiểm tra mật
 * khẩu là bất đồng bộ và trạng thái phòng được kiểm tra lại sau đó.
 */
import { createHash, randomBytes, randomInt, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Server, Socket } from 'socket.io';
import { END_REASON_TEXT, GameClock, GameResult, Side, XiangqiGame, isValidSquare, other, sideOf } from '@kydao/engine';
import {
  Ack, CHAT_KEEP, CHAT_MAX, ChatMessage, DEFAULT_SETTINGS, ErrorCode, GameView, MoveRequest, OfferKind, OfferView,
  PASSWORD_MAX, PublicPlayer, RoomPhase, RoomSettings, RoomView, Snapshot, cleanNickname, validSettings,
} from '@kydao/engine/protocol';
import type { Config } from './config';
import { RateLimiter } from './limiter';
import type { GameRepository } from './storage';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, n: number) => Promise<Buffer>;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface Session {
  id: string;
  publicId: string;
  tokenHash: string;
  nickname: string;
  roomCode: string | null;
  socket: Socket | null;
  lastSeen: number;
  chatSeen: Map<string, ChatMessage>;
}

interface Seat {
  session: Session;
  ready: boolean;
  side: Side | null;
  connected: boolean;
  disconnectAt: number | null;
  /** Hạn kết nối lại, tính theo đồng hồ server. */
  deadline: number | null;
}

interface MoveReply {
  ack: Ack<{ version: number }>;
}

interface ActiveGame {
  id: string;
  game: XiangqiGame;
  clock: GameClock;
  version: number;
  ended: boolean;
  seen: Map<string, MoveReply>;
}

interface Offer {
  id: string;
  kind: OfferKind;
  from: Seat;
  expiresAt: number;
  version: number;
  undo?: OfferView['undo'];
}

interface Room {
  code: string;
  phase: RoomPhase;
  settings: RoomSettings;
  passwordHash: Buffer | null;
  passwordSalt: Buffer | null;
  seats: Seat[];
  hostId: string;
  game: ActiveGame | null;
  offer: Offer | null;
  chat: ChatMessage[];
  emptySince: number | null;
  finishedAt: number | null;
  timer: NodeJS.Timeout | null;
  lastHomeSide: Side | null;
}

const ok = <T extends object>(data: T = {} as T): Ack<T> => ({ ok: true, ...data });
const fail = (code: ErrorCode): { ok: false; code: ErrorCode } => ({ ok: false, code });

export class RoomService {
  private rooms = new Map<string, Room>();
  private sessions = new Map<string, Session>();
  private byToken = new Map<string, Session>();
  private expired = new Map<string, number>();
  private createLimit: RateLimiter;
  private joinLimit: RateLimiter;
  private passwordLimit: RateLimiter;
  private chatLimit: RateLimiter;
  private actionLimit: RateLimiter;
  private sweeper: NodeJS.Timeout;
  private now = () => Date.now();

  constructor(private readonly io: Server, private readonly repo: GameRepository, private readonly cfg: Config) {
    this.createLimit = new RateLimiter(cfg.createRoomPerMinute, 60_000);
    this.joinLimit = new RateLimiter(cfg.joinPerMinute, 60_000);
    this.passwordLimit = new RateLimiter(cfg.wrongPasswordPerMinute, 60_000);
    this.chatLimit = new RateLimiter(cfg.chatCount, cfg.chatWindowMs);
    this.actionLimit = new RateLimiter(120, 10_000);
    this.sweeper = setInterval(() => this.sweep(), cfg.sweepMs);
    this.sweeper.unref();
  }

  get roomCount() {
    return this.rooms.size;
  }

  // ---------- Phiên khách ----------

  /** Xác định phiên từ reconnect token; token sai thì cấp phiên mới. */
  connect(socket: Socket, token: unknown): { session: Session; newToken: string | null } {
    let session = typeof token === 'string' && token.length >= 32 && token.length <= 128
      ? this.byToken.get(sha256(token))
      : undefined;
    let newToken: string | null = null;
    if (!session) {
      newToken = randomBytes(32).toString('base64url');
      session = {
        id: randomUUID(), publicId: randomBytes(9).toString('base64url'), tokenHash: sha256(newToken), nickname: '',
        roomCode: null, socket: null, lastSeen: this.now(), chatSeen: new Map(),
      };
      this.sessions.set(session.id, session);
      this.byToken.set(session.tokenHash, session);
    }
    // Chỉ một kết nối được điều khiển vị trí: kết nối mới nhất thắng.
    const old = session.socket;
    if (old && old.id !== socket.id) {
      session.socket = null;
      old.emit('session:superseded');
      old.disconnect(true);
    }
    session.socket = socket;
    session.lastSeen = this.now();
    return { session, newToken };
  }

  disconnect(session: Session, socket: Socket) {
    if (session.socket?.id !== socket.id) return; // kết nối cũ đã bị thay thế
    session.socket = null;
    session.lastSeen = this.now();
    const room = session.roomCode ? this.rooms.get(session.roomCode) : undefined;
    const seat = room && this.seatOf(room, session);
    if (!room || !seat) return;
    seat.connected = false;
    seat.disconnectAt = this.now();
    if (room.phase === 'playing') {
      seat.deadline = this.now() + this.cfg.reconnectGraceMs;
      this.system(room, `${session.nickname} mất kết nối`);
    } else {
      seat.ready = false;
      this.system(room, `${session.nickname} mất kết nối`);
    }
    if (room.seats.every((s) => !s.connected)) room.emptySince = this.now();
    this.emitRoom(room);
    this.schedule(room);
  }

  /** Gọi khi socket mới của một phiên đã vào: khôi phục vị trí nếu có. */
  resume(session: Session, socket: Socket): Snapshot | null {
    const room = session.roomCode ? this.rooms.get(session.roomCode) : undefined;
    const seat = room && this.seatOf(room, session);
    if (!room || !seat) {
      session.roomCode = null;
      return null;
    }
    socket.join(this.channel(room));
    const wasGone = !seat.connected;
    seat.connected = true;
    seat.deadline = null;
    seat.disconnectAt = null;
    room.emptySince = null;
    if (wasGone) this.system(room, `${session.nickname} đã kết nối lại`);
    this.emitRoom(room);
    this.schedule(room);
    return this.snapshot(room, session);
  }

  // ---------- Phòng ----------

  private channel = (room: Room) => `room:${room.code}`;

  private seatOf(room: Room, session: Session) {
    return room.seats.find((s) => s.session === session);
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LEN; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code) && !this.expired.has(code)) return code;
    }
    throw new Error('Không sinh được mã phòng');
  }

  private normalizeCode(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const code = raw.trim().toUpperCase();
    return /^[A-Z0-9]{4,10}$/.test(code) ? code : null;
  }

  async create(session: Session, ip: string, data: any): Promise<Ack<{ snapshot: Snapshot }>> {
    const nickname = cleanNickname(data?.nickname);
    if (!nickname) return fail('BAD_NICKNAME');
    const settings = data?.settings === undefined ? { ...DEFAULT_SETTINGS } : validSettings(data.settings);
    if (!settings) return fail('BAD_REQUEST');
    const password = data?.password ? String(data.password) : '';
    if (password.length > PASSWORD_MAX) return fail('BAD_REQUEST');
    if (session.roomCode && this.rooms.has(session.roomCode)) return fail('ALREADY_IN_ROOM');
    if (!this.createLimit.take(ip)) return fail('RATE_LIMITED');

    let passwordHash: Buffer | null = null;
    let passwordSalt: Buffer | null = null;
    if (password) {
      passwordSalt = randomBytes(16);
      passwordHash = await scrypt(password, passwordSalt, 32);
    }
    if (session.roomCode && this.rooms.has(session.roomCode)) return fail('ALREADY_IN_ROOM');
    const socket = session.socket;
    if (!socket) return fail('BAD_REQUEST');

    session.nickname = nickname;
    const room: Room = {
      code: this.newCode(), phase: 'lobby', settings, passwordHash, passwordSalt, seats: [], hostId: session.publicId,
      game: null, offer: null, chat: [], emptySince: null, finishedAt: null, timer: null, lastHomeSide: null,
    };
    room.seats.push({ session, ready: false, side: null, connected: true, disconnectAt: null, deadline: null });
    this.rooms.set(room.code, room);
    session.roomCode = room.code;
    socket.join(this.channel(room));
    this.system(room, `${nickname} đã tạo phòng`);
    return ok({ snapshot: this.snapshot(room, session) });
  }

  peek(raw: unknown, ip: string): Ack<{ hasPassword: boolean; phase: RoomPhase; full: boolean; host: string }> {
    const code = this.normalizeCode(raw);
    if (!code) return fail('ROOM_NOT_FOUND');
    if (!this.joinLimit.take(`peek:${ip}`)) return fail('TOO_MANY_ATTEMPTS');
    const room = this.rooms.get(code);
    if (!room) return fail(this.missingReason(code));
    const host = room.seats.find((s) => s.session.publicId === room.hostId)?.session.nickname ?? '';
    return ok({ hasPassword: !!room.passwordHash, phase: room.phase, full: room.seats.length >= 2, host });
  }

  private missingReason(code: string): ErrorCode {
    if (this.expired.has(code)) return 'ROOM_EXPIRED';
    const stored = this.repo.findLatestByRoom(code);
    if (stored?.status === 'interrupted') return 'ROOM_INTERRUPTED';
    return 'ROOM_NOT_FOUND';
  }

  async join(session: Session, ip: string, data: any): Promise<Ack<{ snapshot: Snapshot }>> {
    const nickname = cleanNickname(data?.nickname);
    if (!nickname) return fail('BAD_NICKNAME');
    const code = this.normalizeCode(data?.code);
    if (!code) return fail('ROOM_NOT_FOUND');
    if (!this.joinLimit.take(ip)) return fail('TOO_MANY_ATTEMPTS');
    const attemptKey = `${ip}:${code}`;
    if (this.passwordLimit.blocked(attemptKey)) return fail('TOO_MANY_ATTEMPTS');

    let room = this.rooms.get(code);
    if (!room) return fail(this.missingReason(code));
    const already = this.seatOf(room, session);
    if (already) {
      const snap = session.socket ? this.resume(session, session.socket) : null;
      return snap ? ok({ snapshot: snap }) : fail('BAD_REQUEST');
    }
    if (session.roomCode && this.rooms.has(session.roomCode)) return fail('ALREADY_IN_ROOM');
    if (room.phase !== 'lobby') return fail('GAME_STARTED');
    if (room.seats.length >= 2) return fail('ROOM_FULL');

    if (room.passwordHash) {
      const password = typeof data?.password === 'string' ? data.password : '';
      if (!password) return fail('PASSWORD_REQUIRED');
      if (password.length > PASSWORD_MAX) return fail('WRONG_PASSWORD');
      const hash = await scrypt(password, room.passwordSalt!, 32);
      if (!timingSafeEqual(hash, room.passwordHash)) {
        this.passwordLimit.take(attemptKey);
        return fail('WRONG_PASSWORD');
      }
      // Trạng thái có thể đổi trong lúc băm mật khẩu.
      room = this.rooms.get(code);
      if (!room) return fail(this.missingReason(code));
      if (room.phase !== 'lobby') return fail('GAME_STARTED');
      if (room.seats.length >= 2) return fail('ROOM_FULL');
    }
    const socket = session.socket;
    if (!socket) return fail('BAD_REQUEST');
    session.nickname = nickname;
    session.roomCode = code;
    room.seats.push({ session, ready: false, side: null, connected: true, disconnectAt: null, deadline: null });
    room.emptySince = null;
    socket.join(this.channel(room));
    this.system(room, `${nickname} đã vào phòng`);
    this.emitRoom(room);
    return ok({ snapshot: this.snapshot(room, session) });
  }

  leave(session: Session): Ack {
    const room = session.roomCode ? this.rooms.get(session.roomCode) : undefined;
    if (!room) {
      session.roomCode = null;
      return ok();
    }
    const seat = this.seatOf(room, session);
    if (!seat) return ok();
    if (room.phase === 'playing' && room.game && !room.game.ended && seat.side) {
      this.finish(room, { winner: other(seat.side), reason: 'abandon' });
    }
    session.socket?.leave(this.channel(room));
    session.roomCode = null;
    room.seats = room.seats.filter((s) => s !== seat);
    this.cancelOffer(room);
    this.system(room, `${session.nickname} đã rời phòng`);
    if (room.seats.length === 0) {
      this.destroy(room);
      return ok();
    }
    const rest = room.seats[0];
    rest.ready = false;
    if (room.hostId === session.publicId) room.hostId = rest.session.publicId;
    if (room.phase === 'finished') {
      // Đối thủ đã đi: phòng trở lại trạng thái chờ người mới.
      room.phase = 'lobby';
      room.game = null;
      rest.side = null;
      this.io.to(this.channel(room)).emit('game:sync', this.snapshot(room, rest.session));
    }
    this.emitRoom(room);
    return ok();
  }

  setSettings(session: Session, data: any): Ack {
    const room = this.roomOf(session);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== session.publicId) return fail('NOT_HOST');
    if (room.phase !== 'lobby') return fail('GAME_STARTED');
    const settings = validSettings(data?.settings);
    if (!settings) return fail('BAD_REQUEST');
    room.settings = settings;
    let reset = false;
    for (const s of room.seats) {
      if (s.ready) reset = true;
      s.ready = false;
    }
    if (reset) this.system(room, 'Thiết lập thay đổi, hai bên cần sẵn sàng lại');
    this.emitRoom(room);
    return ok();
  }

  setReady(session: Session, data: any): Ack {
    const room = this.roomOf(session);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.phase !== 'lobby') return fail('GAME_STARTED');
    const seat = this.seatOf(room, session)!;
    seat.ready = !!data?.ready;
    this.emitRoom(room);
    if (room.seats.length === 2 && room.seats.every((s) => s.ready && s.connected)) this.startGame(room);
    return ok();
  }

  private roomOf(session: Session): Room | null {
    if (!session.roomCode) return null;
    const room = this.rooms.get(session.roomCode);
    return room && this.seatOf(room, session) ? room : null;
  }

  // ---------- Ván ----------

  private startGame(room: Room, swapFrom?: Side) {
    const [a, b] = room.seats;
    let hostSide: Side;
    if (swapFrom) hostSide = other(swapFrom);
    else if (room.settings.side === 'random') hostSide = randomInt(2) === 0 ? 'r' : 'b';
    else hostSide = room.settings.side;
    const host = a.session.publicId === room.hostId ? a : b;
    const guest = host === a ? b : a;
    host.side = hostSide;
    guest.side = other(hostSide);
    room.lastHomeSide = hostSide;

    const game = new XiangqiGame();
    const clock = new GameClock(room.settings.baseMs, room.settings.incrementMs, this.now);
    room.game = { id: randomUUID(), game, clock, version: 0, ended: false, seen: new Map() };
    room.phase = 'playing';
    room.finishedAt = null;
    for (const s of room.seats) s.ready = false;
    clock.start('r');
    const redSeat = host.side === 'r' ? host : guest;
    const blackSeat = host.side === 'r' ? guest : host;
    this.repo.createGame({
      id: room.game.id, roomCode: room.code, initialFen: game.initialFen, redName: redSeat.session.nickname,
      blackName: blackSeat.session.nickname, baseMs: room.settings.baseMs, incrementMs: room.settings.incrementMs,
      startedAt: this.now(),
    });
    this.system(room, 'Ván cờ bắt đầu');
    this.emitRoom(room);
    for (const s of room.seats) s.session.socket?.emit('game:sync', this.snapshot(room, s.session));
    this.schedule(room);
  }

  private gameView(g: ActiveGame): GameView {
    return {
      gameId: g.id, version: g.version, initialFen: g.game.initialFen, moves: g.game.serialize().moves,
      clock: g.clock.snapshot(), incrementMs: g.clock.incrementMs, result: g.game.result,
    };
  }

  private progress(g: ActiveGame) {
    const snap = g.clock.snapshot();
    return { moves: g.game.serialize().moves, clockRed: snap.r, clockBlack: snap.b, version: g.version };
  }

  move(session: Session, data: MoveRequest): Ack<{ version: number }> {
    const room = this.roomOf(session);
    if (!room) return fail('NOT_PLAYER');
    const seat = this.seatOf(room, session)!;
    const g = room.game;
    if (!g || typeof data?.gameId !== 'string' || data.gameId !== g.id) return fail('WRONG_GAME');
    if (typeof data.requestId !== 'string' || data.requestId.length === 0 || data.requestId.length > 64) return fail('BAD_REQUEST');

    // Yêu cầu lặp: trả lại đúng kết quả cũ, không đi thêm nước nào.
    const key = `${session.id}:${data.requestId}`;
    const seen = g.seen.get(key);
    if (seen) return seen.ack;

    if (!Number.isInteger(data.version) || !isValidSquare(data.from) || !isValidSquare(data.to)) return fail('BAD_REQUEST');

    this.checkDeadlines(room);
    if (g.ended || room.phase !== 'playing') return fail('GAME_OVER');
    if (!seat.side) return fail('NOT_PLAYER');
    if (g.game.turn !== seat.side) return this.remember(g, key, fail('WRONG_TURN'));
    if (data.version !== g.version) {
      session.socket?.emit('game:sync', this.snapshot(room, session));
      return fail('STALE_STATE');
    }
    if (sideOf(g.game.position.board[data.from]) !== seat.side) return this.remember(g, key, fail('ILLEGAL_MOVE'));

    const played = g.game.play(data.from, data.to);
    if (!played.ok) return this.remember(g, key, fail('ILLEGAL_MOVE'));

    g.version++;
    g.clock.press(seat.side);
    this.cancelOffer(room);
    if (played.result) g.clock.stop();
    this.repo.saveProgress(g.id, this.progress(g));
    const ack = this.remember(g, key, ok({ version: g.version }));
    this.io.to(this.channel(room)).emit('game:moved', {
      gameId: g.id, version: g.version, from: data.from, to: data.to, clock: g.clock.snapshot(), result: played.result,
    });
    if (played.result) this.finish(room, played.result, true);
    else this.schedule(room);
    return ack;
  }

  private remember<T extends Ack<{ version: number }>>(g: ActiveGame, key: string, ack: T): T {
    g.seen.set(key, { ack });
    if (g.seen.size > 400) g.seen.delete(g.seen.keys().next().value!);
    return ack;
  }

  resign(session: Session, data: any): Ack {
    const room = this.roomOf(session);
    if (!room?.game || data?.gameId !== room.game.id) return fail('WRONG_GAME');
    const seat = this.seatOf(room, session)!;
    if (room.game.ended) return fail('GAME_OVER');
    if (!seat.side) return fail('NOT_PLAYER');
    this.finish(room, { winner: other(seat.side), reason: 'resign' });
    return ok();
  }

  /** Điểm duy nhất kết thúc ván; `ended` bảo đảm kết quả chỉ được ghi một lần. */
  private finish(room: Room, result: GameResult, alreadyInGame = false) {
    const g = room.game;
    if (!g || g.ended) return;
    g.ended = true;
    if (!alreadyInGame) {
      g.game.finish(result);
      g.version++;
    }
    g.clock.stop();
    this.cancelOffer(room);
    room.phase = 'finished';
    room.finishedAt = this.now();
    for (const s of room.seats) s.deadline = null;
    this.repo.finishGame(g.id, result.winner, result.reason, this.progress(g), this.now());
    this.io.to(this.channel(room)).emit('game:ended', {
      gameId: g.id, version: g.version, result, clock: g.clock.snapshot(),
    });
    const who = result.winner
      ? `${room.seats.find((s) => s.side === result.winner)?.session.nickname ?? (result.winner === 'r' ? 'Đỏ' : 'Đen')} thắng`
      : 'Hòa';
    this.system(room, `Kết thúc: ${who}. ${END_REASON_TEXT[result.reason]}.`);
    this.emitRoom(room);
    this.schedule(room);
  }

  // ---------- Đề nghị ----------

  private offerView(o: Offer): OfferView {
    return { id: o.id, kind: o.kind, from: o.from.session.publicId, expiresInMs: Math.max(0, o.expiresAt - this.now()), undo: o.undo };
  }

  private cancelOffer(room: Room) {
    if (!room.offer) return;
    room.offer = null;
    this.io.to(this.channel(room)).emit('offer:update', null);
  }

  offer(session: Session, data: any): Ack {
    const room = this.roomOf(session);
    if (!room?.game) return fail('WRONG_GAME');
    const seat = this.seatOf(room, session)!;
    const kind: OfferKind = data?.kind;
    if (!['draw', 'undo', 'rematch'].includes(kind)) return fail('BAD_REQUEST');
    if (data?.gameId !== room.game.id) return fail('WRONG_GAME');
    if (room.offer) return fail('OFFER_PENDING');
    const g = room.game;
    let undo: OfferView['undo'];
    if (kind === 'rematch') {
      if (room.phase !== 'finished' || room.seats.length < 2) return fail('OFFER_INVALID');
    } else {
      this.checkDeadlines(room);
      if (room.phase !== 'playing' || g.ended) return fail('GAME_OVER');
      if (kind === 'undo') {
        const side = seat.side!;
        const lastBySelf = g.game.turn !== side;
        const plies = lastBySelf ? 1 : 2;
        if (g.game.ply < plies) return fail('OFFER_INVALID');
        const notations = g.game.moves.slice(-plies).map((m) => m.notation);
        undo = { plies, notations, turnAfter: side };
      }
    }
    room.offer = { id: randomUUID(), kind, from: seat, expiresAt: this.now() + this.cfg.offerTtlMs, version: g.version, undo };
    const label = { draw: 'xin hòa', undo: 'xin đi lại', rematch: 'mời tái đấu' }[kind];
    this.system(room, `${session.nickname} ${label}`);
    this.io.to(this.channel(room)).emit('offer:update', this.offerView(room.offer));
    this.schedule(room);
    return ok();
  }

  respond(session: Session, data: any): Ack {
    const room = this.roomOf(session);
    if (!room?.game) return fail('WRONG_GAME');
    const seat = this.seatOf(room, session)!;
    const o = room.offer;
    if (!o || o.id !== data?.offerId) return fail('OFFER_INVALID');
    if (o.from === seat) {
      // Người gửi tự rút lại.
      if (data?.accept) return fail('OFFER_INVALID');
      this.cancelOffer(room);
      this.system(room, `${session.nickname} đã rút đề nghị`);
      return ok();
    }
    this.checkDeadlines(room);
    if (room.offer !== o) return fail('OFFER_INVALID');
    if (o.version !== room.game.version) {
      this.cancelOffer(room);
      return fail('OFFER_INVALID');
    }
    room.offer = null;
    this.io.to(this.channel(room)).emit('offer:update', null);
    if (!data?.accept) {
      this.system(room, `${session.nickname} đã từ chối`);
      this.schedule(room);
      return ok();
    }
    const g = room.game;
    if (o.kind === 'draw') {
      this.finish(room, { winner: null, reason: 'agreement' });
    } else if (o.kind === 'undo') {
      const undone: Side[] = [];
      let side = other(g.game.turn);
      for (let i = 0; i < o.undo!.plies; i++) {
        undone.push(side);
        side = other(side);
      }
      g.game.undo(o.undo!.plies);
      g.clock.rewind(undone, g.game.turn);
      g.version++;
      this.repo.saveProgress(g.id, this.progress(g));
      this.system(room, `Đã hoàn tác ${o.undo!.notations.join(', ')}`);
      for (const s of room.seats) s.session.socket?.emit('game:sync', this.snapshot(room, s.session));
      this.schedule(room);
    } else {
      const fromSide = room.lastHomeSide!;
      this.startGame(room, fromSide);
    }
    return ok();
  }

  // ---------- Hẹn giờ của server ----------

  private schedule(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    const times: number[] = [];
    const now = this.now();
    const g = room.game;
    if (room.phase === 'playing' && g && !g.ended) {
      const ms = g.clock.msToExpiry();
      if (Number.isFinite(ms)) times.push(now + ms);
      for (const s of room.seats) if (s.deadline !== null) times.push(s.deadline);
    }
    if (room.offer) times.push(room.offer.expiresAt);
    if (times.length === 0) return;
    const delay = Math.max(0, Math.min(...times) - now);
    room.timer = setTimeout(() => this.checkDeadlines(room), Math.min(delay + 1, 0x7fffffff));
    room.timer.unref?.();
  }

  /** Xử lý các mốc đã đến hạn theo đúng thứ tự thời gian: cái nào đến trước thì quyết định. */
  private checkDeadlines(room: Room) {
    if (!this.rooms.has(room.code)) return;
    const now = this.now();
    if (room.offer && room.offer.expiresAt <= now) {
      this.cancelOffer(room);
      this.system(room, 'Đề nghị đã hết hạn');
    }
    const g = room.game;
    if (room.phase === 'playing' && g && !g.ended) {
      const events: { at: number; result: GameResult }[] = [];
      const ms = g.clock.msToExpiry();
      if (ms <= 0 && g.clock.running) {
        events.push({ at: now + ms, result: { winner: other(g.clock.running), reason: 'timeout' } });
      }
      for (const s of room.seats) {
        if (s.deadline !== null && s.deadline <= now && s.side) {
          events.push({ at: s.deadline, result: { winner: other(s.side), reason: 'abandon' } });
        }
      }
      if (events.length) {
        events.sort((a, b) => a.at - b.at);
        this.finish(room, events[0].result);
        return;
      }
    }
    this.schedule(room);
  }

  // ---------- Chat ----------

  chat(session: Session, data: any): Ack<{ message: ChatMessage }> {
    const room = this.roomOf(session);
    if (!room) return fail('NOT_IN_ROOM');
    if (typeof data?.text !== 'string') return fail('BAD_REQUEST');
    const clientId = typeof data.clientId === 'string' ? data.clientId.slice(0, 64) : undefined;
    if (clientId) {
      const prior = session.chatSeen.get(clientId);
      if (prior) return ok({ message: prior });
    }
    const text = data.text.replace(/\r\n/g, '\n').trim();
    if (!text) return fail('EMPTY_MESSAGE');
    if ([...text].length > CHAT_MAX) return fail('MESSAGE_TOO_LONG');
    if (!this.chatLimit.take(session.id)) return fail('RATE_LIMITED');
    const message: ChatMessage = {
      id: randomUUID(), from: session.publicId, name: session.nickname, text, at: this.now(), clientId,
    };
    this.pushChat(room, message);
    if (clientId) {
      session.chatSeen.set(clientId, message);
      if (session.chatSeen.size > 40) session.chatSeen.delete(session.chatSeen.keys().next().value!);
    }
    return ok({ message });
  }

  private pushChat(room: Room, m: ChatMessage) {
    room.chat.push(m);
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    this.io.to(this.channel(room)).emit('chat:message', m);
  }

  private system(room: Room, text: string) {
    this.pushChat(room, { id: randomUUID(), from: null, name: 'Hệ thống', text, at: this.now() });
  }

  // ---------- Trạng thái công khai ----------

  private roomView(room: Room): RoomView {
    const now = this.now();
    const players: PublicPlayer[] = room.seats.map((s) => ({
      id: s.session.publicId,
      nickname: s.session.nickname,
      connected: s.connected,
      ready: s.ready,
      isHost: s.session.publicId === room.hostId,
      side: s.side,
      reconnectMs: s.deadline !== null ? Math.max(0, s.deadline - now) : null,
    }));
    return { code: room.code, phase: room.phase, settings: room.settings, hasPassword: !!room.passwordHash, players };
  }

  snapshot(room: Room, session: Session): Snapshot {
    return {
      you: session.publicId,
      room: this.roomView(room),
      game: room.game ? this.gameView(room.game) : null,
      offer: room.offer ? this.offerView(room.offer) : null,
      chat: room.chat,
    };
  }

  syncFor(session: Session): Snapshot | null {
    const room = this.roomOf(session);
    return room ? this.snapshot(room, session) : null;
  }

  private emitRoom(room: Room) {
    this.io.to(this.channel(room)).emit('room:update', this.roomView(room));
  }

  allowAction(session: Session): boolean {
    return this.actionLimit.take(session.id);
  }

  // ---------- Dọn dẹp ----------

  private destroy(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    this.rooms.delete(room.code);
    this.expired.set(room.code, this.now());
    for (const s of room.seats) {
      if (s.session.roomCode === room.code) {
        s.session.roomCode = null;
        s.session.socket?.leave(this.channel(room));
        s.session.socket?.emit('room:closed', { code: 'ROOM_EXPIRED' });
      }
    }
    room.chat = [];
  }

  sweep() {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      if (room.phase === 'playing') continue;
      // Người chơi rớt mạng ở phòng chờ quá lâu thì nhường chỗ.
      if (room.phase === 'lobby') {
        for (const seat of [...room.seats]) {
          if (!seat.connected && seat.disconnectAt && now - seat.disconnectAt > this.cfg.reconnectGraceMs && room.seats.length > 1) {
            this.leave(seat.session);
          }
        }
      }
      const emptyFor = room.emptySince !== null ? now - room.emptySince : 0;
      if (room.emptySince !== null && emptyFor > this.cfg.lobbyEmptyTtlMs) this.destroy(room);
      else if (room.phase === 'finished' && room.finishedAt && now - room.finishedAt > this.cfg.finishedTtlMs) this.destroy(room);
    }
    for (const [code, at] of this.expired) if (now - at > 6 * 3600_000) this.expired.delete(code);
    for (const s of [...this.sessions.values()]) {
      if (!s.socket && !s.roomCode && now - s.lastSeen > 24 * 3600_000) {
        this.sessions.delete(s.id);
        this.byToken.delete(s.tokenHash);
      }
    }
    for (const l of [this.createLimit, this.joinLimit, this.passwordLimit, this.chatLimit, this.actionLimit]) l.sweep();
  }

  shutdown() {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) if (room.timer) clearTimeout(room.timer);
  }
}
