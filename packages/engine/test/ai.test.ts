import { describe, expect, it } from 'vitest';
import { AiLevel, Searcher } from '../src/ai';
import { XiangqiGame, checkMove, parseFen, sq } from '../src';

const searcher = new Searcher();

describe('AI', () => {
  it('hard tìm ra nước chiếu bí một nước', () => {
    const fen = '3k5/9/9/9/9/9/9/9/5r3/1r2K4 b';
    const r = searcher.search({ fen, level: 'hard', timeMs: 800, seed: 1 });
    expect(r.score).toBeGreaterThan(29000);
    const g = new XiangqiGame(fen);
    g.play(r.from, r.to);
    expect(g.result?.reason).toBe('checkmate');
  });

  it('không bỏ qua món ăn miễn phí', () => {
    const fen = '3k5/9/9/9/9/2r3R2/9/9/9/4K4 w'; // Xe đỏ ăn được Xe đen
    const r = searcher.search({ fen, level: 'medium', timeMs: 400, seed: 2 });
    expect([r.from, r.to]).toEqual([sq(5, 6), sq(5, 2)]);
  });

  it('nước của mỗi mức luôn hợp lệ trong ván tự đấu', () => {
    const levels: AiLevel[] = ['easy', 'medium', 'easy', 'hard'];
    let g = new XiangqiGame();
    for (let i = 0; i < 70 && !g.result; i++) {
      const level = levels[i % levels.length];
      const r = searcher.search({ ...g.serialize(), level, timeMs: 15, seed: i });
      expect(checkMove(g.position, r.from, r.to)).toBeNull();
      expect(g.play(r.from, r.to).ok).toBe(true);
    }
  }, 30000);

  it('tôn trọng giới hạn thời gian và trả nước từ vòng đã hoàn tất', () => {
    const g = new XiangqiGame();
    const r = searcher.search({ ...g.serialize(), level: 'hard', timeMs: 300, seed: 3 });
    expect(r.timeMs).toBeLessThan(600);
    expect(r.depth).toBeGreaterThanOrEqual(3);
    expect(checkMove(parseFen(g.fen), r.from, r.to)).toBeNull();
    console.log(`hard 300ms: depth ${r.depth}, ${r.nodes} nodes`);
  });

  it('mức khó thắng mức dễ trong ván ngắn', () => {
    const g = new XiangqiGame();
    for (let i = 0; i < 160 && !g.result; i++) {
      const level: AiLevel = g.turn === 'r' ? 'hard' : 'easy';
      const r = searcher.search({ ...g.serialize(), level, timeMs: level === 'hard' ? 40 : 15, seed: i * 7 + 1 });
      g.play(r.from, r.to);
    }
    console.log('kết quả', g.result, 'sau', g.ply);
    expect(g.result?.winner).not.toBe('b');
  }, 30000);
});
