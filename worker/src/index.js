/**
 * Worker — 서버가 할 일 전부
 *
 *   POST /api/submit          팀 코드 확인 → 시도 횟수 확인 → 스키마 검증 → 채점 → 저장 → 점수만 반환
 *   GET  /api/status?code=    그 팀의 회차별 제출 여부·점수와 남은 시도 (POST {팀코드} 도 받는다)
 *                             마감 후에는 그 팀의 순위·최종 점수·문항별 정오(결과)도 함께 — 본인 것만
 *   POST /api/board           전체 리더보드 (마감 전 = 진행 현황, 마감 후 = 전체 순위). 관리키 필요. 60초 캐시
 *                             학생에게는 열지 않는다 — 전체 결과는 운영자가 결과 발표 화면(reveal.html)에서만 보여 준다
 *   POST /api/admin/overview  전체 기록                       ┐
 *   POST /api/admin/teams     팀명 일괄 입력                   │ 본문에 관리키 필요
 *   POST /api/admin/deadline  마감 강제 전환 (true/false/null) │
 *   POST /api/admin/reopen    특정 팀의 한 회차를 취소해 다시 낼 수 있게 함 ┘
 *
 * 절대 어기지 말 것
 *   1. 정답표를 응답에 담지 않는다. 문항별 정오도 마감 전에는 담지 않는다.
 *   2. 시도 횟수는 서버가 센다. 클라이언트가 보낸 회차 번호를 그대로 믿지 않는다.
 *   3. 팀 코드는 HTTP 헤더가 아니라 JSON 본문으로 받는다. 헤더는 ASCII 만 담긴다.
 *   4. 팀마다 파일 하나(teams/<코드>.json)에만 쓴다. 공용 파일을 고치면 마감 직전에 409 가 난다.
 *
 * 저장소 B 의 파일
 *   answer_key.json     정답표 (읽기만)
 *   teams.json          코드↔팀명 (운영자만 쓴다)
 *   teams/<코드>.json   { 코드, 제출: { '1차': {...}, '2차-1': {...} }, 취소: [ {...운영자가 취소한 회차} ] }
 *   state.json          { 마감: true | false | null }  null 이면 DEADLINE_ISO 를 따른다
 */

import { score, weighted, compareTeams, ROUND_WEIGHT } from './scoring.js';
import { checkSubmission, phaseOf } from '../../public/shared/validate.js';
import schema from '../../public/shared/schema.js';

const GH = 'https://api.github.com';
const STATE_PATH = 'state.json';
const BOARD_CACHE_KEY = 'https://contest-api.internal/board';
const BOARD_TTL = 60;

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
      const p = url.pathname;
      if (p === '/api/submit' && request.method === 'POST')
        return json(await handleSubmit(await readBody(request), env), cors);
      if (p === '/api/status')
        return json(await handleStatus(request.method === 'POST' ? (await readBody(request)).팀코드 : url.searchParams.get('code'), env, ctx), cors);
      if (p === '/api/board' && request.method === 'POST') {
        // 전체 순위는 관리키가 있어야 본다. 학생은 /api/status 로 자기 결과만 본다.
        const body = await readBody(request);
        if (!env.ADMIN_KEY) throw fail(500, 'ADMIN_KEY 가 설정되지 않았습니다.');
        if (!(await sameSecret(body?.관리키, env.ADMIN_KEY))) throw fail(401, '관리키가 맞지 않습니다.');
        return json(await handleBoard(env, ctx), cors, 200, { 'cache-control': 'no-store' });
      }
      if (p.startsWith('/api/admin/') && request.method === 'POST')
        return json(await handleAdmin(p.slice('/api/admin/'.length), await readBody(request), env), cors);
      if (p === '/api/health') return json({ ok: true, 시각: new Date().toISOString() }, cors);
      return json({ error: 'not found' }, cors, 404);
    } catch (e) {
      const status = e.status ?? 500;
      if (status >= 500) console.error(e);
      return json({ error: String(e.message ?? e), ...(e.detail ? { detail: e.detail } : {}) }, cors, status);
    }
  },
};

const json = (body, headers, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers, ...extra },
  });

const fail = (status, message, detail) => Object.assign(new Error(message), { status, ...(detail ? { detail } : {}) });

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw fail(400, '요청 본문이 JSON 이 아닙니다.');
  }
}

/** 하이픈·대소문자 흔들림을 흡수한다. 학생이 종이에서 옮겨 적기 때문이다. */
export const normalizeCode = (s) => (s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ────────────────────────────────────────────── UTF-8 안전 base64

/** 한글이 들어가므로 btoa 직접 호출은 깨진다. TextEncoder 로 바이트를 만든 뒤 base64 로 바꾼다. */
export function encodeUtf8Base64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function decodeUtf8Base64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ────────────────────────────────────────────── GitHub 저장소 B 읽고 쓰기

function ghHeaders(env, extra = {}) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'User-Agent': 'contest-api',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra,
  };
}

/** 파일 하나. 없으면 null. */
async function ghGet(env, path) {
  const r = await fetch(`${GH}/repos/${env.PRIVATE_REPO}/contents/${path}`, { headers: ghHeaders(env) });
  if (r.status === 404) return null;
  if (!r.ok) throw fail(502, `GitHub 읽기 실패 ${r.status} (${path})`);
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(decodeUtf8Base64(j.content)) };
}

/** 디렉터리 목록. 없으면 빈 배열. */
async function ghList(env, dir) {
  const r = await fetch(`${GH}/repos/${env.PRIVATE_REPO}/contents/${dir}`, { headers: ghHeaders(env) });
  if (r.status === 404) return [];
  if (!r.ok) throw fail(502, `GitHub 목록 실패 ${r.status} (${dir})`);
  const j = await r.json();
  return Array.isArray(j) ? j.filter((e) => e.type === 'file' && e.name.endsWith('.json')).map((e) => e.name) : [];
}

/** 파일 쓰기. sha 가 어긋나면(동시 수정) 409. */
async function ghPut(env, path, obj, sha, message) {
  const r = await fetch(`${GH}/repos/${env.PRIVATE_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: ghHeaders(env, { 'content-type': 'application/json' }),
    body: JSON.stringify({ message, content: encodeUtf8Base64(JSON.stringify(obj, null, 1)), ...(sha ? { sha } : {}) }),
  });
  if (r.status === 409 || r.status === 422) throw fail(409, '같은 팀의 제출이 동시에 들어왔습니다. 잠시 후 다시 시도하세요.');
  if (!r.ok) throw fail(502, `GitHub 쓰기 실패 ${r.status} (${path})`);
}

// ────────────────────────────────────────────── 공통

async function loadTeams(env) {
  const t = await ghGet(env, env.TEAMS_PATH);
  if (!t) throw fail(500, '팀 명부(teams.json)를 찾을 수 없습니다.');
  return t;
}

function teamLabel(entry, code) {
  if (entry?.팀명) return entry.팀명;
  if (entry?.순번) return `${entry.순번}번 팀`;
  return code;
}

/** 마감 여부. state.json 의 강제값이 있으면 그것, 없으면 DEADLINE_ISO. */
async function deadlineInfo(env) {
  const state = (await ghGet(env, STATE_PATH))?.data ?? {};
  const iso = env.DEADLINE_ISO ?? '';
  const t = Date.parse(iso);
  const auto = Number.isFinite(t) ? Date.now() > t : false;
  const forced = typeof state.마감 === 'boolean' ? state.마감 : null;
  return { 마감후: forced ?? auto, 마감시각: Number.isFinite(t) ? new Date(t).toISOString() : null, 강제: forced };
}

/** 회차별 상한. 서버 설정값이며 클라이언트를 믿지 않는다. */
function limits(env) {
  return { '1차': num(env.MAX_ATTEMPTS_1, 1), '2차': num(env.MAX_ATTEMPTS_2, 3) };
}

/** 회차 계수. 정해진 회차는 scoring.js 의 표를 따르고, 1차는 순위에 반영하지 않으므로 null. */
export function weightOf(round) {
  if (round in ROUND_WEIGHT) return ROUND_WEIGHT[round];
  return null;
}

/**
 * 다음 회차를 서버가 정한다. 클라이언트가 보낸 조건은 1차/2차 구분만 본다.
 * 1차는 '1차' 한 칸, 2차는 '2차-1' … '2차-N' 중 비어 있는 첫 칸 (운영자가 취소한 칸이면 그 칸이 다시 열린다).
 * @returns {{round:string|null, remaining:{'1차':number,'2차':number}}}
 */
export function nextRound(phase, record, env) {
  const lim = limits(env);
  const rounds = Object.keys(record.제출 ?? {});
  const used = { '1차': rounds.filter((r) => phaseOf(r) === '1차').length, '2차': rounds.filter((r) => phaseOf(r) === '2차').length };
  const remaining = { '1차': Math.max(0, lim['1차'] - used['1차']), '2차': Math.max(0, lim['2차'] - used['2차']) };
  let round = null;
  if (remaining[phase] > 0) {
    if (phase === '1차') round = '1차';
    else for (let n = 1; n <= lim['2차']; n++) if (!record.제출?.[`2차-${n}`]) { round = `2차-${n}`; break; }
  }
  return { round, remaining };
}

/** 팀 기록에서 순위용 최종 점수를 뽑는다. 2차 회차 중 가중 점수가 가장 높은 것. */
export function finalOf(record) {
  let best = null;
  for (const [round, s] of Object.entries(record.제출 ?? {})) {
    if (phaseOf(round) !== '2차') continue;
    const w = s.가중점수 ?? weighted(round, s.원점수);
    if (w === null || w === undefined) continue;
    if (!best || w > best.최종점수 || (w === best.최종점수 && Date.parse(s.제출시각) < best.제출시각))
      best = { 채택회차: round, 원점수: s.원점수, 계수: weightOf(round), 최종점수: w, 인용일치: s.인용일치, 오탐: s.오탐, 적발: s.적발, 판단불가: s.판단불가, 제출시각: Date.parse(s.제출시각), detail: s.detail ?? [] };
  }
  return best;
}

// ────────────────────────────────────────────── 제출

async function handleSubmit(body, env) {
  const code = normalizeCode(body?.팀코드);
  if (code.length < 6) throw fail(400, '팀 코드를 입력하세요.');

  // 1) 팀 확인
  const teams = await loadTeams(env);
  const entry = teams.data.팀?.[code];
  if (!entry) throw fail(403, '등록되지 않은 팀 코드입니다.');

  // 2) 마감
  const dl = await deadlineInfo(env);
  if (dl.마감후) throw fail(403, '마감되었습니다. 더 이상 제출할 수 없습니다.');

  // 3) 형식 검증 — 회차를 정하기 전에 조건(1차/2차)이 읽혀야 한다
  const result = body.result;
  if (!result || typeof result !== 'object') throw fail(400, 'result 가 없습니다.');
  const phase = typeof result.meta?.조건 === 'string' ? phaseOf(result.meta.조건) : null;
  const { errors } = checkSubmission(schema, result, { setLetter: (env.SET_NAME ?? 'A')[0] });
  if (errors.length) throw fail(400, '형식 검사에 실패했습니다.', errors);

  // 4) 이 팀의 기존 기록과 회차 — 서버가 정한다
  const file = `teams/${code}.json`;
  const existing = await ghGet(env, file);
  const record = existing?.data ?? { 코드: code, 제출: {} };
  const { round, remaining } = nextRound(phase, record, env);
  if (!round) throw fail(429, `${phase} 제출 횟수를 모두 사용했습니다.`, { 남은시도: remaining });

  // 5) 채점
  const key = await ghGet(env, env.ANSWER_KEY_PATH);
  if (!key) throw fail(500, '정답표를 찾을 수 없습니다.');
  const r = score(result, key.data);
  const w = weightOf(round) === null ? null : Math.round(r.총점 * weightOf(round) * 100) / 100;

  // 6) 저장 — 이 팀 파일 하나만 쓴다
  const now = new Date().toISOString();
  record.제출[round] = {
    원점수: r.총점,
    가중점수: w,
    적발: r.적발, 인용일치: r.인용일치, 오탐: r.오탐, 판단불가: r.판단불가,
    제출시각: now,
    조건표기: result.meta.조건,
    웹검색: result.meta.웹검색 === true,
    지침원문: result.meta.지침원문 ?? '',
    detail: r.detail,          // 마감 후 공개용. 응답에는 담지 않는다
    raw: result,               // 원본 보존
  };
  await ghPut(env, file, record, existing?.sha, `제출 ${code} ${round}`);

  // 7) 반환 — 점수 하나뿐이다
  //    문항별 정오를 돌려주면 한 문항씩 바꿔가며 36번 제출해 정답표를 역산할 수 있다.
  const after = nextRound(phase, record, env).remaining;
  return {
    회차: round,
    점수: r.총점,
    만점: r.만점,
    가중점수: w,
    계수: weightOf(round),
    제출시각: now,
    남은시도: after,
    안내: phase === '1차'
      ? '1차는 순위에 반영되지 않습니다. 어느 문항을 맞혔는지는 대회 종료 후 공개됩니다.'
      : '어느 문항을 맞혔는지는 대회 종료 후 공개됩니다.',
  };
}

// ────────────────────────────────────────────── 상태

async function handleStatus(rawCode, env, ctx) {
  const code = normalizeCode(rawCode);
  if (code.length < 6) throw fail(400, '팀 코드를 입력하세요.');
  const teams = await loadTeams(env);
  const entry = teams.data.팀?.[code];
  if (!entry) throw fail(403, '등록되지 않은 팀 코드입니다.');

  const record = (await ghGet(env, `teams/${code}.json`))?.data ?? { 코드: code, 제출: {} };
  const dl = await deadlineInfo(env);
  const 제출 = {};
  for (const [round, s] of Object.entries(record.제출)) {
    제출[round] = { 점수: s.원점수, 가중점수: s.가중점수, 계수: weightOf(round), 제출시각: s.제출시각, 웹검색: s.웹검색 ?? null };
  }
  const n1 = nextRound('1차', record, env);
  const n2 = nextRound('2차', record, env);

  // 마감 후 — 이 팀의 순위와 문항별 정오. 다른 팀 것은 담지 않는다.
  let 결과;
  if (dl.마감후) {
    const board = await handleBoard(env, ctx);
    const row = board.행?.find((r) => r.코드 === code);
    if (!row) 결과 = null; // 2차 제출이 없어 순위가 없다
    else {
      const byNo = new Map((board.문항 ?? []).map((q) => [q.번호, q]));
      const { 코드: _c, 회차별: _r, 문항별, ...rest } = row;
      결과 = {
        ...rest,
        팀수: board.행.length,
        문항별: (문항별 ?? []).map((d) => { const q = byNo.get(d.번호) ?? {}; return { 번호: d.번호, 제목: q.제목 ?? '', 정답: q.정답 ?? null, 난이도: q.난이도 ?? null, 유형: q.유형 ?? null, 함정: q.함정 === true, 판정: d.판정, 점수: d.점수, 인용일치: d.인용일치 }; }),
      };
    }
  }
  return {
    코드: code,
    코드표기: entry.코드표기 ?? code,
    팀명: teamLabel(entry, code),
    이메일: entry.이메일 ?? '',
    순번: entry.순번 ?? null,
    제출,
    남은시도: n1.remaining,
    다음회차: { '1차': n1.round, '2차': n2.round },
    마감후: dl.마감후,
    마감시각: dl.마감시각,
    서버시각: new Date().toISOString(),
    ...(dl.마감후 ? { 결과 } : {}),
  };
}

// ────────────────────────────────────────────── 리더보드

async function loadAllRecords(env) {
  const names = await ghList(env, 'teams');
  const files = await Promise.all(names.map((n) => ghGet(env, `teams/${n}`)));
  const map = {};
  for (const f of files) if (f?.data?.코드) map[f.data.코드] = f.data;
  return map;
}

async function handleBoard(env, ctx) {
  const cache = globalThis.caches?.default;
  const cacheReq = new Request(BOARD_CACHE_KEY);
  if (cache) {
    const hit = await cache.match(cacheReq);
    if (hit) return await hit.json();
  }
  const body = await buildBoard(env);
  if (cache) {
    const res = new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${BOARD_TTL}` } });
    const put = cache.put(cacheReq, res);
    ctx?.waitUntil ? ctx.waitUntil(put) : await put;
  }
  return body;
}

async function purgeBoardCache() {
  const cache = globalThis.caches?.default;
  if (cache) await cache.delete(new Request(BOARD_CACHE_KEY));
}

export async function buildBoard(env) {
  const [teams, records, dl] = await Promise.all([loadTeams(env), loadAllRecords(env), deadlineInfo(env)]);
  const entries = Object.entries(teams.data.팀 ?? {}).sort((a, b) => (a[1].순번 ?? 0) - (b[1].순번 ?? 0));
  const generated = new Date().toISOString();

  if (!dl.마감후) {
    // 마감 전 — 팀명과 회차별 제출 여부만. 점수 금지.
    const 행 = entries.map(([code, e]) => {
      const rec = records[code];
      const rounds = Object.keys(rec?.제출 ?? {});
      const last = rounds.map((r) => rec.제출[r].제출시각).sort().at(-1) ?? null;
      return {
        코드: code,
        순번: e.순번 ?? null,
        팀명: teamLabel(e, code),
        제출: { '1차': rounds.includes('1차'), '2차-1': rounds.includes('2차-1'), '2차-2': rounds.includes('2차-2'), '2차-3': rounds.includes('2차-3') },
        제출수: rounds.length,
        마지막제출: last,
      };
    });
    return { 마감후: false, 마감시각: dl.마감시각, 강제: dl.강제, 생성시각: generated, 팀수: 행.length, 제출건수: 행.reduce((s, r) => s + r.제출수, 0), 행 };
  }

  // 마감 후 — 전체 공개
  const key = (await ghGet(env, env.ANSWER_KEY_PATH))?.data;
  const qinfo = (key?.문항 ?? []).map((q) => ({ 번호: q.번호, 정답: q.정답, 난이도: q.난이도 ?? '?', 유형: q.유형 ?? '?', 함정: q.함정 === true, 제목: q.제목 ?? '' }));
  const byNo = new Map(qinfo.map((q) => [q.번호, q]));

  const ranked = [];
  const unranked = [];
  const perQ = new Map(qinfo.map((q) => [q.번호, { 응답: 0, 정답: 0, 인용일치: 0, 판단불가: 0 }]));
  const perD = {};

  for (const [code, e] of entries) {
    const rec = records[code] ?? { 제출: {} };
    const fin = finalOf(rec);
    const first = rec.제출?.['1차'];
    const row = {
      코드: code,
      순번: e.순번 ?? null,
      팀명: teamLabel(e, code),
      '1차점수': first?.원점수 ?? null,
      제출수: Object.keys(rec.제출 ?? {}).length,
    };
    if (!fin) { unranked.push(row); continue; }
    Object.assign(row, {
      채택회차: fin.채택회차, 원점수: fin.원점수, 계수: fin.계수, 최종점수: fin.최종점수,
      적발: fin.적발, 인용일치: fin.인용일치, 오탐: fin.오탐, 판단불가: fin.판단불가,
      제출시각: new Date(fin.제출시각).toISOString(),
      문항별: fin.detail.map((d) => ({ 번호: d.번호, 판정: d.판정, 점수: d.점수, 인용일치: d.인용일치 })),
      회차별: Object.fromEntries(Object.entries(rec.제출).map(([r, s]) => [r, { 원점수: s.원점수, 가중점수: s.가중점수, 제출시각: s.제출시각 }])),
    });
    ranked.push({ ...row, _t: fin.제출시각 });
    for (const d of fin.detail) {
      const s = perQ.get(d.번호);
      if (!s) continue;
      s.응답++;
      const q = byNo.get(d.번호);
      const correct = q && d.판정 === q.정답;
      if (correct) s.정답++;
      if (d.인용일치 === true) s.인용일치++;
      if (d.판정 === '판단 불가') s.판단불가++;
      if (q?.정답 === '가짜') {
        const dd = (perD[q.난이도] ??= { 응답: 0, 적발: 0 });
        dd.응답++;
        if (correct) dd.적발++;
      }
    }
  }
  ranked.sort((a, b) => compareTeams({ ...a, 제출시각: a._t }, { ...b, 제출시각: b._t }));
  const 행 = ranked.map((r, i) => { const { _t, ...rest } = r; return { 순위: i + 1, ...rest }; });

  return {
    마감후: true,
    마감시각: dl.마감시각,
    강제: dl.강제,
    생성시각: generated,
    팀수: entries.length,
    행,
    미채점: unranked,
    문항: qinfo.map((q) => {
      const s = perQ.get(q.번호);
      return { ...q, 응답: s.응답, 정답률: s.응답 ? Math.round((s.정답 / s.응답) * 1000) / 10 : null, 인용일치율: q.정답 === '가짜' && s.응답 ? Math.round((s.인용일치 / s.응답) * 1000) / 10 : null, 판단불가: s.판단불가 };
    }),
    난이도별: Object.fromEntries(Object.entries(perD).map(([d, s]) => [d, { 응답: s.응답, 적발: s.적발, 적발률: s.응답 ? Math.round((s.적발 / s.응답) * 1000) / 10 : null }])),
  };
}

// ────────────────────────────────────────────── 운영자

async function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const A = new Uint8Array(ha), B = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

async function handleAdmin(action, body, env) {
  if (!env.ADMIN_KEY) throw fail(500, 'ADMIN_KEY 가 설정되지 않았습니다. wrangler secret put ADMIN_KEY');
  if (!(await sameSecret(body?.관리키, env.ADMIN_KEY))) throw fail(401, '관리키가 맞지 않습니다.');

  if (action === 'overview') {
    const [teams, records, dl] = await Promise.all([loadTeams(env), loadAllRecords(env), deadlineInfo(env)]);
    const 팀 = Object.entries(teams.data.팀 ?? {})
      .sort((a, b) => (a[1].순번 ?? 0) - (b[1].순번 ?? 0))
      .map(([code, e]) => {
        const rec = records[code] ?? { 제출: {} };
        const fin = finalOf(rec);
        return {
          코드: code, 코드표기: e.코드표기 ?? code, 팀명: e.팀명 ?? '', 이메일: e.이메일 ?? '', 순번: e.순번 ?? null,
          취소: (rec.취소 ?? []).map((c) => ({ 회차: c.회차, 원점수: c.원점수, 제출시각: c.제출시각, 취소시각: c.취소시각 })),
          제출: Object.fromEntries(Object.entries(rec.제출 ?? {}).map(([r, s]) => [r, { 원점수: s.원점수, 가중점수: s.가중점수, 적발: s.적발, 인용일치: s.인용일치, 오탐: s.오탐, 판단불가: s.판단불가, 제출시각: s.제출시각, 웹검색: s.웹검색 ?? null, 지침원문: s.지침원문 ?? '' }])),
          최종: fin ? { 채택회차: fin.채택회차, 최종점수: fin.최종점수 } : null,
        };
      });
    return { 마감: dl, 세트: teams.data.세트 ?? env.SET_NAME, 팀, 서버시각: new Date().toISOString(), 전체기록: body.전체기록 === true ? records : undefined };
  }

  if (action === 'teams') {
    // 항목: [{코드, 팀명, 이메일?}] — 코드는 정규화해서 맞춘다. 명부에 없는 코드는 무시하고 알려준다.
    // 이메일은 팀이 쓰는 룸 계정. 식별·표시용이며 인증에는 쓰지 않는다 (인증은 코드 하나).
    const items = Array.isArray(body.항목) ? body.항목 : [];
    const teams = await loadTeams(env);
    const applied = [], unknown = [];
    for (const it of items) {
      const code = normalizeCode(it.코드);
      const name = String(it.팀명 ?? '').trim();
      const email = String(it.이메일 ?? '').trim();
      if (!teams.data.팀[code]) { unknown.push(it.코드); continue; }
      teams.data.팀[code].팀명 = name;
      if (email || it.이메일 !== undefined) teams.data.팀[code].이메일 = email;
      applied.push({ 코드: code, 팀명: name, 이메일: teams.data.팀[code].이메일 ?? '' });
    }
    if (applied.length) await ghPut(env, env.TEAMS_PATH, teams.data, teams.sha, `팀명 ${applied.length}건 갱신`);
    await purgeBoardCache();
    return { 반영: applied, 무시: unknown };
  }

  if (action === 'deadline') {
    // 마감: true(강제 마감) / false(강제 열기) / null(DEADLINE_ISO 를 따름)
    const v = body.마감;
    if (!(v === true || v === false || v === null)) throw fail(400, '마감 은 true / false / null 중 하나여야 합니다.');
    const existing = await ghGet(env, STATE_PATH);
    const state = { ...(existing?.data ?? {}), 마감: v, 변경시각: new Date().toISOString() };
    await ghPut(env, STATE_PATH, state, existing?.sha, `마감 상태 → ${String(v)}`);
    await purgeBoardCache();
    return { 상태: state, 현재: await deadlineInfo(env) };
  }

  if (action === 'reopen') {
    // 사고 대응: 한 회차의 기록을 취소해 그 칸을 다시 열어 준다. 기록은 지우지 않고 취소 목록으로 옮긴다.
    const code = normalizeCode(body.코드);
    const round = String(body.회차 ?? '');
    const teams = await loadTeams(env);
    if (!teams.data.팀[code]) throw fail(404, '명부에 없는 코드입니다.');
    const file = `teams/${code}.json`;
    const existing = await ghGet(env, file);
    if (!existing?.data?.제출?.[round]) throw fail(404, `${round} 회차 기록이 없습니다.`);
    const record = existing.data;
    const { [round]: cancelled, ...rest } = record.제출;
    record.제출 = rest;
    record.취소 = [...(record.취소 ?? []), { 회차: round, ...cancelled, 취소시각: new Date().toISOString(), 사유: String(body.사유 ?? '') }];
    await ghPut(env, file, record, existing.sha, `취소 ${code} ${round}`);
    await purgeBoardCache();
    return { 코드: code, 취소한회차: round, 남은시도: nextRound(phaseOf(round), record, env).remaining, 다음회차: { '1차': nextRound('1차', record, env).round, '2차': nextRound('2차', record, env).round } };
  }

  throw fail(404, `알 수 없는 운영 동작: ${action}`);
}
