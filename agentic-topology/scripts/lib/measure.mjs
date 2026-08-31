/** 估算标签尺寸：全角字符 12px，ASCII 字符 6px，高度恒为 16px。 */
export function measureLabel(text) {
  let width = 0;
  for (const char of String(text)) {
    width += char.charCodeAt(0) > 0x2E80 ? 12 : 6;
  }
  return { w: width, h: 16 };
}
