export const MAX_CUSTOM_TEXT_FILE_SIZE = 5 * 1024 * 1024;

export function extractImportedText(fileName: string, source: string): string {
  const normalized = source.replace(/^\uFEFF/u, '');
  if (!fileName.toLocaleLowerCase().endsWith('.html')) return normalized;

  const documentValue = new DOMParser().parseFromString(normalized, 'text/html');
  for (const element of documentValue.querySelectorAll('script, style, template, noscript')) {
    element.remove();
  }
  return documentValue.body.textContent;
}

export async function readCustomTextFile(file: File): Promise<string> {
  if (file.size > MAX_CUSTOM_TEXT_FILE_SIZE) {
    throw new Error('自定义文本文件不能超过 5 MB');
  }
  if (!/\.(?:txt|md|html)$/iu.test(file.name)) {
    throw new Error('只支持 .txt、.md 或 .html 文本文件');
  }
  try {
    return extractImportedText(file.name, await file.text());
  } catch (error: unknown) {
    if (error instanceof Error && /不能超过|只支持/u.test(error.message)) throw error;
    throw new Error('读取自定义文本文件失败', { cause: error });
  }
}
