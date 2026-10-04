import { expect, test } from '@playwright/test';
import {
  addFonts,
  expectNoSeriousA11yViolations,
  fixtures,
  generate,
  generateButton,
  readZip,
  text,
  trackErrors,
} from './helpers';

test('CJK 字体：分析、规划、生成、真实加载预览与 ZIP', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('只下载页面');
  await expectNoSeriousA11yViolations(page);

  await addFonts(page, fixtures.cjk);
  await expect(page.getByRole('article', { name: /Noto Sans SC/u })).toBeVisible();
  // 测试字体只覆盖几百个字，应用会默认改为"全部"；这里显式选择"常用"字表。
  await expect(page.getByRole('radio', { name: /^全部/u })).toBeChecked();
  await page.getByRole('radio', { name: /^常用/u }).check({ force: true });
  await page.getByText('字体信息与输出设置').click();
  const prefix = page.getByLabel('文件名前缀');
  await expect(prefix).toHaveAttribute('placeholder', 'noto-sans-sc');
  await prefix.fill('noto');
  await expect(page.getByText(/文件名示例：noto-/u)).toBeVisible();
  await expect(generateButton(page)).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByText('每页预计下载')).toBeVisible();
  await expectNoSeriousA11yViolations(page, '#main');

  await generate(page);
  await expect(page.getByText(/已生成 · 用时/u)).toBeVisible();
  await expect(page.getByText('浏览器实际请求')).toBeVisible();
  await expect(page.locator('#result').getByText(/^\d+ \/ \d+ 个文件$/u)).not.toHaveText(/^0 \//u, {
    timeout: 10_000,
  });
  await expectNoSeriousA11yViolations(page, '#result');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 ZIP' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-webfont\.zip$/u);
  const files = await readZip(download);
  const css = text(files['fonts.css']);
  const report = JSON.parse(text(files['report.json'])) as {
    schema: string;
    summary: { shards: number };
    faces: { shards: { file: string }[] }[];
  };
  expect(report.schema).toBe('webfont-slice/report@4');
  const fonts = Object.entries(files).filter(
    ([name]) => name.startsWith('fonts/') && name.endsWith('.woff2'),
  );
  expect(fonts).toHaveLength(report.summary.shards);
  for (const [name, bytes] of fonts) {
    expect(text(bytes.subarray(0, 4))).toBe('wOF2');
    expect(css).toContain(`./${name}`);
    expect(name).toMatch(/^fonts\/noto-[\w-]+\.[0-9a-f]{8}\.woff2$/u);
  }
  expect(css).toContain('unicode-range:');
  expect(css).not.toMatch(/local\(|override|Fallback|sans-serif/u);
  expect(text(files['demo.html'])).toContain('fonts.css');
  expect(text(files['README.md'])).toContain('Cache-Control');
  expect(errors).toEqual([]);
});

test('代码等宽字体：按文字分片，保留连字特性，用法示例指向代码元素', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await page.goto('./');
  await addFonts(page, fixtures.mono);
  const card = page.getByRole('article', { name: /JetBrains Mono/u });
  await expect(card).toBeVisible();
  await expect(card.getByText('等宽', { exact: true })).toBeVisible();
  // 西文字体不显示简繁选择，默认选"全部"，中间两档按区块取字体自身字符。
  await expect(page.getByRole('radio', { name: /^全部/u })).toBeChecked();
  await expect(page.getByRole('radiogroup', { name: '语言' })).toHaveCount(0);
  await expect(page.getByText(/拉丁、希腊、西里尔、符号与图标各自成片/u)).toBeVisible();
  await page.getByRole('radio', { name: /^西欧/u }).check({ force: true });
  await expect(page.getByText(/缺 \d+ 字/u)).toHaveCount(0);
  await page.getByRole('radio', { name: /^全部/u }).check({ force: true });
  await expectNoSeriousA11yViolations(page, '#main');

  await generate(page);
  await expect(page.getByLabel('预览文字')).toHaveValue(/0O 1lI/u);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 ZIP' }).click();
  const files = await readZip(await downloadPromise);
  const css = text(files['fonts.css']);
  const report = JSON.parse(text(files['report.json'])) as {
    characters: { script: string };
    faces: { monospace: boolean; shards: { kind: string; unicodeRange: string }[] }[];
  };
  expect(report.characters.script).toBe('western');
  expect(report.faces[0]?.monospace).toBe(true);
  // 长尾按文字分组装箱：制表符不会和拉丁-1 重音字母挤在同一片。
  const shards = report.faces[0]?.shards ?? [];
  expect(shards.find((shard) => shard.unicodeRange.includes('U+2500'))?.unicodeRange).not.toMatch(
    /U\+00[A-F]/u,
  );
  expect(text(files['README.md'])).toContain('code, kbd, samp, pre {');
  expect(text(files['README.md'])).toContain('https://github.com/DejavuMoe/webfont-slice');
  expect(css).toContain('font-family: "JetBrains Mono"');
  expect(errors).toEqual([]);
});

test('仅文本：自定义字符生成精确子集，设置改变后结果标记为过期', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await addFonts(page, fixtures.latin);
  await expect(page.getByRole('article', { name: /ABeeZee/u })).toBeVisible();
  await page.getByRole('radio', { name: /^仅文本/u }).check({ force: true });
  await page.getByLabel('你的文本', { exact: true }).fill('ABC abc');
  await expect(page.getByText(/6 个不同字符/u)).toBeVisible();
  await generate(page);

  await page.getByRole('radio', { name: 'fonts.css' }).check({ force: true });
  const css = page.locator('pre[aria-label="fonts.css"]');
  await expect(css).toContainText('U+0041-0043');
  await expect(css).toContainText('U+0061-0063');

  await page.getByRole('radio', { name: '单文件' }).check({ force: true });
  await expect(page.getByText(/设置已更改，这份结果对应上一次生成/u)).toBeVisible();
  await page.getByRole('button', { name: /按新设置重新生成/u }).click();
  await expect(page.getByText(/设置已更改，这份结果对应上一次生成/u)).toHaveCount(0, {
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
});

test('签名优先：任意扩展名的合法字体可加入，伪装文件与合集被拒绝', async ({ page }) => {
  await page.goto('./');
  const valid = await import('node:fs/promises').then((fs) => fs.readFile(fixtures.latinWoff2));
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      { name: 'renamed.bin', mimeType: 'application/octet-stream', buffer: valid },
      { name: 'notes.ttf', mimeType: 'font/ttf', buffer: Buffer.from('hello, not a font') },
      {
        name: 'family.ttc',
        mimeType: 'font/collection',
        buffer: Buffer.concat([Buffer.from('ttcf'), Buffer.alloc(32)]),
      },
    ]);
  await expect(page.getByText('2 个文件未加入')).toBeVisible();
  await expect(page.getByText('不是 TTF、OTF、WOFF 或 WOFF2 字体')).toBeVisible();
  await expect(page.getByText(/TTC\/OTC 字体合集/u)).toBeVisible();
  await expect(page.getByRole('article', { name: /ABeeZee/u })).toBeVisible();
  await expect(generateButton(page)).toBeEnabled({ timeout: 30_000 });
});

test('可变字体：保留可变轴或输出多个固定款式', async ({ page }) => {
  await page.goto('./');
  await addFonts(page, fixtures.variable);
  const card = page.getByRole('article', { name: /Source Serif 4/u });
  await expect(card).toBeVisible();
  await expect(card.getByText('wght 200–900 · opsz 8–60')).toBeVisible();
  await generate(page);
  await page.getByRole('radio', { name: 'fonts.css' }).check({ force: true });
  await expect(page.locator('pre[aria-label="fonts.css"]')).toContainText('font-weight: 200 900;');

  await card.getByText('字体信息与输出设置').click();
  await card.getByRole('radio', { name: '固定款式' }).check({ force: true });
  await card.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByRole('button', { name: /按新设置重新生成/u }).click();
  await expect(page.getByText(/设置已更改/u)).toHaveCount(0, { timeout: 30_000 });
  const css = page.locator('pre[aria-label="fonts.css"]');
  await expect(css).toContainText('font-weight: 400;');
  await expect(css).toContainText('font-weight: 700;');
  await expect(css).not.toContainText('200 900');
});
