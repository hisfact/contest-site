/**
 * Worker 핸들러 테스트 — GitHub API 를 메모리 저장소로 흉내 내서 돈다.
 *
 *   node --test test/worker.test.js
 *
 * 골든테스트(score.test.js)와 달리 채점 값이 아니라 접수 규칙을 본다:
 *   회차를 서버가 정하는가, 상한을 넘기면 막는가, 응답에 문항별 정오가 없는가,
 *   마감 전 리더보드에 점수가 없는가, 한글이 base64 를 오가며 깨지지 않는가.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker, { normalizeCode, encodeUtf8Base64, decodeUtf8Base64, nextRound } from '../src/index.js';
import * as scoring from '../src/scoring.js';
import * as textmatch from '../../public/shared/textmatch.js';
import { checkSubmission } from '../../public/shared/validate.js';
import schema from '../../public/shared/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(here, p), 'utf8'));
const KEY = read('answer_key.json');
const SUB_2 = read('fixtures/2차-1_v1.json');      // 26.0
const SUB_2B = read('fixtures/2차-1_v2.json');     // 28.0
const SUB_1 = read('fixtures/1차_v2.json');        // 19.0

import { fakeGitHub } from './fake-github.mjs';

const TEAMS = {
  세트: 'A_대회용',
  팀: {
    ABCDEFGH2345: { 코드표기: 'ABCD-EFGH-2345', 팀명: '', 순번: 1 },
    WXYZWXYZ6789: { 코드표기: 'WXYZ-WXYZ-6789', 팀명: '별똥별', 순번: 2 },
  },
};

function makeEnv(over = {}) {
  return {
    PRIVATE_REPO: 'x/private', ANSWER_KEY_PATH: 'answer_key.json', TEAMS_PATH: 'teams.json', SET_NAME: 'A_대회용',
    DEADLINE_ISO: '2099-01-01T00:00:00+09:00', MAX_ATTEMPTS_1: '1', MAX_ATTEMPTS_2: '3',
    GITHUB_TOKEN: 'tok', ADMIN_KEY: 'admin-secret', ...over,
  };
}

function setup(env = makeEnv(), initial = {}) {
  const gh = fakeGitHub({ 'answer_key.json': KEY, 'teams.json': TEAMS, ...initial });
  globalThis.fetch = gh.fetchImpl;
  const call = async (path, body, method = body ? 'POST' : 'GET') => {
    const req = new Request(`https://api.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const res = await worker.fetch(req, env, { waitUntil() {} });
    return { status: res.status, body: await res.json() };
  };
  return { gh, call, env };
}

const withMeta = (sub, meta) => ({ ...sub, meta: { ...sub.meta, ...meta } });

// ────────────────────────────────────────────── 기본

test('팀 코드 정규화 — 하이픈·소문자·공백을 흡수한다', () => {
  assert.equal(normalizeCode(' abcd-efgh 2345 '), 'ABCDEFGH2345');
});

test('한글이 base64 를 오가며 깨지지 않는다', () => {
  const s = JSON.stringify({ 팀명: '별똥별 🌠', 인용: '"따옴표"와 ‘홑따옴표’' });
  assert.equal(decodeUtf8Base64(encodeUtf8Base64(s)), s);
  assert.equal(decodeUtf8Base64(encodeUtf8Base64(s).replace(/(.{10})/g, '$1\n')), s);
});

test('브라우저용 textmatch 와 채점기 scoring 의 정규화·LCS 가 같다', () => {
  const samples = ['"따옴표", 가운뎃점·하이픈-말줄임표… 공백 제거', "‘홑’ “겹” `백틱´", KEY.문항[0].조작문장, KEY.문항[19].조작문장];
  for (const s of samples) assert.equal(textmatch.normalize(s), scoring.normalize(s));
  assert.equal(textmatch.longestCommonSubstring('가나다라마바사', '다라마바'), scoring.longestCommonSubstring('가나다라마바사', '다라마바'));
  assert.equal(textmatch.QUOTE_MIN, scoring.QUOTE_MIN);
});

test('스키마 검증 — 픽스처는 전부 통과하고, 참고용 GPT-5 제출만 모델 검사에 걸린다', () => {
  for (const f of readdirSync(join(here, 'fixtures')).filter((x) => x.endsWith('.json'))) {
    const { errors } = checkSubmission(schema, read(`fixtures/${f}`), { setLetter: 'A' });
    if (f.startsWith('참고_GPT5')) assert.ok(errors.length === 1 && errors[0].includes('Solar Pro 4'), f);
    else assert.deepEqual(errors, [], f);
  }
});

test('스키마 검증 — 틀린 곳을 짚어 준다', () => {
  const bad = structuredClone(SUB_2);
  bad.meta.모델 = 'GPT-5';
  bad.answers[3].판정 = '판단불가';
  bad.answers[5].번호 = '004';
  const { errors } = checkSubmission(schema, bad);
  assert.ok(errors.some((e) => e.includes('Solar Pro 4')));
  assert.ok(errors.some((e) => e.includes('판단 불가')));
  const { errors: e2 } = checkSubmission(schema, { ...structuredClone(SUB_2), answers: SUB_2.answers.map((a, i) => (i === 5 ? { ...a, 번호: '004' } : a)) });
  assert.ok(e2.some((e) => e.includes('중복')) && e2.some((e) => e.includes('빠졌')));
  const { errors: e3 } = checkSubmission(schema, withMeta(SUB_1, { 웹검색: true }));
  assert.ok(e3.some((e) => e.includes('1차')));
});

// ────────────────────────────────────────────── 제출

test('제출 — 회차는 서버가 정하고, 응답에는 점수만 있다', async () => {
  const { call, gh } = setup();
  const r1 = await call('/api/submit', { 팀코드: 'abcd-efgh-2345', result: SUB_1 });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.회차, '1차');
  assert.equal(r1.body.점수, 19.0);
  assert.equal(r1.body.가중점수, null);
  assert.deepEqual(r1.body.남은시도, { '1차': 0, '2차': 3 });
  assert.equal(r1.body.detail, undefined);
  assert.equal(r1.body.문항별, undefined);
  assert.equal(JSON.stringify(r1.body).includes('조작문장'), false);

  // 클라이언트가 2차-3 이라고 써서 보내도 서버는 2차-1 로 기록한다
  const r2 = await call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: withMeta(SUB_2, { 조건: '2차-3' }) });
  assert.equal(r2.body.회차, '2차-1');
  assert.equal(r2.body.점수, 26.0);
  assert.equal(r2.body.가중점수, 26.0);
  const r3 = await call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_2B });
  assert.equal(r3.body.회차, '2차-2');
  assert.equal(r3.body.가중점수, 26.6); // 28 × 0.95
  const r4 = await call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_2 });
  assert.equal(r4.body.회차, '2차-3');
  assert.equal(r4.body.가중점수, 23.4); // 26 × 0.9
  assert.deepEqual(r4.body.남은시도, { '1차': 0, '2차': 0 });

  // 상한 초과
  const r5 = await call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_2 });
  assert.equal(r5.status, 429);
  const r6 = await call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_1 });
  assert.equal(r6.status, 429);

  // 팀 파일 하나에만 썼다
  const puts = gh.log.filter((l) => l.startsWith('PUT'));
  assert.deepEqual([...new Set(puts)], ['PUT teams/ABCDEFGH2345.json']);
  const rec = gh.get('teams/ABCDEFGH2345.json');
  assert.deepEqual(Object.keys(rec.제출).sort(), ['1차', '2차-1', '2차-2', '2차-3']);
  assert.equal(rec.제출['2차-1'].detail.length, 36);
  assert.equal(rec.제출['2차-1'].raw.answers.length, 36);
});

test('제출 — 모르는 코드는 403, 형식 오류는 400 과 이유, 마감 후는 403', async () => {
  const { call } = setup();
  assert.equal((await call('/api/submit', { 팀코드: 'NOPE-NOPE-NOPE', result: SUB_2 })).status, 403);
  const bad = await call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: withMeta(SUB_2, { 모델: 'gpt-4o' }) });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.detail.some((e) => e.includes('Solar Pro 4')));
  const badSet = await call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: withMeta(SUB_2, { 세트: 'B' }) });
  assert.equal(badSet.status, 400);

  const closed = setup(makeEnv({ DEADLINE_ISO: '2000-01-01T00:00:00+09:00' }));
  assert.equal((await closed.call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_2 })).status, 403);
});

test('제출 — 형식이 틀린 제출은 시도 횟수를 깎지 않는다', async () => {
  const { call } = setup();
  await call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: withMeta(SUB_2, { 모델: 'gpt' }) });
  const st = await call('/api/status?code=ABCDEFGH2345');
  assert.deepEqual(st.body.남은시도, { '1차': 1, '2차': 3 });
});

test('nextRound — 취소된 칸이 다시 열린다', () => {
  const env = makeEnv();
  const rec = { 제출: { '2차-2': {}, '2차-3': {} } };
  assert.equal(nextRound('2차', rec, env).round, '2차-1');
  assert.equal(nextRound('2차', { 제출: { '2차-1': {}, '2차-2': {}, '2차-3': {} } }, env).round, null);
  assert.equal(nextRound('1차', { 제출: {} }, env).round, '1차');
});

// ────────────────────────────────────────────── 상태·리더보드

test('상태 — 본인 점수와 남은 시도, 다음 회차', async () => {
  const { call } = setup();
  await call('/api/submit', { 팀코드: 'WXYZWXYZ6789', result: SUB_2 });
  const st = await call('/api/status?code=wxyz-wxyz-6789');
  assert.equal(st.status, 200);
  assert.equal(st.body.팀명, '별똥별');
  assert.equal(st.body.제출['2차-1'].점수, 26.0);
  assert.deepEqual(st.body.다음회차, { '1차': '1차', '2차': '2차-2' });
  assert.equal(st.body.마감후, false);
  const st2 = await call('/api/status', { 팀코드: 'ABCD-EFGH-2345' });
  assert.equal(st2.body.팀명, '1번 팀');
  assert.equal((await call('/api/status?code=ZZZZZZZZZZZZ')).status, 403);
});

test('리더보드 — 마감 전에는 점수가 한 글자도 없다', async () => {
  const { call } = setup();
  await call('/api/submit', { 팀코드: 'WXYZWXYZ6789', result: SUB_2 });
  await call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_1 });
  const b = await call('/api/board', { 관리키: 'admin-secret' });
  assert.equal(b.body.마감후, false);
  assert.equal(b.body.행.length, 2);
  assert.equal(b.body.제출건수, 2);
  const row = b.body.행.find((r) => r.팀명 === '별똥별');
  assert.deepEqual(row.제출, { '1차': false, '2차-1': true, '2차-2': false, '2차-3': false });
  const text = JSON.stringify(b.body);
  for (const k of ['점수', '최종', '인용일치', '오탐', '순위', 'detail', 'raw']) assert.equal(text.includes(k), false, k);
});

test('리더보드 — 마감 후에는 정렬된 전체 순위와 문항별 통계', async () => {
  const s = setup();
  await s.call('/api/submit', { 팀코드: 'WXYZWXYZ6789', result: SUB_2 });    // 26.0 → 2차-1 26.0
  await s.call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_1 });    // 1차
  await s.call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_2B });   // 28.0 → 2차-1 28.0
  await s.call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_2 });    // 26.0 → 2차-2 24.7
  const closed = makeEnv({ DEADLINE_ISO: '2000-01-01T00:00:00+09:00' });
  const b = await s.call('/api/board', { 관리키: 'admin-secret' }).then(() => s.call('/api/board', { 관리키: 'admin-secret' })); // 캐시 없음(node) — 그냥 두 번 불러도 같다
  assert.equal(b.body.마감후, false);
  // 같은 저장소로 마감 후 환경
  globalThis.fetch = s.gh.fetchImpl;
  const req = new Request('https://api.test/api/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ 관리키: 'admin-secret' }) });
  const res = await worker.fetch(req, closed, { waitUntil() {} });
  const body = await res.json();
  assert.equal(body.마감후, true);
  assert.equal(body.행[0].팀명, '1번 팀');
  assert.equal(body.행[0].순위, 1);
  assert.equal(body.행[0].채택회차, '2차-1');
  assert.equal(body.행[0].최종점수, 28.0);
  assert.equal(body.행[0]['1차점수'], 19.0);
  assert.equal(body.행[1].팀명, '별똥별');
  assert.equal(body.행[0].문항별.length, 36);
  assert.equal(body.문항.length, 36);
  assert.equal(body.문항[0].번호, '001');
  assert.ok(Object.keys(body.난이도별).length >= 2);
  assert.equal(JSON.stringify(body).includes('조작문장'), false);
});

test('리더보드 — 관리키 없이는 못 본다 (GET 도 없다)', async () => {
  const s = setup();
  assert.equal((await s.call('/api/board')).status, 404);
  assert.equal((await s.call('/api/board', {})).status, 401);
  assert.equal((await s.call('/api/board', { 관리키: 'wrong' })).status, 401);
  assert.equal((await s.call('/api/board', { 관리키: 'admin-secret' })).status, 200);
});

test('상태 — 마감 후에는 자기 점수·문항별 정오만 준다 (순위 없음)', async () => {
  const s = setup();
  await s.call('/api/submit', { 팀코드: 'WXYZWXYZ6789', result: SUB_2 });    // 26.0
  await s.call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_2B });   // 28.0
  const before = await s.call('/api/status?code=ABCDEFGH2345');
  assert.equal('결과' in before.body, false);
  const closed = makeEnv({ DEADLINE_ISO: '2000-01-01T00:00:00+09:00' });
  globalThis.fetch = s.gh.fetchImpl;
  const res = await worker.fetch(new Request('https://api.test/api/status?code=wxyz-wxyz-6789'), closed, { waitUntil() {} });
  const st = await res.json();
  assert.equal(st.마감후, true);
  assert.equal('순위' in st.결과, false); // 순위는 결과 발표에서만
  assert.equal('팀수' in st.결과, false);
  assert.equal(st.결과.최종점수, 26.0);
  assert.equal(st.결과.채택회차, '2차-1');
  assert.equal(st.결과.문항별.length, 36);
  assert.ok(st.결과.문항별[0].제목.length > 0);
  assert.ok(['진짜', '가짜'].includes(st.결과.문항별[0].정답));
  const text = JSON.stringify(st);
  assert.equal(text.includes('1번 팀'), false); // 다른 팀 이름이 섞이지 않는다
  assert.equal(text.includes('회차별'), false);
  // 정답 풀이 — 가짜 문항에만 조작 문장·근거, 진짜 문항은 null
  const fake = st.결과.문항별.find((d) => d.정답 === '가짜');
  const real = st.결과.문항별.find((d) => d.정답 === '진짜');
  assert.ok(fake.풀이.조작문장.length > 10);
  assert.ok(fake.풀이.근거.length > 0);
  assert.equal(real.풀이, null);
  // 마감 전 응답에는 풀이가 한 글자도 없다
  const beforeText = JSON.stringify(before.body);
  for (const k of ['풀이', '조작문장', '근거']) assert.equal(beforeText.includes(k), false, k);
});

test('운영자 — 시스템 초기화는 제출·state 를 지우고 명부·정답표는 남긴다', async () => {
  const s = setup(makeEnv(), { 'state.json': { 마감: false } });
  await s.call('/api/submit', { 팀코드: 'WXYZWXYZ6789', result: SUB_2 });
  await s.call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_1 });
  await s.call('/api/admin/teams', { 관리키: 'admin-secret', 항목: [{ 코드: 'ABCDEFGH2345', 팀명: '임시팀', 이메일: 'a@b.c' }] });
  assert.equal((await s.call('/api/admin/reset', { 관리키: 'admin-secret' })).status, 400); // 확인 없음
  assert.equal((await s.call('/api/admin/reset', { 관리키: 'wrong', 확인: '초기화' })).status, 401);
  const r = await s.call('/api/admin/reset', { 관리키: 'admin-secret', 확인: '초기화' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([...r.body.삭제한제출].sort(), ['ABCDEFGH2345', 'WXYZWXYZ6789']);
  assert.equal(r.body.마감상태삭제, true);
  assert.equal(r.body.팀명비움, 0);
  assert.equal(s.gh.store.has('teams/ABCDEFGH2345.json'), false);
  assert.equal(s.gh.store.has('state.json'), false);
  assert.equal(s.gh.store.has('answer_key.json'), true);
  assert.equal(s.gh.get('teams.json').팀.ABCDEFGH2345.팀명, '임시팀'); // 팀명은 요청해야 비운다
  const b = await s.call('/api/board', { 관리키: 'admin-secret' });
  assert.equal(b.body.제출건수, 0);
  // 다시 제출할 수 있다
  assert.equal((await s.call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_1 })).status, 200);
  // 팀명까지
  const r2 = await s.call('/api/admin/reset', { 관리키: 'admin-secret', 확인: '초기화', 팀명비우기: true });
  assert.equal(r2.body.팀명비움, 2); // 임시팀 + 명부에 원래 있던 별똥별
  assert.equal(s.gh.get('teams.json').팀.ABCDEFGH2345.팀명, '');
  assert.equal('이메일' in s.gh.get('teams.json').팀.ABCDEFGH2345, false);
});

test('리더보드 — 강제 마감(state.json)이 DEADLINE_ISO 보다 우선한다', async () => {
  const s = setup(makeEnv(), { 'state.json': { 마감: true } });
  const b = await s.call('/api/board', { 관리키: 'admin-secret' });
  assert.equal(b.body.마감후, true);
  const sub = await s.call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_2 });
  assert.equal(sub.status, 403);
});

// ────────────────────────────────────────────── 운영자

test('운영자 — 관리키 없으면 401, 팀명 일괄, 마감 전환, 회차 취소', async () => {
  const s = setup();
  assert.equal((await s.call('/api/admin/overview', { 관리키: 'wrong' })).status, 401);
  assert.equal((await s.call('/api/admin/overview', {})).status, 401);

  const t = await s.call('/api/admin/teams', { 관리키: 'admin-secret', 항목: [{ 코드: 'abcd-efgh-2345', 팀명: '과학탐사대', 이메일: 'room07@example.com' }, { 코드: 'NOPE', 팀명: 'x' }] });
  assert.equal(t.status, 200);
  assert.equal(t.body.반영.length, 1);
  assert.deepEqual(t.body.무시, ['NOPE']);
  assert.equal(s.gh.get('teams.json').팀.ABCDEFGH2345.팀명, '과학탐사대');
  assert.equal(s.gh.get('teams.json').팀.ABCDEFGH2345.이메일, 'room07@example.com');
  // 이메일은 표시용 — 상태 응답에 나오지만 인증에는 관여하지 않는다
  assert.equal((await s.call('/api/status?code=ABCDEFGH2345')).body.이메일, 'room07@example.com');
  // 팀명만 다시 보내면 이메일은 유지된다
  await s.call('/api/admin/teams', { 관리키: 'admin-secret', 항목: [{ 코드: 'ABCDEFGH2345', 팀명: '과학탐사대2' }] });
  assert.equal(s.gh.get('teams.json').팀.ABCDEFGH2345.이메일, 'room07@example.com');

  await s.call('/api/submit', { 팀코드: 'ABCDEFGH2345', result: SUB_2 });
  const ov = await s.call('/api/admin/overview', { 관리키: 'admin-secret' });
  assert.equal(ov.body.팀[0].팀명, '과학탐사대2');
  assert.equal(ov.body.팀[0].이메일, 'room07@example.com');
  assert.equal(ov.body.팀[0].제출['2차-1'].원점수, 26.0);
  assert.equal(ov.body.마감.마감후, false);

  const d = await s.call('/api/admin/deadline', { 관리키: 'admin-secret', 마감: true });
  assert.equal(d.body.현재.마감후, true);
  assert.equal((await s.call('/api/submit', { 팀코드: 'WXYZWXYZ6789', result: SUB_2 })).status, 403);
  await s.call('/api/admin/deadline', { 관리키: 'admin-secret', 마감: null });
  assert.equal((await s.call('/api/board', { 관리키: 'admin-secret' })).body.마감후, false);

  const ro = await s.call('/api/admin/reopen', { 관리키: 'admin-secret', 코드: 'ABCDEFGH2345', 회차: '2차-1', 사유: '잘못된 파일 제출' });
  assert.equal(ro.status, 200, JSON.stringify(ro.body));
  assert.equal(ro.body.다음회차['2차'], '2차-1');
  const rec = s.gh.get('teams/ABCDEFGH2345.json');
  assert.equal(rec.취소.length, 1);
  assert.equal(rec.취소[0].회차, '2차-1');
  assert.deepEqual(Object.keys(rec.제출), []);
  assert.equal((await s.call('/api/admin/reopen', { 관리키: 'admin-secret', 코드: 'ABCDEFGH2345', 회차: '2차-1' })).status, 404);
});
