/**
 * 골든테스트 — 채점 로직 회귀 검사
 *
 *   node --test test/score.test.js
 *
 * 하나라도 어긋나면 채점 규칙이 바뀐 것이다. 왜 바뀌었는지 설명할 수 있어야 한다.
 * 기대 점수의 출처는 test/fixtures_README.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { score, quoteMatches, normalize } from '../src/scoring.js';

const here = dirname(fileURLToPath(import.meta.url));
const key = JSON.parse(readFileSync(join(here, 'answer_key.json'), 'utf8'));

const EXPECTED = {
  '1차_v1': 15.25,
  '1차_v2': 19.0,
  '1차_v3': 13.5,
  '1차_v4': 12.75,
  '1차_v5': 16.75,
  '1차_v6': 17.5,
  '1차_v7': 12.75,
  '2차-1_A하위': 23.75,
  '2차-1_B중위': 22.25,
  '2차-1_C상위': 26.5,
  '2차-1_v1': 26.0,
  '2차-1_v2': 28.0,
  '2차-2_D상위웹': 26.25,
  '참고_GPT5_1차': 27.0,
};

const dir = join(here, 'fixtures');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

test('픽스처 14건이 전부 있다', () => {
  assert.equal(files.length, Object.keys(EXPECTED).length);
});

for (const f of files) {
  const name = f.replace(/\.json$/, '');
  test(`${name} = ${EXPECTED[name]}`, () => {
    const sub = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const r = score(sub, key);
    assert.equal(r.총점, EXPECTED[name]);
  });
}

test('판단불가는 0.25다', () => {
  assert.equal(key.채점규칙['가짜→판단불가'], 0.25);
  assert.equal(key.채점규칙['진짜→판단불가'], 0.25);
});

test('헤징이 손해다 — 판단불가 31건이 실제로 답을 낸 회차보다 낮아야 한다', () => {
  const a = score(JSON.parse(readFileSync(join(dir, '1차_v7.json'), 'utf8')), key);
  const b = score(JSON.parse(readFileSync(join(dir, '1차_v6.json'), 'utf8')), key);
  assert.equal(a.판단불가, 31);
  assert.equal(b.판단불가, 0);
  assert.ok(a.총점 < b.총점, `헤징 ${a.총점} 이 ${b.총점} 보다 낮아야 한다`);
});

test('인용 불일치는 0.5다 — C상위는 003을 맞히고도 다른 문장을 인용했다', () => {
  const r = score(JSON.parse(readFileSync(join(dir, '2차-1_C상위.json'), 'utf8')), key);
  assert.equal(r.적발, 15);
  assert.equal(r.인용일치, 14);
  assert.equal(r.detail.find((d) => d.번호 === '003').인용일치, false);
});

test('자유 유형(027)은 인용 없이도 1.0이다', () => {
  const r = score(JSON.parse(readFileSync(join(dir, '2차-1_C상위.json'), 'utf8')), key);
  const d = r.detail.find((x) => x.번호 === '027');
  assert.equal(d.점수, 1.0);
  assert.equal(key.문항.find((q) => q.번호 === '027').인용채점, false);
});

test('따옴표만 다른 인용은 일치로 본다', () => {
  const truth = key.문항.find((q) => q.번호 === '001').조작문장;
  assert.ok(quoteMatches(truth.replace(/'/g, "'").replace(/,/g, ''), truth));
  assert.ok(quoteMatches(`  ${truth}  `, truth));
});

test('문장 일부만 옮겨도 15자 이상이면 인정한다', () => {
  const truth = key.문항.find((q) => q.번호 === '020').조작문장;
  const part = Array.from(normalize(truth)).slice(0, 16).join('');
  assert.ok(quoteMatches(part, truth));
  const tooShort = Array.from(normalize(truth)).slice(0, 14).join('');
  assert.ok(!quoteMatches(tooShort, truth));
});

test('빈 인용은 불일치다', () => {
  assert.ok(!quoteMatches('', '아무 문장'));
  assert.ok(!quoteMatches(undefined, '아무 문장'));
});
