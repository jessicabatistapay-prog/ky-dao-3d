/**
 * Đạo diễn hình ảnh: giữ 3D bám theo trạng thái ván nhưng không bao giờ quyết
 * định luật. Mỗi sự kiện mang theo bàn cờ sau nước đi; khi animation kết thúc
 * bàn 3D được đối chiếu với bàn đó, nên không thể có quân ma hoặc trùng quân.
 */
import * as THREE from 'three';
import {
  ADVISOR, CANNON, ELEPHANT, HORSE, KING, PAWN, ROOK, colOf, onHomeSide, rowOf, sideOf, typeOf,
} from '@kydao/engine';
import { PIECE_HEIGHT, PIECE_RADIUS, sqX, sqZ } from './coords';
import { makeFaceTextures, makePieceSideTexture } from './textures';
import { Vfx } from './vfx';
import { playSound } from '../lib/sound';

export interface MoveEvent {
  from: number;
  to: number;
  piece: number;
  captured: number;
  check: boolean;
  boardAfter: Int8Array;
  /** Cho phép phát âm thanh (tắt khi xem lại tua nhanh). */
  silent?: boolean;
}

export interface FxSettings {
  particles: boolean;
  shake: boolean;
  reduced: boolean;
  density: number;
  physical: boolean;
}

interface Piece3D {
  group: THREE.Group;
  body: THREE.Mesh;
  face: THREE.Mesh;
  code: number;
  sq: number;
  lift: number;
  x: number; y: number; z: number; scale: number;
}

interface Anim {
  duration: number;
  tick(ms: number): void;
  end(): void;
  cues: { at: number; run: () => void; done?: boolean }[];
}

const CODES = [1, 2, 3, 4, 5, 6, 7, -1, -2, -3, -4, -5, -6, -7];
const ease = (t: number) => t * t * (3 - 2 * t);
const easeIn = (t: number) => t * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

const GOLD = 0xf2c66d;
const RED_FX = 0xff5a3c;
const JADE_FX = 0xa6f0c8;
const ICE_FX = 0x8fc7ff;

function pieceProfile(): THREE.Vector2[] {
  const r = PIECE_RADIUS;
  const h = PIECE_HEIGHT;
  const pts: [number, number][] = [
    [0, 0], [r - 0.035, 0], [r - 0.012, 0.012], [r, 0.04], [r, h - 0.05], [r - 0.012, h - 0.018],
    [r - 0.034, h], [r - 0.05, h], [r - 0.062, h - 0.012], [r - 0.07, h - 0.016], [0, h - 0.016],
  ];
  return pts.map(([x, y]) => new THREE.Vector2(x, y));
}

export class Director {
  readonly root = new THREE.Group();
  readonly vfx = new Vfx();
  private pieces: Piece3D[] = [];
  private bySquare = new Map<number, Piece3D>();
  private queue: MoveEvent[] = [];
  private anim: Anim | null = null;
  private animClock = 0;
  private current: MoveEvent | null = null;
  private board: Int8Array = new Int8Array(90);
  private ready = false;
  private flipped = false;
  private selected = -1;
  private bodyGeo = new THREE.LatheGeometry(pieceProfile(), 48);
  private faceGeo = new THREE.CircleGeometry(PIECE_RADIUS - 0.07, 48).rotateX(-Math.PI / 2);
  private shadowGeo = new THREE.PlaneGeometry(1.15, 1.15).rotateX(-Math.PI / 2);
  private shadowMat: THREE.MeshBasicMaterial | null = null;
  private faces = new Map<number, THREE.MeshStandardMaterial>();
  private bodies = new Map<boolean, THREE.MeshStandardMaterial>();
  private owned: THREE.Texture[] = [];
  private shakeT = 0;
  private shakeAmp = 0;
  readonly shakeOffset = new THREE.Vector3();
  fx: FxSettings = { particles: true, shake: true, reduced: false, density: 1, physical: true };
  onBusyChange: ((busy: boolean) => void) | null = null;
  /** Cảnh chỉ vẽ khi có thay đổi để tiết kiệm pin; hàm này xin thêm một khung hình. */
  requestFrame: () => void = () => {};
  private lastBusy = false;
  /** Bộ đếm cho kiểm thử. */
  stats = { played: 0, resynced: 0 };

  attach(softDot: THREE.Texture) {
    if (this.ready) return;
    this.root.add(this.vfx.group);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: softDot, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false,
    });
    this.buildMaterials();
    this.ready = true;
    this.placeAll();
  }

  private buildMaterials() {
    const Mat = this.fx.physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    for (const red of [true, false]) {
      const side = makePieceSideTexture(red);
      this.owned.push(side);
      const params: THREE.MeshPhysicalMaterialParameters = {
        map: side, roughness: red ? 0.3 : 0.38, metalness: 0,
      };
      if (this.fx.physical) {
        params.clearcoat = red ? 0.9 : 0.6;
        params.clearcoatRoughness = 0.25;
      }
      this.bodies.set(red, new Mat(params));
    }
    for (const code of CODES) {
      const { map, bump } = makeFaceTextures(code);
      this.owned.push(map, bump);
      const params: THREE.MeshPhysicalMaterialParameters = {
        map, bumpMap: bump, bumpScale: 1.6, roughness: code > 0 ? 0.32 : 0.42, metalness: 0,
      };
      if (this.fx.physical) {
        params.clearcoat = 0.7;
        params.clearcoatRoughness = 0.3;
      }
      this.faces.set(code, new Mat(params));
    }
  }

  /** Vẽ lại vật liệu khi font đã tải xong hoặc đổi mức chất lượng. */
  rebuildMaterials() {
    if (!this.ready) return;
    const old = [...this.faces.values(), ...this.bodies.values()];
    const oldTex = this.owned;
    this.owned = [];
    this.faces.clear();
    this.bodies.clear();
    this.buildMaterials();
    for (const p of this.pieces) if (p.code) this.dress(p, p.code);
    old.forEach((m) => m.dispose());
    oldTex.forEach((t) => t.dispose());
  }

  private dress(p: Piece3D, code: number) {
    p.code = code;
    p.body.material = this.bodies.get(code > 0)!;
    p.face.material = this.faces.get(code)!;
  }

  private spawn(): Piece3D {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeo);
    body.castShadow = true;
    body.receiveShadow = true;
    const face = new THREE.Mesh(this.faceGeo);
    face.position.y = PIECE_HEIGHT - 0.014;
    face.receiveShadow = true;
    const blob = new THREE.Mesh(this.shadowGeo, this.shadowMat!);
    blob.position.y = 0.004;
    blob.renderOrder = 1;
    blob.name = 'blob';
    group.add(body, face, blob);
    group.visible = false;
    this.root.add(group);
    const p: Piece3D = { group, body, face, code: 0, sq: -1, lift: 0, x: 0, y: 0, z: 0, scale: 1 };
    this.pieces.push(p);
    return p;
  }

  private free(): Piece3D {
    return this.pieces.find((p) => p.sq === -1) ?? this.spawn();
  }

  private placeAll() {
    this.bySquare.clear();
    for (const p of this.pieces) {
      p.sq = -1;
      p.group.visible = false;
    }
    for (let s = 0; s < 90; s++) {
      const code = this.board[s];
      if (!code) continue;
      const p = this.free();
      this.dress(p, code);
      p.sq = s;
      p.x = sqX(s);
      p.z = sqZ(s);
      p.y = 0;
      p.scale = 1;
      p.lift = 0;
      p.group.visible = true;
      this.bySquare.set(s, p);
    }
  }

  /** Đặt bàn 3D khớp tuyệt đối với `board`, hủy mọi animation đang chạy. */
  sync(board: Int8Array) {
    this.queue.length = 0;
    this.anim = null;
    this.current = null;
    this.board = board.slice();
    this.vfx.clear();
    this.shakeT = 0;
    if (this.ready) this.placeAll();
    this.notifyBusy();
    this.requestFrame();
  }

  enqueue(ev: MoveEvent) {
    this.queue.push(ev);
    if (!this.ready) {
      // Chưa có cảnh 3D: nhảy thẳng tới trạng thái cuối.
      this.board = ev.boardAfter.slice();
      this.queue.length = 0;
    }
    this.notifyBusy();
    this.requestFrame();
  }

  get busy() {
    return !!this.anim || this.queue.length > 0;
  }

  private notifyBusy() {
    const b = this.busy;
    if (b !== this.lastBusy) {
      this.lastBusy = b;
      this.onBusyChange?.(b);
    }
  }

  setFlipped(flipped: boolean) {
    this.flipped = flipped;
    this.root.rotation.y = flipped ? Math.PI : 0;
    this.requestFrame();
  }

  setSelected(s: number) {
    this.selected = s;
    this.requestFrame();
  }

  /** Danh sách quân đang hiển thị, dùng để phát hiện quân ma trong kiểm thử. */
  visual(): { sq: number; code: number }[] {
    return this.pieces.filter((p) => p.sq >= 0 && p.group.visible).map((p) => ({ sq: p.sq, code: p.code }));
  }
  logicalBoard(): Int8Array {
    return this.board;
  }

  private shake(amp: number, ms = 220) {
    if (this.fx.shake && !this.fx.reduced) {
      this.shakeAmp = amp;
      this.shakeT = ms;
    }
  }

  private land(s: number, code: number) {
    const x = sqX(s);
    const z = sqZ(s);
    if (!this.fx.reduced) {
      this.vfx.ring(x, z, code > 0 ? 0xf3e3b8 : 0xc9d4d6, 0.3, 1.5, 0.42);
      this.vfx.burst(x, 0.06, z, 7, 0xbfa880, 1, 0.18, 0.35, 0.5);
    }
  }

  /** Vinh danh bên thắng: trang trọng, không đụng tới Tướng bên thua. */
  victory(kingSq: number) {
    if (!this.ready || kingSq < 0 || this.fx.reduced) return;
    const x = sqX(kingSq);
    const z = sqZ(kingSq);
    [0, 240, 480].forEach((ms, i) => window.setTimeout(() => {
      this.vfx.ring(x, z, GOLD, 0.8, 2.4 + i * 1.3, 0.85);
      this.vfx.burst(x, 0.3, z, 18, GOLD, 1.3, 0.24, 0.9, 3);
      this.requestFrame();
    }, ms));
    this.vfx.flash(x, 0.5, z, GOLD, 3, 0.6);
    this.requestFrame();
  }

  // ---------- Dựng animation ----------

  private buildMove(ev: MoveEvent): Anim {
    const attacker = this.bySquare.get(ev.from);
    if (!attacker) return this.instant(ev);
    const speed = this.queue.length >= 1 ? 2.2 : 1;
    if (this.fx.reduced) return this.buildReduced(ev, attacker);
    const anim = ev.captured ? this.buildCapture(ev, attacker) : this.buildQuiet(ev, attacker);
    if (speed !== 1) {
      anim.duration /= speed;
      const tick = anim.tick;
      anim.tick = (ms) => tick(ms * speed);
      for (const c of anim.cues) c.at /= speed;
    }
    return anim;
  }

  private instant(ev: MoveEvent): Anim {
    return { duration: 0, tick() {}, end: () => this.commit(ev), cues: [] };
  }

  private buildReduced(ev: MoveEvent, p: Piece3D): Anim {
    const [x0, z0, x1, z1] = [sqX(ev.from), sqZ(ev.from), sqX(ev.to), sqZ(ev.to)];
    const victim = this.bySquare.get(ev.to);
    return {
      duration: 140,
      tick: (ms) => {
        const t = ease(clamp01(ms / 140));
        p.x = x0 + (x1 - x0) * t;
        p.z = z0 + (z1 - z0) * t;
        if (victim) victim.scale = 1 - t;
      },
      cues: [{ at: 120, run: () => !ev.silent && playSound(ev.captured ? 'capture' : 'place') }],
      end: () => this.commit(ev),
    };
  }

  private buildQuiet(ev: MoveEvent, p: Piece3D): Anim {
    const t = typeOf(ev.piece);
    const [x0, z0, x1, z1] = [sqX(ev.from), sqZ(ev.from), sqX(ev.to), sqZ(ev.to)];
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const D = Math.min(400, 220 + dist * 28);
    const height = t === HORSE || t === ELEPHANT ? 0.6 : 0.34;
    return {
      duration: D + 70,
      tick: (ms) => {
        const k = clamp01(ms / D);
        const e = ease(k);
        p.x = x0 + (x1 - x0) * e;
        p.z = z0 + (z1 - z0) * e;
        p.y = Math.sin(Math.PI * k) * height;
        if (ms > D) p.y = Math.sin(((ms - D) / 70) * Math.PI) * 0.025; // nảy rất nhỏ
      },
      cues: [{
        at: D,
        run: () => {
          if (!ev.silent) playSound('place');
          this.land(ev.to, ev.piece);
          if (t === PAWN) this.pawnFlourish(ev);
        },
      }],
      end: () => this.commit(ev),
    };
  }

  private pawnFlourish(ev: MoveEvent) {
    const side = sideOf(ev.piece)!;
    if (onHomeSide(side, rowOf(ev.from)) && !onHomeSide(side, rowOf(ev.to))) {
      const x = sqX(ev.to);
      const z = sqZ(ev.to);
      this.vfx.ring(x, z, GOLD, 0.45, 1.9, 0.6);
      this.vfx.burst(x, 0.2, z, 12, GOLD, 1.2, 0.2, 0.5, 2);
    }
  }

  private buildCapture(ev: MoveEvent, p: Piece3D): Anim {
    const victim = this.bySquare.get(ev.to) ?? null;
    const vfx = this.vfx;
    const [x0, z0, x1, z1] = [sqX(ev.from), sqZ(ev.from), sqX(ev.to), sqZ(ev.to)];
    const color = ev.piece > 0 ? RED_FX : ICE_FX;
    const type = typeOf(ev.piece);
    const shatter = (scale = 1) => {
      const vc = ev.captured > 0 ? 0xf2f6df : 0x7d8a96;
      vfx.burst(x1, 0.16, z1, 26 * scale, vc, 2.6, 0.26, 0.6, 2.2);
      vfx.burst(x1, 0.16, z1, 14 * scale, color, 3.4, 0.2, 0.42, 1.4);
    };
    const dissolve = (ms: number, start: number, len: number) => {
      if (!victim) return;
      const k = clamp01((ms - start) / len);
      victim.scale = 1 - easeIn(k);
      victim.y = k * 0.12;
    };
    const hit = (size = 2.2, snd: 'capture' | 'cannon' = 'capture') => {
      if (!ev.silent) playSound(snd);
      vfx.flash(x1, 0.3, z1, color, 2);
      vfx.ring(x1, z1, color, 0.42, size, 0.95);
      shatter();
      this.shake(0.05);
    };
    const charge = (ms: number, len: number) => {
      const k = clamp01(ms / len);
      p.y = ease(k) * 0.2;
    };
    const chargeCue = { at: 10, run: () => vfx.flash(x0, 0.35, z0, color, 1.25, 0.2) };

    switch (type) {
      case ROOK: {
        // Lao thẳng, vệt sáng sắc.
        const P = 130;
        const R = Math.min(170, 90 + Math.hypot(x1 - x0, z1 - z0) * 12);
        const S = 240;
        return {
          duration: P + R + S,
          tick: (ms) => {
            if (ms < P) {
              charge(ms, P);
              const k = ms / P;
              p.x = x0 - Math.sign(x1 - x0) * 0.1 * k;
              p.z = z0 - Math.sign(z1 - z0) * 0.1 * k;
              return;
            }
            const k = clamp01((ms - P) / R);
            const e = easeIn(k);
            p.x = x0 + (x1 - x0) * e;
            p.z = z0 + (z1 - z0) * e;
            p.y = 0.2 * (1 - k);
            dissolve(ms, P + R * 0.8, 200);
          },
          cues: [
            chargeCue,
            { at: P, run: () => vfx.beam(x0, z0, x1, z1, color, 0.34, 0.34) },
            { at: P + R, run: () => hit(2.6) },
          ],
          end: () => this.commit(ev),
        };
      }
      case HORSE: {
        const P = 120;
        const R = 260;
        const S = 210;
        return {
          duration: P + R + S,
          tick: (ms) => {
            if (ms < P) return charge(ms, P);
            const k = clamp01((ms - P) / R);
            const e = ease(k);
            p.x = x0 + (x1 - x0) * e;
            p.z = z0 + (z1 - z0) * e;
            p.y = 0.2 * (1 - k) + Math.sin(Math.PI * k) * 0.95;
            dissolve(ms, P + R * 0.85, 190);
          },
          cues: [
            chargeCue,
            ...[0.25, 0.5, 0.75].map((f) => ({
              at: P + R * f,
              run: () => {
                // Tàn ảnh ngắn dọc đường bật.
                vfx.flash(p.x, p.y + 0.1, p.z, color, 0.95, 0.24);
              },
            })),
            {
              at: P + R,
              run: () => {
                hit(2.1);
                // Hai dấu vó trước đích.
                for (const s of [-1, 1]) {
                  const nx = (z1 - z0) * 0.12 * s;
                  const nz = -(x1 - x0) * 0.12 * s;
                  vfx.ring(x1 + nx, z1 + nz, GOLD, 0.34, 0.8, 0.8);
                }
              },
            },
          ],
          end: () => this.commit(ev),
        };
      }
      case CANNON: {
        // Bắn đạn qua ngòi trước, nổ ở mục tiêu, rồi quân Pháo mới về đích.
        const screen = this.findScreen(ev.from, ev.to);
        const P = 120;
        const F = 180;
        const W = 90;
        const M = 240;
        return {
          duration: P + F + W + M,
          tick: (ms) => {
            if (ms < P) {
              charge(ms, P);
              return;
            }
            if (ms < P + F) {
              const k = (ms - P) / F;
              const e = k;
              const bx = x0 + (x1 - x0) * e;
              const bz = z0 + (z1 - z0) * e;
              // Đạn vọt cao qua ngòi.
              vfx.setBolt(true, bx, 0.4 + Math.sin(Math.PI * k) * 0.75, bz);
              p.y = 0.2 * (1 - k * 0.7);
              return;
            }
            vfx.setBolt(false);
            dissolve(ms, P + F, 170);
            const k = clamp01((ms - P - F - W) / M);
            const e = ease(k);
            p.x = x0 + (x1 - x0) * e;
            p.z = z0 + (z1 - z0) * e;
            p.y = 0.06 * (1 - k) + Math.sin(Math.PI * k) * 0.18;
          },
          cues: [
            chargeCue,
            {
              at: P,
              run: () => {
                if (!ev.silent) playSound('cannon');
                vfx.flash(x0, 0.4, z0, GOLD, 1.5, 0.18);
              },
            },
            ...(screen >= 0 ? [{ at: P + F * 0.5, run: () => vfx.ring(sqX(screen), sqZ(screen), GOLD, 0.26, 1.2, 0.5) }] : []),
            {
              at: P + F,
              run: () => {
                vfx.setBolt(false);
                hit(2.8);
                this.shake(0.075, 260);
              },
            },
            { at: P + F + W + M - 6, run: () => this.land(ev.to, ev.piece) },
          ],
          end: () => this.commit(ev),
        };
      }
      case ELEPHANT: {
        const P = 130;
        const R = 250;
        const S = 230;
        const key = ev.piece > 0 ? '相' : '象';
        return {
          duration: P + R + S,
          tick: (ms) => {
            if (ms < P) return charge(ms, P);
            const k = clamp01((ms - P) / R);
            const e = ease(k);
            p.x = x0 + (x1 - x0) * e;
            p.z = z0 + (z1 - z0) * e;
            p.y = 0.2 * (1 - k) + Math.sin(Math.PI * k) * 0.7;
            dissolve(ms, P + R * 0.9, 200);
          },
          cues: [
            chargeCue,
            {
              at: P + R,
              run: () => {
                hit(2.3);
                vfx.seal(key, x1, z1, GOLD, this.flipped);
                this.shake(0.06);
              },
            },
          ],
          end: () => this.commit(ev),
        };
      }
      case ADVISOR: {
        const P = 110;
        const R = 180;
        const S = 210;
        return {
          duration: P + R + S,
          tick: (ms) => {
            if (ms < P) return charge(ms, P);
            const k = clamp01((ms - P) / R);
            const e = ease(k);
            p.x = x0 + (x1 - x0) * e;
            p.z = z0 + (z1 - z0) * e;
            p.y = 0.2 * (1 - k);
            dissolve(ms, P + R * 0.8, 190);
          },
          cues: [
            chargeCue,
            { at: P, run: () => vfx.beam(x0 - (x1 - x0) * 0.4, z0 - (z1 - z0) * 0.4, x1 + (x1 - x0) * 0.4, z1 + (z1 - z0) * 0.4, JADE_FX, 0.14, 0.34) },
            { at: P + R, run: () => hit(1.9) },
          ],
          end: () => this.commit(ev),
        };
      }
      case KING: {
        const P = 190;
        const R = 200;
        const S = 280;
        return {
          duration: P + R + S,
          tick: (ms) => {
            if (ms < P) return charge(ms, P);
            const k = clamp01((ms - P) / R);
            const e = ease(k);
            p.x = x0 + (x1 - x0) * e;
            p.z = z0 + (z1 - z0) * e;
            p.y = 0.2 * (1 - k);
            dissolve(ms, P + R * 0.8, 220);
          },
          cues: [
            { at: 10, run: () => { vfx.flash(x0, 0.4, z0, GOLD, 2.2, 0.32); vfx.ring(x0, z0, GOLD, 0.34, 1.4, 0.7); } },
            {
              at: P + R,
              run: () => {
                hit(2.4);
                vfx.flash(x1, 0.5, z1, GOLD, 2.8, 0.34);
                vfx.seal('令', x1, z1, GOLD, this.flipped);
              },
            },
          ],
          end: () => this.commit(ev),
        };
      }
      case PAWN:
      default: {
        const P = 110;
        const R = 130;
        const S = 220;
        return {
          duration: P + R + S,
          tick: (ms) => {
            if (ms < P) return charge(ms, P);
            const k = clamp01((ms - P) / R);
            const e = easeIn(k);
            p.x = x0 + (x1 - x0) * e;
            p.z = z0 + (z1 - z0) * e;
            p.y = 0.2 * (1 - k);
            dissolve(ms, P + R * 0.7, 190);
          },
          cues: [
            chargeCue,
            { at: P, run: () => vfx.beam(x0, z0, x1, z1, GOLD, 0.16, 0.22) },
            { at: P + R, run: () => { hit(1.8); this.pawnFlourish(ev); } },
          ],
          end: () => this.commit(ev),
        };
      }
    }
  }

  private findScreen(from: number, to: number): number {
    const dr = Math.sign(rowOf(to) - rowOf(from));
    const dc = Math.sign(colOf(to) - colOf(from));
    for (let s = from + dr * 9 + dc; s !== to; s += dr * 9 + dc) if (this.bySquare.has(s)) return s;
    return -1;
  }

  /** Chốt nước đi: đặt đúng ô, ẩn quân bị ăn, rồi đối chiếu với bàn logic. */
  private commit(ev: MoveEvent) {
    const attacker = this.bySquare.get(ev.from);
    const victim = this.bySquare.get(ev.to);
    if (victim && victim !== attacker) {
      victim.sq = -1;
      victim.scale = 1;
      victim.group.visible = false;
    }
    this.bySquare.delete(ev.from);
    if (attacker) {
      attacker.sq = ev.to;
      attacker.x = sqX(ev.to);
      attacker.z = sqZ(ev.to);
      attacker.y = 0;
      this.bySquare.set(ev.to, attacker);
    }
    this.board = ev.boardAfter.slice();
    this.stats.played++;
    const mismatch = this.board.some((code, s) => (this.bySquare.get(s)?.code ?? 0) !== code);
    if (mismatch) {
      this.stats.resynced++;
      this.placeAll();
    }
  }

  private next() {
    const ev = this.queue.shift();
    if (!ev) return;
    // Hàng đợi quá dài: bỏ animation trung gian để bắt kịp trạng thái.
    if (this.queue.length >= 3) {
      this.board = this.queue[this.queue.length - 1].boardAfter.slice();
      this.queue.length = 0;
      this.placeAll();
      return;
    }
    this.current = ev;
    this.anim = this.buildMove(ev);
    this.animClock = 0;
  }

  update(dt: number) {
    if (!this.ready) return;
    const ms = Math.min(dt, 0.25) * 1000;
    if (!this.anim && this.queue.length) this.next();
    if (this.anim) {
      this.animClock += ms;
      const a = this.anim;
      for (const c of a.cues) {
        if (!c.done && this.animClock >= c.at) {
          c.done = true;
          c.run();
        }
      }
      if (this.animClock >= a.duration) {
        a.end();
        this.anim = null;
        this.current = null;
        if (this.queue.length) this.next();
      } else {
        a.tick(this.animClock);
      }
    }
    this.notifyBusy();

    // Quân được chọn nâng nhẹ.
    const k = 1 - Math.exp(-ms / 60);
    let settling = false;
    for (const p of this.pieces) {
      if (p.sq < 0) continue;
      const moving = this.current && (p.sq === this.current.from);
      const target = p.sq === this.selected && !moving ? 0.2 : 0;
      p.lift += (target - p.lift) * k;
      if (Math.abs(target - p.lift) > 0.002) settling = true;
      else p.lift = target;
      p.group.position.set(p.x, p.y + p.lift + 0.012, p.z);
      p.group.scale.setScalar(Math.max(0.001, p.scale));
      p.group.rotation.y = this.flipped ? Math.PI : 0;
    }

    this.vfx.update(ms / 1000);

    if (this.shakeT > 0) {
      this.shakeT -= ms;
      const a = this.shakeAmp * Math.max(0, this.shakeT / 240);
      this.shakeOffset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.5, (Math.random() - 0.5) * a);
    } else {
      this.shakeOffset.set(0, 0, 0);
    }

    if (this.anim || this.queue.length || settling || this.shakeT > 0 || this.vfx.active) this.requestFrame();
  }

  dispose() {
    this.vfx.dispose();
    this.bodyGeo.dispose();
    this.faceGeo.dispose();
    this.shadowGeo.dispose();
    this.shadowMat?.dispose();
    [...this.faces.values(), ...this.bodies.values()].forEach((m) => m.dispose());
    this.owned.forEach((t) => t.dispose());
    this.ready = false;
  }
}

export const director = new Director();
