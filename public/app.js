/* 제출·리더보드·운영자 화면 공용 스크립트.
   여기에 정답표를 넣지 않는다. 이 파일은 전부 공개된다. */

// Worker 주소. 배포 뒤 실제 주소로 바꾼다. 로컬에서 `wrangler dev` 를 띄우면 8787 로 붙는다.
const PROD_API = 'https://contest-api.hisfact.workers.dev';
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
export const API = isLocal ? 'http://127.0.0.1:8787' : PROD_API;

/** JSON API 호출. 실패하면 서버가 준 error 메시지를 담은 예외를 던진다. */
export async function api(path, body, method = body ? 'POST' : 'GET') {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('서버에 연결할 수 없습니다. 네트워크를 확인하세요.'), { status: 0 });
  }
  let data = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `서버 오류 ${res.status}`), { status: res.status, detail: data?.detail });
  return data;
}

/** 요소 생성 헬퍼: el('div', {class:'x', onclick}, child, ...) */
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

const KST = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const KST_SHORT = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const KST_FULL = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export const fmtTime = (iso, mode = 'full') => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return (mode === 'short' ? KST_SHORT : mode === 'long' ? KST_FULL : KST).format(d);
};

export const fmtScore = (n, digits = 2) => (n === null || n === undefined ? '—' : Number(n).toFixed(digits).replace(/\.?0+$/, ''));

/** 남은 시간 문자열 */
export function remainingText(deadlineIso) {
  const t = Date.parse(deadlineIso);
  if (!Number.isFinite(t)) return '';
  let s = Math.max(0, Math.floor((t - Date.now()) / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${h}시간 ${String(m).padStart(2, '0')}분 ${String(s).padStart(2, '0')}초`;
}

/** 상단 공용 바 */
export function mountTop(current) {
  // 상단에는 제출 링크만 둔다. 학생은 마감 후 제출 화면의 "내 결과 보기" 링크(board.html)로 자기 결과만 보고,
  // 전체 순위는 결과 발표(reveal.html, 관리키 필요)에서만 공개한다.
  const links = [['index.html', '결과 제출']];
  const top = el('header', { class: 'top' },
    el('span', { class: 'brand' }, 'AI 동행 프로젝트 책임/안전 분과 해커톤 대회'),
    el('nav', {}, links.map(([href, label]) => el('a', { href, 'aria-current': current === href ? 'page' : null }, label))),
    el('span', { class: 'spacer' }),
    el('span', { class: 'server', id: 'serverClock' }),
  );
  document.body.prepend(top);
}

/** replaceChildren 인데 null/false/배열을 걸러 준다. */
export function fill(node, ...kids) {
  node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false).map((k) => (k.nodeType ? k : document.createTextNode(String(k)))));
  return node;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
