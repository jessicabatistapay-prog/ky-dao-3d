import { createServer as createHttp, Server as HttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';
import { Server, Socket } from 'socket.io';
import { Ack, ErrorCode } from '@kydao/engine/protocol';
import type { Config } from './config';
import { RoomService, Session } from './rooms';
import type { GameRepository } from './storage';

export interface App {
  http: HttpServer;
  io: Server;
  service: RoomService;
  close(): Promise<void>;
}

function clientIp(socket: Socket, cfg: Config): string {
  if (cfg.trustProxy) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return socket.handshake.address;
}

export function createApp(cfg: Config, repo: GameRepository): App {
  const web = express();
  web.disable('x-powered-by');
  web.set('trust proxy', cfg.trustProxy);
  web.use((_, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  const http = createHttp(web);
  const allowed = (origin: string | undefined, host: string | undefined): boolean => {
    if (!origin) return true; // không phải trình duyệt
    if (cfg.allowedOrigins.includes(origin)) return true;
    if (cfg.allowedOrigins.length === 0 && !cfg.production) return true;
    try {
      return new URL(origin).host === host; // cùng origin
    } catch {
      return false;
    }
  };
  const io = new Server(http, {
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    cors: cfg.allowedOrigins.length ? { origin: cfg.allowedOrigins } : undefined,
    allowRequest: (req, cb) => cb(null, allowed(req.headers.origin, req.headers.host)),
  });
  const service = new RoomService(io, repo, cfg);

  web.get('/healthz', (_, res) => {
    let db = false;
    try {
      db = repo.ping();
    } catch {
      /* báo lỗi qua mã trạng thái */
    }
    res.status(db ? 200 : 503).json({ ok: db, uptime: Math.round(process.uptime()), rooms: service.roomCount });
  });

  if (cfg.staticDir) {
    const dir = resolve(cfg.staticDir);
    if (existsSync(dir)) {
      web.use('/assets', express.static(join(dir, 'assets'), { immutable: true, maxAge: '1y' }));
      web.use(express.static(dir, { maxAge: '1h', index: false }));
      web.get(/^(?!\/socket\.io).*/, (_, res) => res.sendFile(join(dir, 'index.html')));
    }
  }

  io.on('connection', (socket) => {
    const { session, newToken } = service.connect(socket, socket.handshake.auth?.token);
    const ip = clientIp(socket, cfg);
    const snapshot = service.resume(session, socket);
    // Token chỉ gửi riêng cho chủ phiên, không bao giờ nằm trong URL hoặc log.
    socket.emit('session:ready', { playerId: session.publicId, token: newToken, nickname: session.nickname, snapshot });

    type Handler = (session: Session, data: any) => Ack<any> | Promise<Ack<any>>;
    const on = (event: string, handler: Handler) => {
      socket.on(event, async (data: unknown, ack?: unknown) => {
        const reply = typeof ack === 'function' ? (ack as (r: Ack<any>) => void) : () => {};
        if (session.socket?.id !== socket.id) return reply({ ok: false, code: 'NOT_PLAYER' as ErrorCode });
        if (!service.allowAction(session)) return reply({ ok: false, code: 'RATE_LIMITED' });
        try {
          reply(await handler(session, data));
        } catch (err) {
          console.error(`[${event}]`, err instanceof Error ? err.message : err);
          reply({ ok: false, code: 'BAD_REQUEST' });
        }
      });
    };

    on('room:create', (s, d) => service.create(s, ip, d));
    on('room:peek', (_, d) => service.peek(d?.code, ip));
    on('room:join', (s, d) => service.join(s, ip, d));
    on('room:leave', (s) => service.leave(s));
    on('room:settings', (s, d) => service.setSettings(s, d));
    on('room:ready', (s, d) => service.setReady(s, d));
    on('game:move', (s, d) => service.move(s, d));
    on('game:resign', (s, d) => service.resign(s, d));
    on('game:offer', (s, d) => service.offer(s, d));
    on('game:respond', (s, d) => service.respond(s, d));
    on('chat:send', (s, d) => service.chat(s, d));
    on('game:sync', (s) => ({ ok: true, snapshot: service.syncFor(s) }));

    socket.on('disconnect', () => service.disconnect(session, socket));
  });

  return {
    http, io, service,
    close: () =>
      new Promise((done) => {
        service.shutdown();
        void io.close(() => {
          http.close(() => done());
          http.closeAllConnections?.();
        });
      }),
  };
}
