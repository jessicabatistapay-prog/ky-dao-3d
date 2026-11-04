import { expect, test } from '@playwright/test';
import { createRoom, expectNoGhosts, joinByLink, move, online, ready, sq, startLocal, startOnline, twoPlayers, waitFor } from './helpers';

test('tạo phòng, vào bằng link, chơi, hai bên cùng bàn cờ', async ({ browser }) => {
  const { a, b, close } = await twoPlayers(browser);
  const code = await createRoom(a, 'An');
  await a.getByTestId('copy-link').click();
  expect(await a.evaluate(() => navigator.clipboard.readText())).toContain(`phong=${code}`);
  await joinByLink(b, code, 'Bình');
  await expect(a.getByTestId('lobby')).toContainText('Bình');
  await startOnline(a, b);
  expect((await online(a)).side).toBe('r');
  expect((await online(b)).side).toBe('b');
  await move(a, sq(7, 1), sq(7, 4));
  await waitFor(b, () => (window as any).__kd.online().version === 1);
  await move(b, sq(0, 1), sq(2, 2));
  await waitFor(a, () => (window as any).__kd.online().version === 2);
  await waitFor(b, () => (window as any).__kd.online().version === 2);
  expect((await online(a)).fen).toBe((await online(b)).fen);
  await expectNoGhosts(a);
  await expectNoGhosts(b);
  await close();
});

test('vào bằng mã, sai mật khẩu, phân biệt lỗi', async ({ browser }) => {
  const { a, b, close } = await twoPlayers(browser);
  const code = await createRoom(a, 'An', { password: 'matkhau' });
  await b.goto('/');
  await ready(b);
  await b.getByRole('button', { name: 'Chơi online', exact: true }).click();
  await b.getByTestId('nick').fill('Bình');
  await b.getByRole('button', { name: 'Vào phòng bằng mã' }).click();
  await b.getByTestId('room-code').fill('ZZZZZZ');
  await expect(b.getByTestId('room-submit')).toBeEnabled();
  await b.getByTestId('room-submit').click();
  await expect(b.getByTestId('online-error')).toContainText('Không tìm thấy phòng');
  await b.getByTestId('room-code').fill(code);
  await b.getByTestId('room-submit').click();
  await expect(b.getByTestId('online-error')).toContainText('cần mật khẩu');
  await b.getByTestId('join-password').fill('sai');
  await b.getByTestId('room-submit').click();
  await expect(b.getByTestId('online-error')).toContainText('Sai mật khẩu');
  await b.getByTestId('join-password').fill('matkhau');
  await b.getByTestId('room-submit').click();
  await expect(b.getByTestId('lobby')).toBeVisible();
  await close();
});

test('chat: gửi nhận, HTML hiện như văn bản, ẩn đối thủ, chưa đọc', async ({ browser }) => {
  const { a, b, close } = await twoPlayers(browser);
  const code = await createRoom(a, 'An');
  await joinByLink(b, code, 'Bình');
  await a.getByTestId('chat-input').fill('Xin chào 😀');
  await a.getByTestId('chat-input').press('Enter');
  await expect(b.getByTestId('chat-list')).toContainText('Xin chào 😀');
  const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
  await b.getByTestId('chat-input').fill(evil);
  await b.getByTestId('chat-send').click();
  await expect(a.getByTestId('chat-list')).toContainText('<img src=x');
  expect(await a.evaluate(() => (window as any).__xss)).toBeUndefined();
  expect(await a.locator('.chat-list img, .chat-list script').count()).toBe(0);
  await a.getByTestId('chat-input').fill('dòng 1');
  await a.getByTestId('chat-input').press('Shift+Enter');
  await a.getByTestId('chat-input').type('dòng 2');
  await expect(a.getByTestId('chat-input')).toHaveValue('dòng 1\ndòng 2');
  await a.getByTestId('hide-opponent').click();
  await expect(a.getByTestId('chat-list')).not.toContainText('<img src=x');
  await a.getByTestId('hide-opponent').click();
  // Giới hạn tần suất.
  for (let i = 0; i < 7; i++) {
    await b.getByTestId('chat-input').fill(`m${i}`);
    await b.getByTestId('chat-input').press('Enter');
  }
  await expect(b.getByTestId('chat-list')).toContainText('quá nhanh');
  await startOnline(a, b);
  await a.getByTestId('chat-toggle').click();
  await b.waitForTimeout(10500);
  await b.locator('.side-panel').getByTestId('chat-input').fill('khi đang chơi');
  await b.locator('.side-panel').getByTestId('chat-input').press('Enter');
  await expect(a.getByTestId('unread').first()).toHaveText('1');
  await close();
});

test('tải lại trang và mất mạng khôi phục đúng vị trí', async ({ browser }) => {
  const { a, b, close } = await twoPlayers(browser);
  const code = await createRoom(a, 'An');
  await joinByLink(b, code, 'Bình');
  await startOnline(a, b);
  await move(a, sq(7, 1), sq(7, 4));
  await waitFor(b, () => (window as any).__kd.online().version === 1);
  await b.reload();
  await ready(b);
  await waitFor(b, () => (window as any).__kd.online?.().fen);
  expect((await online(b)).side).toBe('b');
  await expectNoGhosts(b);
  // Mất mạng thật ở context B.
  await b.context().setOffline(true);
  await expect(b.getByTestId('reconnecting')).toBeVisible({ timeout: 25000 });
  await expect(a.locator('.side-panel')).toContainText('Mất kết nối', { timeout: 25000 });
  await b.context().setOffline(false);
  await expect(b.getByTestId('reconnecting')).toBeHidden({ timeout: 20000 });
  await move(b, sq(0, 1), sq(2, 2));
  await waitFor(a, () => (window as any).__kd.online().version === 2);
  await close();
});

test('nhiều tab: tab mới giành quyền, tab cũ dừng lại', async ({ browser }) => {
  const { a, b, close } = await twoPlayers(browser);
  const code = await createRoom(a, 'An');
  await joinByLink(b, code, 'Bình');
  await startOnline(a, b);
  const a2 = await a.context().newPage();
  await a2.goto('/');
  await ready(a2);
  await waitFor(a2, () => (window as any).__kd.online?.().fen);
  await expect(a.getByTestId('superseded')).toBeVisible();
  await move(a2, sq(7, 1), sq(7, 4));
  await waitFor(b, () => (window as any).__kd.online().version === 1);
  await close();
});

test('xin hòa, xin đi lại, đầu hàng và tái đấu', async ({ browser }) => {
  const { a, b, close } = await twoPlayers(browser);
  const code = await createRoom(a, 'An');
  await joinByLink(b, code, 'Bình');
  await startOnline(a, b);
  await move(a, sq(7, 1), sq(7, 4));
  await waitFor(b, () => (window as any).__kd.online().version === 1);
  await waitFor(a, () => !(window as any).__kd.busy());
  await a.getByTestId('offer-undo').first().click();
  await expect(b.getByTestId('offer')).toContainText('Pháo 8 bình 5');
  await expect(b.getByTestId('offer')).toContainText('lượt về Đỏ');
  await b.getByTestId('offer-accept').click();
  await waitFor(a, () => (window as any).__kd.online().version === 2);
  await expectNoGhosts(a);
  await b.getByTestId('offer-draw').first().click();
  await a.getByTestId('offer-decline').click();
  await expect(a.getByTestId('offer')).toBeHidden();
  await a.getByTestId('resign').first().click();
  await a.getByTestId('confirm-resign').click();
  await expect(a.getByTestId('result')).toContainText('Bạn thua');
  await expect(b.getByTestId('result')).toContainText('Bạn thắng');
  await b.getByTestId('result-rematch').click();
  await a.locator('.dialog header button').click();
  await a.getByTestId('offer-accept').click();
  await waitFor(a, () => (window as any).__kd.online().side === 'b' && (window as any).__kd.online().version === 0);
  expect((await online(b)).side).toBe('r');
  await close();
});

test('đồng hồ server hiển thị đồng nhất ở hai bên', async ({ browser }) => {
  const { a, b, close } = await twoPlayers(browser);
  await createRoom(a, 'An', { time: 'Tùy chỉnh' });
  await a.locator('input[type=number]').fill('1');
  const code = await a.getByTestId('code').textContent();
  await joinByLink(b, code!, 'Bình');
  await startOnline(a, b);
  // Hết giờ thật được kiểm tra ở test tích hợp server với mốc 1 giây.
  await a.waitForTimeout(1500);
  await expect(a.getByTestId('clock-r').first()).toHaveText(/^0:5\d$/);
  await expect(b.getByTestId('clock-r').first()).toHaveText(/^0:5\d$/);
  await close();
});

test('kết quả AI từ chế độ trước không ảnh hưởng ván online', async ({ browser }) => {
  const { a, b, close } = await twoPlayers(browser);
  await startLocal(a, 'Chơi với máy', ['Khó']);
  await move(a, sq(9, 7), sq(7, 6));
  await waitFor(a, () => (window as any).__kd.local().thinking);
  await a.getByTestId('leave').click();
  const code = await (async () => {
    await a.getByRole('button', { name: 'Chơi online', exact: true }).click();
    await a.getByTestId('nick').fill('An');
    await a.getByRole('button', { name: 'Đỏ', exact: true }).click();
    await expect(a.getByTestId('room-submit')).toBeEnabled();
    await a.getByTestId('room-submit').click();
    return (await a.getByTestId('code').textContent())!;
  })();
  await joinByLink(b, code, 'Bình');
  await startOnline(a, b);
  await a.waitForTimeout(3000);
  const s = await online(a);
  expect(s.version).toBe(0);
  await expectNoGhosts(a);
  await close();
});

test('desktop và mobile chơi cùng nhau', async ({ browser }) => {
  const { a, b, close } = await twoPlayers(browser, true);
  const code = await createRoom(a, 'An');
  await joinByLink(b, code, 'Di động');
  await startOnline(a, b);
  await move(a, sq(7, 1), sq(7, 4));
  await waitFor(b, () => (window as any).__kd.online().version === 1);
  await waitFor(b, () => !(window as any).__kd.busy());
  // Chạm trên mobile.
  for (const s of [sq(0, 1), sq(2, 2)]) {
    const p = await b.evaluate((x) => (window as any).__kd.project(x), s);
    await b.touchscreen.tap(p.x, p.y);
    await b.waitForTimeout(250);
  }
  await waitFor(a, () => (window as any).__kd.online().version === 2);
  await b.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(b.getByTestId('sheet-chat')).toBeVisible();
  const box = await b.getByTestId('sheet-chat').boundingBox();
  expect(box!.height).toBeLessThan(420);
  await b.getByTestId('sheet-chat').getByTestId('chat-input').fill('từ điện thoại');
  await b.getByTestId('sheet-chat').getByTestId('chat-send').click();
  await expect(a.getByTestId('chat-list').first()).toContainText('từ điện thoại');
  await close();
});
