/* 제출 화면. 형식 검사는 전부 브라우저에서 한다 — 정답표는 여기 없다. */
import { api, el, fill, fmtTime, fmtScore, mountTop, remainingText } from './app.js';
import schema from './shared/schema.js';
import { checkSubmission, phaseOf } from './shared/validate.js';
import { locateQuote, normalize, QUOTE_MIN } from './shared/textmatch.js';

mountTop('index.html');

const $ = (id) => document.getElementById(id);
const state = { code: '', status: null, parsed: null, passed: false, clockOffset: 0 };

// ────────────────────────────────────────────── 서버 시각 표시

setInterval(() => {
  const now = new Date(Date.now() + state.clockOffset);
  const dl = state.status?.마감시각;
  let text = `서버 시각 ${fmtTime(now.toISOString(), 'short')}`;
  if (dl && !state.status.마감후) text += ` · 마감까지 ${remainingText(dl)}`;
  $('serverClock').textContent = text;
}, 1000);

// ────────────────────────────────────────────── 1단계 — 팀 코드

const savedCode = sessionStorage.getItem('teamCode');
if (savedCode) { $('codeInput').value = savedCode; loadStatus(); }

$('codeBtn').addEventListener('click', loadStatus);
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadStatus(); });

async function loadStatus(keepResult = false) {
  const code = $('codeInput').value.trim();
  if (!code) return;
  $('codeBtn').disabled = true;
  const box = $('statusBox');
  box.hidden = false;
  fill(box, el('p', { class: 'muted' }, '확인 중…'));
  try {
    const st = await api(`/api/status?code=${encodeURIComponent(code)}`);
    state.code = code;
    state.status = st;
    state.clockOffset = Date.parse(st.서버시각) - Date.now();
    sessionStorage.setItem('teamCode', code);
    sessionStorage.setItem('teamName', st.팀명); // 리더보드에서 내 줄을 강조하는 데만 쓴다
    renderStatus(st);
    $('step2').dataset.disabled = st.마감후 ? 'true' : 'false';
    resetChecks(keepResult);
  } catch (e) {
    state.status = null;
    $('step2').dataset.disabled = 'true';
    $('step3').dataset.disabled = 'true';
    fill(box, el('div', { class: 'alert bad' }, e.status === 403 ? '등록되지 않은 팀 코드입니다. 배부받은 코드를 다시 확인하세요.' : e.message));
  } finally {
    $('codeBtn').disabled = false;
  }
}

function renderStatus(st) {
  const rounds = ['1차', '2차-1', '2차-2', '2차-3'];
  const box = $('statusBox');
  fill(box, 
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('strong', {}, st.팀명),
      el('span', { class: 'badge info mono' }, st.코드표기),
      st.마감후 ? el('span', { class: 'badge bad' }, '마감') : el('span', { class: 'badge ok' }, '진행 중'),
    ),
    el('div', { class: 'status-round' }, rounds.map((r) => {
      const s = st.제출[r];
      return el('div', {},
        el('div', { class: 'rn' }, r, r === '1차' ? ' (순위 미반영)' : ` · 계수 ${{ '2차-1': '1.00', '2차-2': '0.95', '2차-3': '0.90' }[r]}`),
        s ? el('div', { class: 'rv' }, `${fmtScore(s.점수)}점`) : el('div', { class: 'rv muted' }, '—'),
        el('div', { class: 'muted' }, s ? fmtTime(s.제출시각) : '미제출'),
      );
    })),
    el('p', { class: 'small', style: 'margin:10px 0 0' },
      `남은 시도 — 1차 ${st.남은시도['1차']}회 · 2차 ${st.남은시도['2차']}회`,
      st.마감시각 ? ` · 마감 ${fmtTime(st.마감시각, 'long')}` : '',
    ),
    st.마감후 ? el('div', { class: 'alert bad' }, '마감되었습니다. 더 이상 제출할 수 없습니다. 결과는 리더보드에서 확인하세요.') : null,
  );
}

// ────────────────────────────────────────────── 2단계 — 형식 검사

$('checkBtn').addEventListener('click', runChecks);
$('jsonInput').addEventListener('input', () => { if (state.passed) resetChecks(); });

function resetChecks(keepResult = false) {
  state.passed = false;
  state.parsed = null;
  $('checkList').hidden = true;
  fill($('checkList'));
  $('submitBtn').disabled = true;
  $('confirmBox').hidden = true;
  if (!keepResult) {
    $('step3').dataset.disabled = 'true';
    $('submitHint').textContent = '형식 검사를 통과하면 열립니다.';
    $('resultBox').hidden = true;
  }
}

/** 코드펜스·BOM 을 벗기고 JSON 만 남긴다. 학생이 채팅창에서 복사하면 ```json 이 따라온다. */
function stripFences(text) {
  let t = text.replace(/^﻿/, '').trim();
  const m = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/);
  if (m) t = m[1].trim();
  return t;
}

function parseError(text, err) {
  const m = String(err.message).match(/position (\d+)/) ?? String(err.message).match(/line (\d+) column (\d+)/);
  if (!m) return err.message;
  let line, col;
  if (m.length === 3) { line = +m[1]; col = +m[2]; }
  else {
    const pos = +m[1];
    const before = text.slice(0, pos);
    line = before.split('\n').length;
    col = pos - before.lastIndexOf('\n');
  }
  const snippet = text.split('\n')[line - 1] ?? '';
  return `${line}번째 줄 ${col}번째 글자 근처에서 깨졌습니다.\n${snippet.trim().slice(0, 120)}\n흔한 원인: 마지막 항목 뒤의 쉼표, 인용문 안의 큰따옴표(") — 따옴표는 ' 로 바꿔 적으세요.`;
}

const articleCache = new Map();
async function loadArticle(no) {
  if (!articleCache.has(no)) {
    articleCache.set(no, fetch(`articles/${no}.md`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`기사 ${no} 를 불러올 수 없습니다`)))));
  }
  return articleCache.get(no);
}

async function runChecks() {
  if (!state.status) return;
  const list = $('checkList');
  const items = [];
  const push = (level, title, detail) => items.push({ level, title, detail });
  const render = () => {
    list.hidden = false;
    fill(list, items.map((it) => el('li', { class: it.level },
      el('span', { class: 'mark' }, it.level === 'ok' ? '✓' : it.level === 'warn' ? '△' : '✕'),
      el('div', {}, el('div', { class: 'title' }, it.title), it.detail ? el('div', { class: 'detail' }, it.detail) : null),
    )));
  };
  const finish = () => {
    render();
    const bad = items.filter((i) => i.level === 'bad').length;
    const warn = items.filter((i) => i.level === 'warn').length;
    state.passed = bad === 0;
    $('step3').dataset.disabled = state.passed ? 'false' : 'true';
    $('submitBtn').disabled = !state.passed;
    $('submitHint').textContent = state.passed
      ? (warn ? `통과 (주의 ${warn}건). 주의 사항을 확인한 뒤 제출하세요.` : '통과. 제출할 수 있습니다.')
      : `문제 ${bad}건을 고친 뒤 다시 형식 검사를 누르세요.`;
    $('checkBtn').disabled = false;
  };

  state.passed = false;
  $('checkBtn').disabled = true;
  $('confirmBox').hidden = true;
  $('resultBox').hidden = true;

  // 1. JSON 파싱
  const text = stripFences($('jsonInput').value);
  if (!text) { push('bad', 'JSON 읽기', '붙여넣은 내용이 없습니다.'); return finish(); }
  let data;
  try { data = JSON.parse(text); }
  catch (e) { push('bad', 'JSON 읽기', parseError(text, e)); return finish(); }
  push('ok', 'JSON 읽기', text !== $('jsonInput').value.trim() ? '코드펜스(```)를 벗기고 읽었습니다.' : null);

  // 2~4·6. 스키마와 의미 검사 (Worker 와 같은 코드)
  const { errors, warnings } = checkSubmission(schema, data, { setLetter: 'A' });
  const modelErr = errors.filter((e) => e.includes('Solar Pro 4'));
  const restErr = errors.filter((e) => !e.includes('Solar Pro 4'));
  if (restErr.length) push('bad', '구조와 항목', restErr.slice(0, 12).join('\n') + (restErr.length > 12 ? `\n… 외 ${restErr.length - 12}건` : ''));
  else push('ok', '구조와 항목', 'meta 와 answers 36개, 번호 001~036, 판정 값이 모두 올바릅니다.');
  if (modelErr.length) push('bad', '모델', modelErr[0]);
  else if (data.meta?.모델) push('ok', '모델', `${data.meta.모델}`);
  if (errors.length) return finish();

  // 5. 회차
  const st = state.status;
  const phase = phaseOf(data.meta.조건);
  const next = st.다음회차[phase];
  if (!next) push('bad', '회차', `${phase} 제출 횟수를 모두 사용했습니다 (남은 ${phase} 시도 0회). 제출본의 조건은 "${data.meta.조건}" 입니다.`);
  else if (next !== data.meta.조건) push('warn', '회차', `제출본의 조건은 "${data.meta.조건}" 이지만 이 팀의 다음 ${phase} 회차는 ${next} 입니다. 서버는 ${next} 로 기록합니다.`);
  else push('ok', '회차', `${next} 로 접수됩니다. 남은 ${phase} 시도 ${st.남은시도[phase]}회.`);

  // 6. 빈 인용·근거 (경고)
  for (const w of warnings) push('warn', w.includes('근거') ? '근거' : '인용 채움', w);

  // 7·8. 인용 위치 대조 / 원문 충실도
  const fakes = data.answers.filter((a) => a.판정 === '가짜' && (a.인용 ?? '').trim());
  if (fakes.length) {
    push('ok', '인용 위치 대조', '기사 원문을 불러와 확인하는 중…');
    render();
    try {
      const all = await Promise.all(Array.from({ length: 36 }, (_, i) => String(i + 1).padStart(3, '0')).map(async (no) => [no, await loadArticle(no)]));
      const articles = new Map(all);
      const misplaced = [], missing = [], partial = [];
      for (const a of fakes) {
        const art = articles.get(a.번호);
        const r = locateQuote(a.인용, art);
        if (r.포함) continue;
        const pct = Math.round(r.충실도 * 100);
        if (r.공통길이 < QUOTE_MIN) {
          // 채점기는 원문과 15자 이상 이어지는 구간이 있어야 인용 일치로 본다. 그게 없으면 이 문항은 확실히 0.5점이다.
          // 다른 기사의 문장을 잘못된 칸에 적은 것은 아닌지 본다 (예비실험에서 실제로 있었던 사고).
          const near = [...articles]
            .filter(([no]) => no !== a.번호)
            .map(([no, text]) => [no, locateQuote(a.인용, text)])
            .filter(([, x]) => x.공통길이 >= QUOTE_MIN && x.충실도 >= 0.5)
            .sort((x, y) => y[1].충실도 - x[1].충실도)[0];
          if (near) misplaced.push(`${a.번호}번의 인용문이 ${a.번호}.md 에 없습니다 — ${near[0]}.md 의 문장으로 보입니다. 번호를 확인하세요.`);
          else missing.push(`${a.번호}번의 인용문이 ${a.번호}.md 에 없습니다 (원문과 이어지는 구간 ${r.공통길이}자). 요약하지 말고 기사에 있는 문장을 그대로 복사하세요. 이대로 내면 이 문항은 최대 0.5점입니다.`);
        } else {
          partial.push(`${a.번호}번의 인용문은 원문과 ${pct}%만 이어집니다 (가장 긴 일치 구간 ${r.공통길이}자). 조작된 부분이 그대로 옮긴 구간 안에 있어야 인용 일치로 인정됩니다. 여러 문장을 이어 붙였거나 일부를 바꿔 적지 않았는지 확인하세요.`);
        }
      }
      items.pop();
      if (misplaced.length || missing.length) push('bad', '인용 위치 대조', [...misplaced, ...missing].join('\n'));
      else push('ok', '인용 위치 대조', `가짜로 판정한 ${fakes.length}건의 인용문이 모두 해당 기사에 있습니다.`);
      if (partial.length) push('warn', '인용 원문 충실도', partial.join('\n'));
      else if (!misplaced.length && !missing.length) push('ok', '인용 원문 충실도', '인용문이 모두 원문 그대로입니다.');
    } catch (e) {
      items.pop();
      push('warn', '인용 위치 대조', `기사 원문을 불러오지 못해 건너뜁니다 (${e.message}). 제출은 가능합니다.`);
    }
  } else {
    push('ok', '인용 위치 대조', '대조할 인용문이 없습니다.');
  }

  state.parsed = data;
  finish();
}

// ────────────────────────────────────────────── 3단계 — 제출

$('submitBtn').addEventListener('click', () => {
  if (!state.passed || !state.parsed) return;
  const phase = phaseOf(state.parsed.meta.조건);
  const next = state.status.다음회차[phase];
  const left = state.status.남은시도[phase];
  const box = $('confirmBox');
  box.className = 'alert warn';
  box.hidden = false;
  fill(box, 
    el('div', {}, el('strong', {}, `${next} 로 제출합니다.`), ` 남은 ${phase} 시도 ${left}회 → ${left - 1}회. 제출 후에는 취소할 수 없습니다.`),
    el('div', { class: 'row', style: 'margin-top:10px' },
      el('button', { class: 'primary', onclick: doSubmit }, '확인하고 제출'),
      el('button', { onclick: () => { box.hidden = true; } }, '취소'),
    ),
  );
});

async function doSubmit() {
  const box = $('confirmBox');
  fill(box, el('span', {}, '제출 중… 채점에 몇 초 걸립니다.'));
  $('submitBtn').disabled = true;
  try {
    const r = await api('/api/submit', { 팀코드: state.code, result: state.parsed });
    box.hidden = true;
    const res = $('resultBox');
    res.hidden = false;
    fill(res, 
      el('div', { class: 'alert ok' }, el('strong', {}, `${r.회차} 접수 완료`), ` · ${fmtTime(r.제출시각)}`),
      el('div', { class: 'score' },
        el('span', { class: 'big' }, fmtScore(r.점수)),
        el('span', { class: 'of' }, `/ ${r.만점}점`),
        r.가중점수 !== null ? el('span', { class: 'badge info' }, `계수 ${r.계수.toFixed(2)} → 가중 ${fmtScore(r.가중점수)}점`) : el('span', { class: 'badge' }, '순위 미반영 (1차)'),
      ),
      el('p', { class: 'muted small' }, r.안내, ` 남은 시도 — 1차 ${r.남은시도['1차']}회 · 2차 ${r.남은시도['2차']}회.`),
    );
    state.passed = false;
    state.parsed = null;
    $('jsonInput').value = '';
    $('checkList').hidden = true;
    await loadStatus(true);
    $('submitHint').textContent = '다음 회차를 내려면 JSON 을 다시 붙여넣고 형식 검사를 하세요.';
  } catch (e) {
    box.hidden = false;
    box.className = 'alert bad';
    const lines = [e.message];
    if (Array.isArray(e.detail)) lines.push(...e.detail);
    if (e.status === 409) lines.push('같은 팀에서 동시에 제출이 들어왔습니다. 잠시 뒤 상태를 다시 확인하고, 아직 접수되지 않았으면 다시 제출하세요.');
    fill(box, el('div', { style: 'white-space:pre-wrap' }, lines.join('\n')));
    if (e.status === 429 || e.status === 403) await loadStatus().catch(() => {});
    else $('submitBtn').disabled = false;
  }
}
