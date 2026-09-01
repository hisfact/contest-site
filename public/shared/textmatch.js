/**
 * 인용문 대조용 문자열 처리 — 브라우저(형식 검사)와 Worker 가 함께 쓴다.
 *
 * worker/src/scoring.js 의 normalize / longestCommonSubstring 과 같은 규칙이어야 한다.
 * (scoring.js 는 브라우저로 내려보내지 않으므로 여기 복사해 두고, 테스트가 두 쪽이 같은지 확인한다.)
 *
 * 이 파일에는 정답표와 관련된 정보가 한 글자도 없다. 기사 원문과 참가자 인용문만 비교한다.
 */

// 대조 전에 지우는 문자: 따옴표 종류 전부, 쉼표, 가운뎃점, 하이픈, 말줄임표, 공백
export const STRIP = /['"'‘’"“”`´,·\-—…\s]/gu;

export function normalize(s) {
  return (s ?? '').normalize('NFC').replace(STRIP, '');
}

/** 두 문자열의 최장 공통 부분문자열 길이 (코드포인트 단위) */
export function longestCommonSubstring(a, b) {
  const A = Array.from(a);
  const B = Array.from(b);
  if (A.length === 0 || B.length === 0) return 0;
  let best = 0;
  let prev = new Uint32Array(B.length + 1);
  let cur = new Uint32Array(B.length + 1);
  for (let i = 1; i <= A.length; i++) {
    for (let j = 1; j <= B.length; j++) {
      cur[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : 0;
      if (cur[j] > best) best = cur[j];
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return best;
}

/** 채점기가 인용 일치로 보는 최소 공통 길이. scoring.js 의 QUOTE_MIN 과 같다. */
export const QUOTE_MIN = 15;

/**
 * 인용문이 기사 원문 안에 있는지 본다. 어느 문장이 조작인지는 전혀 모른다.
 *
 * @returns {{ 포함: boolean, 공통길이: number, 충실도: number }}
 *   포함     정규화한 인용문이 기사에 그대로 들어 있는가
 *   공통길이 기사와 인용문의 최장 공통 부분문자열 길이
 *   충실도   공통길이 / 인용문 길이 (0~1). 요약·의역했으면 낮아진다
 */
export function locateQuote(quote, article) {
  const q = normalize(quote);
  const a = normalize(article);
  if (!q) return { 포함: false, 공통길이: 0, 충실도: 0 };
  if (a.includes(q)) return { 포함: true, 공통길이: Array.from(q).length, 충실도: 1 };
  const lcs = longestCommonSubstring(q, a);
  return { 포함: false, 공통길이: lcs, 충실도: lcs / Array.from(q).length };
}
