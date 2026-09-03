/**
 * 线上标注要在一条曲线上放得下，所以「靠什么交过去」只能用一个字符表示。
 * 这里是那一个字符的唯一出处——布局算宽度、渲染画清单、页面画状态栏都取它，
 * 三处各写一份就会出现「线上是 📄、清单里是 📁」这种对不上的情况。
 */
export const CARRIER_MARK = {
  file: '📄',
  bundle: '📦',
  prompt: '💬',
  event: '⚡',
  other: '•',
};

/** 形态比交法多一档：接口本身是一份信息，但没人能把接口当载体交出去。 */
export const FORM_MARK = { ...CARRIER_MARK, interface: '🔌' };

/** 线上一条线最多列几份，超出的收成「等 N 份」。放不下的时候图就没法看了。 */
export const LABEL_MAX_ITEMS = 3;

/** 信息名超过这个字数，线上截断加省略号；浮层与清单给全名。 */
export const LABEL_MAX_NAME = 10;

const MORE_TEXT = {
  zh: (total) => `等 ${total} 份`,
  en: (total) => `+${total} total`,
};

/**
 * 线上标注：每份信息的交法小标 + 名字，按引用顺序排列。
 * 至多列 LABEL_MAX_ITEMS 份，超出时补一句「等 N 份」，N 是这条线引用的**总**份数
 * ——写成「还有 N 份」会让人以为总数是 3+N。
 */
export function edgeLabel(edge, infoById, lang = 'zh') {
  const refs = Array.isArray(edge?.payloads) ? edge.payloads : [];
  const parts = refs.slice(0, LABEL_MAX_ITEMS).map((ref) => {
    const name = String(infoById.get(ref?.info)?.name ?? ref?.info ?? '');
    const shown = [...name].length > LABEL_MAX_NAME
      ? `${[...name].slice(0, LABEL_MAX_NAME).join('')}…`
      : name;
    // 小标取这条引用自己的交法：同一条线上几份可以各不相同。
    return `${CARRIER_MARK[ref?.carrier] || CARRIER_MARK.other} ${shown}`;
  });
  if (refs.length > LABEL_MAX_ITEMS) parts.push((MORE_TEXT[lang] || MORE_TEXT.zh)(refs.length));
  return parts.join('  ');
}
