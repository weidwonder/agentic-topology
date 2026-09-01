/** 估算标签尺寸：全角字符 12px，ASCII 字符 6px，高度恒为 16px。 */
export function measureLabel(text) {
  let width = 0;
  for (const char of String(text)) {
    width += char.charCodeAt(0) > 0x2E80 ? 12 : 6;
  }
  return { w: width, h: 16 };
}

/**
 * 按同一套全角/半角字符宽度估算一段文本在给定容器宽度下会换成几行。
 * 换行符和其它空白一律按浏览器默认的 white-space:normal 折叠成一个空格再排版，
 * 不当成强制换行——卡片描述那栏没有设 white-space:pre-line。
 */
export function wrapLineCount(text, maxWidth) {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (!normalized) return 1;
  let lines = 1;
  let width = 0;
  for (const char of normalized) {
    const charWidth = char.charCodeAt(0) > 0x2E80 ? 12 : 6;
    if (width + charWidth > maxWidth) {
      lines += 1;
      width = 0;
    }
    width += charWidth;
  }
  return lines;
}
