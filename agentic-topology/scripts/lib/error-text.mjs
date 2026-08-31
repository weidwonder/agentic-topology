/** 把解析/校验错误格式化成带行号的一行——FR-021 要求语法错 MUST 指出行号。 */
export function errorText(error, inputPath) {
  const where = error.line == null ? inputPath : `${inputPath}:${error.line}`;
  return `${where}  ${error.message}\n`;
}
