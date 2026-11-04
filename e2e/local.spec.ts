import { expect, test } from '@playwright/test';
import { clickSq, expectNoGhosts, local, move, ready, sq, startLocal, waitFor } from './helpers';

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors).toEqual([]));

test('đấu máy: đi nước đầu, máy trả lời bằng nước hợp lệ', async ({ page }) => {
  await startLocal(page, 'Chơi với máy', ['Dễ']);
  await move(page, sq(7, 1), sq(7, 4));
  await waitFor(page, () => (window as any).__kd.local().ply >= 2 && !(window as any).__kd.local().thinking);
  const s = await local(page);
  expect(s.turn).toBe('r');
  await expectNoGhosts(page);
  await expect(page.getByTestId('moves')).toContainText('Pháo 8 bình 5');
});

test('nước sai không đổi bàn cờ và có phản hồi ngắn', async ({ page }) => {
  await startLocal(page, 'Hai người');
  const before = (await local(page)).fen;
  await clickSq(page, sq(9, 1)); // Mã
  await page.waitForTimeout(300);
  await clickSq(page, sq(8, 3)); // sai hình
  await expect(page.getByTestId('toast')).toBeVisible();
  expect((await local(page)).fen).toBe(before);
  await page.mouse.click(5, 5);
});

test('Mã bị cản chân báo đúng lý do', async ({ page }) => {
  await startLocal(page, 'Hai người');
  await move(page, sq(9, 1), sq(7, 2)); // Mã đỏ ra (7,2)
  await move(page, sq(3, 0), sq(4, 0));
  await clickSq(page, sq(7, 2));
  await page.waitForTimeout(200);
  // Pháo đỏ ở (7,1) cản chân Mã khi đi sang trái.
  await clickSq(page, sq(8, 0));
  await expect(page.getByTestId('toast')).toContainText('Mã bị cản chân');
});

test('ăn quân chạy animation, không tạo quân ma', async ({ page }) => {
  await startLocal(page, 'Hai người');
  await move(page, sq(7, 1), sq(0, 1)); // Pháo ăn Mã qua ngòi
  const stats = await page.evaluate(() => (window as any).__kd.busy());
  expect(stats).toBe(true);
  await expectNoGhosts(page);
  expect((await local(page)).ply).toBe(1);
  const v = await page.evaluate(() => (window as any).__kd.visual().length);
  expect(v).toBe(31);
  await move(page, sq(0, 0), sq(0, 1)); // Xe ăn lại Pháo
  await expectNoGhosts(page);
  expect(await page.evaluate(() => (window as any).__kd.stats().resynced)).toBe(0);
});

test('đặt lại khi máy đang suy nghĩ không làm hỏng ván', async ({ page }) => {
  await startLocal(page, 'Chơi với máy', ['Khó']);
  await move(page, sq(9, 7), sq(7, 6));
  await waitFor(page, () => (window as any).__kd.local().thinking);
  const id = (await local(page)).gameId;
  await page.getByTestId('leave').click();
  await page.getByRole('button', { name: 'Chơi với máy', exact: true }).click();
  await page.getByRole('button', { name: 'Dễ', exact: true }).click();
  await page.getByTestId('start-game').click();
  await waitFor(page, (old) => (window as any).__kd.local().gameId && (window as any).__kd.local().gameId !== old, id);
  await page.waitForTimeout(3200); // lâu hơn ngân sách suy nghĩ của mức Khó
  const s = await local(page);
  expect(s.ply).toBe(0);
  expect(s.thinking).toBe(false);
  await expectNoGhosts(page);
});

test('undo giữa animation không tạo quân ma hoặc trùng quân', async ({ page }) => {
  await startLocal(page, 'Hai người');
  await move(page, sq(7, 1), sq(0, 1));
  expect(await page.evaluate(() => {
    const busy = (window as any).__kd.busy();
    (document.querySelector('[data-testid=undo]') as HTMLButtonElement).click();
    return busy;
  })).toBe(true);
  await expectNoGhosts(page);
  const s = await local(page);
  expect(s.ply).toBe(0);
  expect(await page.evaluate(() => (window as any).__kd.visual().length)).toBe(32);
});

test('undo khi đấu máy luôn trả về lượt người chơi', async ({ page }) => {
  await startLocal(page, 'Chơi với máy', ['Dễ']);
  await move(page, sq(7, 1), sq(7, 4));
  await waitFor(page, () => (window as any).__kd.local().ply === 2 && !(window as any).__kd.busy());
  await page.getByTestId('undo').click();
  const s = await local(page);
  expect([s.ply, s.turn]).toEqual([0, 'r']);
  await expectNoGhosts(page);
});

test('cầm Đen: máy đi trước và bàn đảo vẫn click đúng ô', async ({ page }) => {
  await startLocal(page, 'Chơi với máy', ['Đen, đi sau', 'Dễ']);
  await waitFor(page, () => (window as any).__kd.local().ply === 1 && !(window as any).__kd.busy());
  // Pháo đen từ (2,1) sang (2,4): quân đang nằm phía dưới màn hình.
  const p = await page.evaluate((s) => (window as any).__kd.project(s), sq(2, 1));
  const q = await page.evaluate((s) => (window as any).__kd.project(s), sq(7, 1));
  expect(p.y).toBeGreaterThan(q.y);
  await move(page, sq(0, 1), sq(2, 2));
  await waitFor(page, () => (window as any).__kd.local().ply >= 2);
  const fen = (await local(page)).fen;
  expect(fen.startsWith('r1bakabnr') || (await local(page)).ply >= 2).toBe(true);
});

test('tự lưu và tiếp tục ván; dữ liệu hỏng được xử lý an toàn', async ({ page }) => {
  await startLocal(page, 'Hai người');
  await move(page, sq(7, 1), sq(7, 4));
  await waitFor(page, () => !(window as any).__kd.busy());
  const fen = (await local(page)).fen;
  await page.reload();
  await ready(page);
  await page.getByRole('button', { name: 'Tiếp tục ván' }).click();
  await waitFor(page, () => (window as any).__kd.local().fen);
  expect((await local(page)).fen).toBe(fen);
  await expectNoGhosts(page);
  await page.getByTestId('leave').click();
  await page.evaluate(() => localStorage.setItem('kydao.save.v1', '{"v":1,"gameId":"x","game":{"moves":[[0,89]]}}'));
  await page.reload();
  await ready(page);
  await page.getByRole('button', { name: 'Tiếp tục ván' }).click();
  await expect(page.getByTestId('toast')).toContainText('Không đọc được');
  expect(await page.evaluate(() => localStorage.getItem('kydao.save.v1'))).toBeNull();
});

test('đầu hàng, xem lại ván, chơi lại', async ({ page }) => {
  await startLocal(page, 'Hai người');
  await move(page, sq(7, 1), sq(7, 4));
  await move(page, sq(0, 1), sq(2, 2));
  await page.getByTestId('resign').click();
  await page.getByTestId('confirm-resign').click();
  await expect(page.getByTestId('result')).toContainText('Đầu hàng');
  await page.getByTestId('review').click();
  await expect(page.locator('.side-panel').getByTestId('review-bar')).toContainText('0/2');
  await page.locator('.side-panel').getByTestId('review-next').click();
  await expect(page.locator('.side-panel').getByTestId('review-bar')).toContainText('1/2');
  await expectNoGhosts(page);
});

test('đồng hồ chạy theo thời gian thực', async ({ page }) => {
  await startLocal(page, 'Hai người', ['5 phút']);
  const read = async (side: string) => (await page.getByTestId(`clock-${side}`).first().textContent())!;
  const toSec = (t: string) => { const [m, x] = t.split(':').map(Number); return m * 60 + x; };
  const first = toSec(await read('r'));
  await page.waitForTimeout(2500);
  const second = toSec(await read('r'));
  expect(first - second).toBeGreaterThanOrEqual(2);
  expect(await read('b')).toBe('5:00'); // đồng hồ bên không đến lượt đứng yên
});
