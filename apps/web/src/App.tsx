import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { START_FEN, parseFen } from '@kydao/engine';
import { useApp } from './store/appStore';
import { useBoardView } from './store/boardView';
import { useLocal } from './store/localStore';
import { director } from './three/director';
import { unlockAudio } from './lib/sound';
import { Menu, Setup } from './ui/Menu';
import { LocalGame } from './ui/GameScreen';
import { RulesDialog, SettingsDialog } from './ui/dialogs';
import { Toast } from './ui/common';
import { OnlineRoot, inviteCodeFromUrl, hasOnlineSeat } from './ui/Online';

const Scene = lazy(() => import('./three/Scene'));

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function App() {
  const screen = useApp((s) => s.screen);
  const dialog = useApp((s) => s.dialog);
  const webgl = useMemo(webglAvailable, []);
  const [, setReady] = useState(false);

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    if (window.matchMedia('(max-aspect-ratio: 3/4)').matches) useBoardView.getState().set({ cameraView: 'top' });
    const start = parseFen(START_FEN).board;
    director.sync(start);
    useBoardView.getState().set({ board: start });
    if (inviteCodeFromUrl() || hasOnlineSeat()) useApp.getState().go('online');
    (window as any).__kd = {
      ...(window as any).__kd,
      local: () => {
        const l = useLocal.getState();
        return {
          fen: l.game?.fen ?? null, ply: l.game?.ply ?? 0, thinking: l.thinking, result: l.result,
          turn: l.game?.turn ?? null, gameId: l.gameId,
        };
      },
    };
    setReady(true);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  if (!webgl) {
    return (
      <main className="fatal">
        <h1>Trình duyệt chưa bật WebGL</h1>
        <p>Kỳ Đạo 3D cần WebGL để vẽ bàn cờ. Hãy bật tăng tốc phần cứng trong cài đặt trình duyệt, hoặc mở game bằng Chrome, Edge, Firefox hay Safari bản mới.</p>
      </main>
    );
  }

  const inGame = screen === 'game' || screen === 'online';
  return (
    <div className="app" data-screen={screen}>
      <div className="stage" data-ingame={inGame}>
        <Suspense fallback={<div className="loading">Đang dựng bàn cờ</div>}>
          <Scene />
        </Suspense>
      </div>
      {screen === 'menu' && <Menu />}
      {screen === 'setup' && <Setup />}
      {screen === 'game' && <LocalGame />}
      {screen === 'online' && <OnlineRoot />}
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'rules' && <RulesDialog />}
      <Toast />
    </div>
  );
}
