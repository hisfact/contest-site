/**
 * 팀 코드 발송용 메일 본문 만들기 — 운영자가 행사용 지메일에서 직접 보낼 때 쓴다.
 *
 *   npm run mails
 *   → contest-private/발송/메일_전체.md   팀별 [받는 사람 / 제목 / 본문] 30묶음. 위에서부터 복사해 붙인다
 *   → contest-private/발송/메일병합.csv   이메일,팀명,코드표기,제목,본문 — 메일 병합 도구용
 *
 * 읽는 것: contest-private/teams.json (코드표기·팀명·이메일). 이메일이 비어 있는 팀은 목록 끝에 따로 표시한다.
 * 쓰는 곳: contest-private/발송/ — 코드가 들어가므로 저장소 A(contest-site) 안에는 절대 쓰지 않는다.
 *
 * 환경변수로 바꿀 수 있는 것
 *   SITE_URL   제출 사이트 주소 (기본 https://scinews-contest.pages.dev)
 *   SUBJECT    메일 제목 (기본 [과학뉴스 검증 대회] {팀명} 팀 제출 코드)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const priv = process.env.PRIVATE_DIR ? resolve(process.env.PRIVATE_DIR) : resolve(here, '..', '..', '..', 'contest-private');
const teamsPath = join(priv, 'teams.json');
if (!existsSync(teamsPath)) {
  console.error(`teams.json 을 찾지 못했습니다: ${teamsPath}`);
  process.exit(1);
}
const SITE = process.env.SITE_URL ?? 'https://scinews-contest.pages.dev';
const SUBJECT = process.env.SUBJECT ?? '[과학뉴스 검증 대회] {팀명} 팀 제출 코드';

const teams = JSON.parse(readFileSync(teamsPath, 'utf8'));
const rows = Object.entries(teams.팀)
  .map(([code, t]) => ({ 코드: code, 코드표기: t.코드표기 ?? code, 팀명: t.팀명 || `${t.순번}번 팀`, 이메일: t.이메일 ?? '', 순번: t.순번 ?? 0 }))
  .sort((a, b) => a.순번 - b.순번);

const body = (r) => `${r.팀명} 팀 안녕하세요.

과학뉴스 검증 대회 결과 제출에 쓰는 팀 코드입니다.

  팀 코드:  ${r.코드표기}
  제출 사이트:  ${SITE}

- 이 코드는 팀의 비밀번호입니다. 다른 팀에게 보이지 않게 해 주세요.
- 사이트에서 코드를 넣고 "확인"을 누르면 팀명(${r.팀명})이 표시됩니다. 다른 팀명이 나오면 운영진에게 알려 주세요.
- 하이픈과 대소문자는 상관없습니다. 복사해서 붙여넣는 것이 가장 정확합니다.
- 제출은 1차 1회, 2차 3회입니다. 형식 검사는 횟수에 들어가지 않으니 마음껏 눌러 보세요.

운영진 드림`;

const outDir = join(priv, '발송');
mkdirSync(outDir, { recursive: true });

const withMail = rows.filter((r) => r.이메일);
const without = rows.filter((r) => !r.이메일);

const md = [
  `# 팀 코드 발송 — ${withMail.length}통 (${new Date().toISOString().slice(0, 10)})`,
  '',
  '이 파일은 contest-private 에만 있다. 저장소 A 로 옮기지 않는다.',
  '',
  ...withMail.flatMap((r) => [
    `---`,
    `## ${r.순번}. ${r.팀명}`,
    `**받는 사람:** ${r.이메일}`,
    `**제목:** ${SUBJECT.replace('{팀명}', r.팀명)}`,
    '',
    '```',
    body(r),
    '```',
    '',
  ]),
  ...(without.length ? ['---', `## 이메일이 없는 팀 (${without.length})`, ...without.map((r) => `- ${r.순번}. ${r.팀명} — 운영자 화면에서 이메일을 채운 뒤 다시 실행`)] : []),
].join('\n');
writeFileSync(join(outDir, '메일_전체.md'), md);

const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;
const csv = ['이메일,팀명,코드표기,제목,본문', ...withMail.map((r) => [r.이메일, r.팀명, r.코드표기, SUBJECT.replace('{팀명}', r.팀명), body(r)].map(csvCell).join(','))].join('\n');
writeFileSync(join(outDir, '메일병합.csv'), '﻿' + csv);

console.log(`발송 준비 ${withMail.length}통 → ${outDir}`);
if (without.length) console.log(`이메일 없는 팀 ${without.length}: ${without.map((r) => r.팀명).join(', ')}`);
