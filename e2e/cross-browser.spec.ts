import { expect, test } from '@playwright/test';
import { addFonts, fixtures, generate, trackErrors } from './helpers';

test('主流程可在当前浏览器完成分析、生成与真实加载预览', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await addFonts(page, fixtures.latinWoff2);
  await expect(page.getByRole('article', { name: /ABeeZee/u })).toBeVisible({ timeout: 30_000 });
  await generate(page);
  await expect(page.getByText('浏览器实际请求')).toBeVisible();
  expect(errors).toEqual([]);
});
