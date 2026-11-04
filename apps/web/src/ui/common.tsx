import { ReactNode, useEffect, useState } from 'react';
import { MoveRecord, Side, hanOf, nameOf, sign, typeOf } from '@kydao/engine';
import { useToast } from '../lib/toast';

export function formatClock(ms: number | null): string {
  if (ms === null) return '∞';
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function useNow(interval = 200) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => set((n) => n + 1), interval);
    return () => clearInterval(id);
  }, [interval]);
}

export function Seal({ side }: { side: Side }) {
  return <span className={`seal seal-${side}`} aria-hidden="true">{hanOf(sign(side))}</span>;
}

export function PlayerPlate(props: {
  side: Side; name: string; active: boolean; clock: number | null; timed: boolean; status?: ReactNode; captured: number[];
}) {
  const { side, name, active, clock, timed, status, captured } = props;
  const low = timed && clock !== null && clock < 30000;
  return (
    <section className="plate" data-active={active} data-side={side} aria-label={`Bên ${side === 'r' ? 'Đỏ' : 'Đen'}`}>
      <Seal side={side} />
      <div className="plate-main">
        <div className="plate-name" data-testid={`name-${side}`}>{name}</div>
        <div className="plate-status">{status ?? (active ? 'Đang đi' : ' ')}</div>
      </div>
      {timed && <div className="plate-clock" data-low={low} data-testid={`clock-${side}`}>{formatClock(clock)}</div>}
      {captured.length > 0 && (
        <div className="plate-captured" aria-label="Quân đã ăn được">
          {captured.map((p, i) => <span key={i} className={p > 0 ? 'cap-r' : 'cap-b'} title={nameOf(p)}>{hanOf(p)}</span>)}
        </div>
      )}
    </section>
  );
}

export function capturedBy(moves: MoveRecord[], side: Side): number[] {
  return moves
    .filter((m) => m.captured && (m.piece > 0) === (side === 'r'))
    .map((m) => m.captured)
    .sort((a, b) => typeOf(b) === typeOf(a) ? 0 : pieceRank(a) - pieceRank(b));
}
const pieceRank = (p: number) => [0, 0, 5, 4, 2, 1, 3, 6][typeOf(p)];

export function MoveList(props: { moves: Pick<MoveRecord, 'notation'>[]; current?: number | null; onPick?: (ply: number) => void }) {
  const { moves, current, onPick } = props;
  const rows: { no: number; r?: string; b?: string }[] = [];
  moves.forEach((m, i) => {
    const row = (i / 2) | 0;
    rows[row] ??= { no: row + 1 };
    if (i % 2 === 0) rows[row].r = m.notation;
    else rows[row].b = m.notation;
  });
  useEffect(() => {
    document.querySelectorAll('.moves-body').forEach((el) => {
      if (current == null) el.scrollTop = el.scrollHeight;
    });
  }, [moves.length, current]);
  if (moves.length === 0) return <p className="empty">Chưa có nước nào. Đỏ đi trước.</p>;
  const cell = (text: string | undefined, ply: number) =>
    text === undefined ? <span /> : onPick ? (
      <button className="move" data-current={current === ply} onClick={() => onPick(ply)}>{text}</button>
    ) : <span className="move" data-current={current === ply}>{text}</span>;
  return (
    <ol className="moves-body" data-testid="moves">
      {rows.map((r) => (
        <li key={r.no}>
          <span className="move-no">{r.no}</span>
          {cell(r.r, r.no * 2 - 1)}
          {cell(r.b, r.no * 2)}
        </li>
      ))}
    </ol>
  );
}

export function Toast() {
  const text = useToast((s) => s.text);
  const nonce = useToast((s) => s.nonce);
  if (!text) return null;
  return <div className="toast" role="status" key={nonce} data-testid="toast">{text}</div>;
}

export function CheckBanner({ nonce }: { nonce: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!nonce) return;
    setShown(nonce);
    const t = window.setTimeout(() => setShown(0), 1000);
    return () => clearTimeout(t);
  }, [nonce]);
  if (!shown) return null;
  return <div className="check-banner" role="alert" data-testid="check-banner">CHIẾU!</div>;
}

export function Dialog(props: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean; testId?: string }) {
  useEffect(() => {
    if (!props.onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div className="dialog-back" onClick={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={props.title} data-wide={props.wide} data-testid={props.testId}>
        <header>
          <h2>{props.title}</h2>
          {props.onClose && <button className="ghost" onClick={props.onClose}>Đóng</button>}
        </header>
        {props.children}
      </div>
    </div>
  );
}

export function Choice<T extends string | number | null>(props: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <fieldset className="choice" disabled={props.disabled}>
      <legend>{props.label}</legend>
      <div>
        {props.options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
