/** Toàn bộ texture được vẽ bằng canvas nên game không cần tải ảnh ngoài. */
import * as THREE from 'three';
import { hanOf } from '@kydao/engine';
import { BOARD_D, BOARD_W } from './coords';

export const HAN_FONT = '"KyDao Han", "LXGW WenKai TC", "Noto Serif CJK TC", "Songti TC", "SimSun", serif';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function walnut(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, base = '#3b2318') {
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // Các vân chạy dọc thân gỗ, uốn nhẹ quanh vài tâm mắt gỗ.
  for (let i = 0; i < 900; i++) {
    const x0 = r() * w;
    const wobble = 8 + r() * 30;
    const phase = r() * 6;
    const freq = 0.002 + r() * 0.004;
    const light = r() > 0.55;
    ctx.strokeStyle = light
      ? `rgba(${120 + r() * 60},${72 + r() * 40},${42 + r() * 20},${0.05 + r() * 0.13})`
      : `rgba(${12 + r() * 16},${6 + r() * 8},${3 + r() * 6},${0.08 + r() * 0.2})`;
    ctx.lineWidth = 0.6 + r() * 3.4;
    ctx.beginPath();
    for (let y = 0; y <= h; y += 40) {
      const x = x0 + Math.sin(y * freq + phase) * wobble + Math.sin(y * freq * 2.7 + phase) * wobble * 0.3;
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = `rgba(10,5,3,${0.1 + r() * 0.2})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 1.4, 5 + r() * 16);
  }
}

export interface BoardMaps {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

export function makeBoardTextures(): BoardMaps {
  const ppu = 205;
  const W = Math.round(BOARD_W * ppu);
  const H = Math.round(BOARD_D * ppu);
  const [c, ctx] = canvas(W, H);
  walnut(ctx, W, H, 11);
  const [bc, b] = canvas(W, H);
  b.fillStyle = '#b0b0b0';
  b.fillRect(0, 0, W, H);

  const X = (col: number) => W / 2 + (col - 4) * ppu;
  const Y = (row: number) => H / 2 + (row - 4.5) * ppu;

  // Dải sông tối hơn, phủ ánh nước rất nhẹ.
  const river = ctx.createLinearGradient(0, Y(4), 0, Y(5));
  river.addColorStop(0, 'rgba(16,28,30,.55)');
  river.addColorStop(0.5, 'rgba(24,46,46,.62)');
  river.addColorStop(1, 'rgba(16,28,30,.55)');
  ctx.fillStyle = river;
  ctx.fillRect(X(0), Y(4), X(8) - X(0), ppu);

  const stroke = (fn: (g: CanvasRenderingContext2D) => void) => {
    // Đường khảm đồng: vệt tối làm rãnh, vệt sáng làm kim loại.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10,5,3,.75)';
    ctx.lineWidth = 11;
    ctx.beginPath();
    fn(ctx);
    ctx.stroke();
    ctx.strokeStyle = '#dcb876';
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    fn(ctx);
    ctx.stroke();
    ctx.restore();
    b.strokeStyle = '#3a3a3a';
    b.lineWidth = 9;
    b.lineCap = 'round';
    b.beginPath();
    fn(b);
    b.stroke();
  };

  stroke((g) => {
    for (let row = 0; row < 10; row++) {
      g.moveTo(X(0), Y(row));
      g.lineTo(X(8), Y(row));
    }
    for (let col = 0; col < 9; col++) {
      if (col === 0 || col === 8) {
        g.moveTo(X(col), Y(0));
        g.lineTo(X(col), Y(9));
      } else {
        g.moveTo(X(col), Y(0));
        g.lineTo(X(col), Y(4));
        g.moveTo(X(col), Y(5));
        g.lineTo(X(col), Y(9));
      }
    }
    // Cửu cung
    g.moveTo(X(3), Y(0)); g.lineTo(X(5), Y(2));
    g.moveTo(X(5), Y(0)); g.lineTo(X(3), Y(2));
    g.moveTo(X(3), Y(7)); g.lineTo(X(5), Y(9));
    g.moveTo(X(5), Y(7)); g.lineTo(X(3), Y(9));
  });

  // Viền ngoài dày hơn.
  ctx.strokeStyle = '#c9a564';
  ctx.lineWidth = 9;
  ctx.strokeRect(X(0) - 24, Y(0) - 24, X(8) - X(0) + 48, Y(9) - Y(0) + 48);

  // Dấu vị trí Pháo và Tốt.
  const marks: [number, number][] = [[2, 1], [2, 7], [7, 1], [7, 7]];
  for (let col = 0; col <= 8; col += 2) marks.push([3, col], [6, col]);
  stroke((g) => {
    const gap = 12;
    const len = 30;
    for (const [row, col] of marks) {
      const x = X(col);
      const y = Y(row);
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if ((col === 0 && sx < 0) || (col === 8 && sx > 0)) continue;
        g.moveTo(x + sx * gap, y + sy * (gap + len));
        g.lineTo(x + sx * gap, y + sy * gap);
        g.lineTo(x + sx * (gap + len), y + sy * gap);
      }
    }
  });

  ctx.save();
  ctx.fillStyle = 'rgba(214,184,126,.78)';
  ctx.font = `700 ${ppu * 0.68}px ${HAN_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const riverY = (Y(4) + Y(5)) / 2;
  ctx.fillText('楚', X(1), riverY);
  ctx.fillText('河', X(2.3), riverY);
  ctx.save();
  ctx.translate(X(6.3), riverY);
  ctx.rotate(Math.PI);
  ctx.fillText('漢', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(X(7), riverY);
  ctx.rotate(Math.PI);
  ctx.fillText('界', 0, 0);
  ctx.restore();
  ctx.restore();

  return { map: tex(c), bump: tex(bc, false) };
}

export function makeWoodTexture(seed: number, base: string, repeat = 1): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 1024);
  walnut(ctx, 1024, 1024, seed, base);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

/** Vân đá/ngọc dùng chung cho mặt và thân quân. */
function stoneVeins(ctx: CanvasRenderingContext2D, size: number, seed: number, red: boolean) {
  const r = rng(seed);
  const g = ctx.createRadialGradient(size * 0.42, size * 0.38, size * 0.05, size / 2, size / 2, size * 0.72);
  if (red) {
    g.addColorStop(0, '#f3f4e6');
    g.addColorStop(0.6, '#dfe8d2');
    g.addColorStop(1, '#bfd2b6');
  } else {
    g.addColorStop(0, '#34383c');
    g.addColorStop(0.6, '#23272b');
    g.addColorStop(1, '#14171a');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = red
      ? `rgba(${120 + r() * 60},${165 + r() * 40},${130 + r() * 30},${0.08 + r() * 0.18})`
      : `rgba(${150 + r() * 80},${150 + r() * 70},${130 + r() * 60},${0.05 + r() * 0.1})`;
    ctx.lineWidth = 0.6 + r() * (red ? 5 : 1.6);
    let x = r() * size;
    let y = r() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      x += (r() - 0.5) * size * 0.32;
      y += (r() - 0.5) * size * 0.32;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

export function makePieceSideTexture(red: boolean): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  stoneVeins(ctx, 256, red ? 3 : 4, red);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface FaceMaps {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

export function makeFaceTextures(piece: number, size = 384): FaceMaps {
  const red = piece > 0;
  const [c, ctx] = canvas(size, size);
  stoneVeins(ctx, size, 100 + piece + 8, red);
  const [bc, b] = canvas(size, size);
  b.fillStyle = '#ffffff';
  b.fillRect(0, 0, size, size);

  const ink = red ? '#7a0d0d' : '#ecd6a0';
  const m = size / 2;
  for (const g of [ctx, b]) {
    g.lineWidth = size * 0.016;
    g.strokeStyle = g === b ? '#000' : ink;
    g.globalAlpha = g === b ? 1 : 0.85;
    g.beginPath();
    g.arc(m, m, size * 0.425, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  }
  const font = `700 ${size * 0.62}px ${HAN_FONT}`;
  const text = hanOf(piece);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Nét khắc: viền sáng phía dưới phải, tô chữ phía trên.
  ctx.fillStyle = red ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.65)';
  ctx.fillText(text, m + size * 0.008, m + size * 0.018);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = size * 0.012; // làm dày nét để vẫn đọc được trên màn hình nhỏ
  ctx.lineJoin = 'round';
  ctx.strokeText(text, m, m + size * 0.01);
  ctx.fillText(text, m, m + size * 0.01);
  b.font = font;
  b.textAlign = 'center';
  b.textBaseline = 'middle';
  b.fillStyle = '#000';
  b.fillText(text, m, m + size * 0.01);
  return { map: tex(c), bump: tex(bc, false) };
}

export function makeSoftDot(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return tex(c);
}

export function makeRing(thickness = 0.1): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  const mid = 0.86;
  g.addColorStop(Math.max(0, mid - thickness * 2.4), 'rgba(255,255,255,0)');
  g.addColorStop(mid - thickness * 0.3, 'rgba(255,255,255,.55)');
  g.addColorStop(mid, 'rgba(255,255,255,1)');
  g.addColorStop(Math.min(1, mid + thickness), 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return tex(c);
}

export function makeBeamTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 64);
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.75, 'rgba(255,255,255,.8)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 64);
  ctx.globalCompositeOperation = 'destination-in';
  const v = ctx.createLinearGradient(0, 0, 0, 64);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.5, 'rgba(0,0,0,1)');
  v.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 256, 64);
  return tex(c);
}

/** Dấu triện vuông cho Tượng và Tướng, chỉ là họa tiết trang trí. */
export function makeSeal(text: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 12;
  ctx.strokeRect(26, 26, 204, 204);
  ctx.lineWidth = 3;
  ctx.strokeRect(42, 42, 172, 172);
  ctx.fillStyle = '#fff';
  ctx.font = `700 150px ${HAN_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 136);
  return tex(c);
}

export function makeLatticeTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  const g = ctx.createRadialGradient(256, 300, 40, 256, 300, 340);
  g.addColorStop(0, '#f5c77c');
  g.addColorStop(0.55, '#c07a35');
  g.addColorStop(1, '#4a2612');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = '#1a0e09';
  ctx.lineWidth = 11;
  const cell = 64;
  for (let i = 0; i <= 512; i += cell) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
  }
  // Hoa văn chữ vạn đơn giản.
  ctx.lineWidth = 7;
  for (let x = cell / 2; x < 512; x += cell * 2) {
    for (let y = cell / 2; y < 512; y += cell * 2) {
      ctx.strokeRect(x - 15, y - 15, 30 + cell, 30 + cell);
    }
  }
  ctx.strokeStyle = '#1a0e09';
  ctx.lineWidth = 30;
  ctx.strokeRect(0, 0, 512, 512);
  return tex(c);
}

