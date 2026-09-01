/* 리더보드. 서버가 준 것만 그린다 — 마감 전 응답에는 점수가 들어 있지 않다. */
import { api, el, fill, fmtTime, fmtScore, mountTop, remainingText } from './app.js';

mountTop('board.html');
const $ = (id) => document.getElementById(id);
const myName = sessionStorage.getItem('teamName');
let board = null;

setInterval(() => {
  const dl = board?.마감시각;
  $('serverClock').textContent = dl && !board.마감후 ? `마감까지 ${remainingText(dl)}` : (board?.마감후 ? '마감' : '');
}, 1000);

async function load() {
  try {
    board = await api('/api/board');
    render(board);
  } catch (e) {
    $('lead').textContent = e.message;
  }
}
load();
setInterval(load, 60_000);

const ROUNDS = ['1차', '2차-1', '2차-2', '2차-3'];
const DIFF_ORDER = ['하', '중', '상'];

function render(b) {
  fill($('meta'), 
    el('div', {}, `팀 ${b.팀수}개 · ${fmtTime(b.생성시각)} 기준`),
    b.강제 === true ? el('div', {}, '운영자가 마감함') : b.강제 === false ? el('div', {}, '운영자가 열어 둠') : b.마감시각 ? el('div', {}, `마감 ${fmtTime(b.마감시각, 'long')}`) : null,
  );
  if (!b.마감후) return renderBefore(b);
  return renderAfter(b);
}

function renderBefore(b) {
  $('lead').textContent = `진행 현황 — 제출 ${b.제출건수}건. 점수와 순위는 마감 후에 공개됩니다.`;
  const table = el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, '팀'), ROUNDS.map((r) => el('th', { class: 'center' }, r)), el('th', {}, '마지막 제출'))),
    el('tbody', {}, b.행.map((r) => el('tr', { class: r.팀명 === myName ? 'me' : null },
      el('td', { class: 'num' }, r.순번 ?? ''),
      el('td', {}, r.팀명),
      ROUNDS.map((k) => el('td', { class: 'center' }, el('span', { class: `dot ${r.제출[k] ? 'on' : ''}`, title: r.제출[k] ? '제출' : '미제출' }))),
      el('td', { class: 'muted' }, fmtTime(r.마지막제출)),
    ))),
  );
  fill($('content'), el('section', { class: 'card' }, el('div', { class: 'tablewrap' }, table)));
}

function renderAfter(b) {
  $('lead').textContent = '최종 순위. 정렬 기준은 아래 설명을 참고하세요.';
  const rank = el('table', {},
    el('thead', {}, el('tr', {},
      el('th', { class: 'num' }, '순위'), el('th', {}, '팀'), el('th', { class: 'num' }, '최종'), el('th', {}, '채택'),
      el('th', { class: 'num' }, '원점수'), el('th', { class: 'num' }, '계수'), el('th', { class: 'num' }, '적발'), el('th', { class: 'num' }, '인용일치'),
      el('th', { class: 'num' }, '오탐'), el('th', { class: 'num' }, '판단불가'), el('th', { class: 'num' }, '1차'), el('th', {}, '제출시각'),
    )),
    el('tbody', {}, b.행.map((r) => el('tr', { class: [r.순위 <= 3 ? `top${r.순위}` : '', r.팀명 === myName ? 'me' : ''].join(' ') },
      el('td', { class: 'num' }, r.순위),
      el('td', {}, r.팀명),
      el('td', { class: 'num' }, el('strong', {}, fmtScore(r.최종점수))),
      el('td', {}, r.채택회차),
      el('td', { class: 'num' }, fmtScore(r.원점수)),
      el('td', { class: 'num' }, r.계수?.toFixed(2) ?? '—'),
      el('td', { class: 'num' }, r.적발),
      el('td', { class: 'num' }, r.인용일치),
      el('td', { class: 'num' }, r.오탐),
      el('td', { class: 'num' }, r.판단불가),
      el('td', { class: 'num muted' }, fmtScore(r['1차점수'])),
      el('td', { class: 'muted' }, fmtTime(r.제출시각)),
    ))),
  );

  const diffs = Object.entries(b.난이도별).sort((x, y) => DIFF_ORDER.indexOf(x[0]) - DIFF_ORDER.indexOf(y[0]));
  const diffCard = el('section', { class: 'card' },
    el('h2', {}, '난이도별 평균 적발률'),
    el('p', { class: 'muted small' }, '채택된 회차 기준. 가짜 기사를 가짜로 판정한 비율입니다.'),
    el('div', { class: 'kv' }, diffs.map(([d, s]) => [
      el('dt', {}, d),
      el('dd', {}, el('span', { class: 'bar', style: `width:${Math.max(2, (s.적발률 ?? 0) * 2)}px` }), `${s.적발률 ?? '—'}%`, el('span', { class: 'muted' }, ` (${s.적발}/${s.응답})`)),
    ]).flat()),
  );

  const qTable = el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, '번호'), el('th', {}, '제목'), el('th', {}, '정답'), el('th', {}, '난이도'), el('th', {}, '유형'), el('th', { class: 'num' }, '정답률'), el('th', { class: 'num' }, '인용일치율'), el('th', { class: 'num' }, '판단불가'))),
    el('tbody', {}, b.문항.map((q) => el('tr', {},
      el('td', { class: 'mono' }, q.번호),
      el('td', { style: 'white-space:normal;min-width:240px' }, q.제목),
      el('td', {}, el('span', { class: `badge ${q.정답 === '가짜' ? 'bad' : 'ok'}` }, q.정답), q.함정 ? el('span', { class: 'badge warn', style: 'margin-left:4px' }, '함정') : null),
      el('td', {}, q.난이도),
      el('td', {}, q.유형),
      el('td', { class: 'num' }, el('span', { class: 'bar', style: `width:${Math.max(2, (q.정답률 ?? 0) * 0.8)}px` }), q.정답률 === null ? '—' : `${q.정답률}%`),
      el('td', { class: 'num' }, q.인용일치율 === null ? '—' : `${q.인용일치율}%`),
      el('td', { class: 'num' }, q.판단불가),
    ))),
  );

  fill($('content'), 
    el('section', { class: 'card' }, el('div', { class: 'tablewrap' }, rank),
      b.미채점?.length ? el('p', { class: 'muted small', style: 'margin:10px 0 0' }, `2차 제출이 없어 순위에 들지 않은 팀: ${b.미채점.map((r) => r.팀명).join(', ')}`) : null),
    diffCard,
    el('section', { class: 'card' }, el('h2', {}, '문항별 정답률'), el('p', { class: 'muted small' }, '채택된 회차 기준. 인용일치율은 가짜 문항에서 조작 문장을 제대로 인용한 비율입니다.'), el('div', { class: 'tablewrap' }, qTable)),
  );
}
