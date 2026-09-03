// 通知：给使用者发一条消息。这里也有个叫 "报告" 的东西，
// 但它是从模板现拼的一句话，跟 summarise 造的那份报告没有关系。
export function notify(total: number) {
  const report = `本轮处理了 ${total} 份`;   // 同名，不同物
  return send(report);
}
