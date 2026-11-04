/** Hệ thống hiệu ứng có pool: không cấp phát đối tượng mới trong lúc chơi. */
import * as THREE from 'three';
import { makeBeamTexture, makeRing, makeSeal, makeSoftDot } from './textures';

export interface VfxOptions {
  particles: boolean;
  /** Hệ số số lượng hạt theo chất lượng. */
  density: number;
}

const MAX_PARTICLES = 420;

const PARTICLE_VS = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FS = /* glsl */ `
varying vec4 vColor;
uniform sampler2D uMap;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
}`;

interface Sprite3D {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  active: boolean;
  from: number;
  to: number;
  peak: number;
}

const flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

export class Vfx {
  readonly group = new THREE.Group();
  options: VfxOptions = { particles: true, density: 1 };

  private positions = new Float32Array(MAX_PARTICLES * 3);
  private colors = new Float32Array(MAX_PARTICLES * 4);
  private sizes = new Float32Array(MAX_PARTICLES);
  private vel = new Float32Array(MAX_PARTICLES * 3);
  private life = new Float32Array(MAX_PARTICLES);
  private maxLife = new Float32Array(MAX_PARTICLES);
  private baseSize = new Float32Array(MAX_PARTICLES);
  private cursor = 0;
  private live = 0;
  private points: THREE.Points;
  private pointMat: THREE.ShaderMaterial;
  private geo = new THREE.BufferGeometry();

  private rings: Sprite3D[] = [];
  private beams: Sprite3D[] = [];
  private flashes: Sprite3D[] = [];
  private seals: Record<string, Sprite3D> = {};
  private textures: THREE.Texture[] = [];
  private bolt: THREE.Mesh;
  private boltMat: THREE.MeshBasicMaterial;

  constructor() {
    const dot = this.own(makeSoftDot());
    const ring = this.own(makeRing(0.09));
    const beam = this.own(makeBeamTexture());

    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.pointMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      uniforms: { uMap: { value: dot }, uScale: { value: 420 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.pointMat);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    for (let i = 0; i < 10; i++) this.rings.push(this.sprite(ring));
    for (let i = 0; i < 6; i++) this.beams.push(this.sprite(beam));
    for (let i = 0; i < 8; i++) this.flashes.push(this.sprite(dot));
    this.boltMat = new THREE.MeshBasicMaterial({
      map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffb060,
    });
    this.bolt = new THREE.Mesh(flatGeo, this.boltMat);
    this.bolt.scale.set(0.9, 1, 0.9);
    this.bolt.visible = false;
    this.bolt.renderOrder = 5;
    this.group.add(this.bolt);

    for (const key of ['象', '相', '令']) {
      const t = this.own(makeSeal(key));
      this.seals[key] = this.sprite(t);
    }
  }

  private own<T extends THREE.Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  private sprite(map: THREE.Texture): Sprite3D {
    const mat = new THREE.MeshBasicMaterial({
      map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(flatGeo, mat);
    mesh.visible = false;
    mesh.renderOrder = 4;
    this.group.add(mesh);
    return { mesh, mat, age: 0, life: 0, active: false, from: 1, to: 1, peak: 1 };
  }

  private fire(pool: Sprite3D[]): Sprite3D {
    return pool.find((s) => !s.active) ?? pool.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
  }

  private start(s: Sprite3D, x: number, y: number, z: number, life: number, from: number, to: number, color: THREE.ColorRepresentation, peak: number) {
    s.active = true;
    s.age = 0;
    s.life = life;
    s.from = from;
    s.to = to;
    s.peak = peak;
    s.mesh.position.set(x, y, z);
    s.mesh.rotation.set(0, 0, 0);
    s.mesh.scale.set(from, 1, from);
    s.mesh.visible = true;
    s.mat.color.set(color);
    s.mat.opacity = peak;
  }

  /** Vòng xung kích lan trên mặt bàn. */
  ring(x: number, z: number, color: THREE.ColorRepresentation, life = 0.38, size = 2, peak = 0.9) {
    this.start(this.fire(this.rings), x, 0.03, z, life, 0.5, size, color, peak);
  }

  flash(x: number, y: number, z: number, color: THREE.ColorRepresentation, size = 1.6, life = 0.22) {
    this.start(this.fire(this.flashes), x, y, z, life, size * 0.5, size, color, 0.95);
  }

  /** Vệt sáng thẳng giữa hai điểm. */
  beam(x0: number, z0: number, x1: number, z1: number, color: THREE.ColorRepresentation, width = 0.3, life = 0.28) {
    const s = this.fire(this.beams);
    const len = Math.hypot(x1 - x0, z1 - z0);
    this.start(s, (x0 + x1) / 2, 0.09, (z0 + z1) / 2, life, 1, 1, color, 0.9);
    s.mesh.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    s.mesh.scale.set(Math.max(0.01, len), 1, width);
    s.from = s.to = -1; // giữ nguyên tỉ lệ khi cập nhật
  }

  seal(key: '象' | '相' | '令', x: number, z: number, color: THREE.ColorRepresentation, flipped: boolean) {
    const s = this.seals[key];
    this.start(s, x, 0.05, z, 0.5, 2.2, 1.3, color, 0.75);
    s.mesh.rotation.y = flipped ? Math.PI : 0;
  }

  get active() {
    return this.live > 0 || this.bolt.visible ||
      [...this.rings, ...this.beams, ...this.flashes, ...Object.values(this.seals)].some((s) => s.active);
  }

  setBolt(visible: boolean, x = 0, y = 0, z = 0) {
    this.bolt.visible = visible;
    if (visible) this.bolt.position.set(x, y, z);
  }

  burst(x: number, y: number, z: number, count: number, color: THREE.ColorRepresentation, speed = 2.4, size = 0.32, life = 0.55, up = 1.6) {
    if (!this.options.particles) return;
    const n = Math.max(2, Math.round(count * this.options.density));
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.35 + Math.random() * 0.75);
      this.positions[k * 3] = x + Math.cos(a) * 0.12;
      this.positions[k * 3 + 1] = y;
      this.positions[k * 3 + 2] = z + Math.sin(a) * 0.12;
      this.vel[k * 3] = Math.cos(a) * sp;
      this.vel[k * 3 + 1] = up * (0.3 + Math.random());
      this.vel[k * 3 + 2] = Math.sin(a) * sp;
      this.life[k] = this.maxLife[k] = life * (0.6 + Math.random() * 0.6);
      this.baseSize[k] = size * (0.5 + Math.random() * 0.8);
      this.colors[k * 4] = c.r;
      this.colors[k * 4 + 1] = c.g;
      this.colors[k * 4 + 2] = c.b;
      this.colors[k * 4 + 3] = 1;
    }
    this.live = MAX_PARTICLES;
  }

  /** Hủy mọi hiệu ứng đang chạy, dùng khi hoàn tác hoặc đặt lại bàn. */
  clear() {
    this.life.fill(0);
    this.sizes.fill(0);
    this.colors.fill(0);
    this.live = 1;
    for (const s of [...this.rings, ...this.beams, ...this.flashes, ...Object.values(this.seals)]) {
      s.active = false;
      s.mesh.visible = false;
    }
    this.setBolt(false);
  }

  update(dt: number) {
    for (const s of [...this.rings, ...this.beams, ...this.flashes, ...Object.values(this.seals)]) {
      if (!s.active) continue;
      s.age += dt;
      const t = Math.min(1, s.age / s.life);
      if (s.from >= 0) {
        const eased = 1 - (1 - t) * (1 - t);
        const v = s.from + (s.to - s.from) * eased;
        s.mesh.scale.set(v, 1, v);
      }
      s.mat.opacity = s.peak * (1 - t) * (1 - t * 0.3);
      if (t >= 1) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
    if (this.live > 0) {
      let alive = 0;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (this.life[i] <= 0) {
          this.sizes[i] = 0;
          continue;
        }
        alive++;
        this.life[i] -= dt;
        const k = Math.max(0, this.life[i] / this.maxLife[i]);
        this.vel[i * 3 + 1] -= 5.5 * dt;
        this.vel[i * 3] *= 0.975;
        this.vel[i * 3 + 2] *= 0.975;
        this.positions[i * 3] += this.vel[i * 3] * dt;
        this.positions[i * 3 + 1] = Math.max(0.03, this.positions[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
        this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        this.colors[i * 4 + 3] = k;
        this.sizes[i] = this.baseSize[i] * (0.4 + 0.6 * k);
      }
      this.live = alive;
      this.geo.attributes.position.needsUpdate = true;
      (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  setViewportHeight(px: number) {
    this.pointMat.uniforms.uScale.value = px * 0.9;
  }

  dispose() {
    this.geo.dispose();
    this.pointMat.dispose();
    this.boltMat.dispose();
    for (const s of [...this.rings, ...this.beams, ...this.flashes, ...Object.values(this.seals)]) s.mat.dispose();
    for (const t of this.textures) t.dispose();
  }
}
