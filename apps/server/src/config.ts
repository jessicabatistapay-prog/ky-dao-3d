import { RECONNECT_GRACE_MS } from '@kydao/engine/protocol';

export interface Config {
  port: number;
  host: string;
  production: boolean;
  /** Danh sách origin được phép; rỗng = chỉ cùng origin với máy chủ. */
  allowedOrigins: string[];
  dbPath: string;
  staticDir: string | null;
  trustProxy: boolean;
  reconnectGraceMs: number;
  offerTtlMs: number;
  lobbyEmptyTtlMs: number;
  finishedTtlMs: number;
  sweepMs: number;
  createRoomPerMinute: number;
  joinPerMinute: number;
  wrongPasswordPerMinute: number;
  chatCount: number;
  chatWindowMs: number;
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: num(env.PORT, 3001),
    host: env.HOST ?? '0.0.0.0',
    production: env.NODE_ENV === 'production',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    dbPath: env.DB_PATH ?? './data/kydao.sqlite',
    staticDir: env.STATIC_DIR ?? null,
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    reconnectGraceMs: num(env.RECONNECT_GRACE_MS, RECONNECT_GRACE_MS),
    offerTtlMs: num(env.OFFER_TTL_MS, 30_000),
    lobbyEmptyTtlMs: num(env.ROOM_EMPTY_TTL_MS, 10 * 60_000),
    finishedTtlMs: num(env.ROOM_FINISHED_TTL_MS, 30 * 60_000),
    sweepMs: num(env.SWEEP_MS, 15_000),
    createRoomPerMinute: num(env.RATE_CREATE_PER_MIN, 10),
    joinPerMinute: num(env.RATE_JOIN_PER_MIN, 30),
    wrongPasswordPerMinute: num(env.RATE_WRONG_PASSWORD_PER_MIN, 6),
    chatCount: num(env.RATE_CHAT_COUNT, 5),
    chatWindowMs: num(env.RATE_CHAT_WINDOW_MS, 10_000),
  };
}
