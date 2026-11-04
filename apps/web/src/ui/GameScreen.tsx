import { ReactNode, useEffect, useState } from 'react';
import { END_REASON_TEXT, GameResult, SIDE_NAME, Side, other } from '@kydao/engine';
import { useApp } from '../store/appStore';
import { useBoardView } from '../store/boardView';
import { useLocal } from '../store/localStore';
import { showMenuBoard } from '../lib/interaction';
import { CheckBanner, Dialog, MoveList, PlayerPlate, capturedBy, useNow } from './common';

export function ViewButtons() {
  const view = useBoardView((s) => s.cameraView);
  const set = useBoardView((s) => s.set);
  const nonce = useBoardView((s) => s.cameraNonce);
  return (
    <div className="view-buttons">
      <button onClick={() => set({ cameraView: view === 'top' ? 'tilted' : 'top', cameraNonce: nonce + 1 })}>
        {view === 'top' ? 'Nhìn nghiêng' : 'Nhìn từ trên'}
      </button>
      <button onClick={() => set({ cameraNonce: nonce + 1 })}>Đặt lại góc nhìn</button>
    </div>
  );
}

/** Khung ván dùng chung: bảng phụ bên phải trên desktop, ngăn kéo trên mobile. */
export function GameFrame(props: {
  top: ReactNode; bottom: ReactNode; side: ReactNode; actions: ReactNode; banner?: ReactNode; chatBadge?: number;
  tabs?: { key: string; label: string; badge?: number; content: ReactNode }[];
  onSheet?: (key: string | null) => void;
}) {
  const [sheet, setSheetState] = useState<string | null>(null);
  const setSheet = (key: string | null) => {
    setSheetState(key);
    props.onSheet?.(key);
  };
  const tabs = props.tabs ?? [];
  return (
    <>
      <div className="stage-hud">
        {props.banner}
        <ViewButtons />
      </div>
      <aside className="scroll side-panel">
        {props.top}
        <div className="side-middle">{props.side}</div>
        {props.bottom}
        <div className="actions">{props.actions}</div>
      </aside>
      <div className="mobile-top">{props.top}</div>
      <div className="mobile-bottom">
        {props.bottom}
        <div className="mobile-bar">
          {tabs.map((t) => (
            <button key={t.key} aria-pressed={sheet === t.key} onClick={() => setSheet(sheet === t.key ? null : t.key)}>
              {t.label}{t.badge ? <b className="badge">{t.badge}</b> : null}
            </button>
          ))}
        </div>
      </div>
      {sheet && (
        <div className="sheet scroll" data-testid={`sheet-${sheet}`}>
          <button className="ghost sheet-close" onClick={() => setSheet(null)}>Thu gọn</button>
          {tabs.find((t) => t.key === sheet)?.content}
        </div>
      )}
    </>
  );
}

export function resultTitle(result: GameResult, viewer: Side | null): string {
  if (!result.winner) return result.reason === 'interrupted' ? 'Ván bị gián đoạn' : 'Hòa';
  if (viewer) return result.winner === viewer ? 'Bạn thắng' : 'Bạn thua';
  return `${SIDE_NAME[result.winner]} thắng`;
}

export function LocalGame() {
  const go = useApp((s) => s.go);
  const openDialog = useApp((s) => s.openDialog);
  const l = useLocal();
  const [confirmResign, setConfirmResign] = useState(false);
  useNow(250);
  useEffect(() => {
    const id = window.setInterval(() => useLocal.getState().tick(), 100);
    const save = () => useLocal.getState().persist();
    document.addEventListener('visibilitychange', save);
    window.addEventListener('pagehide', save);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', save);
      window.removeEventListener('pagehide', save);
    };
  }, []);

  const game = l.game;
  if (!game) return null;
  const { config, clock, result } = l;
  const reviewing = l.reviewPly !== null;
  const flipped = config.mode === 'ai' && config.humanSide === 'b';
  const topSide: Side = flipped ? 'r' : 'b';
  const nameFor = (side: Side) =>
    config.mode === 'local' ? `Người chơi ${SIDE_NAME[side]}` : side === config.humanSide ? 'Bạn' : 'Máy';
  const moves = reviewing ? game.moves.slice(0, game.ply) : game.moves;

  const plate = (side: Side) => (
    <PlayerPlate
      side={side}
      name={nameFor(side)}
      active={!result && !reviewing && game.turn === side}
      clock={clock ? Math.max(0, clock.read(side)) : null}
      timed={!!clock}
      captured={capturedBy(game.moves, side)}
      status={!result && game.turn === side
        ? (l.thinking && config.mode === 'ai' && side !== config.humanSide ? 'Máy đang suy nghĩ' : 'Đang đi')
        : undefined}
    />
  );

  const list = <MoveList moves={moves} current={l.reviewPly} onPick={reviewing ? (p) => l.review(p) : undefined} />;
  const reviewBar = reviewing && (
    <div className="review-bar" data-testid="review-bar">
      <button onClick={() => l.review(0)} aria-label="Về đầu ván">Đầu</button>
      <button onClick={() => l.reviewStep(-1)} aria-label="Nước trước">Lùi</button>
      <span>{l.reviewPly}/{game.ply}</span>
      <button onClick={() => l.reviewStep(1)} aria-label="Nước sau" data-testid="review-next">Tới</button>
      <button onClick={() => l.toggleAutoplay()} aria-pressed={l.autoplay}>{l.autoplay ? 'Dừng' : 'Tự chạy'}</button>
    </div>
  );

  const canUndo = !result && !reviewing && game.ply > 0;
  const canHint = config.mode === 'ai' && !result && !l.thinking && !l.hinting && game.turn === config.humanSide;
  const leave = () => { l.exit(); showMenuBoard(); go('menu'); };
  const actions = (
    <>
      {config.mode === 'ai' && (
        <button onClick={() => l.hint()} disabled={!canHint} data-testid="hint">{l.hinting ? 'Đang tìm' : 'Gợi ý'}</button>
      )}
      <button onClick={() => l.undo()} disabled={!canUndo} data-testid="undo">Đi lại</button>
      <button onClick={() => setConfirmResign(true)} disabled={!!result} data-testid="resign">Đầu hàng</button>
      <button onClick={() => openDialog('settings')}>Cài đặt</button>
      <button onClick={leave} data-testid="leave">Về menu</button>
    </>
  );

  const side = (
    <>
      <h3>Biên bản ván</h3>
      {list}
      {reviewBar}
      {result && !reviewing && <button className="primary" onClick={() => l.review(0)}>Xem lại ván</button>}
    </>
  );

  return (
    <>
      <GameFrame
        top={plate(topSide)}
        bottom={plate(other(topSide))}
        side={side}
        actions={actions}
        banner={<CheckBanner nonce={l.checkNonce} />}
        tabs={[
          { key: 'moves', label: 'Biên bản', content: <>{list}{reviewBar}{result && !reviewing && <button className="primary" onClick={() => l.review(0)}>Xem lại ván</button>}</> },
          { key: 'actions', label: 'Thao tác', content: <div className="actions">{actions}</div> },
        ]}
      />
      {reviewing && <div className="mobile-review">{reviewBar}</div>}
      {confirmResign && (
        <Dialog title="Đầu hàng ván này?" onClose={() => setConfirmResign(false)}>
          <div className="row">
            <button className="ghost" onClick={() => setConfirmResign(false)}>Chơi tiếp</button>
            <button className="primary" data-testid="confirm-resign" onClick={() => { setConfirmResign(false); l.resign(); }}>Đầu hàng</button>
          </div>
        </Dialog>
      )}
      {l.showResult && result && (
        <Dialog title={resultTitle(result, config.mode === 'ai' ? config.humanSide : null)} testId="result">
          <div className="result-body" data-outcome={!result.winner ? 'draw' : config.mode === 'local' || result.winner === config.humanSide ? 'win' : 'lose'}>
            <p>{END_REASON_TEXT[result.reason]}</p>
            <div className="row wrap">
              <button className="primary" onClick={() => l.rematch()} data-testid="play-again">Chơi lại</button>
              <button onClick={() => l.review(0)} data-testid="review">Xem lại ván</button>
              <button className="ghost" onClick={leave}>Về menu</button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
