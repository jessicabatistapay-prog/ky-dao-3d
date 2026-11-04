/**
 * Lớp lưu trữ tách khỏi logic phòng. Muốn chuyển sang PostgreSQL chỉ cần viết
 * một lớp khác thỏa `GameRepository`. Chat cố tình không có ở đây.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface GameRow {
  id: string;
  roomCode: string;
  initialFen: string;
  redName: string;
  blackName: string;
  baseMs: number | null;
  incrementMs: number;
  startedAt: number;
}

export interface ProgressRow {
  moves: [number, number][];
  clockRed: number | null;
  clockBlack: number | null;
  version: number;
}

export interface StoredGame extends GameRow, ProgressRow {
  status: 'active' | 'finished' | 'interrupted';
  winner: string | null;
  reason: string | null;
  endedAt: number | null;
}

export interface GameRepository {
  createGame(row: GameRow): void;
  saveProgress(id: string, progress: ProgressRow): void;
  finishGame(id: string, winner: string | null, reason: string, progress: ProgressRow, at: number): void;
  /** Sau khi khởi động: ván đang dở không phục hồi được thì đánh dấu gián đoạn. */
  markActiveInterrupted(at: number): number;
  findLatestByRoom(roomCode: string): StoredGame | null;
  getGame(id: string): StoredGame | null;
  ping(): boolean;
  close(): void;
}

export class SqliteRepository implements GameRepository {
  private db: DatabaseSync;
  private stmts;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        initial_fen TEXT NOT NULL,
        red_name TEXT NOT NULL,
        black_name TEXT NOT NULL,
        base_ms INTEGER,
        increment_ms INTEGER NOT NULL,
        moves TEXT NOT NULL DEFAULT '[]',
        clock_red REAL,
        clock_black REAL,
        version INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        winner TEXT,
        reason TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_games_room ON games(room_code, started_at);
      CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
    `);
    this.stmts = {
      insert: this.db.prepare(`INSERT INTO games (id, room_code, initial_fen, red_name, black_name, base_ms, increment_ms, clock_red, clock_black, started_at)
        VALUES (@id, @roomCode, @initialFen, @redName, @blackName, @baseMs, @incrementMs, @baseMs, @baseMs, @startedAt)`),
      progress: this.db.prepare(`UPDATE games SET moves=@moves, clock_red=@clockRed, clock_black=@clockBlack, version=@version WHERE id=@id`),
      finish: this.db.prepare(`UPDATE games SET moves=@moves, clock_red=@clockRed, clock_black=@clockBlack, version=@version,
        status='finished', winner=@winner, reason=@reason, ended_at=@at WHERE id=@id AND status='active'`),
      interrupt: this.db.prepare(`UPDATE games SET status='interrupted', reason='interrupted', ended_at=? WHERE status='active'`),
      latest: this.db.prepare(`SELECT * FROM games WHERE room_code=? ORDER BY started_at DESC LIMIT 1`),
      get: this.db.prepare(`SELECT * FROM games WHERE id=?`),
      ping: this.db.prepare('SELECT 1 AS ok'),
    };
  }

  createGame(row: GameRow) {
    this.stmts.insert.run({ ...row });
  }
  saveProgress(id: string, p: ProgressRow) {
    this.stmts.progress.run({ id, moves: JSON.stringify(p.moves), clockRed: p.clockRed, clockBlack: p.clockBlack, version: p.version });
  }
  finishGame(id: string, winner: string | null, reason: string, p: ProgressRow, at: number) {
    this.stmts.finish.run({ id, winner, reason, at, moves: JSON.stringify(p.moves), clockRed: p.clockRed, clockBlack: p.clockBlack, version: p.version });
  }
  markActiveInterrupted(at: number) {
    return Number(this.stmts.interrupt.run(at).changes);
  }
  private map(r: any): StoredGame | null {
    if (!r) return null;
    return {
      id: r.id, roomCode: r.room_code, initialFen: r.initial_fen, redName: r.red_name, blackName: r.black_name,
      baseMs: r.base_ms, incrementMs: r.increment_ms, startedAt: r.started_at, moves: JSON.parse(r.moves),
      clockRed: r.clock_red, clockBlack: r.clock_black, version: r.version, status: r.status, winner: r.winner,
      reason: r.reason, endedAt: r.ended_at,
    };
  }
  findLatestByRoom(code: string) {
    return this.map(this.stmts.latest.get(code));
  }
  getGame(id: string) {
    return this.map(this.stmts.get.get(id));
  }
  ping() {
    return (this.stmts.ping.get() as unknown as { ok: number }).ok === 1;
  }
  close() {
    this.db.close();
  }
}
