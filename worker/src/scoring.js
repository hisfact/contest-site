/**
 * 채점 로직 — AI 동행 프로젝트 책임/안전 분과 해커톤 대회
 *
 * 이 파일은 Worker와 테스트가 함께 쓴다. 브라우저로는 절대 내려보내지 않는다
 * (정답표를 인자로 받으므로 이 파일 자체에 비밀은 없지만, 호출부가 정답표를 갖는다).
 *
 * 기준: 관리대장/A_대회용_정답표.json (2026-09-01 판)
 * 검증: test/score.test.js — 골든테스트 14건과 기대 점수가 정확히 일치해야 한다.
 */

// 인용 대조 전에 지우는 문자. 학생이 JSON 안전을 위해 따옴표를 바꿔 적어도
// 감점되지 않게 하려는 것이 목적이다. 하나라도 빼면 골든테스트가 깨진다.
const STRIP = /['"'‘’"“”`´,·\-—…\s]/gu;

/** NFC 정규화 후 대조 제외 문자를 모두 제거한다. */
export function normalize(s) {
  return (s ?? '').normalize('NFC').replace(STRIP, '');
}

/** 두 문자열의 최장 공통 부분문자열 길이. (파이썬 SequenceMatcher.find_longest_match 와 동일) */
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

export const QUOTE_MIN = 15;

/** 참가자 인용이 정답표의 조작 문장과 일치하는가. */
export function quoteMatches(submitted, truth) {
  const a = normalize(submitted);
  const b = normalize(truth);
  if (!a || !b) return false;
  return longestCommonSubstring(a, b) >= QUOTE_MIN;
}

/**
 * 제출본 하나를 채점한다.
 *
 * @param {{meta:object, answers:Array}} submission  스키마 검증을 이미 통과한 제출본
 * @param {object} key  answer_key.json 전문
 * @returns 총점과 집계. 문항별 정오는 detail 에만 담기며, 마감 전에는 반환하지 않는다.
 */
export function score(submission, key) {
  const byNo = new Map(key.문항.map((q) => [q.번호, q]));
  const rules = key.채점규칙;
  const UNKNOWN = rules['가짜→판단불가']; // 진짜→판단불가 와 같은 값이다
  const traps = new Set(key.오인주의_문항 ?? []);

  let total = 0;
  let detected = 0;      // 가짜를 가짜로 맞힌 수
  let quoteHits = 0;     // 그중 인용까지 일치한 수
  let falsePositives = 0;// 진짜를 가짜라고 한 수
  let unknowns = 0;      // 판단 불가 수
  let realHits = 0;      // 진짜를 진짜로 맞힌 수
  let fakeTotal = 0;
  let realTotal = 0;

  const byDifficulty = {};
  const byType = {};
  const detail = [];

  for (const a of submission.answers) {
    const q = byNo.get(a.번호);
    if (!q) throw new Error(`정답표에 없는 번호: ${a.번호}`);

    const truthIsFake = q.정답 === '가짜';
    if (truthIsFake) fakeTotal++; else realTotal++;

    let points = 0;
    let quoteOk = null;

    if (a.판정 === '판단 불가') {
      points = UNKNOWN;
      unknowns++;
    } else if (!truthIsFake) {
      if (a.판정 === '진짜') { points = rules['진짜→진짜']; realHits++; }
      else { points = rules['진짜→가짜']; falsePositives++; }
    } else {
      if (a.판정 === '가짜') {
        detected++;
        // 자유 유형은 조작이 한 문장에 있지 않으므로 인용 대조에서 제외한다.
        const needsQuote = q.인용채점 !== false;
        quoteOk = needsQuote ? quoteMatches(a.인용, q.조작문장) : true;
        points = quoteOk ? rules['가짜→가짜(인용일치)'] : rules['가짜→가짜(인용불일치)'];
        if (quoteOk) quoteHits++;
      } else {
        points = rules['가짜→진짜'];
      }
    }

    total += points;

    if (truthIsFake) {
      const d = q.난이도 ?? '?';
      const t = q.유형 ?? '?';
      (byDifficulty[d] ??= { hit: 0, total: 0 }).total++;
      (byType[t] ??= { hit: 0, total: 0 }).total++;
      if (a.판정 === '가짜') { byDifficulty[d].hit++; byType[t].hit++; }
    }

    detail.push({
      번호: a.번호,
      정답: q.정답,
      판정: a.판정,
      점수: points,
      인용일치: quoteOk,
      오인주의: traps.has(a.번호),
      함정: q.함정 === true,
    });
  }

  return {
    총점: Math.round(total * 100) / 100,
    만점: submission.answers.length,
    적발: detected,
    가짜문항수: fakeTotal,
    인용일치: quoteHits,
    오탐: falsePositives,
    판단불가: unknowns,
    진짜정답: realHits,
    진짜문항수: realTotal,
    난이도별: byDifficulty,
    유형별: byType,
    detail, // 마감 전에는 학생에게 반환하지 않는다
  };
}

/** 회차 계수. 2차 세 시도 중 가중 점수가 가장 높은 회차를 최종 점수로 삼는다. */
export const ROUND_WEIGHT = { '2차-1': 1.0, '2차-2': 0.95, '2차-3': 0.9 };

export function weighted(round, raw) {
  const w = ROUND_WEIGHT[round];
  if (w === undefined) return null; // 1차는 순위에 반영하지 않는다
  return Math.round(raw * w * 100) / 100;
}

/**
 * 리더보드 정렬. 위에서부터 차례로 적용한다.
 *   1) 최종 가중 점수 높은 순
 *   2) 인용 일치 많은 순  — 찍어서 맞힌 쪽보다 찾아서 맞힌 쪽이 위
 *   3) 오탐 적은 순        — 함정에 걸리지 않은 쪽이 위
 *   4) 먼저 제출한 순      — 서버 시각. 브라우저 시각은 믿지 않는다
 */
export function compareTeams(a, b) {
  return (
    (b.최종점수 - a.최종점수) ||
    (b.인용일치 - a.인용일치) ||
    (a.오탐 - b.오탐) ||
    (a.제출시각 - b.제출시각)
  );
}
