/* 운영자 화면. 모든 요청은 관리키를 본문에 담아 Worker 로 보낸다. */
import { api, el, fill, fmtTime, fmtScore, mountTop } from './app.js';

mountTop('admin.html');
const $ = (id) => document.getElementById(id);
const ROUNDS = ['1차', '2차-1', '2차-2', '2차-3'];
let key = sessionStorage.getItem('adminKey') ?? '';
let overview = null;

if (key) { $('keyInput').value = key; load(); }
$('loadBtn').addEventListener('click', () => { key = $('keyInput').value.trim(); load(); });
$('keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { key = $('keyInput').value.trim(); load(); } });
$('refreshBtn').addEventListener('click', load);

const admin = (action, body = {}) => api(`/api/admin/${action}`, { 관리키: key, ...body });

async function load() {
  if (!key) return;
  $('loadMsg').textContent = '불러오는 중…';
  try {
    overview = await admin('overview');
    sessionStorage.setItem('adminKey', key);
    $('panels').hidden = false;
    $('loadMsg').textContent = `서버 시각 ${fmtTime(overview.서버시각)} · 세트 ${overview.세트}`;
    renderDeadline(overview.마감);
    renderOverview(overview);
  } catch (e) {
    $('loadMsg').textContent = e.status === 401 ? '관리키가 맞지 않습니다.' : e.message;
    if (e.status === 401) { $('panels').hidden = true; sessionStorage.removeItem('adminKey'); }
  }
}

// ────────────────────────────────────────────── 마감

function renderDeadline(d) {
  const mode = d.강제 === true ? '강제 마감' : d.강제 === false ? '강제 열림' : '자동';
  fill($('deadlineRow'), 
    el('span', { class: `badge ${d.마감후 ? 'bad' : 'ok'}` }, d.마감후 ? '마감됨' : '진행 중'),
    el('span', { class: 'small' }, `모드: ${mode}`, d.마감시각 ? ` · DEADLINE_ISO ${fmtTime(d.마감시각, 'long')}` : ' · DEADLINE_ISO 미설정 (wrangler.toml)'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'sm danger', onclick: () => setDeadline(true), disabled: d.강제 === true }, '지금 강제 마감'),
    el('button', { class: 'sm', onclick: () => setDeadline(false), disabled: d.강제 === false }, '강제 열기'),
    el('button', { class: 'sm', onclick: () => setDeadline(null), disabled: d.강제 === null }, '자동(DEADLINE_ISO)으로'),
  );
}

async function setDeadline(v) {
  const label = v === true ? '지금 강제 마감합니다. 모든 팀의 제출이 막히고 리더보드에 전체 점수가 공개됩니다.' : v === false ? '강제로 엽니다. DEADLINE_ISO 가 지났어도 제출을 받습니다.' : 'DEADLINE_ISO 를 따르는 자동 모드로 돌립니다.';
  if (!(await inlineConfirm($('deadlineRow'), label))) return;
  try {
    const r = await admin('deadline', { 마감: v });
    renderDeadline(r.현재);
  } catch (e) { alertBox($('deadlineRow'), e.message); }
}

// ────────────────────────────────────────────── 팀명

let previewItems = [];
$('previewBtn').addEventListener('click', () => {
  const codes = new Map(Object.values(overview?.팀 ?? []).map((t) => [t.코드, t]));
  const norm = (s) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  previewItems = $('namesInput').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const cells = line.split(/\t|,/).map((x) => x.trim());
    const code = norm(cells[0] ?? '');
    // 팀명·이메일 순서는 상관없다 — @ 가 있는 칸을 이메일로 본다
    const email = cells.slice(1).find((x) => x.includes('@')) ?? '';
    const name = cells.slice(1).filter((x) => x && x !== email).join(' ');
    const t = codes.get(code);
    const changed = t && ((t.팀명 && t.팀명 !== name) || (email && t.이메일 && t.이메일 !== email));
    return { 코드: code, 팀명: name, 이메일: email, 상태: !t ? '명부에 없음' : !name ? '팀명 비어 있음' : changed ? `변경 (${t.팀명}${t.이메일 ? ' · ' + t.이메일 : ''} →)` : '반영 예정', ok: !!t && !!name };
  });
  const okCount = previewItems.filter((p) => p.ok).length;
  $('namesMsg').textContent = `${previewItems.length}줄 중 ${okCount}건 반영 가능`;
  $('applyBtn').disabled = okCount === 0;
  fill($('namesPreview'), el('div', { class: 'tablewrap' }, el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, '코드'), el('th', {}, '팀명'), el('th', {}, '이메일'), el('th', {}, '상태'))),
    el('tbody', {}, previewItems.map((p) => el('tr', {}, el('td', { class: 'mono' }, p.코드), el('td', {}, p.팀명), el('td', { class: 'muted' }, p.이메일), el('td', { class: p.ok ? 'ok' : 'muted' }, el('span', { class: `badge ${p.ok ? 'ok' : 'warn'}` }, p.상태))))),
  )));
});

$('applyBtn').addEventListener('click', async () => {
  const items = previewItems.filter((p) => p.ok).map(({ 코드, 팀명, 이메일 }) => ({ 코드, 팀명, ...(이메일 ? { 이메일 } : {}) }));
  $('applyBtn').disabled = true;
  try {
    const r = await admin('teams', { 항목: items });
    $('namesMsg').textContent = `${r.반영.length}건 반영${r.무시.length ? `, ${r.무시.length}건 무시` : ''}`;
    fill($('namesPreview'));
    $('namesInput').value = '';
    await load();
  } catch (e) { $('namesMsg').textContent = e.message; $('applyBtn').disabled = false; }
});

// ────────────────────────────────────────────── 현황

function renderOverview(o) {
  const total = o.팀.reduce((s, t) => s + Object.keys(t.제출).length, 0);
  const named = o.팀.filter((t) => t.팀명).length;
  $('overviewMeta').textContent = `팀 ${o.팀.length}개 (팀명 입력 ${named}개) · 제출 ${total}건 · 2차 제출이 있는 팀 ${o.팀.filter((t) => t.최종).length}개`;
  const table = el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, '코드'), el('th', {}, '팀명'), ROUNDS.map((r) => el('th', {}, r)), el('th', { class: 'num' }, '최종'), el('th', {}, '취소'))),
    el('tbody', {}, o.팀.map((t) => el('tr', {},
      el('td', { class: 'num' }, t.순번 ?? ''),
      el('td', { class: 'mono small' }, t.코드표기),
      el('td', {}, t.팀명 || el('span', { class: 'muted' }, '(미입력)'), t.이메일 ? el('div', { class: 'muted small' }, t.이메일) : null),
      ROUNDS.map((r) => {
        const s = t.제출[r];
        if (!s) return el('td', { class: 'muted' }, '—');
        return el('td', {},
          el('div', {}, el('strong', {}, fmtScore(s.원점수)), s.가중점수 !== null && s.가중점수 !== undefined ? el('span', { class: 'muted small' }, ` → ${fmtScore(s.가중점수)}`) : null, s.웹검색 ? el('span', { class: 'badge info', style: 'margin-left:4px' }, '웹') : null),
          el('div', { class: 'muted small' }, fmtTime(s.제출시각, 'short'), ' ', el('button', { class: 'sm', title: s.지침원문 || '', onclick: (ev) => reopen(ev.currentTarget, t, r) }, '취소')),
        );
      }),
      el('td', { class: 'num' }, t.최종 ? el('span', {}, el('strong', {}, fmtScore(t.최종.최종점수)), el('span', { class: 'muted small' }, ` (${t.최종.채택회차})`)) : '—'),
      el('td', { class: 'small muted' }, t.취소.length ? t.취소.map((c) => `${c.회차} ${fmtScore(c.원점수)}점`).join(', ') : ''),
    ))),
  );
  fill($('overview'), table);
}

async function reopen(btn, team, round) {
  const cell = btn.closest('td');
  const reason = el('input', { type: 'text', placeholder: '사유 (선택)', style: 'max-width:200px' });
  const ok = await inlineConfirm(cell, el('span', {}, `${team.팀명 || team.코드표기} 의 ${round} 기록을 취소하고 칸을 다시 엽니다. `, reason));
  if (!ok) return;
  try {
    await admin('reopen', { 코드: team.코드, 회차: round, 사유: reason.value });
    await load();
  } catch (e) { alertBox(cell, e.message); }
}

// ────────────────────────────────────────────── 코드 발송 메일 본문 (운영자가 행사용 메일에서 직접 보낸다)

const SITE_URL = location.origin.startsWith('http') && !location.hostname.match(/^(localhost|127\.0\.0\.1)$/) ? location.origin : 'https://scinews-contest.pages.dev';
const mailSubject = (t) => `[AI 동행 프로젝트 책임/안전 분과 해커톤 대회] ${t.팀명} 팀 제출 코드`;
const mailBody = (t) => `${t.팀명} 팀 안녕하세요.

AI 동행 프로젝트 책임/안전 분과 해커톤 대회 결과 제출에 쓰는 팀 코드입니다.

  팀 코드:  ${t.코드표기}
  제출 사이트:  ${SITE_URL}

- 이 코드는 팀의 비밀번호입니다. 다른 팀에게 보이지 않게 해 주세요.
- 사이트에서 코드를 넣고 "확인"을 누르면 팀명(${t.팀명})이 표시됩니다. 다른 팀명이 나오면 운영진에게 알려 주세요.
- 하이픈과 대소문자는 상관없습니다. 복사해서 붙여넣는 것이 가장 정확합니다.
- 제출은 1차 1회, 2차 3회입니다. 형식 검사는 횟수에 들어가지 않으니 마음껏 눌러 보세요.

운영진 드림`;

$('mailBtn').addEventListener('click', () => {
  if (!overview) return;
  const withMail = overview.팀.filter((t) => t.이메일 && t.팀명);
  const without = overview.팀.filter((t) => !t.이메일 || !t.팀명);
  const md = [
    `# 팀 코드 발송 — ${withMail.length}통 (${new Date().toISOString().slice(0, 10)})`, '',
    '코드가 들어 있는 파일입니다. 발송이 끝나면 지우세요. 저장소나 공유 폴더에 올리지 않습니다.', '',
    ...withMail.flatMap((t) => ['---', `## ${t.순번}. ${t.팀명}`, `받는 사람: ${t.이메일}`, `제목: ${mailSubject(t)}`, '', mailBody(t), '']),
    ...(without.length ? ['---', `## 팀명 또는 이메일이 없는 팀 (${without.length})`, ...without.map((t) => `- ${t.순번}. ${t.팀명 || '(팀명 없음)'} ${t.이메일 || '(이메일 없음)'}`)] : []),
  ].join('\n');
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `팀코드_발송_${new Date().toISOString().slice(0, 10)}.md` });
  document.body.append(a); a.click(); a.remove();
  $('overviewMeta').textContent = `메일 본문 ${withMail.length}통 생성${without.length ? ` · 팀명/이메일 없는 팀 ${without.length}` : ''}`;
});

// ────────────────────────────────────────────── 내려받기

$('downloadBtn').addEventListener('click', async () => {
  try {
    const r = await admin('overview', { 전체기록: true });
    const blob = new Blob([JSON.stringify(r, null, 1)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `contest-records-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json` });
    document.body.append(a); a.click(); a.remove();
  } catch (e) { $('overviewMeta').textContent = e.message; }
});

// ────────────────────────────────────────────── 작은 도우미 (브라우저 confirm 대신 인라인)

function inlineConfirm(anchor, message) {
  return new Promise((resolve) => {
    const box = el('div', { class: 'alert warn', style: 'width:100%' }, el('div', {}, message),
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { class: 'primary sm', onclick: () => { box.remove(); resolve(true); } }, '확인'),
        el('button', { class: 'sm', onclick: () => { box.remove(); resolve(false); } }, '취소')));
    anchor.append(box);
  });
}

function alertBox(anchor, msg) {
  const box = el('div', { class: 'alert bad', style: 'width:100%' }, msg, ' ', el('button', { class: 'sm', onclick: () => box.remove() }, '닫기'));
  anchor.append(box);
}
