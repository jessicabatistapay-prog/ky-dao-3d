import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { Environment, Html, Lightformer, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { nameOf, sideOf } from '@kydao/engine';
import { director } from './director';
import { BOARD_D, BOARD_W, PIECE_HEIGHT, localToSquare, sqX, sqZ } from './coords';
import { makeBoardTextures, makeLatticeTexture, makeRing, makeSoftDot, makeWoodTexture } from './textures';
import { useBoardView } from '../store/boardView';
import { QUALITY, prefersReducedMotion, useSettings } from '../lib/settings';

const FOV = 34;

/** Khoảng cách camera để cả bàn lọt khung ở tỉ lệ màn hình hiện tại. */
function fitDistance(aspect: number, polar: number): number {
  const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const halfW = 5.7;
  const halfD = 6.0 * Math.cos(polar) + 0.7 * Math.sin(polar);
  const byHeight = halfD / tanV;
  const byWidth = halfW / (tanV * aspect);
  return Math.max(byHeight, byWidth) + 1.6 * Math.sin(polar) + 0.3;
}

function useDisposable<T extends { dispose(): void }>(make: () => T, deps: unknown[] = []): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(make, deps);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

function BoardBody() {
  const maps = useMemo(makeBoardTextures, []);
  useEffect(() => () => { maps.map.dispose(); maps.bump.dispose(); }, [maps]);
  const table = useDisposable(() => makeWoodTexture(5, '#22130d', 3));
  const hw = BOARD_W / 2;
  const hd = BOARD_D / 2;
  const bronze = <meshStandardMaterial color="#a67c42" metalness={1} roughness={0.34} />;
  const bar = 0.34;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0} receiveShadow>
        <planeGeometry args={[BOARD_W, BOARD_D]} />
        <meshStandardMaterial map={maps.map} bumpMap={maps.bump} bumpScale={0.8} roughness={0.5} metalness={0.05} />
      </mesh>
      {/* thân bàn */}
      <mesh position-y={-0.36} castShadow receiveShadow>
        <boxGeometry args={[BOARD_W + 0.1, 0.7, BOARD_D + 0.1]} />
        <meshStandardMaterial color="#2a170f" roughness={0.6} />
      </mesh>
      {/* khung đồng */}
      <RoundedBox args={[BOARD_W + bar * 2, 0.34, bar]} radius={0.05} position={[0, -0.05, -hd - bar / 2]} castShadow receiveShadow>{bronze}</RoundedBox>
      <RoundedBox args={[BOARD_W + bar * 2, 0.34, bar]} radius={0.05} position={[0, -0.05, hd + bar / 2]} castShadow receiveShadow>{bronze}</RoundedBox>
      <RoundedBox args={[bar, 0.34, BOARD_D]} radius={0.05} position={[-hw - bar / 2, -0.05, 0]} castShadow receiveShadow>{bronze}</RoundedBox>
      <RoundedBox args={[bar, 0.34, BOARD_D]} radius={0.05} position={[hw + bar / 2, -0.05, 0]} castShadow receiveShadow>{bronze}</RoundedBox>
      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} position={[sx * (hw + bar / 2), 0.03, sz * (hd + bar / 2)]} castShadow rotation-y={Math.PI / 8}>
          <cylinderGeometry args={[0.36, 0.42, 0.28, 8]} />
          <meshStandardMaterial color="#b98d4e" metalness={1} roughness={0.28} />
        </mesh>
      ))}
      {/* mặt bàn đá phía dưới */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.72} receiveShadow>
        <circleGeometry args={[34, 48]} />
        <meshStandardMaterial map={table} color="#5c4638" roughness={0.62} metalness={0.05} />
      </mesh>
    </group>
  );
}

/** Hậu cảnh đình cổ: cột, xà, song cửa và đèn lồng – cố tình để tối. */
function Pavilion({ low }: { low: boolean }) {
  const lattice = useDisposable(makeLatticeTexture);
  const pillar = <meshStandardMaterial color="#3a150f" roughness={0.45} />;
  return (
    <group position={[0, -0.7, -6]}>
      {[-15, -5.5, 5.5, 15].map((x) => (
        <mesh key={x} position={[x, 7, -14]}>
          <cylinderGeometry args={[0.62, 0.72, 16, 16]} />
          {pillar}
        </mesh>
      ))}
      <mesh position={[0, 14, -14]}><boxGeometry args={[42, 1.1, 1.1]} />{pillar}</mesh>
      <mesh position={[0, 11.4, -14.5]}><boxGeometry args={[42, 0.4, 0.5]} /><meshStandardMaterial color="#7c5a2c" metalness={0.8} roughness={0.5} /></mesh>
      {[-10.25, 0, 10.25].map((x) => (
        <mesh key={x} position={[x, 5.6, -15.5]}>
          <planeGeometry args={[8.8, 10.8]} />
          <meshBasicMaterial map={lattice} toneMapped={false} color={x === 0 ? '#b98b58' : '#6d4a2c'} />
        </mesh>
      ))}
      <mesh position={[0, 6, -16.2]}><planeGeometry args={[60, 24]} /><meshBasicMaterial color="#120a08" /></mesh>
      {!low && [-11, 11].map((x) => (
        <group key={x} position={[x, 8.6, -7]}>
          <mesh position-y={2.6}><cylinderGeometry args={[0.012, 0.012, 3.6, 4]} /><meshBasicMaterial color="#20100a" /></mesh>
          <mesh scale={[1, 1.15, 1]}>
            <sphereGeometry args={[0.72, 20, 16]} />
            <meshBasicMaterial color="#d8532a" toneMapped={false} />
          </mesh>
          <pointLight color="#ff9a55" intensity={18} distance={13} decay={1.8} />
        </group>
      ))}
    </group>
  );
}

function Overlays() {
  const selected = useBoardView((s) => s.selected);
  const targets = useBoardView((s) => s.targets);
  const lastMove = useBoardView((s) => s.lastMove);
  const checkSquare = useBoardView((s) => s.checkSquare);
  const hint = useBoardView((s) => s.hint);
  const board = useBoardView((s) => s.board);
  const ring = useDisposable(() => makeRing(0.1));
  const dot = useDisposable(makeSoftDot);
  const plane = useDisposable(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const checkRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock, invalidate }) => {
    if (checkRef.current) {
      invalidate();
      // Thở rất chậm, không nhấp nháy.
      const m = checkRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.72 + Math.sin(clock.elapsedTime * 2.2) * 0.14;
    }
  });
  const flat = (s: number, y = 0.018) => [sqX(s), y, sqZ(s)] as const;
  return (
    <group>
      {lastMove && (
        <>
          <mesh geometry={plane} position={flat(lastMove.from)} scale={[0.84, 1, 0.84]} renderOrder={2}>
            <meshBasicMaterial map={ring} color="#f0c56c" transparent opacity={0.55} depthWrite={false} />
          </mesh>
          <mesh geometry={plane} position={flat(lastMove.to)} scale={[1.08, 1, 1.08]} renderOrder={2}>
            <meshBasicMaterial map={ring} color="#f7d98c" transparent opacity={0.95} depthWrite={false} />
          </mesh>
        </>
      )}
      {selected >= 0 && (
        <mesh geometry={plane} position={flat(selected, 0.022)} scale={[1.2, 1, 1.2]} renderOrder={3}>
          <meshBasicMaterial map={ring} color="#9df0c6" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}
      {targets.map((s) =>
        board[s] ? (
          <mesh key={s} geometry={plane} position={flat(s, 0.26)} scale={[1.14, 1, 1.14]} renderOrder={6}>
            <meshBasicMaterial map={ring} color="#ff5040" transparent depthWrite={false} toneMapped={false} />
          </mesh>
        ) : (
          <mesh key={s} geometry={plane} position={flat(s, 0.03)} scale={[0.46, 1, 0.46]} renderOrder={3}>
            <meshBasicMaterial map={dot} color="#8ff0b4" transparent depthWrite={false} toneMapped={false} />
          </mesh>
        ),
      )}
      {checkSquare >= 0 && (
        <mesh ref={checkRef} geometry={plane} position={flat(checkSquare, 0.025)} scale={[1.34, 1, 1.34]} renderOrder={3}>
          <meshBasicMaterial map={ring} color="#ff2d20" transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
      {hint && (
        <>
          <mesh geometry={plane} position={flat(hint.from, 0.024)} scale={[1.2, 1, 1.2]} renderOrder={3}>
            <meshBasicMaterial map={ring} color="#7fc4ff" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          <mesh geometry={plane} position={flat(hint.to, 0.024)} scale={[1.2, 1, 1.2]} renderOrder={3}>
            <meshBasicMaterial map={ring} color="#7fc4ff" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        </>
      )}
    </group>
  );
}

function Picker() {
  const onSquare = useBoardView((s) => s.onSquare);
  const interactive = useBoardView((s) => s.interactive);
  const board = useBoardView((s) => s.board);
  const flipped = useBoardView((s) => s.flipped);
  const showNames = useSettings((s) => s.showNames);
  const [hover, setHover] = useState(-1);
  const ring = useDisposable(() => makeRing(0.08));
  const plane = useDisposable(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const local = useMemo(() => new THREE.Vector3(), []);
  const toSquare = (e: ThreeEvent<MouseEvent | PointerEvent>) => {
    local.copy(e.point);
    director.root.worldToLocal(local);
    return localToSquare(local.x, local.z);
  };
  const piece = hover >= 0 ? board[hover] : 0;
  return (
    <>
      <mesh
        position-y={PIECE_HEIGHT * 0.6}
        rotation-x={-Math.PI / 2}
        onPointerMove={(e) => {
          if (e.pointerType === 'touch') return;
          const s = toSquare(e);
          setHover(s);
          document.body.style.cursor = interactive && s >= 0 && board[s] ? 'pointer' : '';
        }}
        onPointerOut={() => { setHover(-1); document.body.style.cursor = ''; }}
        onClick={(e) => {
          if (e.delta > 10) return; // đang kéo xoay camera
          const s = toSquare(e);
          if (s >= 0) onSquare?.(s);
        }}
      >
        <planeGeometry args={[12, 12.5]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {hover >= 0 && piece !== 0 && interactive && (
        <mesh geometry={plane} position={[sqX(hover), 0.02, sqZ(hover)]} scale={[1.06, 1, 1.06]} renderOrder={2}>
          <meshBasicMaterial map={ring} color="#ffe6ac" transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}
      {showNames && hover >= 0 && piece !== 0 && (
        <Html position={[sqX(hover), 0.75, sqZ(hover)]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
          <div className="piece-tip" data-flip={flipped}>{sideOf(piece) === 'r' ? 'Đỏ' : 'Đen'}: {nameOf(piece)}</div>
        </Html>
      )}
    </>
  );
}

function BoardRoot() {
  const soft = useDisposable(makeSoftDot);
  const flipped = useBoardView((s) => s.flipped);
  const { gl, size, invalidate } = useThree();
  const quality = useSettings((s) => s.quality);
  const particles = useSettings((s) => s.particles);
  const shake = useSettings((s) => s.shake);
  const reducedMotion = useSettings((s) => s.reducedMotion);

  useEffect(() => {
    const q = QUALITY[quality];
    const physicalChanged = director.fx.physical !== q.physical;
    director.fx = {
      particles: particles && !reducedMotion && !prefersReducedMotion(),
      shake,
      reduced: reducedMotion || prefersReducedMotion(),
      density: q.density,
      physical: q.physical,
    };
    director.vfx.options = { particles: director.fx.particles, density: q.density };
    if (physicalChanged) director.rebuildMaterials();
  }, [quality, particles, shake, reducedMotion]);

  useEffect(() => {
    director.requestFrame = () => invalidate();
    director.attach(soft);
    let live = true;
    // Texture quân vẽ chữ bằng font nhúng: vẽ lại khi font đã sẵn sàng.
    void document.fonts.load('700 64px "KyDao Han"', '帥').then(() => {
      if (live) {
        director.rebuildMaterials();
        invalidate();
      }
    });
    return () => { live = false; };
  }, [soft]);

  useEffect(() => director.setFlipped(flipped), [flipped]);
  useEffect(() => director.vfx.setViewportHeight(size.height * gl.getPixelRatio()), [size.height, gl]);

  useFrame((_, dt) => director.update(dt));

  return (
    <primitive object={director.root}>
      <BoardBody />
      <Overlays />
      <Picker />
    </primitive>
  );
}

function CameraRig() {
  const { camera, size, invalidate } = useThree();
  const lowQuality = useSettings((q) => q.quality === 'low');
  const controls = useRef<any>(null);
  const cameraView = useBoardView((s) => s.cameraView);
  const nonce = useBoardView((s) => s.cameraNonce);
  const showcase = useBoardView((s) => s.showcase);
  const aspect = size.width / Math.max(1, size.height);
  const goal = useRef<THREE.Spherical | null>(null);
  const userDriving = useRef(false);

  const polar = cameraView === 'top' ? 0.015 : 0.72;
  const distance = fitDistance(aspect, polar);

  useEffect(() => {
    goal.current = new THREE.Spherical(distance, polar, 0);
    userDriving.current = false;
  }, [distance, polar, nonce]);

  const s = useMemo(() => new THREE.Spherical(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, dt) => {
    const c = controls.current;
    if (!c) return;
    if (showcase) {
      // Dành chỗ cho cuộn trình đơn: đẩy tâm hình sang phải trên màn hình ngang.
      if (size.width > 900 && aspect > 1) {
        const pc = camera as THREE.PerspectiveCamera;
        if (pc.view?.offsetX !== -size.width * 0.13) {
          pc.setViewOffset(size.width, size.height, -size.width * 0.13, 0, size.width, size.height);
          invalidate();
        }
      }
      const t = lowQuality ? 0.5 : clock.elapsedTime * 0.12;
      const target = new THREE.Spherical(distance * 0.98, 0.98, Math.sin(t) * 0.42);
      v.setFromSpherical(target).add(c.target);
      if (lowQuality || prefersReducedMotion()) {
        // Máy yếu: trình đơn đứng yên, không vẽ liên tục.
        if (camera.position.distanceToSquared(v) > 0.01) {
          camera.position.copy(v);
          invalidate();
        }
      } else {
        camera.position.lerp(v, 1 - Math.exp(-dt * 1.4));
        invalidate();
      }
      camera.lookAt(c.target);
      goal.current = new THREE.Spherical(distance, polar, 0);
      return;
    }
    if ((camera as THREE.PerspectiveCamera).view?.enabled) (camera as THREE.PerspectiveCamera).clearViewOffset();
    if (goal.current && !userDriving.current) {
      s.setFromVector3(v.copy(camera.position).sub(c.target));
      const k = 1 - Math.exp(-dt * 6);
      s.radius += (goal.current.radius - s.radius) * k;
      s.phi += (goal.current.phi - s.phi) * k;
      s.theta += (goal.current.theta - s.theta) * k;
      v.setFromSpherical(s).add(c.target);
      camera.position.copy(v);
      if (Math.abs(goal.current.phi - s.phi) + Math.abs(goal.current.radius - s.radius) + Math.abs(goal.current.theta - s.theta) < 0.002) {
        goal.current = null;
      } else invalidate();
    }
    c.update();
    camera.position.add(director.shakeOffset);
  });

  return (
    <OrbitControls
      ref={controls}
      enabled={!showcase}
      enablePan={false}
      enableDamping
      dampingFactor={0.12}
      minPolarAngle={0.01}
      maxPolarAngle={1.12}
      minAzimuthAngle={-0.62}
      maxAzimuthAngle={0.62}
      minDistance={distance * 0.55}
      maxDistance={distance * 1.5}
      target={[0, 0, 0]}
      touches={{ ONE: -1 as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE }}
      onStart={() => { userDriving.current = true; goal.current = null; }}
    />
  );
}

function SceneLights({ shadow }: { shadow: number }) {
  return (
    <>
      <ambientLight intensity={0.2} color="#ffdcb8" />
      <spotLight
        position={[-5, 15, 7]}
        angle={0.62}
        penumbra={0.7}
        intensity={420}
        distance={40}
        decay={2}
        color="#ffe9c9"
        castShadow={shadow > 0}
        shadow-mapSize-width={shadow || 512}
        shadow-mapSize-height={shadow || 512}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[8, 6, -6]} intensity={0.5} color="#9fc1ff" />
      <Environment resolution={128} frames={1} environmentIntensity={0.55}>
        <Lightformer form="rect" intensity={2.6} color="#ffe2b8" position={[0, 7, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#ff9e5c" position={[-8, 3, -6]} rotation-y={Math.PI / 3} scale={[6, 6, 1]} />
        <Lightformer form="rect" intensity={0.9} color="#88aaff" position={[8, 2, 6]} rotation-y={-Math.PI / 2} scale={[6, 6, 1]} />
      </Environment>
    </>
  );
}

/** Mức chất lượng thấp bật bóng giả (đĩa mờ dưới quân); cao hơn dùng shadow map. */
function BlobToggle({ on }: { on: boolean }) {
  useEffect(() => {
    director.root.traverse((o) => {
      if (o.name === 'blob') (o as THREE.Mesh).visible = on;
    });
  }, [on]);
  useFrame(() => {
    if (on) return;
    // quân mới sinh cũng phải ẩn đĩa
    director.root.traverse((o) => {
      if (o.name === 'blob' && o.visible) o.visible = false;
    });
  });
  return null;
}

/** Bảo đảm cảnh được vẽ sau khi chuyển màn hình hoặc đổi cỡ khung. */
function FirstFrames() {
  const { invalidate, size } = useThree();
  const showcase = useBoardView((s) => s.showcase);
  useEffect(() => {
    invalidate();
  }, [invalidate, size, showcase]);
  return null;
}

function ExposeTestHooks() {
  const { camera, size, gl } = useThree();
  useEffect(() => {
    const v = new THREE.Vector3();
    (window as any).__kd = {
      ...(window as any).__kd,
      /** Tọa độ màn hình của một ô, tính qua đúng phép biến đổi của cảnh. */
      project(s: number) {
        v.set(sqX(s), PIECE_HEIGHT * 0.6, sqZ(s));
        director.root.localToWorld(v);
        v.project(camera);
        const r = gl.domElement.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      visual: () => director.visual(),
      logical: () => Array.from(director.logicalBoard()),
      busy: () => director.busy,
      stats: () => director.stats,
    };
  }, [camera, size, gl]);
  return null;
}

export default function Scene() {
  const quality = useSettings((s) => s.quality);
  const q = QUALITY[quality];
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, q.dpr]}
      shadows={q.shadow > 0}
      camera={{ fov: FOV, position: [0, 16, 13], near: 1, far: 80 }}
      gl={{ antialias: quality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: false }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <color attach="background" args={['#120a08']} />
      <fog attach="fog" args={['#120a08', 26, 54]} />
      <SceneLights shadow={q.shadow} />
      <BoardRoot />
      <Pavilion low={quality === 'low'} />
      <BlobToggle on={q.shadow === 0} />
      <CameraRig />
      <ExposeTestHooks />
      <FirstFrames />
    </Canvas>
  );
}
