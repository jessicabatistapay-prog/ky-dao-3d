import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Socket, io } from 'socket.io-client';
import { XiangqiGame, sq } from '@kydao/engine';
import type { Ack, Snapshot } from '@kydao/engine/protocol';
import { App, createApp } from '../src/app';
import { Config, loadConfig } from '../src/config';
import { SqliteRepository } from '../src/storage';

let app: App;
let repo: SqliteRepository;
let url: string;
const sockets: Socket[] = [];

async function boot(over: Partial<Config> = {}) {
  repo = new SqliteRepository(':memory:');
  const cfg = { ...loadConfig({}), production: false, createRoomPerMinute: 1000, joinPerMinute: 1000, ...over };
  app = createApp(cfg, repo);
  await new Promise<void>((r) => app.http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
}

interface Client {
  s: Socket;
  token: string;
  id: string;
  events: Record<string, any[]>;
  snapshot: any;
  call<T = object>(event: string, data?: unknown): Promise<Ack<T>>;
  wait(event: string, pred?: (d: any) => boolean, ms?: number): Promise<any>;
}

async function client(token?: string): Promise<Client> {
  const s = io(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(s);
  const events: Record<string, any[]> = {};
  s.onAny((e, d) => (events[e] ??= []).push(d));
  const ready: any = await new Promise((r) => s.once('session:ready', r));
  const c: Client = {
    s, events, token: ready.token ?? token!, id: ready.playerId, snapshot: ready.snapshot,
    call: (event, data) => new Promise((r) => s.emit(event, data, r)),
    wait(event, pred = () => true, ms = 4000) {
      const list = events[event] ?? [];
      const idx = list.findIndex(pred);
      if (idx >= 0) return Promise.resolve(list[idx]);
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error(`hết giờ chờ ${event}`)), ms);
        const h = (d: any) => {
          if (pred(d)) {
            clearTimeout(t);
            s.off(event, h);
            res(d);
          }
        };
        s.on(event, h);
      });
    },
  };
  return c;
}

async function pair(settings: object = { side: 'r', baseMs: 60000, incrementMs: 0 }) {
  const a = await client();
  const b = await client();
  const made: any = await a.call('room:create', { nickname: 'An', settings });
  expect(made.ok).toBe(true);
  const code = made.snapshot.room.code;
  const joined: any = await b.call('room:join', { nickname: 'Bình', code });
  expect(joined.ok).toBe(true);
  return { a, b, code };
}

async function start(settings?: object) {
  const p = await pair(settings);
  await p.a.call('room:ready', { ready: true });
  await p.b.call('room:ready', { ready: true });
  const snap: Snapshot = await p.a.wait('game:sync', (d) => d.game);
  await p.b.wait('game:sync', (d) => d.game);
  return { ...p, gameId: snap.game!.gameId };
}

const mv = (gameId: string, version: number, from: number, to: number, requestId: string = crypto.randomUUID()) =>
  ({ gameId, version, from, to, requestId });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  await boot();
});
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  await app.close();
  repo.close();
});

describe('Phòng', () => {
  it('tạo phòng, vào bằng mã, đủ hai người sẵn sàng thì bắt đầu', async () => {
    const { a, b, gameId } = await start();
    expect(gameId).toBeTruthy();
    const ra = a.events['game:sync'].at(-1).room.players;
    expect(ra.find((p: any) => p.id === a.id).side).toBe('r');
    expect(ra.find((p: any) => p.id === b.id).side).toBe('b');
  });

  it('phân biệt các lỗi vào phòng', async () => {
    const c = await client();
    expect(await c.call('room:join', { nickname: 'C', code: 'ZZZZZZ' })).toEqual({ ok: false, code: 'ROOM_NOT_FOUND' });
    const { code } = await pair();
    expect(await c.call('room:join', { nickname: 'C', code })).toEqual({ ok: false, code: 'ROOM_FULL' });
    const { code: playing } = await start();
    expect(await c.call('room:join', { nickname: 'C', code: playing })).toEqual({ ok: false, code: 'GAME_STARTED' });
  });

  it('mật khẩu: cần, sai, đúng, và giới hạn số lần thử', async () => {
    await app.close();
    repo.close();
    await boot({ wrongPasswordPerMinute: 3 });
    const a = await client();
    const made: any = await a.call('room:create', { nickname: 'An', password: 'bi-mat' });
    const code = made.snapshot.room.code;
    const b = await client();
    expect(await b.call('room:join', { nickname: 'B', code })).toEqual({ ok: false, code: 'PASSWORD_REQUIRED' });
    expect(await b.call('room:join', { nickname: 'B', code, password: 'sai' })).toEqual({ ok: false, code: 'WRONG_PASSWORD' });
    expect((await b.call<any>('room:join', { nickname: 'B', code, password: 'bi-mat' })).ok).toBe(true);
    const c = await client();
    const d: any = await a.call('room:leave');
    expect(d.ok).toBe(true);
    for (let i = 0; i < 3; i++) await c.call('room:join', { nickname: 'C', code, password: 'x' });
    expect(await c.call('room:join', { nickname: 'C', code, password: 'x' })).toEqual({ ok: false, code: 'TOO_MANY_ATTEMPTS' });
  });

  it('đổi thiết lập hủy sẵn sàng; chỉ chủ phòng được đổi', async () => {
    const { a, b } = await pair();
    await b.call('room:ready', { ready: true });
    expect(await b.call('room:settings', { settings: { side: 'b', baseMs: null, incrementMs: 0 } })).toEqual({ ok: false, code: 'NOT_HOST' });
    expect((await a.call('room:settings', { settings: { side: 'b', baseMs: null, incrementMs: 0 } })).ok).toBe(true);
    const up = await b.wait('room:update', (r) => r.settings.baseMs === null);
    expect(up.players.every((p: any) => !p.ready)).toBe(true);
  });

  it('khóa thiết lập khi ván đã bắt đầu', async () => {
    const { a } = await start();
    expect(await a.call('room:settings', { settings: { side: 'r', baseMs: null, incrementMs: 0 } })).toEqual({ ok: false, code: 'GAME_STARTED' });
  });

  it('phòng trống hết hạn thì báo đúng lý do', async () => {
    await app.close();
    repo.close();
    await boot({ lobbyEmptyTtlMs: 10, sweepMs: 20 });
    const a = await client();
    const made: any = await a.call('room:create', { nickname: 'An' });
    const code = made.snapshot.room.code;
    a.s.disconnect();
    await delay(150);
    const b = await client();
    expect(await b.call('room:join', { nickname: 'B', code })).toEqual({ ok: false, code: 'ROOM_EXPIRED' });
  });
});

describe('Chống gian lận', () => {
  it('hai bên nhận cùng nước đi đã xác nhận', async () => {
    const { a, b, gameId } = await start();
    const r: any = await a.call('game:move', mv(gameId, 0, sq(7, 1), sq(7, 4)));
    expect(r).toEqual({ ok: true, version: 1 });
    const ma = await a.wait('game:moved');
    const mb = await b.wait('game:moved');
    expect(ma).toEqual(mb);
  });

  it('từ chối sai lượt, sai luật, giả mạo phe, người ngoài', async () => {
    const { a, b, gameId } = await start();
    // Đen đi khi chưa tới lượt
    expect(await b.call('game:move', mv(gameId, 0, sq(0, 0), sq(1, 0)))).toEqual({ ok: false, code: 'WRONG_TURN' });
    // Đỏ đi sai luật
    expect(await a.call('game:move', mv(gameId, 0, sq(9, 0), sq(5, 5)))).toEqual({ ok: false, code: 'ILLEGAL_MOVE' });
    // Đỏ tìm cách đi quân Đen
    expect(await a.call('game:move', mv(gameId, 0, sq(0, 0), sq(1, 0)))).toEqual({ ok: false, code: 'ILLEGAL_MOVE' });
    // Người ngoài
    const c = await client();
    expect(await c.call('game:move', mv(gameId, 0, sq(9, 0), sq(8, 0)))).toEqual({ ok: false, code: 'NOT_PLAYER' });
    expect(await a.call('game:move', { ...mv('gia-mao', 0, 1, 2) })).toEqual({ ok: false, code: 'WRONG_GAME' });
    expect((await a.call('game:move', { gameId, requestId: 'x', version: 0, from: 'a', to: 1 })).ok).toBe(false);
  });

  it('gửi lặp yêu cầu không đi hai nước và trả lại cùng kết quả', async () => {
    const { a, b, gameId } = await start();
    const m = mv(gameId, 0, sq(7, 1), sq(7, 4), 'req-1');
    const first = await a.call('game:move', m);
    const second = await a.call('game:move', m);
    expect(second).toEqual(first);
    await delay(50);
    expect(a.events['game:moved'].length).toBe(1);
    expect(b.events['game:moved'].length).toBe(1);
  });

  it('từ chối trạng thái cũ và gửi lại dữ liệu đồng bộ', async () => {
    const { a, b, gameId } = await start();
    await a.call('game:move', mv(gameId, 0, sq(7, 1), sq(7, 4)));
    await b.call('game:move', mv(gameId, 1, sq(0, 1), sq(2, 2)));
    expect(await a.call('game:move', mv(gameId, 1, sq(9, 1), sq(7, 2)))).toEqual({ ok: false, code: 'STALE_STATE' });
    const sync = await a.wait('game:sync', (d) => d.game?.version === 2);
    expect(sync.game.moves.length).toBe(2);
  });

  it('kết quả do server quyết: không tin dữ liệu thêm từ client', async () => {
    const { a, gameId } = await start();
    const r: any = await a.call('game:move', { ...mv(gameId, 0, sq(7, 1), sq(7, 4)), result: { winner: 'r' }, clock: { r: 999 } });
    expect(r.ok).toBe(true);
    const moved = await a.wait('game:moved');
    expect(moved.result).toBeNull();
    expect(moved.clock.r).toBeLessThanOrEqual(60000);
  });
});

describe('Đồng hồ và kết thúc', () => {
  it('server tự kết thúc khi hết giờ, đúng một lần', async () => {
    const { a, b } = await start({ side: 'r', baseMs: 1000, incrementMs: 0 });
    const end = await a.wait('game:ended', undefined, 2500);
    expect(end.result).toEqual({ winner: 'b', reason: 'timeout' });
    await b.wait('game:ended');
    await delay(100);
    expect(a.events['game:ended'].length).toBe(1);
  });

  it('nước đi sau khi hết giờ bị từ chối', async () => {
    const { a, gameId } = await start({ side: 'r', baseMs: 1000, incrementMs: 0 });
    await delay(1100);
    expect(await a.call('game:move', mv(gameId, 0, sq(7, 1), sq(7, 4)))).toEqual({ ok: false, code: 'GAME_OVER' });
  });

  it('nhiều sự kiện gần đồng thời chỉ tạo một kết quả', async () => {
    const { a, b, gameId } = await start();
    await Promise.all([a.call('game:resign', { gameId }), b.call('game:resign', { gameId })]);
    await delay(80);
    expect(a.events['game:ended'].length).toBe(1);
    expect(b.events['game:ended'].length).toBe(1);
    expect(repo.getGame(gameId)?.status).toBe('finished');
  });

  it('lưu nước đi và kết quả vào SQLite', async () => {
    const { a, gameId } = await start();
    await a.call('game:move', mv(gameId, 0, sq(7, 1), sq(7, 4)));
    expect(repo.getGame(gameId)?.moves).toEqual([[sq(7, 1), sq(7, 4)]]);
    await a.call('game:resign', { gameId });
    const row = repo.getGame(gameId);
    expect([row?.status, row?.winner, row?.reason]).toEqual(['finished', 'b', 'resign']);
  });

  it('chiếu bí do server phát hiện', async () => {
    const { a, b, gameId } = await start({ side: 'r', baseMs: null, incrementMs: 0 });
    // Đặt thẳng một thế chiếu bí trong một nước để kiểm tra server tự phát hiện.
    const room = [...(app.service as any).rooms.values()][0] as any;
    room.game.game = new XiangqiGame('3k5/9/9/9/9/9/9/9/5r3/1r2K4 b');
    const r: any = await b.call('game:move', mv(gameId, 0, sq(9, 1), sq(9, 2)));
    expect(r.ok).toBe(true);
    const end = await a.wait('game:ended');
    expect(end.result).toEqual({ winner: 'b', reason: 'checkmate' });
    await delay(50);
    expect(a.events['game:ended'].length).toBe(1);
    expect(repo.getGame(gameId)?.reason).toBe('checkmate');
  });
});

describe('Mất kết nối', () => {
  it('khôi phục đúng vị trí bằng token; biệt danh không phải bằng chứng', async () => {
    const { a, b, gameId, code } = await start();
    await a.call('game:move', mv(gameId, 0, sq(7, 1), sq(7, 4)));
    b.s.disconnect();
    const up = await a.wait('room:update', (r) => r.players.some((p: any) => !p.connected));
    expect(up.players.find((p: any) => p.id === b.id).reconnectMs).toBeGreaterThan(100000);
    // Kẻ khác dùng cùng biệt danh không vào được.
    const fake = await client();
    expect(await fake.call('room:join', { nickname: 'Bình', code })).toEqual({ ok: false, code: 'GAME_STARTED' });
    const back = await client(b.token);
    expect(back.snapshot.game.gameId).toBe(gameId);
    expect(back.snapshot.game.moves.length).toBe(1);
    expect(back.id).toBe(b.id);
    const r: any = await back.call('game:move', mv(gameId, 1, sq(0, 1), sq(2, 2)));
    expect(r.ok).toBe(true);
  });

  it('quá hạn kết nối lại thì xử thua do bỏ cuộc', async () => {
    await app.close();
    repo.close();
    await boot({ reconnectGraceMs: 200 });
    const { a, b } = await start();
    b.s.disconnect();
    const end = await a.wait('game:ended');
    expect(end.result).toEqual({ winner: 'r', reason: 'abandon' });
  });

  it('hết giờ trước hạn kết nối lại thì thua do hết giờ', async () => {
    await app.close();
    repo.close();
    await boot({ reconnectGraceMs: 5000 });
    const { a } = await start({ side: 'r', baseMs: 1000, incrementMs: 0 });
    a.s.disconnect();
    await delay(1200);
    const [game] = [...(app.service as any).rooms.values()].map((x: any) => x.game);
    expect(game.game.result).toEqual({ winner: 'b', reason: 'timeout' });
  });

  it('cả hai cùng mất kết nối chỉ ra một kết quả', async () => {
    await app.close();
    repo.close();
    await boot({ reconnectGraceMs: 200 });
    const { a, b, gameId } = await start();
    a.s.disconnect();
    await delay(30);
    b.s.disconnect();
    await delay(400);
    const row = repo.getGame(gameId)!;
    expect(row.status).toBe('finished');
    expect(row.reason).toBe('abandon');
    expect(row.winner).toBe('b'); // Đỏ rớt trước nên hết hạn trước
  });

  it('nhiều tab: kết nối mới giành quyền, kết nối cũ bị ngắt', async () => {
    const { a, gameId } = await start();
    const second = await client(a.token);
    await a.wait('session:superseded');
    expect(second.snapshot.game.gameId).toBe(gameId);
    expect(a.s.connected).toBe(false);
    const r: any = await second.call('game:move', mv(gameId, 0, sq(7, 1), sq(7, 4)));
    expect(r.ok).toBe(true);
    await delay(30);
    const room = [...(app.service as any).rooms.values()][0] as any;
    expect(room.seats.every((s: any) => s.connected)).toBe(true);
  });

  it('server khởi động lại: ván dở thành gián đoạn, không xử ai thua', async () => {
    const { gameId, code } = await start();
    const n = repo.markActiveInterrupted(Date.now());
    expect(n).toBe(1);
    const row = repo.getGame(gameId)!;
    expect([row.status, row.winner]).toEqual(['interrupted', null]);
    (app.service as any).rooms.delete(code);
    const c = await client();
    expect(await c.call('room:join', { nickname: 'C', code })).toEqual({ ok: false, code: 'ROOM_INTERRUPTED' });
  });

  it('không lộ token trong dữ liệu phòng', async () => {
    const { a, b } = await start();
    const dump = JSON.stringify(b.events);
    expect(dump).not.toContain(a.token);
  });
});

describe('Đề nghị giữa hai người', () => {
  it('xin hòa được chấp nhận', async () => {
    const { a, b, gameId } = await start();
    await a.call('game:offer', { gameId, kind: 'draw' });
    const o = await b.wait('offer:update', (x) => x);
    expect((await a.call('game:offer', { gameId, kind: 'draw' }))).toEqual({ ok: false, code: 'OFFER_PENDING' });
    await b.call('game:respond', { offerId: o.id, accept: true });
    const end = await a.wait('game:ended');
    expect(end.result).toEqual({ winner: null, reason: 'agreement' });
  });

  it('đề nghị bị hủy khi có nước đi mới', async () => {
    const { a, b, gameId } = await start();
    await b.call('game:offer', { gameId, kind: 'draw' });
    const o = await a.wait('offer:update', (x) => x);
    await a.call('game:move', mv(gameId, 0, sq(7, 1), sq(7, 4)));
    await b.wait('offer:update', (x) => x === null);
    expect(await a.call('game:respond', { offerId: o.id, accept: true })).toEqual({ ok: false, code: 'OFFER_INVALID' });
  });

  it('đề nghị hết hạn', async () => {
    await app.close();
    repo.close();
    await boot({ offerTtlMs: 100 });
    const { a, b, gameId } = await start();
    await a.call('game:offer', { gameId, kind: 'draw' });
    await b.wait('offer:update', (x) => x);
    await b.wait('offer:update', (x) => x === null);
  });

  it('xin đi lại ghi rõ nước và trả lượt đúng, không hoàn thời gian đã nghĩ', async () => {
    const { a, b, gameId } = await start();
    await a.call('game:move', mv(gameId, 0, sq(7, 1), sq(7, 4)));
    await delay(120);
    await a.call('game:offer', { gameId, kind: 'undo' });
    const o = await b.wait('offer:update', (x) => x);
    expect(o.undo).toEqual({ plies: 1, notations: ['Pháo 8 bình 5'], turnAfter: 'r' });
    await b.call('game:respond', { offerId: o.id, accept: true });
    const sync = await a.wait('game:sync', (d) => d.game?.moves.length === 0 && d.game.version === 2);
    expect(sync.game.clock.running).toBe('r');
    expect(sync.game.clock.b).toBeLessThan(60000);
  });

  it('xin đi lại khi đối thủ đã trả lời thì hoàn tác hai nước', async () => {
    const { a, b, gameId } = await start();
    await a.call('game:move', mv(gameId, 0, sq(7, 1), sq(7, 4)));
    await b.call('game:move', mv(gameId, 1, sq(0, 1), sq(2, 2)));
    await a.call('game:offer', { gameId, kind: 'undo' });
    const o = await b.wait('offer:update', (x) => x);
    expect(o.undo.plies).toBe(2);
    expect(o.undo.turnAfter).toBe('r');
  });

  it('từ chối đề nghị giữ nguyên ván', async () => {
    const { a, b, gameId } = await start();
    await a.call('game:offer', { gameId, kind: 'draw' });
    const o = await b.wait('offer:update', (x) => x);
    await b.call('game:respond', { offerId: o.id, accept: false });
    await a.wait('offer:update', (x) => x === null);
    expect((a.events['game:ended'] ?? []).length).toBe(0);
  });

  it('tái đấu: cần hai bên đồng ý, ID ván mới, đổi bên, đặt lại đồng hồ', async () => {
    const { a, b, gameId } = await start();
    await a.call('game:move', mv(gameId, 0, sq(7, 1), sq(7, 4)));
    await a.call('game:resign', { gameId });
    await b.wait('game:ended');
    await b.call('game:offer', { gameId, kind: 'rematch' });
    const o = await a.wait('offer:update', (x) => x);
    await a.call('game:respond', { offerId: o.id, accept: true });
    const s = await a.wait('game:sync', (d) => d.game && d.game.gameId !== gameId);
    expect(s.game.moves).toEqual([]);
    expect(s.game.clock.r).toBeGreaterThan(59000);
    expect(s.room.players.find((p: any) => p.id === a.id).side).toBe('b');
    expect(s.room.players.find((p: any) => p.id === b.id).side).toBe('r');
  });
});

describe('Chat', () => {
  it('gửi nhận đúng phòng, không lộ sang phòng khác', async () => {
    const p1 = await pair();
    const p2 = await pair();
    const r: any = await p1.a.call('chat:send', { clientId: 'c1', text: 'Chào bạn 😀' });
    expect(r.ok).toBe(true);
    const m = await p1.b.wait('chat:message', (x) => x.text === 'Chào bạn 😀');
    expect(m.name).toBe('An');
    await delay(50);
    const leaked = [...(p2.a.events['chat:message'] ?? []), ...(p2.b.events['chat:message'] ?? [])];
    expect(leaked.some((x) => x.text.includes('Chào bạn'))).toBe(false);
  });

  it('người gửi do server xác định, không nhận tên từ client', async () => {
    const { a, b } = await pair();
    await a.call('chat:send', { text: 'hi', name: 'Admin', from: b.id });
    const m = await b.wait('chat:message', (x) => x.text === 'hi');
    expect([m.name, m.from]).toEqual(['An', a.id]);
  });

  it('người ngoài phòng không gửi được', async () => {
    const c = await client();
    expect(await c.call('chat:send', { text: 'x' })).toEqual({ ok: false, code: 'NOT_IN_ROOM' });
  });

  it('từ chối tin rỗng, quá dài, và giới hạn tần suất', async () => {
    const { a } = await pair();
    expect(await a.call('chat:send', { text: '   ' })).toEqual({ ok: false, code: 'EMPTY_MESSAGE' });
    expect(await a.call('chat:send', { text: 'a'.repeat(301) })).toEqual({ ok: false, code: 'MESSAGE_TOO_LONG' });
    expect((await a.call('chat:send', { text: '😀'.repeat(300) })).ok).toBe(true);
    for (let i = 0; i < 4; i++) expect((await a.call('chat:send', { text: `m${i}` })).ok).toBe(true);
    expect(await a.call('chat:send', { text: 'nhiều quá' })).toEqual({ ok: false, code: 'RATE_LIMITED' });
  });

  it('gửi lại cùng clientId không tạo tin trùng', async () => {
    const { a, b } = await pair();
    const x: any = await a.call('chat:send', { clientId: 'same', text: 'một lần' });
    const y: any = await a.call('chat:send', { clientId: 'same', text: 'một lần' });
    expect(x.message.id).toBe(y.message.id);
    await delay(40);
    expect(b.events['chat:message'].filter((m) => m.text === 'một lần').length).toBe(1);
  });

  it('chỉ giữ 100 tin gần nhất', async () => {
    await app.close();
    repo.close();
    await boot({ chatCount: 1000 });
    const { a, b } = await pair();
    for (let i = 0; i < 110; i++) await a.call('chat:send', { text: `t${i}` });
    const back = await client(b.token);
    expect(back.snapshot.chat.length).toBe(100);
    expect(back.snapshot.chat.at(-1).text).toBe('t109');
  });

  it('lịch sử ván không chứa chat', async () => {
    const { a, gameId } = await start();
    await a.call('chat:send', { text: 'bí mật' });
    expect(JSON.stringify(repo.getGame(gameId))).not.toContain('bí mật');
  });
});

describe('Origin và health', () => {
  it('production từ chối origin lạ, cho phép origin khai báo', async () => {
    await app.close();
    repo.close();
    await boot({ production: true, allowedOrigins: ['https://game.example'] });
    const res = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    const good = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: 'https://game.example' } });
    expect(good.status).toBe(200);
  });
  it('healthz trả trạng thái', async () => {
    const r = await fetch(`${url}/healthz`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { ok: boolean }).ok).toBe(true);
  });
});
