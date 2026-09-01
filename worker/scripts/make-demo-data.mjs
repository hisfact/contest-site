/**
 * 데모 저장소(contest-private-demo) 내용을 만든다 — 발주처 시연·운영 리허설용.
 *
 *   node scripts/make-demo-data.mjs [출력폴더]      (기본: ../../contest-private-demo)
 *
 * 만드는 것
 *   answer_key.json   가짜 정답표. 진짜/가짜·난이도·유형은 난수(고정 시드), "조작 문장"은 기사 본문에서 아무 문장이나 뽑은 것.
 *                     실제 정답표와 아무 관련이 없다 → 데모 사이트에서 정답 풀이가 보여도 새는 것이 없다.
 *   teams.json        DEMO- 로 시작하는 팀 코드 30개, 팀명 채워 둠 (운영자 화면에서 덮어써 볼 수 있다)
 *   teams/<코드>.json 앞 12팀의 제출 기록 — 실제 채점기(scoring.js)로 채점한 결과라 형식이 실전과 같다
 *   README.md
 *
 * 채점 규칙·시도 횟수·화면은 실전과 같은 코드(Worker 는 wrangler.demo.toml 로 따로 배포)를 쓴다.
 * 다시 돌리면 같은 내용이 나온다(시드 고정). 실제 저장소(contest-private)는 건드리지 않는다.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { score, weighted } from '../src/scoring.js';
import { checkSubmission } from '../../public/shared/validate.js';
import schema from '../../public/shared/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const ARTICLES = resolve(here, '..', '..', 'public', 'articles');
const OUT = resolve(process.argv[2] ?? resolve(here, '..', '..', '..', 'contest-private-demo'));

// ── 고정 시드 난수
let seed = 20260901;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ── 기사 읽기: 제목과 문장들
function readArticle(file) {
  const text = readFileSync(join(ARTICLES, file), 'utf8');
  const no = file.replace(/\.md$/, '');
  const title = (text.match(/^#\s+(.+)$/m)?.[1] ?? `기사 ${no}`).trim();
  const body = text.split('\n').filter((l) => l.trim() && !l.startsWith('#') && !/^\[\d{3}\]$/.test(l.trim()));
  // 문단을 문장으로 — 마침표 뒤 공백 기준. 너무 짧은 문장은 뺀다.
  const sentences = body.flatMap((p) => p.split(/(?<=[.다\.])\s+/)).map((s) => s.trim()).filter((s) => s.length >= 30 && s.length <= 140);
  return { no, title, sentences };
}
const articles = readdirSync(ARTICLES).filter((f) => /^\d{3}\.md$/.test(f)).sort().map(readArticle);
if (articles.length !== 36) throw new Error(`기사 36편이어야 합니다: ${articles.length}`);

// ── 가짜 정답표
const TYPES = ['숫자', '인과', '출처', '단위', '시점'];
const fakeIdx = new Set(shuffle(articles.map((_, i) => i)).slice(0, 22)); // 가짜 22 / 진짜 14 — 실전과 같은 비율
const freeIdx = new Set([...fakeIdx].slice(0, 2));                          // 그중 2개는 자유 유형(인용 대조 없음)
const trapIdx = new Set(articles.map((_, i) => i).filter((i) => !fakeIdx.has(i)).slice(0, 2)); // 진짜인데 가짜처럼 보이는 함정 2개
const 문항 = articles.map((a, i) => {
  const fake = fakeIdx.has(i);
  const free = freeIdx.has(i);
  const sentence = fake && !free ? pick(a.sentences.slice(1)) ?? a.sentences[0] : null;
  return {
    번호: a.no,
    정답: fake ? '가짜' : '진짜',
    함정: trapIdx.has(i),
    난이도: fake ? pick(['하', '중', '상']) : '-',
    유형: fake ? (free ? '자유' : pick(TYPES)) : '-',
    근거: fake ? (free ? '(데모) 기사 전체 구성이 조작된 것으로 가정한 자유 유형 문항' : `(데모) 이 문장이 조작된 것으로 가정 — 실제 정답표와 무관`) : '-',
    제목: a.title,
    조작문장: sentence,
    인용채점: fake && !free,
  };
});
const answerKey = {
  세트: 'A_데모',
  설명: '데모·리허설용 가짜 정답표. 진짜/가짜 판정과 조작 문장은 난수로 정한 것이라 실제 정답표와 아무 관련이 없다.',
  총문항: 36, 진짜: 36 - fakeIdx.size, 가짜: fakeIdx.size, 함정: trapIdx.size,
  채점규칙: { '진짜→진짜': 1.0, '진짜→가짜': 0.0, '진짜→판단불가': 0.25, '가짜→가짜(인용일치)': 1.0, '가짜→가짜(인용불일치)': 0.5, '가짜→진짜': 0.0, '가짜→판단불가': 0.25, 자유유형: '인용 무관, 가짜 판정만으로 1.0' },
  인용대조: '따옴표·공백·쉼표·가운뎃점·하이픈·말줄임표를 제거한 뒤 최장공통부분문자열 15자 이상이면 일치',
  문항,
  오인주의_문항: [...trapIdx].map((i) => articles[i].no),
};

// ── 데모 팀 30개
const NAMES = ['빛의속도', '가설검정단', '팩트체커스', '오차범위', '재현성', '피어리뷰', '귀무가설', '표본추출', '대조군', '이중맹검', '메타분석', '베이지안', '카이제곱', 'p값사냥꾼', '유의수준', '신뢰구간', '교란변수', '회귀분석', '표준편차', '정규분포', '검정력', '무작위배정', '코호트', '위약효과', '이상치', '상관계수', '독립변수', '통계적유의', '재현위기', '체리피킹'];
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const 팀 = {};
NAMES.forEach((name, i) => {
  let code;
  do { code = 'DEMO' + Array.from({ length: 8 }, () => ALPHA[Math.floor(rnd() * ALPHA.length)]).join(''); } while (팀[code]);
  팀[code] = { 코드표기: code.replace(/(.{4})(?=.)/g, '$1-'), 팀명: name, 순번: i + 1 };
});
const teams = { 세트: 'A_데모', 설명: '데모·리허설용 명부. 실제 팀 코드가 아니다. 팀명은 운영자 화면에서 덮어써 볼 수 있다.', 팀 };

// ── 제출본 생성 → 실제 채점기로 채점 → 기록 파일
const byNo = new Map(문항.map((q) => [q.번호, q]));
function makeSubmission(code, round, skill, useWeb) {
  const answers = 문항.map((q) => {
    let 판정, 인용 = '', 근거 = '', 검사항목 = '';
    if (rnd() < 0.05) 판정 = '판단 불가';
    else if (q.정답 === '가짜') {
      if (rnd() < skill) {
        판정 = '가짜';
        검사항목 = round.startsWith('2차') ? `${q.유형} 확인` : '';
        근거 = '기사 안의 수치·인과 관계가 앞뒤와 맞지 않음';
        if (q.조작문장) 인용 = rnd() < skill + 0.15 ? q.조작문장 : q.조작문장.slice(0, 10) + ' … (요약함)';
      } else 판정 = '진짜';
    } else 판정 = rnd() < skill + 0.25 ? '진짜' : '가짜';
    if (판정 === '가짜' && !근거) 근거 = '출처가 확인되지 않음';
    return { 번호: q.번호, 판정, 검사항목, 근거, 인용: 판정 === '가짜' ? 인용 : '', 확인출처: '' };
  });
  return {
    meta: { 참가자ID: code, 세트: 'A', 조건: round, 웹검색: useWeb, 모델: 'Solar Pro 4', ...(round.startsWith('2차') ? { 지침원문: '숫자·단위·인과·출처를 항목별로 점검하고 확신이 없으면 판단 불가' } : {}) },
    answers,
  };
}
const codes = Object.keys(팀);
const seeded = codes.slice(0, 12);
const base = Date.UTC(2026, 8, 20, 1, 0, 0); // 2026-09-20 10:00 KST
const records = {};
seeded.forEach((code, i) => {
  const skill = 0.35 + rnd() * 0.55;
  const rounds = ['1차', '2차-1', ...(i % 2 === 0 ? ['2차-2'] : []), ...(i % 4 === 0 ? ['2차-3'] : [])];
  const rec = { 코드: code, 제출: {} };
  rounds.forEach((round, k) => {
    const sub = makeSubmission(code, round, Math.min(0.95, skill + k * 0.08), round !== '1차' && rnd() < 0.5);
    const { errors } = checkSubmission(schema, sub, { setLetter: 'A' });
    if (errors.length) throw new Error(`${code} ${round} 형식 오류: ${JSON.stringify(errors)}`);
    const r = score(sub, answerKey);
    const w = weighted(round, r.총점);
    const at = new Date(base + i * 7 * 60e3 + k * 50 * 60e3 + Math.floor(rnd() * 60e3)).toISOString();
    rec.제출[round] = {
      원점수: r.총점, 가중점수: w, 적발: r.적발, 인용일치: r.인용일치, 오탐: r.오탐, 판단불가: r.판단불가,
      제출시각: at, 조건표기: round, 웹검색: sub.meta.웹검색, 지침원문: sub.meta.지침원문 ?? '', detail: r.detail, raw: sub,
    };
  });
  records[code] = rec;
});

// ── 데모 사이트 입력칸에 미리 채워 둘 견본 제출본 (public/demo-sample.js — 두 사이트에 다 배포되지만 기사 문장뿐이라 새는 것 없음)
//    빈 팀 코드(13번째 팀)로 2차-1 을 낸다는 설정. 대부분 맞히고 몇 개는 일부러 틀린다 — 정오표가 다채롭게 보이도록.
const sampleCode = codes[12];
const sample = {
  meta: { 참가자ID: 팀[sampleCode].코드표기, 세트: 'A', 조건: '2차-1', 웹검색: false, 모델: 'Solar Pro 4', 지침원문: '숫자·단위·인과·출처를 항목별로 점검하고 확신이 없으면 판단 불가' },
  answers: 문항.map((q, i) => {
    const a = articles[i];
    let 판정 = q.정답;
    if (i === 2 || i === 7) 판정 = q.정답 === '가짜' ? '진짜' : '가짜';   // 놓침 / 오탐 하나씩
    if (i === 11) 판정 = '판단 불가';
    let 인용 = '';
    if (판정 === '가짜' && q.정답 === '가짜') 인용 = i === 5 ? (a.sentences.find((x) => x !== q.조작문장) ?? '') : (q.조작문장 ?? ''); // 5번은 엉뚱한 문장 → 인용 불일치
    if (판정 === '가짜' && q.정답 === '진짜') 인용 = a.sentences[0] ?? '';
    return { 번호: q.번호, 판정, 검사항목: 판정 === '가짜' ? `${q.유형 === '-' ? '숫자' : q.유형} 확인` : '', 근거: 판정 === '가짜' ? '기사 안의 수치·인과 관계가 앞뒤와 맞지 않음' : '', 인용, 확인출처: '' };
  }),
};
{
  const { errors } = checkSubmission(schema, sample, { setLetter: 'A' });
  if (errors.length) throw new Error(`견본 제출본 형식 오류: ${JSON.stringify(errors)}`);
}
const SAMPLE_OUT = resolve(here, '..', '..', 'public', 'demo-sample.js');
writeFileSync(SAMPLE_OUT, `/* 데모 사이트 입력칸 견본 — make-demo-data.mjs 가 만든다. 손으로 고치지 말 것.
   가짜 정답표(contest-private-demo)에 맞춘 2차-1 제출본. 기사 문장만 들어 있어 실제 정답과 무관하다. */
export const DEMO_TEAM_CODE = ${JSON.stringify(팀[sampleCode].코드표기)};        // 제출 시연용 (제출 기록 없음)
export const DEMO_RESULT_CODE = ${JSON.stringify(팀[codes[0]].코드표기)};      // 내 결과 시연용 (1차·2차 기록 있음)
export const DEMO_ADMIN_KEY = 'demo';
export const DEMO_TEAM_LINES = ${JSON.stringify(codes.slice(12, 15).map((c) => `${팀[c].코드표기}\t${팀[c].팀명}\troom${String(codes.indexOf(c) + 1).padStart(2, '0')}@example.com`).join('\n'))};
export default ${JSON.stringify(sample, null, 1)};
`, 'utf8');
console.log('→', SAMPLE_OUT);

// ── 쓰기
mkdirSync(join(OUT, 'teams'), { recursive: true });
const write = (name, obj) => writeFileSync(join(OUT, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1) + '\n', 'utf8');
write('answer_key.json', answerKey);
write('teams.json', teams);
write('teams/.gitkeep', '');
for (const [code, rec] of Object.entries(records)) write(`teams/${code}.json`, rec);
write('.gitignore', '.DS_Store\nnode_modules/\n');
write('README.md', `# contest-private-demo — 데모·리허설용 저장소 B

발주처 시연과 운영 리허설용. **실제 대회 저장소(contest-private)와 완전히 분리**되어 있고, 정답표는 가짜다.
Worker \`contest-api-demo\`(wrangler.demo.toml)가 이 저장소를 읽고 쓴다. 화면은 scinews-contest-demo.pages.dev.

- answer_key.json  가짜 정답표. 진짜/가짜·조작 문장은 난수로 정했다 → 실제 정답과 무관. 데모에서 정답 풀이가 보여도 새는 것 없음
- teams.json       DEMO- 로 시작하는 팀 코드 30개 (팀명 채워 둠)
- teams/           앞 12팀의 제출 기록 (실제 채점기로 채점). 나머지 18팀은 비어 있어 제출 시연에 쓴다
- state.json       (Worker 가 만든다) 운영자 화면의 강제 마감/열기

다시 만들기: contest-site/worker 에서 \`node scripts/make-demo-data.mjs\` (시드 고정이라 같은 내용이 나온다).
운영자 화면의 [시스템 초기화]로 제출 기록을 비울 수 있고, 다시 채우려면 이 스크립트를 돌려 push 한다.
`);

// ── 요약
const board = Object.entries(records).map(([c, r]) => {
  const best = Object.entries(r.제출).filter(([k]) => k !== '1차').map(([k, s]) => s.가중점수).sort((a, b) => b - a)[0];
  return `${팀[c].팀명}(${팀[c].코드표기}) ${Object.keys(r.제출).join('/')} 최고 ${best}`;
});
console.log(`→ ${OUT}\n가짜 ${answerKey.가짜} / 진짜 ${answerKey.진짜} / 함정 ${answerKey.함정}\n팀 ${codes.length}개, 제출 기록 ${seeded.length}팀\n` + board.join('\n'));
console.log('\n제출 시연용 빈 팀 코드:', codes.slice(12, 16).map((c) => 팀[c].코드표기).join(', '));
