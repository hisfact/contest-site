/**
 * Worker — 서버가 할 일 전부
 *
 *   POST /api/submit    팀 코드 확인 → 시도 횟수 확인 → 스키마 검증 → 채점 → 저장 → 점수만 반환
 *   GET  /api/status    그 팀의 회차별 제출 여부와 남은 시도
 *   GET  /api/board     리더보드 (마감 전 = 진행 현황만, 마감 후 = 전체 순위)
 *   GET  /api/admin/*   ADMIN_KEY 필요
 *
 * ── 이 파일은 뼈대다. TODO 를 채우면 된다. ──
 *
 * 절대 어기지 말 것
 *   1. 정답표를 응답에 담지 않는다. 문항별 정오도 마감 전에는 담지 않는다.
 *   2. 시도 횟수는 서버가 센다. 클라이언트가 보낸 회차 번호를 그대로 믿지 않는다.
 *   3. 팀 코드는 HTTP 헤더가 아니라 JSON 본문으로 받는다. 헤더는 ASCII 만 담긴다.
 *   4. 팀마다 파일 하나(teams/<코드>.json)에만 쓴다. 공용 파일을 고치면 마감 직전에 409 가 난다.
 */

import { score, weighted, compareTeams } from './scoring.js';

const GH = 'https://api.github.com';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOW_ORIGIN ?? '*',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      if (url.pathname === '/api/submit' && request.method === 'POST')
        return json(await handleSubmit(request, env), cors);
      if (url.pathname === '/api/status')
        return json(await handleStatus(url, env), cors);
      if (url.pathname === '/api/board')
        return json(await handleBoard(env, ctx), cors);
      return json({ error: 'not found' }, cors, 404);
    } catch (e) {
      return json({ error: String(e.message ?? e) }, cors, e.status ?? 500);
    }
  },
};

const json = (body, headers, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

const fail = (status, message) => Object.assign(new Error(message), { status });

/** 하이픈·대소문자 흔들림을 흡수한다. 학생이 종이에서 옮겨 적기 때문이다. */
export const normalizeCode = (s) => (s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

// ────────────────────────────────────────────── GitHub 저장소 B 읽고 쓰기

async function ghGet(env, path) {
  const r = await fetch(`${GH}/repos/${env.PRIVATE_REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'contest-api', Accept: 'application/vnd.github+json' },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw fail(502, `GitHub 읽기 실패 ${r.status}`);
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(atob(j.content.replace(/\n/g, ''))) };
}

async function ghPut(env, path, obj, sha, message) {
  // TODO 한글이 들어가므로 btoa 로는 안 된다. TextEncoder 로 UTF-8 바이트를 만든 뒤 base64 로 바꿀 것.
  const bytes = new TextEncoder().encode(JSON.stringify(obj, null, 1));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const r = await fetch(`${GH}/repos/${env.PRIVATE_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'contest-api', 'content-type': 'application/json' },
    body: JSON.stringify({ message, content: btoa(bin), ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) throw fail(502, `GitHub 쓰기 실패 ${r.status}`);
}

// ────────────────────────────────────────────── 핸들러

async function handleSubmit(request, env) {
  const body = await request.json();
  const code = normalizeCode(body.팀코드);

  // 1) 팀 확인
  const teams = await ghGet(env, env.TEAMS_PATH);
  if (!teams?.data.팀[code]) throw fail(403, '등록되지 않은 팀 코드입니다.');

  // 2) 이 팀의 기존 기록
  const file = `teams/${code}.json`;
  const existing = await ghGet(env, file);
  const record = existing?.data ?? { 코드: code, 제출: {} };

  // 3) 회차 결정 — 클라이언트가 보낸 조건을 믿지 않고 서버가 정한다
  // TODO body.result.meta.조건 이 1차인지 2차인지만 보고,
  //      2차라면 record.제출 에 이미 있는 2차 회차 수로 다음 회차를 서버가 매긴다.
  //      MAX_ATTEMPTS_2 를 넘으면 429.
  const round = null; // TODO

  // 4) 스키마 검증
  // TODO src/schema.json 으로 검증한다. 실패하면 400 과 함께 어디가 틀렸는지 돌려준다.
  //      모델 패턴(Solar Pro 4)도 여기서 걸린다.

  // 5) 채점
  const key = await ghGet(env, env.ANSWER_KEY_PATH);
  const r = score(body.result, key.data);

  // 6) 저장 — 이 팀 파일 하나만 쓴다
  record.제출[round] = {
    원점수: r.총점,
    가중점수: weighted(round, r.총점),
    적발: r.적발, 인용일치: r.인용일치, 오탐: r.오탐, 판단불가: r.판단불가,
    제출시각: new Date().toISOString(),
    지침원문: body.result.meta.지침원문 ?? '',
    detail: r.detail,          // 마감 후 공개용. 응답에는 담지 않는다
    raw: body.result,          // 원본 보존
  };
  await ghPut(env, file, record, existing?.sha, `제출 ${code} ${round}`);

  // 7) 반환 — 점수 하나뿐이다
  //    문항별 정오를 돌려주면 한 문항씩 바꿔가며 36번 제출해 정답표를 역산할 수 있다.
  return {
    회차: round,
    점수: r.총점,
    가중점수: weighted(round, r.총점),
    남은시도: null, // TODO
    안내: '어느 문항을 맞혔는지는 대회 종료 후 공개됩니다.',
  };
}

async function handleStatus(url, env) {
  const code = normalizeCode(url.searchParams.get('code'));
  // TODO 그 팀 파일을 읽어 회차별 제출 여부와 남은 시도만 돌려준다. 점수는 본인 것이므로 담아도 된다.
  return { 코드: code, 제출: {}, 남은시도: {} };
}

async function handleBoard(env, ctx) {
  // TODO teams/ 를 나열해 30개를 읽어 합친다. 60초 캐시를 건다 (caches.default 또는 KV).
  //      마감 전  → 팀명과 회차별 제출 여부만. 점수 금지
  //      마감 후  → compareTeams 로 정렬한 전체 순위
  const past = Date.now() > Date.parse(env.DEADLINE_ISO);
  return { 마감후: past, 행: [] };
}
