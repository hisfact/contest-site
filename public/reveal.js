/* 결과 발표 화면 — ICPC 리졸버 방식. 동작 설명은 reveal.html 주석에.
   서버가 준 문항별 채점 결과만 그린다. 정답표는 여기 없다. */
import { api, el, fill, fmtScore, sleep } from './app.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');

// ────────────────────────────────────────────── 상태
let Q = [];        // 문항 정보 [{번호, 제목, 정답, 난이도, 유형, 함정, 정답률}]
let teams = [];    // 발표 대상 팀 (순위 있는 팀). 서버가 준 순위 그대로.
let unranked = []; // 2차 제출이 없어 순위가 없는 팀
let order = [];    // 공개 순서: 꼴찌 → 1위
let N = 36;        // 문항 수
let step = 0;      // 0 … order.length * N. 팀 i 의 문항 k 까지 열린 상태 = i*N + k
let playing = false;
let lastPos = new Map(); // 팀 id → 직전 화면 위치(0부터). 순위 변동 화살표용
let rowsById = new Map();

// ────────────────────────────────────────────── 데이터 준비
function prepare(b) {
  Q = b.문항.map((q) => ({ ...q }));
  N = Q.length;
  const byNo = new Map(Q.map((q) => [q.번호, q]));
  teams = b.행.map((r) => ({
    id: `${r.순위}-${r.팀명}`,
    팀명: r.팀명, 순번: r.순번, 순위: r.순위, 최종점수: r.최종점수, 계수: r.계수 ?? 1, 채택회차: r.채택회차,
    제출시각: Date.parse(r.제출시각) || 0,
    // 001 → 036 순서로 고정. 서버 detail 은 제출 순서지만 같은 순서라 보장은 여기서 한다.
    cells: [...(r.문항별 ?? [])].sort((x, y) => x.번호.localeCompare(y.번호)).map((d) => ({ ...d, 정답: byNo.get(d.번호)?.정답 })),
  }));
  unranked = (b.미채점 ?? []).map((r) => ({ id: `u-${r.팀명}`, 팀명: r.팀명, 순번: r.순번, unranked: true }));
  order = [...teams].sort((a, b2) => b2.순위 - a.순위); // 꼴찌부터
}

/** 팀의 지금 상태 — k개 열린 시점의 누적치. 정렬 기준은 scoring.js compareTeams 와 같다. */
function partial(t, k) {
  let raw = 0, quotes = 0, fp = 0;
  for (let i = 0; i < k; i++) {
    const c = t.cells[i];
    raw += c.점수;
    if (c.인용일치 === true) quotes++;
    if (c.정답 === '진짜' && c.판정 === '가짜') fp++;
  }
  const score = Math.round(raw * t.계수 * 100) / 100;
  return { raw, score, quotes, fp };
}
const cmp = (a, b) => (b.p.score - a.p.score) || (b.p.quotes - a.p.quotes) || (a.p.fp - b.p.fp) || (a.t.제출시각 - b.t.제출시각);

/** step 에서 각 팀이 몇 문항 열렸는지 */
function openedOf(t) {
  const i = order.indexOf(t);
  const cur = Math.floor(step / N);
  if (i < cur) return N;
  if (i === cur) return step % N;
  return 0;
}

/** 화면 순서: 공개된 팀(점수순) → 아직 안 연 팀(순번순) → 순위 없는 팀 */
function standings() {
  const st = teams.map((t) => { const k = openedOf(t); return { t, k, p: partial(t, k) }; });
  const shown = st.filter((s) => s.k > 0).sort(cmp);
  const hidden = st.filter((s) => s.k === 0).sort((a, b) => (a.t.순번 ?? 0) - (b.t.순번 ?? 0));
  return [...shown, ...hidden];
}

// ────────────────────────────────────────────── 그리기
const CELL = (c) => (c.점수 >= 1 ? ['full', '✓'] : c.점수 >= 0.5 ? ['half', '½'] : c.점수 > 0 ? ['unk', '?'] : ['zero', '✕']);
const cellTitle = (c) => `${c.번호} · 정답 ${c.정답} / 판정 ${c.판정}` + (c.인용일치 === true ? ' · 인용 일치' : c.인용일치 === false ? ' · 인용 불일치' : '') + ` · ${fmtScore(c.점수)}점`;

function buildRows() {
  $('board').style.setProperty('--n', N);
  fill($('head'), el('div'), el('div', { class: 'muted small' }, `${N}문항 · 001 → ${Q.at(-1)?.번호 ?? ''}`), el('div', { class: 'cells' }, Q.map((q) => el('div', { class: 'c', title: q.제목 }, q.번호.replace(/^0+/, '')))), el('div', { class: 'right muted small' }, '누적'));
  rowsById.clear();
  const make = (t) => {
    const row = el('div', { class: 'rrow team', dataset: { id: t.id } },
      el('div', { class: 'rank' }, el('span', { class: 'n' }), el('span', { class: 'd' })),
      el('div', { class: 'name' }, el('span', { class: 'nm', title: t.팀명 }, t.팀명), el('span', { class: 'sub' })),
      el('div', { class: 'cells' }, (t.cells ?? Q.map((q) => ({ 번호: q.번호 }))).map((c) => el('div', { class: 'c', dataset: { no: c.번호 } }))),
      el('div', { class: 'score' }, el('div', { class: 'val' }, '—'), el('div', { class: 'sub' })),
    );
    rowsById.set(t.id, row);
    return row;
  };
  fill($('rows'), teams.map(make), unranked.map(make));
  $('board').hidden = false;
}

/** step 에 맞게 전부 다시 그린다. animate=true 면 행 이동·셀 팝 애니메이션. */
function render({ animate = true, opened = null } = {}) {
  const st = standings();
  const cur = order[Math.floor(step / N)] ?? null;
  const finished = step >= order.length * N;
  const rows = $('rows');

  // 1) 위치 기억 (FLIP)
  const before = new Map();
  if (animate) for (const [id, row] of rowsById) before.set(id, row.getBoundingClientRect().top);

  // 2) 내용 갱신
  st.forEach((s, idx) => {
    const row = rowsById.get(s.t.id);
    const done = s.k >= N;
    row.className = ['rrow team', s.k === 0 ? 'hidden-team' : '', s.t === cur && !finished ? 'cur' : '', done ? 'done' : '', finished && idx < 3 ? `medal${idx + 1}` : ''].filter(Boolean).join(' ');
    row.querySelector('.rank .n').textContent = s.k > 0 ? String(idx + 1) : '';
    const coef = s.t.계수 !== 1 ? ` · 원점수 ${fmtScore(s.p.raw)} × ${s.t.계수.toFixed(2)}` : '';
    row.querySelector('.name .sub').textContent = done ? `${s.t.채택회차} 채택${coef} · 인용일치 ${s.p.quotes} · 오탐 ${s.p.fp}` : s.k > 0 ? `${s.k}/${N} 문항${coef} · 인용일치 ${s.p.quotes} · 오탐 ${s.p.fp}` : '아직 공개 전';
    const val = row.querySelector('.score .val');
    const txt = s.k > 0 ? fmtScore(s.p.score) : '—';
    if (val.textContent !== txt) { val.textContent = txt; if (animate) { val.classList.remove('bump'); void val.offsetWidth; val.classList.add('bump'); } }
    const cells = row.querySelectorAll('.cells .c');
    s.t.cells.forEach((c, i) => {
      const n = cells[i];
      const on = i < s.k;
      const [cls, mark] = on ? CELL(c) : ['', ''];
      const want = `c ${cls}` + (on && opened && opened.t === s.t && opened.i === i ? ' pop now' : '');
      if (n.className !== want) n.className = want;
      if (n.textContent !== mark) n.textContent = mark;
      n.title = on ? cellTitle(c) : '';
    });
    // 순위 변동 화살표
    const d = row.querySelector('.rank .d');
    const prev = lastPos.get(s.t.id);
    if (animate && s.k > 0 && prev !== undefined && prev !== idx) {
      const up = idx < prev;
      d.replaceChildren(el('span', { class: `delta ${up ? '' : 'down'}` }, `${up ? '▲' : '▼'}${Math.abs(prev - idx)}`));
    } else if (!animate) d.replaceChildren();
    lastPos.set(s.t.id, idx);
  });
  for (const u of unranked) {
    const row = rowsById.get(u.id);
    row.className = 'rrow team unranked';
    row.querySelector('.name .sub').textContent = '2차 제출 없음 · 순위 없음';
  }

  // 3) 순서 바꾸고 이동 애니메이션
  const nodes = [...st.map((s) => rowsById.get(s.t.id)), ...unranked.map((u) => rowsById.get(u.id))];
  rows.append(...nodes);
  if (animate) {
    for (const [id, row] of rowsById) {
      const dy = (before.get(id) ?? row.getBoundingClientRect().top) - row.getBoundingClientRect().top;
      if (!dy) continue;
      row.style.transition = 'none';
      row.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { row.style.transition = 'transform .55s cubic-bezier(.2,.8,.2,1)'; row.style.transform = ''; }));
    }
  }
  // 지금 팀이 보이게
  const curRow = cur && !finished ? rowsById.get(cur.id) : null;
  if (curRow && animate) curRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  // 4) 배너·진행
  renderBanner(opened, finished, st);
  const ti = Math.min(order.length, Math.floor(step / N) + (finished ? 0 : 1));
  fill($('progress'), finished ? el('strong', {}, '최종 순위 확정') : [el('strong', {}, cur?.팀명 ?? ''), ` · 팀 ${ti}/${order.length} · 문항 ${step % N}/${N}`]);
  $('btnPrev').disabled = step === 0;
  $('btnNext').disabled = finished;
  $('btnTeam').disabled = finished;
  $('btnAuto').disabled = finished && !playing;
  $('btnAuto').textContent = playing ? '멈춤 (A)' : '자동 재생';
  $('btnAuto').classList.toggle('on', playing);
}

function renderBanner(opened, finished, st) {
  const b = $('banner');
  if (finished) {
    const top = st[0];
    b.className = 'banner final';
    fill(b, el('div', {}, el('div', { class: 'qtitle' }, `🏆 우승 — ${top.t.팀명} (${fmtScore(top.p.score)}점)`), el('div', { class: 'qmeta', style: 'justify-content:center' }, `2위 ${st[1]?.t.팀명 ?? '—'} · 3위 ${st[2]?.t.팀명 ?? '—'}`)));
    b.hidden = false;
    return;
  }
  if (!opened) { b.hidden = true; return; }
  const q = Q[opened.i];
  const c = opened.t.cells[opened.i];
  const [cls] = CELL(c);
  const why = c.판정 === '판단 불가' ? '판단 불가' : c.판정 === q.정답 ? (q.정답 === '가짜' ? (c.인용일치 === false ? '가짜 적발, 인용 불일치' : '가짜 적발') : '진짜로 맞힘') : (q.정답 === '진짜' ? '진짜를 가짜로 (오탐)' : '가짜를 놓침');
  b.className = 'banner';
  fill(b,
    el('div', { class: 'qno' }, q.번호),
    el('div', { style: 'min-width:0' },
      el('div', { class: 'qtitle', title: q.제목 }, q.제목 || '(제목 없음)'),
      el('div', { class: 'qmeta' },
        el('span', { class: `badge ${q.정답 === '가짜' ? 'bad' : 'ok'}` }, `정답 ${q.정답}`),
        q.함정 ? el('span', { class: 'badge warn' }, '함정') : null,
        el('span', {}, `난이도 ${q.난이도}`), el('span', {}, '·'), el('span', {}, q.유형),
        el('span', {}, '·'), el('span', {}, q.정답률 === null || q.정답률 === undefined ? '정답률 —' : `전체 정답률 ${q.정답률}%`),
      ),
    ),
    el('div', { class: `result ${cls}` }, el('div', { class: 'who' }, `${opened.t.팀명} · ${c.판정} · ${why}`), el('div', { class: 'pts' }, `+${fmtScore(c.점수)}`)),
  );
  b.hidden = false;
}

// ────────────────────────────────────────────── 조작
const total = () => order.length * N;

function next() {
  if (step >= total()) return false;
  step++;
  const i = Math.floor((step - 1) / N);
  render({ opened: { t: order[i], i: (step - 1) % N } });
  return true;
}
function prev() {
  playing = false;
  if (step === 0) return;
  step--;
  render({ animate: true, opened: step % N ? { t: order[Math.floor((step - 1) / N)], i: (step - 1) % N } : null });
}
async function finishTeam() {
  if (playing) { playing = false; return; }
  const end = (Math.floor(step / N) + 1) * N;
  playing = true; render({ animate: false, opened: null });
  while (playing && step < Math.min(end, total())) { next(); await sleep(70); }
  playing = false; render({ animate: false, opened: null });
}
async function autoPlay() {
  if (playing) { playing = false; render({ animate: false }); return; }
  playing = true; render({ animate: false });
  while (playing && step < total()) {
    next();
    await sleep(step % N === 0 ? 1600 : 260); // 팀이 끝나면 잠깐 멈춰서 확정 순위를 보여준다
  }
  playing = false; render({ animate: false });
}
function reset() { playing = false; step = 0; lastPos.clear(); render({ animate: false }); }

function bindControls() {
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  $('btnNext').addEventListener('click', stop(() => { playing = false; next(); }));
  $('btnPrev').addEventListener('click', stop(prev));
  $('btnTeam').addEventListener('click', stop(finishTeam));
  $('btnAuto').addEventListener('click', stop(autoPlay));
  $('btnReset').addEventListener('click', stop(reset));
  $('btnFull').addEventListener('click', stop(() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())));
  $('bar').addEventListener('click', (e) => e.stopPropagation());
  $('body').addEventListener('click', () => { playing = false; next(); });
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === ' ' || k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); playing = false; next(); }
    else if (k === 'ArrowLeft' || k === 'Backspace' || k === 'ArrowUp') { e.preventDefault(); prev(); }
    else if (k === 'Enter') { e.preventDefault(); finishTeam(); }
    else if (k === 'a' || k === 'A') autoPlay();
    else if (k === 'r' || k === 'R') reset();
    else if (k === 'f' || k === 'F') $('btnFull').click();
    else if (k === 'Escape') playing = false;
  });
}

// ────────────────────────────────────────────── 시작
async function main() {
  bindControls();
  let b;
  try {
    b = DEMO ? demoBoard() : await api('/api/board');
  } catch (e) {
    $('msg').textContent = e.message;
    return;
  }
  if (!b.마감후) {
    fill($('msg'), '아직 마감 전이라 점수가 공개되지 않았습니다. 마감 후에 다시 여세요.', el('br'), el('a', { href: 'reveal.html?demo=1' }, '가짜 데이터로 미리 보기'));
    return;
  }
  if (!b.행?.length) { $('msg').textContent = '순위에 든 팀이 없습니다.'; return; }
  prepare(b);
  $('msg').hidden = true;
  if (DEMO) $('title').textContent = '결과 발표 · 데모';
  buildRows();
  render({ animate: false });
  // 검증용: 전부 열었을 때의 순서가 서버 순위와 같은지. 콘솔에만 찍는다.
  const saved = step; step = total();
  const finalOrder = standings().map((s) => s.t.순위);
  step = saved;
  const ok = finalOrder.every((r, i) => r === i + 1);
  console[ok ? 'log' : 'warn']('[reveal] 최종 순서 검증', ok ? '일치' : '불일치', finalOrder);
  window.__reveal = { get step() { return step; }, set step(v) { step = v; render({ animate: false }); }, standings, order, total, next, prev, ok };
}
main();

// ────────────────────────────────────────────── 데모 데이터 (?demo=1)
// 서버 응답과 같은 모양의 가짜 리더보드. 실제 정답표·기사와 무관하다.
function demoBoard() {
  let seed = Number(params.get('seed') ?? 7) || 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const NQ = 36;
  const TOPICS = ['유전자 가위로 난치병 완치', '화성 대기에서 산소 생성 실험', '초전도체 상온 구현 주장', '뇌-컴퓨터 인터페이스 임상', '심해 열수구 신종 발견', '백신 부작용 통계 재분석', '핵융합 점화 지속 시간 경신', '미세플라스틱 혈액 검출', '양자컴퓨터 소인수분해 기록', '고대 DNA 로 본 이주 경로', '나노로봇 종양 표적 치료', '태양광 효율 40% 돌파'];
  const 문항 = Array.from({ length: NQ }, (_, i) => ({
    번호: String(i + 1).padStart(3, '0'), 정답: rnd() < 0.6 ? '가짜' : '진짜', 난이도: pick(['하', '중', '상']), 유형: pick(['숫자', '인과', '출처', '단위', '시점', '자유']),
    함정: rnd() < 0.15, 제목: `${pick(TOPICS)} — 데모 ${i + 1}`,
  }));
  const NAMES = ['빛의속도', '가설검정단', '팩트체커스', '오차범위', '재현성', '피어리뷰', '귀무가설', '표본추출', '대조군', '이중맹검', '메타분석', '베이지안', '카이제곱', 'p값사냥꾼'];
  const rows = NAMES.map((name, i) => {
    const skill = 0.45 + rnd() * 0.5;
    const round = pick(['2차-1', '2차-1', '2차-2', '2차-3']);
    const 계수 = { '2차-1': 1, '2차-2': 0.95, '2차-3': 0.9 }[round];
    let raw = 0, 적발 = 0, 인용일치 = 0, 오탐 = 0, 판단불가 = 0;
    const 문항별 = 문항.map((q) => {
      let 판정, 점수 = 0, quote = null;
      if (rnd() < 0.06) { 판정 = '판단 불가'; 점수 = 0.25; 판단불가++; }
      else if (q.정답 === '가짜') {
        if (rnd() < skill) { 판정 = '가짜'; 적발++; quote = q.유형 === '자유' ? true : rnd() < skill; 점수 = quote ? 1 : 0.5; if (quote) 인용일치++; }
        else { 판정 = '진짜'; 점수 = 0; }
      } else {
        if (rnd() < skill + 0.25) { 판정 = '진짜'; 점수 = 1; } else { 판정 = '가짜'; 오탐++; 점수 = 0; }
      }
      raw += 점수;
      return { 번호: q.번호, 판정, 점수, 인용일치: quote };
    });
    const 원점수 = Math.round(raw * 100) / 100;
    return { 순번: i + 1, 팀명: name, 채택회차: round, 원점수, 계수, 최종점수: Math.round(원점수 * 계수 * 100) / 100, 적발, 인용일치, 오탐, 판단불가, 제출시각: new Date(Date.UTC(2026, 8, 20, 4, 0, i * 3 + Math.floor(rnd() * 100))).toISOString(), 문항별 };
  });
  rows.sort((a, b) => (b.최종점수 - a.최종점수) || (b.인용일치 - a.인용일치) || (a.오탐 - b.오탐) || (Date.parse(a.제출시각) - Date.parse(b.제출시각)));
  const 행 = rows.map((r, i) => ({ 순위: i + 1, ...r }));
  const per = 문항.map((q) => { const n = 행.filter((r) => r.문항별.find((d) => d.번호 === q.번호).판정 === q.정답).length; return { ...q, 응답: 행.length, 정답률: Math.round((n / 행.length) * 1000) / 10, 인용일치율: null, 판단불가: 0 }; });
  return { 마감후: true, 마감시각: null, 강제: null, 생성시각: new Date().toISOString(), 팀수: 행.length + 1, 행, 미채점: [{ 순번: 99, 팀명: '미제출팀' }], 문항: per, 난이도별: {} };
}
