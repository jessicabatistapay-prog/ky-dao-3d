import { Browser, BrowserContext, Page, expect } from '@playwright/test';
import { BASE, LOW_QUALITY } from '../playwright.config';

/** Thăm dò bằng timer: rAF bị bóp nghẹt khi cảnh vẽ bằng phần mềm. */
export function waitFor(page: Page, fn: any, arg?: any) {
  return page.waitForFunction(fn, arg, { polling: 120 });
}

export const sq = (row: number, col: number) => row * 9 + col;

export async function ready(page: Page) {
  await waitFor(page, () => (window as any).__kd?.project && (window as any).__kd.visual().length > 0);
}

/** Bấm vào đúng giao điểm trên canvas qua phép chiếu của cảnh 3D. */
export async function clickSq(page: Page, s: number) {
  await waitFor(page, () => !(window as any).__kd.busy());
  const p = await page.evaluate((x) => (window as any).__kd.project(x), s);
  await page.mouse.click(p.x, p.y);
}

export async function move(page: Page, from: number, to: number) {
  await clickSq(page, from);
  await clickSq(page, to);
}

export const local = (page: Page) => page.evaluate(() => (window as any).__kd.local());
export const online = (page: Page) => page.evaluate(() => (window as any).__kd.online());

/** Quân hiển thị phải trùng khít bàn logic: không có quân ma, không trùng quân. */
export async function expectNoGhosts(page: Page) {
  await waitFor(page, () => !(window as any).__kd.busy());
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    const kd = (window as any).__kd;
    const visual = kd.visual() as { sq: number; code: number }[];
    const logical = kd.logical() as number[];
    return { visual, logical };
  });
  const seen = new Set(r.visual.map((v) => v.sq));
  expect(seen.size).toBe(r.visual.length);
  const expected = r.logical.map((code, s) => ({ code, s })).filter((x) => x.code !== 0);
  expect(r.visual.length).toBe(expected.length);
  for (const e of expected) expect(r.visual.find((v) => v.sq === e.s)?.code).toBe(e.code);
}

export async function startLocal(page: Page, mode: 'Chơi với máy' | 'Hai người', opts: string[] = []) {
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: mode, exact: true }).click();
  for (const o of opts) await page.getByRole('button', { name: o, exact: true }).click();
  await page.getByTestId('start-game').click();
  await waitFor(page, () => (window as any).__kd.local().fen);
  await page.waitForTimeout(600);
}

export async function createRoom(page: Page, nick: string, opts: { password?: string; time?: string } = {}) {
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Chơi online', exact: true }).click();
  await page.getByTestId('nick').fill(nick);
  if (opts.time) await page.getByRole('button', { name: opts.time, exact: true }).click();
  await page.getByRole('button', { name: 'Đỏ', exact: true }).click();
  if (opts.password) await page.getByTestId('room-password').fill(opts.password);
  await expect(page.getByTestId('room-submit')).toBeEnabled();
  await page.getByTestId('room-submit').click();
  await expect(page.getByTestId('code')).toBeVisible();
  return (await page.getByTestId('code').textContent())!;
}

export async function joinByLink(page: Page, code: string, nick: string, password?: string) {
  await page.goto(`/?phong=${code}`);
  await ready(page);
  await page.getByTestId('nick').fill(nick);
  if (password) await page.getByTestId('join-password').fill(password);
  await expect(page.getByTestId('room-submit')).toBeEnabled();
  await page.getByTestId('room-submit').click();
  await expect(page.getByTestId('lobby')).toBeVisible();
}

export async function startOnline(a: Page, b: Page) {
  await a.getByTestId('ready').click();
  await b.getByTestId('ready').click();
  await waitFor(a, () => (window as any).__kd.online().fen);
  await waitFor(b, () => (window as any).__kd.online().fen);
  await a.waitForTimeout(800);
}

export async function twoPlayers(browser: Browser, mobileB = false) {
  const ctxA: BrowserContext = await browser.newContext({ baseURL: BASE, storageState: LOW_QUALITY, viewport: { width: 1000, height: 640 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const ctxB: BrowserContext = await browser.newContext(
    mobileB
      ? { baseURL: BASE, storageState: LOW_QUALITY, viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }
      : { baseURL: BASE, storageState: LOW_QUALITY, viewport: { width: 1000, height: 640 } },
  );
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  return { a, b, close: async () => { await ctxA.close(); await ctxB.close(); } };
}
