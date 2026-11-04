/** Hợp đồng dữ liệu giữa client và server. Server là nguồn sự thật duy nhất. */
import type { ClockSnapshot } from './clock';
import type { GameResult } from './game';
import type { Side } from './board';

export const NICK_MAX = 20;
export const CHAT_MAX = 300;
export const CHAT_KEEP = 100;
export const CHAT_RATE = { count: 5, windowMs: 10_000 };
export const OFFER_TTL_MS = 30_000;
export const RECONNECT_GRACE_MS = 120_000;
export const CUSTOM_MINUTES_MAX = 180;
export const PASSWORD_MAX = 64;

export interface RoomSettings {
  side: Side | 'random';
  /** null = không giới hạn. */
  baseMs: number | null;
  incrementMs: 0 | 3000 | 5000;
}

export const DEFAULT_SETTINGS: RoomSettings = { side: 'random', baseMs: 600_000, incrementMs: 3000 };

export type RoomPhase = 'lobby' | 'playing' | 'finished';

export interface PublicPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
  side: Side | null;
  /** Còn bao nhiêu mili-giây để kết nối lại, null nếu không áp dụng. */
  reconnectMs: number | null;
}

export interface RoomView {
  code: string;
  phase: RoomPhase;
  settings: RoomSettings;
  hasPassword: boolean;
  players: PublicPlayer[];
}

export interface GameView {
  gameId: string;
  version: number;
  initialFen: string;
  moves: [number, number][];
  clock: ClockSnapshot;
  incrementMs: number;
  result: GameResult | null;
}

export type OfferKind = 'draw' | 'undo' | 'rematch';

export interface OfferView {
  id: string;
  kind: OfferKind;
  from: string;
  expiresInMs: number;
  /** Chỉ có với xin đi lại. */
  undo?: { plies: number; notations: string[]; turnAfter: Side };
}

export interface ChatMessage {
  id: string;
  /** null là tin hệ thống. */
  from: string | null;
  name: string;
  text: string;
  at: number;
  clientId?: string;
}

export interface Snapshot {
  you: string;
  room: RoomView;
  game: GameView | null;
  offer: OfferView | null;
  chat: ChatMessage[];
}

export interface MoveEvent {
  gameId: string;
  version: number;
  from: number;
  to: number;
  clock: ClockSnapshot;
  result: GameResult | null;
}

export interface EndEvent {
  gameId: string;
  version: number;
  result: GameResult;
  clock: ClockSnapshot;
}

export type ErrorCode =
  | 'BAD_REQUEST' | 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'ROOM_EXPIRED' | 'ROOM_INTERRUPTED' | 'WRONG_PASSWORD'
  | 'PASSWORD_REQUIRED' | 'GAME_STARTED' | 'TOO_MANY_ATTEMPTS' | 'RATE_LIMITED' | 'NOT_IN_ROOM' | 'NOT_HOST'
  | 'NOT_PLAYER' | 'NOT_READY' | 'WRONG_GAME' | 'WRONG_TURN' | 'STALE_STATE' | 'ILLEGAL_MOVE' | 'GAME_OVER'
  | 'OFFER_PENDING' | 'OFFER_INVALID' | 'BAD_NICKNAME' | 'EMPTY_MESSAGE' | 'MESSAGE_TOO_LONG' | 'ALREADY_IN_ROOM';

export const ERROR_TEXT: Record<ErrorCode, string> = {
  BAD_REQUEST: 'Yêu cầu không hợp lệ',
  ROOM_NOT_FOUND: 'Không tìm thấy phòng. Hãy kiểm tra lại mã.',
  ROOM_FULL: 'Phòng đã đủ người',
  ROOM_EXPIRED: 'Phòng đã hết hạn',
  ROOM_INTERRUPTED: 'Ván bị gián đoạn do máy chủ khởi động lại. Không bên nào bị xử thua.',
  WRONG_PASSWORD: 'Sai mật khẩu',
  PASSWORD_REQUIRED: 'Phòng này cần mật khẩu',
  GAME_STARTED: 'Ván đã bắt đầu, không thể vào phòng',
  TOO_MANY_ATTEMPTS: 'Thử quá nhiều lần. Hãy đợi một phút.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh',
  NOT_IN_ROOM: 'Bạn không ở trong phòng này',
  NOT_HOST: 'Chỉ chủ phòng mới đổi được thiết lập',
  NOT_PLAYER: 'Bạn không thuộc ván này',
  NOT_READY: 'Cần đủ hai người và cả hai sẵn sàng',
  WRONG_GAME: 'Ván này đã thay đổi',
  WRONG_TURN: 'Chưa đến lượt bạn',
  STALE_STATE: 'Bàn cờ vừa được cập nhật lại',
  ILLEGAL_MOVE: 'Nước đi không hợp lệ',
  GAME_OVER: 'Ván đã kết thúc',
  OFFER_PENDING: 'Đang có một đề nghị chờ trả lời',
  OFFER_INVALID: 'Đề nghị không còn hiệu lực',
  BAD_NICKNAME: 'Biệt danh cần từ 1 đến 20 ký tự',
  EMPTY_MESSAGE: 'Tin nhắn đang trống',
  MESSAGE_TOO_LONG: 'Tin nhắn tối đa 300 ký tự',
  ALREADY_IN_ROOM: 'Bạn đang ở một phòng khác',
};

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; code: ErrorCode };

export interface MoveRequest {
  gameId: string;
  requestId: string;
  version: number;
  from: number;
  to: number;
}

/** Quy về chuỗi an toàn: bỏ ký tự điều khiển; trả null nếu không hợp lệ. */
export function cleanNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  const length = [...text].length;
  return length >= 1 && length <= NICK_MAX ? text : null;
}

export function validSettings(raw: unknown): RoomSettings | null {
  const s = raw as RoomSettings;
  if (!s || typeof s !== 'object') return null;
  if (s.side !== 'r' && s.side !== 'b' && s.side !== 'random') return null;
  if (s.incrementMs !== 0 && s.incrementMs !== 3000 && s.incrementMs !== 5000) return null;
  if (s.baseMs !== null) {
    if (typeof s.baseMs !== 'number' || !Number.isFinite(s.baseMs)) return null;
    if (s.baseMs < 1000 || s.baseMs > CUSTOM_MINUTES_MAX * 60_000) return null;
  }
  return { side: s.side, baseMs: s.baseMs, incrementMs: s.incrementMs };
}
