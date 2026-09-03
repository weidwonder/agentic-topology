// 收件：把一批待处理的单据整理成一份清单，算好指纹交给下一步。
export type Docket = { files: string[]; fingerprint: string };

export function buildDocket(dir: string): Docket {
  const files = listFiles(dir);
  return { files, fingerprint: hashAll(files) };
}

// 交给 router 的就是 buildDocket 造出来的那个对象本身，没有重新拼装。
export function handOff(dir: string) {
  const docket = buildDocket(dir);
  return route(docket);
}
