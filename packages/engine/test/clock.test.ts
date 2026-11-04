import { describe, expect, it } from 'vitest';
import { GameClock } from '../src';

describe('GameClock', () => {
  it('tính theo mốc thời gian và cộng thêm giờ sau mỗi nước', () => {
    let t = 0;
    const c = new GameClock(60000, 3000, () => t);
    c.start('r');
    t = 10000;
    expect(c.read('r')).toBe(50000);
    c.press('r');
    expect(c.read('r')).toBe(53000);
    t = 12000;
    expect(c.read('b')).toBe(58000);
  });
  it('báo hết giờ đúng bên', () => {
    let t = 0;
    const c = new GameClock(1000, 0, () => t);
    c.start('r');
    t = 999;
    expect(c.expired()).toBeNull();
    t = 1000;
    expect(c.expired()).toBe('r');
  });
  it('không giới hạn thì không hết giờ', () => {
    let t = 0;
    const c = new GameClock(null, 0, () => t);
    c.start('b');
    t = 1e9;
    expect(c.expired()).toBeNull();
    expect(c.snapshot()).toEqual({ r: null, b: null, running: 'b' });
  });
  it('hoàn tác không trả lại thời gian đã nghĩ, thu hồi thêm giờ', () => {
    let t = 0;
    const c = new GameClock(60000, 5000, () => t);
    c.start('r');
    t = 20000;
    c.press('r'); // r: 45000
    t = 30000; // b đã nghĩ 10s
    c.rewind(['r'], 'r');
    expect(c.read('r')).toBe(40000);
    expect(c.read('b')).toBe(50000);
  });
});
