import { useState } from 'react';
import { Side } from '@kydao/engine';
import { AiLevel } from '@kydao/engine/ai';
import { hasSave } from '../lib/save';
import { useApp } from '../store/appStore';
import { useLocal } from '../store/localStore';
import { Choice } from './common';

export function Menu() {
  const { go, openDialog } = useApp();
  const saved = hasSave();
  return (
    <main className="menu">
      <h1 className="title" aria-label="Kỳ Đạo 3D">
        <span className="title-han" aria-hidden="true"><span>棋</span><span>道</span></span>
        <span className="title-vi">Kỳ Đạo</span>
      </h1>
      <p className="tagline">Cờ tướng trên bàn gỗ óc chó, quân ngọc và đá.</p>
      <nav className="menu-list">
        {saved && (
          <button className="primary" onClick={() => { if (useLocal.getState().resume()) go('game'); else go('menu'); }}>
            Tiếp tục ván
          </button>
        )}
        <button className={saved ? '' : 'primary'} onClick={() => { useSetup.mode = 'ai'; go('setup'); }}>Chơi với máy</button>
        <button onClick={() => { useSetup.mode = 'local'; go('setup'); }}>Hai người</button>
        <button onClick={() => go('online')}>Chơi online</button>
        <span className="menu-minor">
          <button className="ghost" onClick={() => openDialog('rules')}>Hướng dẫn</button>
          <button className="ghost" onClick={() => openDialog('settings')}>Cài đặt</button>
        </span>
      </nav>
    </main>
  );
}

const useSetup = { mode: 'ai' as 'ai' | 'local' };

export function Setup() {
  const { go } = useApp();
  const mode = useSetup.mode;
  const [humanSide, setSide] = useState<Side>('r');
  const [level, setLevel] = useState<AiLevel>('medium');
  const [minutes, setMinutes] = useState<number | null>(null);
  const [inc, setInc] = useState(0);
  return (
    <main className="setup scroll">
      <h2>{mode === 'ai' ? 'Chơi với máy' : 'Hai người trên máy này'}</h2>
      {mode === 'ai' && (
        <>
          <Choice label="Bạn cầm" value={humanSide} onChange={setSide}
            options={[{ value: 'r', label: 'Đỏ, đi trước' }, { value: 'b', label: 'Đen, đi sau' }]} />
          <Choice label="Độ khó" value={level} onChange={setLevel}
            options={[{ value: 'easy', label: 'Dễ' }, { value: 'medium', label: 'Vừa' }, { value: 'hard', label: 'Khó' }]} />
        </>
      )}
      <Choice label="Thời gian mỗi bên" value={minutes} onChange={setMinutes}
        options={[{ value: null, label: 'Không giới hạn' }, { value: 5, label: '5 phút' }, { value: 10, label: '10 phút' }, { value: 15, label: '15 phút' }]} />
      {minutes !== null && (
        <Choice label="Cộng thêm mỗi nước" value={inc} onChange={setInc}
          options={[{ value: 0, label: '0 giây' }, { value: 3, label: '3 giây' }, { value: 5, label: '5 giây' }]} />
      )}
      <div className="row">
        <button className="ghost" onClick={() => go('menu')}>Quay lại</button>
        <button className="primary" data-testid="start-game" onClick={() => {
          useLocal.getState().start({ mode, humanSide, level, baseMs: minutes === null ? null : minutes * 60000, incMs: inc * 1000 });
          go('game');
        }}>Bắt đầu ván</button>
      </div>
    </main>
  );
}
