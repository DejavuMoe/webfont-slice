// @vitest-environment jsdom

import { expect, it } from 'vitest';
import { extractImportedText } from './text-import';

it('HTML 导入只保留可见文本并排除脚本与样式源码', () => {
  const text = extractImportedText(
    'article.html',
    '<style>.hidden{display:none}</style><h1>天地</h1><script>evil()</script><p>玄黄</p>',
  );
  expect(text).toContain('天地');
  expect(text).toContain('玄黄');
  expect(text).not.toContain('evil');
  expect(text).not.toContain('display');
});

it('纯文本只移除 BOM', () => {
  expect(extractImportedText('article.md', '\uFEFF# 标题')).toBe('# 标题');
});
