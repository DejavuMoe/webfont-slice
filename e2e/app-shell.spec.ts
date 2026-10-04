import { expect, test } from '@playwright/test';
import { addFonts, fixtures, generate, horizontalOverflow } from './helpers';

// Service Worker 注册与离线切换需要串行，避免同一 origin 的并发注册互相干扰。
test.describe.configure({ mode: 'serial' });

test('语言与主题偏好切换后持久化', async ({ page }) => {
  await page.goto('./');
  const github = page.getByRole('link', { name: 'GitHub 源代码' });
  await expect(github).toHaveAttribute('href', 'https://github.com/DejavuMoe/webfont-slice');
  await expect(github).toHaveAttribute('rel', 'noreferrer noopener');
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ship only the glyphs');

  const theme = page.getByRole('button', { name: /^Theme:/u });
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /^Theme:/u }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('窄屏不产生页面级横向溢出，并提供吸底操作条', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('./');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  }
  await addFonts(page, fixtures.cjk);
  await expect(page.getByRole('article', { name: /Noto Sans SC/u })).toBeVisible();
  await expect(page.getByText(/每页约/u)).toBeVisible({ timeout: 30_000 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  // 吸底条可展开为抽屉，抽屉内有完整的分包预览与粒度滑杆。
  await page.getByRole('button', { name: /每页约/u }).click();
  const sheet = page.getByRole('dialog', { name: '分包预览' });
  await expect(sheet.getByRole('slider', { name: '分包粒度' })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  await sheet.getByRole('button', { name: '关闭' }).click();
  await expect(sheet).toHaveCount(0);
  const bar = page.getByRole('button', { name: '生成', exact: true });
  await expect(bar).toBeEnabled();
  await bar.click();
  await expect(page.getByRole('link', { name: '查看结果' }).first()).toBeVisible({
    timeout: 60_000,
  });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test('离线可重新打开并完成本地生成', async ({ context, page }) => {
  test.setTimeout(90_000);
  await page.goto('./');
  await page.evaluate('navigator.serviceWorker.ready');
  await page.reload();
  await expect(page.getByText('本地处理 · 可离线')).toBeVisible({ timeout: 20_000 });

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await addFonts(page, fixtures.latin);
  await expect(page.getByRole('article', { name: /ABeeZee/u })).toBeVisible();
  await generate(page);
  await context.setOffline(false);
});
