/**
 * 제출 JSON 검증 — 브라우저(형식 검사)와 Worker(제출 접수)가 같은 코드를 쓴다.
 *
 * 1) schema.json 에 대한 검증 (여기서 쓰는 키워드만 구현한 작은 검증기)
 * 2) 스키마로 표현하기 어려운 의미 검사 — 번호 빠짐·중복, 1차의 웹검색, 빈 인용
 *
 * 정답표는 여기 없다. 어느 문항이 가짜인지 전혀 모르는 상태에서 하는 검사다.
 */

// ────────────────────────────────────────────── 작은 JSON Schema 검증기

const TYPE_NAME = { object: '객체', array: '배열', string: '문자열', boolean: '참/거짓', number: '숫자', integer: '정수' };

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function pathStr(path) {
  return path.length ? path.join('.') : '(최상위)';
}

/**
 * @returns {Array<{path:string, keyword:string, message:string}>} 비어 있으면 통과
 */
export function validateSchema(schema, data, path = [], out = []) {
  const here = pathStr(path);
  if (schema.type) {
    const t = typeOf(data);
    const ok = schema.type === 'integer' ? Number.isInteger(data) : t === schema.type;
    if (!ok) {
      out.push({ path: here, keyword: 'type', message: `${here}: ${TYPE_NAME[schema.type] ?? schema.type}이어야 하는데 ${TYPE_NAME[t] ?? t}입니다` });
      return out; // 타입이 다르면 아래 검사는 의미가 없다
    }
  }
  if (schema.enum && !schema.enum.includes(data)) {
    out.push({ path: here, keyword: 'enum', message: `${here}: "${String(data)}" 은(는) 허용되지 않습니다. 가능한 값: ${schema.enum.join(' / ')}` });
  }
  if (typeof data === 'string') {
    if (schema.minLength !== undefined && Array.from(data).length < schema.minLength)
      out.push({ path: here, keyword: 'minLength', message: `${here}: 비어 있습니다` });
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(data))
      out.push({ path: here, keyword: 'pattern', message: `${here}: "${data}" 형식이 맞지 않습니다` });
  }
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems)
      out.push({ path: here, keyword: 'minItems', message: `${here}: ${schema.minItems}개여야 하는데 ${data.length}개입니다` });
    if (schema.maxItems !== undefined && data.length > schema.maxItems)
      out.push({ path: here, keyword: 'maxItems', message: `${here}: ${schema.maxItems}개여야 하는데 ${data.length}개입니다` });
    if (schema.items) data.forEach((item, i) => validateSchema(schema.items, item, [...path, `[${i}]`], out));
  }
  if (typeOf(data) === 'object') {
    for (const k of schema.required ?? []) {
      if (!(k in data)) out.push({ path: here, keyword: 'required', message: `${here}: "${k}" 항목이 없습니다` });
    }
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(data)) {
      if (props[k]) validateSchema(props[k], v, [...path, k], out);
      else if (schema.additionalProperties === false)
        out.push({ path: here, keyword: 'additionalProperties', message: `${here}: "${k}" 은(는) 허용되지 않는 항목입니다` });
    }
  }
  return out;
}

// ────────────────────────────────────────────── 의미 검사

export const ROUNDS = ['1차', '2차-1', '2차-2', '2차-3'];
export const ALL_NUMBERS = Array.from({ length: 36 }, (_, i) => String(i + 1).padStart(3, '0'));

/** 사람이 읽기 좋게 스키마 오류 메시지를 다듬는다. */
function friendly(e) {
  if (e.path === 'meta.모델' && e.keyword === 'pattern')
    return 'meta.모델: 대회 지정 모델은 Solar Pro 4 입니다. 다른 모델의 제출은 무효입니다';
  if (e.path.startsWith('answers[') && e.path.endsWith('.판정') && e.keyword === 'enum')
    return `${e.path}: 판정은 "진짜" / "가짜" / "판단 불가" 셋 중 하나여야 합니다 (띄어쓰기 포함)`;
  if (e.path.startsWith('answers[') && e.path.endsWith('.번호') && e.keyword === 'pattern')
    return `${e.path}: 번호는 "001" 처럼 세 자리 문자열이어야 합니다`;
  if (e.path === 'answers' && (e.keyword === 'minItems' || e.keyword === 'maxItems'))
    return `${e.message} — 001부터 036까지 전부 있어야 합니다`;
  return e.message;
}

/**
 * 제출본 하나를 검사한다. 서버는 errors 만 본다. warnings 는 브라우저 안내용이다.
 *
 * @param {object} schema   schema.json
 * @param {any} data        파싱된 제출 JSON
 * @param {{expectedPhase?: '1차'|'2차', setLetter?: string}} [opts]
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkSubmission(schema, data, opts = {}) {
  const errors = validateSchema(schema, data).map(friendly);
  const warnings = [];
  if (errors.length) return { errors, warnings };

  // 번호 빠짐·중복
  const seen = new Map();
  for (const a of data.answers) seen.set(a.번호, (seen.get(a.번호) ?? 0) + 1);
  const dup = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  const missing = ALL_NUMBERS.filter((n) => !seen.has(n));
  if (dup.length) errors.push(`번호가 중복됩니다: ${dup.join(', ')}`);
  if (missing.length) errors.push(`번호가 빠졌습니다: ${missing.join(', ')}`);

  // 세트
  if (opts.setLetter && data.meta.세트 !== opts.setLetter)
    errors.push(`meta.세트: 이번 대회는 ${opts.setLetter} 세트입니다 (제출본은 ${data.meta.세트})`);

  // 1차는 웹 검색을 쓰지 않는다
  const phase = data.meta.조건.startsWith('1차') ? '1차' : '2차';
  if (phase === '1차' && data.meta.웹검색 === true)
    errors.push('meta.웹검색: 1차는 웹 검색 없이 진행합니다. 웹검색이 true 이면 1차로 접수할 수 없습니다');
  if (opts.expectedPhase && phase !== opts.expectedPhase)
    errors.push(`meta.조건: 지금은 ${opts.expectedPhase} 제출 차례인데 제출본의 조건은 "${data.meta.조건}" 입니다`);

  // 가짜인데 인용이 비었으면 감점 안내 (막지는 않는다 — 인용할 문장이 없는 문항도 있다)
  const noQuote = data.answers.filter((a) => a.판정 === '가짜' && !(a.인용 ?? '').trim()).map((a) => a.번호);
  if (noQuote.length)
    warnings.push(`가짜로 판정했지만 인용이 비어 있습니다: ${noQuote.join(', ')} — 인용이 없으면 그 문항은 최대 0.5점입니다`);
  const noReason = data.answers.filter((a) => a.판정 === '가짜' && !(a.근거 ?? '').trim()).map((a) => a.번호);
  if (noReason.length)
    warnings.push(`가짜로 판정했지만 근거가 비어 있습니다: ${noReason.join(', ')} — 점수에는 영향이 없지만 동점 처리·심사에 쓰입니다`);

  return { errors, warnings };
}

/** 회차 문자열에서 1차/2차 구분만 뽑는다. */
export const phaseOf = (round) => (String(round).startsWith('1차') ? '1차' : '2차');
