/**
 * GitHub Contents API 흉내 — 메모리 저장소.
 * 테스트(worker.test.js)와 로컬 개발 서버(scripts/dev-local.mjs)가 함께 쓴다.
 */
import { encodeUtf8Base64, decodeUtf8Base64 } from '../src/index.js';

export function fakeGitHub(initial = {}) {
  const store = new Map(); // path → { content(json string), sha }
  let counter = 0;
  const put = (path, obj) => store.set(path, { content: typeof obj === 'string' ? obj : JSON.stringify(obj), sha: `sha${++counter}` });
  for (const [p, v] of Object.entries(initial)) put(p, v);
  const log = [];
  const fetchImpl = async (url, init = {}) => {
    const m = String(url).match(/\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (!m) return new Response('no', { status: 500 });
    const path = decodeURIComponent(m[1]);
    const method = init.method ?? 'GET';
    log.push(`${method} ${path}`);
    if (method === 'GET') {
      if (store.has(path)) {
        const f = store.get(path);
        return Response.json({ sha: f.sha, content: encodeUtf8Base64(f.content).replace(/(.{60})/g, '$1\n') });
      }
      const children = [...store.keys()].filter((k) => k.startsWith(path + '/'));
      if (children.length) return Response.json(children.map((k) => ({ type: 'file', name: k.slice(path.length + 1) })));
      return new Response('{}', { status: 404 });
    }
    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      const cur = store.get(path);
      if (cur && cur.sha !== body.sha) return new Response('{}', { status: 409 });
      if (!cur && body.sha) return new Response('{}', { status: 422 });
      store.set(path, { content: decodeUtf8Base64(body.content), sha: `sha${++counter}` });
      return Response.json({ content: { sha: `sha${counter}` } });
    }
    return new Response('no', { status: 405 });
  };
  return { store, log, fetchImpl, put, get: (p) => JSON.parse(store.get(p).content) };
}
