/**
 * 로컬 개발 서버 — Cloudflare 도 GitHub 도 없이 화면과 Worker 를 함께 띄운다.
 *
 *   npm run dev:local
 *   → http://127.0.0.1:8080/index.html   (public/ 정적 파일)
 *   → http://127.0.0.1:8787/api/...      (Worker 를 그대로 실행, 저장소는 메모리)
 *
 * 정답표는 test/answer_key.json (npm run setup:test 가 복사해 온 것), 팀 명부는 아래 DEV_TEAMS.
 * 서버를 끄면 제출 기록은 사라진다. 실제 배포 구성은 wrangler.toml 을 본다.
 *
 * 환경변수
 *   DEADLINE_ISO   마감 시각 (기본: 내일)      ADMIN_KEY  운영자 키 (기본 dev-admin)
 *   PORT / API_PORT  포트 (기본 8080 / 8787)
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname } from 'node:path';
import worker from '../src/index.js';
import { fakeGitHub } from '../test/fake-github.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(here, '..', '..', 'public');
const keyPath = resolve(here, '..', 'test', 'answer_key.json');
if (!existsSync(keyPath)) {
  console.error('test/answer_key.json 이 없습니다. 먼저 `npm run setup:test` 를 실행하세요.');
  process.exit(1);
}

export const DEV_TEAMS = {
  세트: 'A_대회용',
  설명: '로컬 개발용 명부. 실제 코드가 아니다.',
  팀: {
    DEVTEAMAAAA1: { 코드표기: 'DEVT-EAMA-AAA1', 팀명: '개발1팀', 순번: 1 },
    DEVTEAMBBBB2: { 코드표기: 'DEVT-EAMB-BBB2', 팀명: '', 순번: 2 },
    DEVTEAMCCCC3: { 코드표기: 'DEVT-EAMC-CCC3', 팀명: '개발3팀', 순번: 3 },
  },
};

const gh = fakeGitHub({ 'answer_key.json': readFileSync(keyPath, 'utf8'), 'teams.json': DEV_TEAMS });
globalThis.fetch = gh.fetchImpl;

const tomorrow = new Date(Date.now() + 86400e3).toISOString();
const env = {
  PRIVATE_REPO: 'local/dev', ANSWER_KEY_PATH: 'answer_key.json', TEAMS_PATH: 'teams.json', SET_NAME: 'A_대회용',
  DEADLINE_ISO: process.env.DEADLINE_ISO ?? tomorrow, MAX_ATTEMPTS_1: '1', MAX_ATTEMPTS_2: '3',
  GITHUB_TOKEN: 'dev', ADMIN_KEY: process.env.ADMIN_KEY ?? 'dev-admin',
};

const API_PORT = Number(process.env.API_PORT ?? 8787);
const PORT = Number(process.env.PORT ?? 8080);

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request(`http://127.0.0.1:${API_PORT}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, { waitUntil() {} });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(API_PORT, () => console.log(`API     http://127.0.0.1:${API_PORT}/api/health`));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json; charset=utf-8' };
http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = resolve(PUBLIC, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(PUBLIC) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`화면    http://127.0.0.1:${PORT}/index.html\n운영자  http://127.0.0.1:${PORT}/admin.html  (관리키 ${env.ADMIN_KEY})\n개발용 팀 코드: ${Object.values(DEV_TEAMS.팀).map((t) => t.코드표기).join(', ')}`));
