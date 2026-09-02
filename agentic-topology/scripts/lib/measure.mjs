/**
 * 估算一段文本在给定字号下的显示宽度：全角字符按 1em、其余按 0.5em。
 * 字号 MUST 由调用方按各自的 CSS 传进来——卡片名字是 12px、描述是 10.5px，
 * 共用一张宽度表会把小字那段算宽、行数算多（或反过来算少），高度就跟着错。
 */
export function textWidth(text, fontSize = 12) {
  let width = 0;
  for (const char of String(text)) {
    width += char.charCodeAt(0) > 0x2E80 ? fontSize : fontSize / 2;
  }
  return width;
}

/** 估算标签尺寸：连线标注固定 12px 字号，高度恒为 16px。 */
export function measureLabel(text) {
  return { w: textWidth(text, 12), h: 16 };
}

/**
 * 按同一套全角/半角字符宽度估算一段文本在给定容器宽度下会换成几行。
 * 换行符和其它空白一律按浏览器默认的 white-space:normal 折叠成一个空格再排版，
 * 不当成强制换行——卡片描述那栏没有设 white-space:pre-line。
 */
export function wrapLineCount(text, maxWidth, fontSize = 12) {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (!normalized) return 1;
  let lines = 1;
  let width = 0;
  for (const char of normalized) {
    const charWidth = char.charCodeAt(0) > 0x2E80 ? fontSize : fontSize / 2;
    if (width + charWidth > maxWidth) {
      lines += 1;
      width = 0;
    }
    width += charWidth;
  }
  return lines;
}
