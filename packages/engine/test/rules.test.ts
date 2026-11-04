import { describe, expect, it } from 'vitest';
import {
  ILLEGAL_MESSAGE, START_FEN, XiangqiGame, applyMove, checkMove, genPseudo, isAttacked, isInCheck,
  kingsFacing, legalMoves, legalTargets, moveNotation, parseFen, sq, toFen, typeOf,
} from '../src';

const pos = (fen: string) => parseFen(fen);
const targets = (fen: string, r: number, c: number) => legalTargets(pos(fen), sq(r, c)).sort((a, b) => a - b);
const can = (fen: string, from: [number, number], to: [number, number]) =>
  targets(fen, ...from).includes(sq(...to));
const why = (fen: string, from: [number, number], to: [number, number]) =>
  checkMove(pos(fen), sq(...from), sq(...to));

describe('FEN', () => {
  it('đọc và ghi lại thế khai cuộc', () => {
    expect(toFen(pos(START_FEN))).toBe(START_FEN);
  });
  it('khai cuộc có đúng 44 nước hợp lệ', () => {
    expect(legalMoves(pos(START_FEN)).length).toBe(44);
  });
  it('từ chối FEN hỏng', () => {
    expect(() => parseFen('9/9 w')).toThrow();
    expect(() => parseFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABN w')).toThrow();
  });
});

describe('Perft – đối chiếu số liệu đã công bố của cờ tướng', () => {
  const perft = (p: ReturnType<typeof parseFen>, d: number): number => {
    if (d === 0) return 1;
    let n = 0;
    for (const m of legalMoves(p)) n += perft(applyMove(p, m & 255, m >> 8), d - 1);
    return n;
  };
  it('khai cuộc độ sâu 1–3', () => {
    const p = pos(START_FEN);
    expect(perft(p, 1)).toBe(44);
    expect(perft(p, 2)).toBe(1920);
    expect(perft(p, 3)).toBe(79666);
  });
});

describe('Mã', () => {
  it('bị cản chân thì không đi được hướng đó', () => {
    const open = '5k3/9/9/9/9/9/9/4N4/9/3K5 w';
    expect(targets(open, 7, 4).length).toBe(7); // (9,3) là Tướng mình
    const blocked = '5k3/9/9/9/9/9/4P4/4N4/9/3K5 w';
    expect(can(blocked, [7, 4], [5, 3])).toBe(false);
    expect(can(blocked, [7, 4], [5, 5])).toBe(false);
    expect(can(blocked, [7, 4], [6, 2])).toBe(true);
    expect(why(blocked, [7, 4], [5, 3])).toBe('HORSE_BLOCKED');
    expect(ILLEGAL_MESSAGE.HORSE_BLOCKED).toBe('Mã bị cản chân');
  });
  it('quân cản nằm cạnh Mã chứ không phải cạnh đích', () => {
    const fen = '5k3/9/9/9/9/9/3P5/4N4/9/3K5 w'; // (6,3) không phải chân Mã
    expect(can(fen, [7, 4], [5, 3])).toBe(true);
  });
  it('isAttacked tính đúng chân Mã khi chiếu', () => {
    expect(isAttacked(pos('5k3/9/2n6/9/9/9/9/9/9/3K5 b').board, sq(0, 3), 'b')).toBe(true);
    expect(isAttacked(pos('5k3/2p6/2n6/9/9/9/9/9/9/3K5 b').board, sq(0, 3), 'b')).toBe(false);
    const check = '4k4/9/3N5/9/9/9/9/9/9/3K5 b';
    expect(isInCheck(pos(check).board, 'b')).toBe(true);
    const legged = '4k4/3p5/3N5/9/9/9/9/9/9/3K5 b';
    expect(isInCheck(pos(legged).board, 'b')).toBe(false);
  });
});

describe('Tượng', () => {
  it('bị cản mắt', () => {
    const fen = '3k5/9/9/9/9/9/9/9/3P5/2B1K4 w';
    expect(can(fen, [9, 2], [7, 4])).toBe(false);
    expect(can(fen, [9, 2], [7, 0])).toBe(true);
    expect(why(fen, [9, 2], [7, 4])).toBe('ELEPHANT_BLOCKED');
  });
  it('không được qua sông', () => {
    const fen = '3k5/9/9/9/9/2B6/9/9/9/4K4 w';
    expect(can(fen, [5, 2], [3, 0])).toBe(false);
    expect(can(fen, [5, 2], [3, 4])).toBe(false);
    expect(can(fen, [5, 2], [7, 4])).toBe(true);
    expect(why(fen, [5, 2], [3, 4])).toBe('ELEPHANT_RIVER');
  });
});

describe('Giới hạn cửu cung', () => {
  it('Tướng không rời cửu cung', () => {
    const fen = '5k3/9/9/9/9/9/9/3K5/9/9 w';
    expect(can(fen, [7, 3], [6, 3])).toBe(false);
    expect(can(fen, [7, 3], [7, 2])).toBe(false);
    expect(why(fen, [7, 3], [6, 3])).toBe('PALACE');
  });
  it('Sĩ chỉ đi chéo trong cửu cung', () => {
    const fen = '5k3/9/9/9/9/9/9/5A3/9/3K5 w';
    expect(targets(fen, 7, 5)).toEqual([sq(8, 4)]);
    const center = '5k3/9/9/9/9/9/9/9/4A4/3K5 w';
    expect(targets(center, 8, 4).length).toBe(3); // (9,3) có Tướng mình
  });
});

describe('Tốt', () => {
  it('trước sông chỉ tiến', () => {
    const fen = '5k3/9/9/9/9/9/4P4/9/9/3K5 w';
    expect(targets(fen, 6, 4)).toEqual([sq(5, 4)]);
    expect(why(fen, [6, 4], [6, 3])).toBe('PAWN_SIDEWAYS');
    expect(why(fen, [6, 4], [7, 4])).toBe('PAWN_BACKWARD');
  });
  it('qua sông được đi ngang, không lùi', () => {
    const fen = '5k3/9/9/9/4P4/9/9/9/9/3K5 w';
    expect(targets(fen, 4, 4).sort((a, b) => a - b)).toEqual([sq(3, 4), sq(4, 3), sq(4, 5)]);
  });
  it('Tốt đen đi ngược chiều', () => {
    const fen = '3k5/9/9/9/9/4p4/9/9/9/5K3 b';
    expect(targets(fen, 5, 4).sort((a, b) => a - b)).toEqual([sq(5, 3), sq(5, 5), sq(6, 4)]);
  });
  it('tới hàng cuối thì không tiến được nữa', () => {
    const f2 = '4P4/3k5/9/9/9/9/9/9/9/5K3 w';
    expect(targets(f2, 0, 4).sort((a, b) => a - b)).toEqual([sq(0, 3), sq(0, 5)]);
  });
});

describe('Pháo', () => {
  const base = (between: string) => `5k3/9/9/9/9/9/${between}/9/9/3K5 w`;
  it('0 ngòi: không ăn được', () => {
    const fen = base('C3p4');
    expect(can(fen, [6, 0], [6, 4])).toBe(false);
    expect(why(fen, [6, 0], [6, 4])).toBe('CANNON_NO_SCREEN');
  });
  it('1 ngòi: ăn được', () => {
    const fen = base('C1P1p4');
    expect(can(fen, [6, 0], [6, 4])).toBe(true);
    expect(can(fen, [6, 0], [6, 2])).toBe(false);
    expect(can(fen, [6, 0], [6, 3])).toBe(false); // ô trống sau ngòi
    expect(why(fen, [6, 0], [6, 3])).toBe('CANNON_NEEDS_TARGET');
  });
  it('2 ngòi: không ăn được', () => {
    const fen = base('CPP1p4');
    expect(can(fen, [6, 0], [6, 4])).toBe(false);
    expect(why(fen, [6, 0], [6, 4])).toBe('CANNON_MANY_SCREENS');
  });
  it('ngòi có thể là quân đối phương', () => {
    expect(can(base('C1p1p4'), [6, 0], [6, 4])).toBe(true);
  });
  it('không đi xuyên quân khi không ăn', () => {
    expect(can(base('C1P6'), [6, 0], [6, 1])).toBe(true);
    expect(can(base('C1P6'), [6, 0], [6, 3])).toBe(false);
  });
});

describe('Xe', () => {
  it('không xuyên quân, không ăn quân mình', () => {
    const fen = '5k3/9/9/9/9/9/R1P3p2/9/9/3K5 w';
    expect(can(fen, [6, 0], [6, 1])).toBe(true);
    expect(can(fen, [6, 0], [6, 2])).toBe(false);
    expect(why(fen, [6, 0], [6, 2])).toBe('OWN_PIECE');
    expect(can(fen, [6, 0], [6, 3])).toBe(false);
  });
});

describe('Hai Tướng đối mặt', () => {
  it('phát hiện đối mặt', () => {
    expect(kingsFacing(pos('4k4/9/9/9/9/9/9/9/9/4K4 w').board)).toBe(true);
    expect(kingsFacing(pos('4k4/9/9/9/4p4/9/9/9/9/4K4 w').board)).toBe(false);
  });
  it('Tướng không được đi vào cột đối mặt', () => {
    const fen = '4k4/9/9/9/9/9/9/9/9/3K5 w';
    expect(can(fen, [9, 3], [9, 4])).toBe(false);
    expect(why(fen, [9, 3], [9, 4])).toBe('KINGS_FACING');
    expect(ILLEGAL_MESSAGE.KINGS_FACING).toBe('Không thể để hai Tướng đối mặt');
  });
  it('quân chắn duy nhất không được rời cột', () => {
    const fen = '4k4/9/9/9/4R4/9/9/9/9/4K4 w';
    expect(can(fen, [4, 4], [4, 0])).toBe(false);
    expect(why(fen, [4, 4], [4, 0])).toBe('KINGS_FACING');
    expect(can(fen, [4, 4], [3, 4])).toBe(true);
  });
});

describe('Ghim và giải chiếu', () => {
  it('quân đang chắn không được đi nếu làm Tướng bị chiếu', () => {
    // Mã đỏ chắn Xe đen trên cột 3 của Tướng đỏ
    const fen = '4k4/9/9/3r5/9/9/3N5/9/9/3K5 w';
    expect(legalTargets(pos(fen), sq(6, 3))).toEqual([]);
    expect(why(fen, [6, 3], [4, 2])).toBe('EXPOSES_KING');
  });
  it('khi bị chiếu chỉ được đi nước giải chiếu', () => {
    const fen = '4k4/9/9/3r5/9/9/9/2R6/9/3K5 w';
    const moves = legalMoves(pos(fen));
    expect(why(fen, [7, 2], [7, 0])).toBe('STILL_IN_CHECK');
    expect(moves.map((m) => [m & 255, m >> 8])).toEqual([[sq(7, 2), sq(7, 3)]]); // chỉ còn nước chắn
    expect(ILLEGAL_MESSAGE.STILL_IN_CHECK).toBe('Tướng đang bị chiếu');
  });
  it('giải chiếu bằng cách ăn quân chiếu', () => {
    const f2 = '4k4/9/9/R2r5/9/9/9/9/9/3K5 w';
    expect(can(f2, [3, 0], [3, 3])).toBe(true);
    expect(can(f2, [3, 0], [3, 2])).toBe(false);
  });
  it('giải chiếu bằng cách né', () => {
    const fen = '3k5/9/9/4r4/9/9/9/9/9/4K4 w';
    const t = targets(fen, 9, 4);
    expect(t).toContain(sq(9, 5));
    expect(t).not.toContain(sq(8, 4));
  });
  it('chiếu Pháo: rút ngòi là giải chiếu', () => {
    const fen = '3k5/9/9/4c4/9/9/4P4/9/9/4K4 w'; // Tốt là ngòi
    expect(isInCheck(pos(fen).board, 'r')).toBe(true);
    expect(legalMoves(pos(fen)).length).toBeGreaterThan(0);
  });
});

describe('Kết thúc ván', () => {
  it('chiếu bí', () => {
    // Hai Xe đen khóa Tướng đỏ ở cột 3-5
    const mate = new XiangqiGame('3k5/9/9/9/9/9/9/9/5r3/r3K4 w');
    expect(mate.result).toEqual({ winner: 'b', reason: 'checkmate' });
  });
  it('hết nước đi nhưng không bị chiếu vẫn bị xử thua', () => {
    // Đỏ không bị chiếu nhưng mọi nước đều bị cấm.
    const fen = '3k1r3/9/9/9/9/9/9/9/8r/4K4 w';
    const p = pos(fen);
    expect(isInCheck(p.board, 'r')).toBe(false);
    expect(legalMoves(p).length).toBe(0);
    const g = new XiangqiGame(fen);
    expect(g.result).toEqual({ winner: 'b', reason: 'stalemate' });
  });
  it('đi nước chiếu bí tạo kết quả và ghi cờ chiếu', () => {
    const g = new XiangqiGame('3k5/9/9/9/9/9/9/5r3/r8/4K4 b');
    g.play(sq(8, 0), sq(9, 0)); // chiếu theo hàng 9, Xe (7,5) chưa khóa hàng 8
    expect(g.result).toBeNull();
    const m = new XiangqiGame('3k5/9/9/9/9/9/9/5r3/r8/4K4 b');
    const r = m.play(sq(7, 5), sq(8, 5));
    expect(r.ok && r.record.check).toBe(false);
    const r2 = new XiangqiGame('3k5/9/9/9/9/9/9/9/5r3/1r2K4'.replace('1r2K4', '1r2K4') + ' b').play(sq(9, 1), sq(9, 2));
    expect(r2.ok && r2.record.check).toBe(true);
    expect(r2.ok && r2.result).toEqual({ winner: 'b', reason: 'checkmate' });
  });
  it('không cho đi tiếp sau khi ván kết thúc', () => {
    const g = new XiangqiGame('3k5/9/9/9/9/9/9/9/5r3/r3K4 w');
    expect(g.play(sq(9, 4), sq(9, 3)).ok).toBe(false);
  });
});

describe('Chính sách hòa – Luật chơi giải trí', () => {
  it('lặp lại ba lần xử hòa', () => {
    const g = new XiangqiGame('3k5/9/9/9/9/9/9/9/R8/4K4 b');
    const shuffle = () => {
      g.play(sq(0, 3), sq(1, 3));
      g.play(sq(8, 0), sq(8, 1));
      g.play(sq(1, 3), sq(0, 3));
      g.play(sq(8, 1), sq(8, 0));
    };
    shuffle();
    expect(g.result).toBeNull();
    shuffle();
    expect(g.result).toEqual({ winner: null, reason: 'repetition' });
  });
  it('không còn quân tấn công thì hòa', () => {
    const g = new XiangqiGame('5k3/4a4/9/9/9/9/9/9/4A4/3K5 w'.replace('3K5', '5K3'));
    expect(g.result).toEqual({ winner: null, reason: 'insufficient' });
  });
});

describe('Lịch sử, undo và save', () => {
  it('undo khôi phục đúng thế cờ, quân bị ăn và kết quả', () => {
    const g = new XiangqiGame();
    const f0 = g.fen;
    g.play(sq(7, 1), sq(0, 1)); // Pháo ăn Mã
    expect(typeOf(g.moves[0].captured)).toBe(4);
    g.play(sq(0, 0), sq(0, 1));
    expect(g.undo(2)).toBe(2);
    expect(g.fen).toBe(f0);
    expect(g.moves.length).toBe(0);
    expect(g.undo()).toBe(0);
  });
  it('undo sau chiếu bí mở lại ván', () => {
    const g = new XiangqiGame('3k5/9/9/9/9/9/9/9/5r3/1r2K4 b');
    g.play(sq(9, 1), sq(9, 2));
    expect(g.result?.reason).toBe('checkmate');
    g.undo();
    expect(g.result).toBeNull();
  });
  it('serialize và replay ra cùng thế cờ', () => {
    const g = new XiangqiGame();
    g.play(sq(7, 1), sq(7, 4));
    g.play(sq(0, 1), sq(2, 2));
    const copy = XiangqiGame.replay(JSON.parse(JSON.stringify(g.serialize())));
    expect(copy.fen).toBe(g.fen);
    expect(copy.moves[0].notation).toBe('Pháo 8 bình 5');
    expect(copy.moves[1].notation).toBe('Mã 2 tiến 3');
  });
  it('replay từ chối dữ liệu giả', () => {
    expect(() => XiangqiGame.replay({ initialFen: START_FEN, moves: [[0, 89]] })).toThrow();
    expect(() => XiangqiGame.replay({ initialFen: START_FEN, moves: [['a', 3]] as never })).toThrow();
    expect(() => XiangqiGame.replay(null as never)).toThrow();
  });
});

describe('Ký hiệu nước đi', () => {
  it('phân biệt tiến, thoái, bình và quân trước/sau', () => {
    const p = pos('3k5/9/9/9/9/9/2R6/9/2R6/4K4 w');
    expect(moveNotation(p, sq(6, 2), sq(4, 2))).toBe('Xe trước tiến 2');
    expect(moveNotation(p, sq(8, 2), sq(8, 4))).toBe('Xe sau bình 5');
    const b = pos(START_FEN.replace(' w', ' b'));
    expect(moveNotation(b, sq(2, 1), sq(2, 4))).toBe('Pháo 2 bình 5');
  });
  it('genPseudo gồm cả nước tự làm mất Tướng, legalMoves thì không', () => {
    const fen = '4k4/9/9/9/4R4/9/9/9/9/4K4 w';
    const p = pos(fen);
    expect(genPseudo(p.board, 'r').length).toBeGreaterThan(legalMoves(p).length);
  });
});
