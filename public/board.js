/* 내 결과 — /api/status 가 준 우리 팀 것만 그린다. 다른 팀 데이터도, 우리 팀 순위도 이 화면에 오지 않는다(순위는 결과 발표에서만). */
import { api, el, fill, fmtTime, fmtScore, mountTop, remainingText } from './app.js';

mountTop('board.html');
const $ = (id) => document.getElementById(id);
const ROUNDS = ['1차', '2차-1', '2차-2', '2차-3'];
const COEF = { '2차-1': '1.00', '2차-2': '0.95', '2차-3': '0.90' };
let status = null;

setInterval(() => {
  const dl = status?.마감시각;
  $('serverClock').textContent = dl && !status.마감후 ? `마감까지 ${remainingText(dl)}` : (status?.마감후 ? '마감' : '');
}, 1000);

// 제출 화면에서 확인한 코드가 있으면 바로 불러온다
const saved = sessionStorage.getItem('teamCode');
if (saved) { $('codeInput').value = saved; load(saved); }

$('codeBtn').addEventListener('click', () => load($('codeInput').value));
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') load($('codeInput').value); });

async function load(raw) {
  const code = (raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const box = $('statusBox');
  if (code.length < 6) { fill(box, el('div', { class: 'alert warn' }, '팀 코드를 입력하세요.')); box.hidden = false; return; }
  fill(box, el('p', { class: 'muted' }, '확인 중…')); box.hidden = false;
  fill($('content'));
  try {
    status = await api(`/api/status?code=${encodeURIComponent(code)}`);
    sessionStorage.setItem('teamCode', code);
    sessionStorage.setItem('teamName', status.팀명);
    renderStatus(status);
    renderResult(status);
  } catch (e) {
    status = null;
    fill(box, el('div', { class: 'alert bad' }, e.status === 403 ? '등록되지 않은 팀 코드입니다. 배부받은 코드를 다시 확인하세요.' : e.message));
  }
}

function renderStatus(st) {
  fill($('statusBox'),
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('strong', {}, st.팀명),
      st.이메일 ? el('span', { class: 'muted small' }, st.이메일) : null,
      el('span', { class: 'badge info mono' }, st.코드표기),
      st.마감후 ? el('span', { class: 'badge bad' }, '마감') : el('span', { class: 'badge ok' }, '진행 중'),
    ),
    el('div', { class: 'status-round' }, ROUNDS.map((r) => {
      const s = st.제출[r];
      return el('div', {},
        el('div', { class: 'rn' }, r, r === '1차' ? ' (순위 미반영)' : ` · 계수 ${COEF[r]}`),
        s ? el('div', { class: 'rv' }, `${fmtScore(s.점수)}점`) : el('div', { class: 'rv muted' }, '—'),
        el('div', { class: 'muted' }, s ? fmtTime(s.제출시각) : '미제출'),
      );
    })),
    el('p', { class: 'small', style: 'margin:10px 0 0' },
      st.마감후 ? '마감되었습니다.' : `남은 시도 — 1차 ${st.남은시도['1차']}회 · 2차 ${st.남은시도['2차']}회`,
      st.마감시각 ? ` · 마감 ${fmtTime(st.마감시각, 'long')}` : '',
    ),
  );
}

function renderResult(st) {
  if (!st.마감후) {
    fill($('content'), el('section', { class: 'card' }, el('div', { class: 'alert info', style: 'margin:0' }, '최종 점수와 문항별 정오표는 마감 후에 이 화면에서 볼 수 있습니다. 회차별 점수는 위 칸에 바로 반영됩니다.')));
    return;
  }
  const r = st.결과;
  if (!r) {
    fill($('content'), el('section', { class: 'card' }, el('div', { class: 'alert warn', style: 'margin:0' }, '2차 제출이 없어 순위에 들지 않았습니다. 1차 점수는 위 칸에서 볼 수 있습니다.')));
    return;
  }
  const summary = el('section', { class: 'card' },
    el('h2', {}, '최종'),
    el('div', { class: 'score' },
      el('span', { class: 'big' }, fmtScore(r.최종점수)), el('span', { class: 'of' }, '점'),
      el('span', { class: 'muted small', style: 'margin-left:16px' }, '순위는 결과 발표 때 공개됩니다'),
    ),
    el('div', { class: 'kv', style: 'margin-top:14px' },
      el('dt', {}, '채택 회차'), el('dd', {}, `${r.채택회차} · 원점수 ${fmtScore(r.원점수)} × 계수 ${Number(r.계수).toFixed(2)}`),
      el('dt', {}, '가짜 적발'), el('dd', {}, `${r.적발}개 (인용까지 일치 ${r.인용일치}개)`),
      el('dt', {}, '오탐'), el('dd', {}, `${r.오탐}개 (진짜를 가짜라고 함)`),
      el('dt', {}, '판단 불가'), el('dd', {}, `${r.판단불가}개`),
      el('dt', {}, '제출 시각'), el('dd', {}, fmtTime(r.제출시각)),
    ),
  );

  const mark = (d) => (d.점수 >= 1 ? ['ok', '정답'] : d.점수 >= 0.5 ? ['warn', '인용 불일치'] : d.판정 === '판단 불가' ? ['', '판단 불가'] : ['bad', d.정답 === '진짜' ? '오탐' : '놓침']);
  const table = el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, '번호'), el('th', {}, '제목'), el('th', {}, '정답'), el('th', {}, '내 판정'), el('th', {}, '결과'), el('th', { class: 'num' }, '점수'))),
    el('tbody', {}, r.문항별.map((d) => {
      const [cls, label] = mark(d);
      return el('tr', {},
        el('td', { class: 'mono' }, d.번호),
        el('td', { style: 'white-space:normal;min-width:240px' }, d.제목, d.함정 ? el('span', { class: 'badge warn', style: 'margin-left:6px' }, '함정') : null),
        el('td', {}, el('span', { class: `badge ${d.정답 === '가짜' ? 'bad' : 'ok'}` }, d.정답)),
        el('td', {}, d.판정),
        el('td', {}, el('span', { class: `badge ${cls}` }, label)),
        el('td', { class: 'num' }, fmtScore(d.점수)),
      );
    })),
  );
  fill($('content'), summary,
    el('section', { class: 'card' }, el('h2', {}, `문항별 정오표 — ${r.채택회차}`),
      el('p', { class: 'muted small' }, '채택된 회차 기준. "인용 불일치"는 가짜를 맞혔지만 조작 문장을 그대로 인용하지 못해 절반만 받은 문항입니다.'),
      el('div', { class: 'tablewrap' }, table)),
  );
}
