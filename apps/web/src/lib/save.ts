/** Lưu ván local. Dữ liệu có phiên bản và được đi lại từng nước khi đọc. */
import { SerializedGame, Side, XiangqiGame } from '@kydao/engine';
import type { AiLevel } from '@kydao/engine/ai';

export interface LocalConfig {
  mode: 'ai' | 'local';
  humanSide: Side;
  level: AiLevel;
  baseMs: number | null;
  incMs: number;
}

export interface SaveData {
  v: 1;
  gameId: string;
  config: LocalConfig;
  game: SerializedGame;
  clock: { r: number; b: number } | null;
  savedAt: number;
}

export const SAVE_KEY = 'kydao.save.v1';

export function validateSave(raw: unknown): { data: SaveData; game: XiangqiGame } {
  const d = raw as SaveData;
  if (!d || d.v !== 1 || typeof d.gameId !== 'string') throw new Error('Sai phiên bản');
  const c = d.config;
  if (
    !c || !['ai', 'local'].includes(c.mode) || !['r', 'b'].includes(c.humanSide) ||
    !['easy', 'medium', 'hard'].includes(c.level) ||
    !(c.baseMs === null || (typeof c.baseMs === 'number' && c.baseMs > 0)) ||
    typeof c.incMs !== 'number'
  ) {
    throw new Error('Thiết lập ván sai');
  }
  if (d.clock !== null && !(typeof d.clock?.r === 'number' && typeof d.clock?.b === 'number')) {
    throw new Error('Đồng hồ sai');
  }
  const game = XiangqiGame.replay(d.game);
  if (game.result) throw new Error('Ván đã kết thúc');
  return { data: d, game };
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* hết dung lượng hoặc bị chặn: chơi vẫn tiếp tục */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* bỏ qua */
  }
}

export type LoadResult =
  | { status: 'none' }
  | { status: 'ok'; data: SaveData; game: XiangqiGame }
  | { status: 'corrupt' };

export function loadSave(): LoadResult {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return { status: 'none' };
  }
  if (!raw) return { status: 'none' };
  try {
    return { status: 'ok', ...validateSave(JSON.parse(raw)) };
  } catch {
    clearSave();
    return { status: 'corrupt' };
  }
}

export const hasSave = (): boolean => {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
};
