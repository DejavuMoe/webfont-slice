import AxeBuilder from '@axe-core/playwright';
import { expect, type Download, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const fixtures = {
  cjk: path.resolve('src/test/fixtures/noto-sans-sc-subset/NotoSansSC-TestSubset.ttf'),
  latin: path.resolve('src/test/fixtures/abeezee/ABeeZee-Regular.ttf'),
  latinWoff2: path.resolve('src/test/fixtures/abeezee/ABeeZee-Regular.woff2'),
  variable: path.resolve('src/test/fixtures/source-serif-4/SourceSerif4Variable-TestSubset.ttf'),
  mono: path.resolve('src/test/fixtures/jetbrains-mono-subset/JetBrainsMono-TestSubset.ttf'),
};

export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

export async function addFonts(page: Page, files: string | readonly string[]): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles(files);
}

export function generateButton(page: Page) {
  return page.getByRole('button', { name: /^生成 \d+ 个分片/u });
}

export async function generate(page: Page): Promise<void> {
  const button = generateButton(page);
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
  await expect(page.getByRole('heading', { name: '结果', exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

export async function expectNoSeriousA11yViolations(page: Page, include?: string): Promise<void> {
  // 入场动画进行中时透明度会让 axe 把文字颜色算浅，先等有限时长的动画结束。
  // e2e 工程不带 DOM 类型，脚本以字符串形式在页面中执行。
  await page.evaluate(
    `Promise.all(document.getAnimations()
      .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
      .map((a) => a.finished.catch(() => undefined))).then(() => undefined)`,
  );
  const builder = new AxeBuilder({ page });
  const results = await (include === undefined ? builder : builder.include(include)).analyze();
  expect(
    results.violations
      .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
      .map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => `${node.target.join(' ')} (${(node.failureSummary ?? '').replace(/\s+/gu, ' ').slice(0, 160)})`).join(', ')}`,
      ),
  ).toEqual([]);
}

export async function readZip(download: Download): Promise<Record<string, Uint8Array>> {
  const file = await download.path();
  return unzipSync(new Uint8Array(await readFile(file)));
}

export function text(bytes: Uint8Array | undefined): string {
  return bytes === undefined ? '' : strFromU8(bytes);
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate<number>(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  );
}
