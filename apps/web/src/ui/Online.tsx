import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { END_REASON_TEXT, SIDE_NAME, Side, other } from '@kydao/engine';
import { CHAT_MAX, ERROR_TEXT, RoomSettings, RoomView } from '@kydao/engine/protocol';
import { useApp } from '../store/appStore';
import { ChatItem, storedNick, storedRoom, useOnline } from '../store/onlineStore';
import { toast } from '../lib/toast';
import { CheckBanner, Choice, Dialog, MoveList, PlayerPlate, capturedBy, formatClock, useNow } from './common';
import { GameFrame, resultTitle } from './GameScreen';

export const inviteCodeFromUrl = () => new URLSearchParams(location.search).get('phong')?.toUpperCase() ?? '';
export const hasOnlineSeat = () => !!storedRoom();

const QUICK = ['Chào bạn!', 'Nước hay!', 'Chờ mình chút', 'Chơi lại nhé!'];
const EMOJI = ['😀', '😂', '👍', '🙏', '😮', '😅', '🔥', '🎉'];

const inviteLink = (code: string) => `${location.origin}${location.pathname}?phong=${code}`;

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast(text);
  }
}

function TimeSettings(props: { value: RoomSettings; onChange: (s: RoomSettings) => void; disabled?: boolean }) {
  const { value, onChange, disabled } = props;
  const presets = [null, 300000, 600000, 900000];
  const custom = value.baseMs !== null && !presets.includes(value.baseMs);
  const [customMode, setCustomMode] = useState(custom);
  return (
    <>
      <Choice label="Chủ phòng cầm" value={value.side} disabled={disabled} onChange={(side) => onChange({ ...value, side })}
        options={[{ value: 'r', label: 'Đỏ' }, { value: 'b', label: 'Đen' }, { value: 'random', label: 'Ngẫu nhiên' }]} />
      <Choice<number | null | 'custom'>
        label="Thời gian mỗi bên"
        value={customMode ? 'custom' : value.baseMs}
        disabled={disabled}
        onChange={(v) => {
          if (v === 'custom') {
            setCustomMode(true);
            onChange({ ...value, baseMs: presets.includes(value.baseMs) ? 1200000 : value.baseMs });
          } else {
            setCustomMode(false);
            onChange({ ...value, baseMs: v as number | null });
          }
        }}
        options={[
          { value: null, label: 'Không giới hạn' }, { value: 300000, label: '5 phút' }, { value: 600000, label: '10 phút' },
          { value: 900000, label: '15 phút' }, { value: 'custom', label: 'Tùy chỉnh' },
        ]} />
      {customMode && (
        <label className="field">
          <span>Số phút (1–180)</span>
          <input type="number" min={1} max={180} disabled={disabled} value={Math.round((value.baseMs ?? 60000) / 60000)}
            onChange={(e) => {
              const m = Math.max(1, Math.min(180, Number(e.target.value) || 1));
              onChange({ ...value, baseMs: m * 60000 });
            }} />
        </label>
      )}
      <Choice label="Cộng thêm mỗi nước" value={value.incrementMs} disabled={disabled} onChange={(incrementMs) => onChange({ ...value, incrementMs })}
        options={[{ value: 0, label: '0 giây' }, { value: 3000, label: '3 giây' }, { value: 5000, label: '5 giây' }]} />
    </>
  );
}

function Entry() {
  const go = useApp((s) => s.go);
  const o = useOnline();
  const invite = inviteCodeFromUrl();
  const [mode, setMode] = useState<'create' | 'join'>(invite ? 'join' : 'create');
  const [nick, setNick] = useState(storedNick());
  const [code, setCode] = useState(invite);
  const [password, setPassword] = useState('');
  const [needsPw, setNeedsPw] = useState(false);
  const [settings, setSettings] = useState<RoomSettings>({ side: 'random', baseMs: 600000, incrementMs: 3000 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (invite && o.status === 'online') {
      void o.peek(invite).then((r) => {
        if (r.ok) setNeedsPw(r.hasPassword);
        else o.set({ error: ERROR_TEXT[r.code] });
      });
    }
  }, [invite, o.status]);

  const back = () => {
    history.replaceState(null, '', location.pathname);
    o.disconnect();
    go('menu');
  };
  const submit = async () => {
    setBusy(true);
    o.set({ error: '' });
    if (mode === 'create') await o.create(nick.trim(), settings, password);
    else {
      const err = await o.join(nick.trim(), code.trim().toUpperCase(), password);
      if (err === 'PASSWORD_REQUIRED' || err === 'WRONG_PASSWORD') setNeedsPw(true);
    }
    setBusy(false);
  };
  const disabled = busy || o.status !== 'online' || !nick.trim() || (mode === 'join' && code.trim().length < 4);
  return (
    <main className="setup scroll" data-testid="online-entry">
      <h2>Chơi online</h2>
      <p className="conn-note" data-status={o.status}>
        {o.status === 'connecting' && 'Đang kết nối máy chủ'}
        {o.status === 'online' && 'Đã kết nối máy chủ'}
        {o.status === 'reconnecting' && 'Đang kết nối lại'}
        {o.status === 'failed' && 'Kết nối thất bại. Hãy kiểm tra mạng, game sẽ tự thử lại.'}
      </p>
      <label className="field">
        <span>Biệt danh</span>
        <input data-testid="nick" value={nick} maxLength={20} onChange={(e) => setNick(e.target.value)} placeholder="Tên hiển thị với đối thủ" />
      </label>
      <Choice label="Bạn muốn" value={mode} onChange={setMode}
        options={[{ value: 'create', label: 'Tạo phòng riêng' }, { value: 'join', label: 'Vào phòng bằng mã' }]} />
      {mode === 'create' ? (
        <>
          <TimeSettings value={settings} onChange={setSettings} />
          <label className="field">
            <span>Mật khẩu phòng (không bắt buộc)</span>
            <input data-testid="room-password" type="password" value={password} maxLength={64} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
        </>
      ) : (
        <>
          <label className="field">
            <span>Mã phòng</span>
            <input data-testid="room-code" className="code-input" value={code} maxLength={10} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </label>
          {needsPw && (
            <label className="field">
              <span>Mật khẩu phòng</span>
              <input data-testid="join-password" type="password" value={password} maxLength={64} onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
        </>
      )}
      {o.error && <p className="error" role="alert" data-testid="online-error">{o.error}</p>}
      <div className="row">
        <button className="ghost" onClick={back}>Quay lại</button>
        <button className="primary" disabled={disabled} onClick={submit} data-testid="room-submit">
          {mode === 'create' ? 'Tạo phòng' : 'Vào phòng'}
        </button>
      </div>
    </main>
  );
}

function Chat({ collapsible }: { collapsible?: boolean }) {
  const o = useOnline();
  const [text, setText] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const shown = o.hideOpponent ? o.chat.filter((m) => m.from === null || m.from === o.you) : o.chat;
  const collapsed = collapsible && !o.chatOpen;
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, collapsed]);

  const send = () => {
    if (!text.trim() || [...text.trim()].length > CHAT_MAX) return;
    o.sendChat(text);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const fmt = (t: number) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const line = (m: ChatItem) =>
    m.from === null ? (
      <li key={m.id} className="chat-system">{m.text}</li>
    ) : (
      <li key={m.id} className="chat-line" data-mine={m.from === o.you} data-state={m.state}>
        <header><b>{m.name}</b> <time>{fmt(m.at)}</time></header>
        <p>{m.text}</p>
        {m.state === 'sending' && <small>Đang gửi</small>}
        {m.state === 'failed' && (
          <small>{m.error}. <button className="link" onClick={() => o.retryChat(m)}>Gửi lại</button></small>
        )}
      </li>
    );
  return (
    <section className="chat" data-collapsed={collapsed} data-testid="chat">
      <header className="chat-head">
        <h3>Trò chuyện{collapsed && o.unread > 0 ? <b className="badge" data-testid="unread">{o.unread}</b> : null}</h3>
        <div>
          <button className="mini" aria-pressed={o.chatMuted} onClick={() => o.set({ chatMuted: !o.chatMuted })}>{o.chatMuted ? 'Bật âm' : 'Tắt âm'}</button>
          <button className="mini" aria-pressed={o.hideOpponent} onClick={() => o.set({ hideOpponent: !o.hideOpponent })} data-testid="hide-opponent">
            {o.hideOpponent ? 'Hiện đối thủ' : 'Ẩn đối thủ'}
          </button>
          {collapsible && <button className="mini" onClick={() => o.setChatOpen(!o.chatOpen)} data-testid="chat-toggle">{o.chatOpen ? 'Thu gọn' : 'Mở'}</button>}
        </div>
      </header>
      {!collapsed && (
        <>
          <ol className="chat-list" ref={list} aria-live="polite" data-testid="chat-list">{shown.map(line)}</ol>
          <div className="chat-quick">
            {QUICK.map((q) => <button key={q} className="mini" onClick={() => o.sendChat(q)}>{q}</button>)}
            {EMOJI.map((e) => <button key={e} className="mini emoji" aria-label={`Thêm ${e}`} onClick={() => setText(text + e)}>{e}</button>)}
          </div>
          <div className="chat-input">
            <textarea data-testid="chat-input" rows={2} value={text} maxLength={CHAT_MAX * 2} placeholder="Nhập tin nhắn"
              onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label="Tin nhắn" />
            <button onClick={send} disabled={!text.trim()} data-testid="chat-send">Gửi</button>
          </div>
          {[...text].length > CHAT_MAX - 40 && <small className="chat-count">{[...text].length}/{CHAT_MAX}</small>}
        </>
      )}
    </section>
  );
}

function SeatCard({ room, index, you }: { room: RoomView; index: number; you: string }) {
  const p = room.players[index];
  if (!p) return <div className="seat seat-empty">Đang chờ đối thủ</div>;
  return (
    <div className="seat" data-testid="seat" data-ready={p.ready}>
      <strong>{p.nickname}{p.id === you ? ' (bạn)' : ''}</strong>
      <span>{p.isHost ? 'Chủ phòng' : 'Khách'}</span>
      <span data-connected={p.connected}>{p.connected ? 'Đang kết nối' : 'Mất kết nối'}</span>
      <span className="seat-ready">{p.ready ? 'Sẵn sàng' : 'Chưa sẵn sàng'}</span>
    </div>
  );
}

function Lobby() {
  const o = useOnline();
  const room = o.room!;
  const me = room.players.find((p) => p.id === o.you);
  useEffect(() => o.setChatOpen(true), []);
  return (
    <main className="lobby" data-testid="lobby">
      <section className="scroll lobby-main">
        <h2>Phòng chờ</h2>
        <div className="room-code">
          <output data-testid="code">{room.code}</output>
          <button onClick={() => copy(inviteLink(room.code), 'Đã sao chép link mời')} data-testid="copy-link">Sao chép link mời</button>
        </div>
        {room.hasPassword && <p className="note">Phòng có mật khẩu. Hãy gửi mật khẩu riêng cho bạn của bạn.</p>}
        <div className="seats">
          <SeatCard room={room} index={0} you={o.you} />
          <SeatCard room={room} index={1} you={o.you} />
        </div>
        <TimeSettings value={room.settings} onChange={o.updateSettings} disabled={!me?.isHost} />
        <p className="note">Đồng hồ vẫn chạy khi mất kết nối. Bạn có 120 giây để kết nối lại; quá hạn sẽ bị xử thua do bỏ cuộc, hết giờ trước thì thua do hết giờ.</p>
        {o.error && <p className="error" role="alert">{o.error}</p>}
        <div className="row">
          <button className="ghost" onClick={() => o.leave()} data-testid="leave-room">Rời phòng</button>
          <button className="primary" data-testid="ready" disabled={room.players.length < 2 && !me?.ready}
            onClick={() => o.setReady(!me?.ready)}>
            {me?.ready ? 'Hủy sẵn sàng' : 'Sẵn sàng'}
          </button>
        </div>
      </section>
      <aside className="scroll lobby-chat"><Chat /></aside>
    </main>
  );
}

function OfferBox() {
  const o = useOnline();
  const offer = o.offer;
  useNow(500);
  if (!offer) return null;
  const mine = offer.from === o.you;
  const left = Math.max(0, Math.ceil((offer.expiresInMs - (performance.now() - o.offerAt)) / 1000));
  let text = '';
  if (offer.kind === 'draw') text = mine ? 'Bạn đã xin hòa' : 'Đối thủ xin hòa';
  if (offer.kind === 'rematch') text = mine ? 'Bạn đã mời tái đấu' : 'Đối thủ mời tái đấu, hai bên sẽ đổi màu';
  if (offer.kind === 'undo' && offer.undo) {
    const names = offer.undo.notations.join(', ');
    const turn = SIDE_NAME[offer.undo.turnAfter];
    text = `${mine ? 'Bạn xin' : 'Đối thủ xin'} đi lại: hoàn tác ${names}, lượt về ${turn}`;
  }
  return (
    <div className="offer" role="alert" data-testid="offer">
      <p>{text} <small>({left}s)</small></p>
      <div className="row">
        {mine ? (
          <button onClick={() => o.respond(false)}>Rút lại</button>
        ) : (
          <>
            <button onClick={() => o.respond(false)} data-testid="offer-decline">Từ chối</button>
            <button className="primary" onClick={() => o.respond(true)} data-testid="offer-accept">Đồng ý</button>
          </>
        )}
      </div>
    </div>
  );
}

function OnlineGame() {
  const o = useOnline();
  const go = useApp((s) => s.go);
  const openDialog = useApp((s) => s.openDialog);
  const [confirm, setConfirm] = useState<'resign' | 'leave' | null>(null);
  const isMobile = () => window.matchMedia('(max-width: 820px), (max-aspect-ratio: 1/1)').matches;
  useEffect(() => {
    // Trên mobile chat nằm trong ngăn kéo, đóng theo mặc định để đếm tin chưa đọc.
    if (isMobile()) o.setChatOpen(false);
  }, []);
  useNow(250);
  const { game, room, result } = o;
  if (!game || !room) return null;
  const me = room.players.find((p) => p.id === o.you);
  const mine: Side = me?.side ?? 'r';
  const opp = room.players.find((p) => p.id !== o.you);
  const timed = room.settings.baseMs !== null;

  const plate = (side: Side) => {
    const p = side === mine ? me : opp;
    const gone = p && !p.connected;
    const left = p?.reconnectMs != null ? p.reconnectMs - (performance.now() - o.roomAt) : null;
    return (
      <PlayerPlate
        side={side}
        name={`${p?.nickname ?? 'Đã rời phòng'}${p?.id === o.you ? ' (bạn)' : ''}`}
        active={!result && game.turn === side}
        clock={o.readClock(side)}
        timed={timed}
        captured={capturedBy(game.moves, side)}
        status={gone ? <span className="gone">Mất kết nối{left !== null ? `, còn ${formatClock(left)}` : ''}</span> : undefined}
      />
    );
  };
  const leave = () => {
    o.leave();
    setConfirm(null);
    o.disconnect();
    go('menu');
  };
  const pending = !!o.offer;
  const actions = (
    <>
      {!result ? (
        <>
          <button disabled={pending} onClick={() => o.offerAction('draw')} data-testid="offer-draw">Xin hòa</button>
          <button disabled={pending || game.ply === 0} onClick={() => o.offerAction('undo')} data-testid="offer-undo">Xin đi lại</button>
          <button onClick={() => setConfirm('resign')} data-testid="resign">Đầu hàng</button>
        </>
      ) : (
        <button disabled={pending || room.players.length < 2} onClick={() => o.offerAction('rematch')} data-testid="offer-rematch">Chơi lại</button>
      )}
      <button onClick={() => openDialog('settings')}>Cài đặt</button>
      <button onClick={() => (result ? leave() : setConfirm('leave'))} data-testid="leave">Rời phòng</button>
    </>
  );
  const list = <MoveList moves={game.moves} />;
  const top = other(mine);
  return (
    <>
      <GameFrame
        top={plate(top)}
        bottom={plate(mine)}
        side={<><div className="side-moves"><h3>Biên bản ván</h3>{list}</div><Chat collapsible /></>}
        actions={actions}
        banner={<><CheckBanner nonce={o.checkNonce} /><OfferBox /></>}
        onSheet={(key) => isMobile() && o.setChatOpen(key === 'chat')}
        tabs={[
          { key: 'moves', label: 'Biên bản', content: list },
          { key: 'chat', label: 'Chat', badge: o.unread, content: <Chat /> },
          { key: 'actions', label: 'Thao tác', content: <div className="actions">{actions}</div> },
        ]}
      />
      {confirm === 'resign' && (
        <Dialog title="Đầu hàng ván này?" onClose={() => setConfirm(null)}>
          <div className="row">
            <button className="ghost" onClick={() => setConfirm(null)}>Chơi tiếp</button>
            <button className="primary" data-testid="confirm-resign" onClick={() => { setConfirm(null); o.resign(); }}>Đầu hàng</button>
          </div>
        </Dialog>
      )}
      {confirm === 'leave' && (
        <Dialog title="Rời phòng khi ván chưa xong?" onClose={() => setConfirm(null)}>
          <p className="note">Rời phòng lúc này sẽ bị xử thua do bỏ cuộc.</p>
          <div className="row">
            <button className="ghost" onClick={() => setConfirm(null)}>Ở lại</button>
            <button className="primary" onClick={leave}>Rời phòng</button>
          </div>
        </Dialog>
      )}
      {o.showResult && result && (
        <Dialog title={resultTitle(result, mine)} onClose={() => o.set({ showResult: false })} testId="result">
          <div className="result-body" data-outcome={!result.winner ? 'draw' : result.winner === mine ? 'win' : 'lose'}>
            <p>{END_REASON_TEXT[result.reason]}</p>
            <div className="row wrap">
              <button className="primary" disabled={pending || room.players.length < 2} onClick={() => { o.offerAction('rematch'); o.set({ showResult: false }); }} data-testid="result-rematch">Chơi lại</button>
              <button className="ghost" onClick={leave}>Rời phòng</button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function OnlineRoot() {
  const o = useOnline();
  const go = useApp((s) => s.go);
  useEffect(() => {
    o.connect();
    (window as any).__kd = {
      ...(window as any).__kd,
      online: () => {
        const s = useOnline.getState();
        return { fen: s.game?.fen ?? null, version: s.version, gameId: s.gameId, status: s.status, result: s.result, side: s.mySide(), code: s.room?.code };
      },
    };
  }, []);

  if (o.status === 'superseded') {
    return (
      <Dialog title="Ván đang mở ở tab khác" testId="superseded">
        <p className="note">Mỗi vị trí chỉ được điều khiển từ một nơi. Tab này đã dừng để tránh đi trùng nước.</p>
        <div className="row">
          <button className="ghost" onClick={() => { o.disconnect(); go('menu'); }}>Về menu</button>
          <button className="primary" onClick={() => o.reclaim()} data-testid="reclaim">Dùng tab này</button>
        </div>
      </Dialog>
    );
  }
  const banner = o.status === 'reconnecting' && o.room && (
    <div className="reconnecting" role="status" data-testid="reconnecting">Đang kết nối lại</div>
  );
  if (!o.room) return <>{banner}<Entry /></>;
  const live = o.game && o.room.phase !== 'lobby';
  return (
    <>
      {banner}
      {live ? <OnlineGame /> : <Lobby />}
    </>
  );
}
