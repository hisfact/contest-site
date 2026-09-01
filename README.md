# 저장소 A — contest-site

Cloudflare Pages 에 연결한다. **여기 커밋한 파일은 전부 웹으로 열린다.**
비공개 저장소로 만들어도 마찬가지다. 이미 확인된 사실이므로 비밀값을 두지 않는다.

```
public/          ← Pages 빌드 출력 디렉터리로 지정
├─ index.html  submit.js    제출 (형식 검사 → 제출 → 점수)
├─ board.html  board.js     리더보드 (마감 전 현황 / 마감 후 순위·통계)
├─ admin.html  admin.js     운영자 (실제 방어는 Worker 의 ADMIN_KEY)
├─ app.js  style.css        공용 (API 주소는 app.js 맨 위)
├─ shared/                  브라우저와 Worker 가 같이 쓰는 코드 — 비밀 없음
│  ├─ schema.js               제출 JSON 스키마
│  ├─ validate.js             스키마 검증 + 번호·회차·빈 인용 검사
│  └─ textmatch.js            인용문 정규화·최장공통부분문자열 (scoring.js 와 같은 규칙)
└─ articles/                배포한 기사 36편. 인용 위치 대조에 쓴다

worker/          ← Pages 가 아니라 Worker 로 따로 배포한다
├─ wrangler.toml
├─ src/index.js    라우팅·회차 결정·GitHub 연동·리더보드·운영자 API
├─ src/scoring.js  채점 로직 (완성·검증됨 — 손대지 않는다)
├─ scripts/setup-test-data.mjs   테스트 데이터를 contest-private 에서 복사
├─ scripts/dev-local.mjs         로컬 개발 서버 (Cloudflare·GitHub 없이 전체 흐름 실행)
└─ test/           골든테스트 22건 + Worker 핸들러 테스트 14건 (정답표·픽스처는 커밋하지 않는다)
```

## 정답표는 이 저장소에 들어가면 안 된다

Pages 에 연결하면 커밋한 파일이 전부 웹으로 열린다. 테스트에 쓰는 정답표와 픽스처는
`contest-private/test-data/` 에 있고 `.gitignore` 가 막고 있다.
`npm test` 가 `setup:test` 를 먼저 돌려 알아서 복사해 온다.

`git ls-files | grep json` 의 결과가 `worker/package.json` (과 package-lock.json) 뿐인지 가끔 확인한다.

## 테스트

```
cd worker && npm test
```

`contest-site` 와 `contest-private` 가 나란히 있어야 한다.
다른 곳에 뒀다면 `PRIVATE_DIR=/경로/contest-private npm test`.

- `test/score.test.js` — 골든테스트. **깨지면 채점 규칙이 바뀐 것이다.** 근거는 `test/fixtures_README.md`.
- `test/worker.test.js` — 접수 규칙. 회차를 서버가 정하는가, 상한을 넘기면 429 인가,
  응답에 문항별 정오가 없는가, 마감 전 리더보드에 점수가 없는가, 운영자 동작.

## 로컬에서 전체 흐름 돌려 보기

```
cd worker && npm run dev:local
→ http://127.0.0.1:8080/index.html      화면
→ http://127.0.0.1:8080/admin.html      운영자 (관리키 dev-admin)
```

GitHub 대신 메모리 저장소를 쓰고, 정답표는 `test/answer_key.json` 을 쓴다. 개발용 팀 코드는
콘솔에 찍힌다 (`DEVT-EAMA-AAA1` 등). 서버를 끄면 기록은 사라진다.
`app.js` 는 `localhost` 에서 열리면 자동으로 `127.0.0.1:8787` 을 API 로 쓴다.

## 배포

1. **Worker**
   ```
   cd worker
   npm install
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN     # 저장소 B 전용 파인그레인드 토큰 (Contents: Read and write)
   npx wrangler secret put ADMIN_KEY        # 운영자 화면용 임의 문자열 (길게)
   npx wrangler deploy
   ```
   배포 주소(`https://contest-api.<계정>.workers.dev`)를 `public/app.js` 의 `PROD_API` 에 적고 커밋한다.
2. **Pages** — Cloudflare 대시보드에서 이 저장소를 연결한다. 빌드 명령 없음, 출력 디렉터리 `public`.
3. **대회 당일 전**
   - `wrangler.toml` 의 `DEADLINE_ISO` 를 마감 시각으로 바꾸고 다시 `wrangler deploy`
   - 운영자 화면에서 팀명 일괄 입력 (구글시트 두 열을 복사해 붙인다)
   - `GET /api/health` 와 개발용이 아닌 실제 팀 코드 하나로 `/api/status` 를 확인한다

## API 요약

| 경로 | 방식 | 하는 일 |
|---|---|---|
| `/api/submit` | POST `{팀코드, result}` | 접수·채점. 응답은 회차·점수·가중점수·남은시도만 |
| `/api/status?code=` | GET (또는 POST `{팀코드}`) | 그 팀의 회차별 점수·남은 시도·다음 회차 |
| `/api/board` | GET | 마감 전 진행 현황 / 마감 후 전체 순위·문항별 통계. 60초 캐시 |
| `/api/admin/overview` | POST `{관리키}` | 전체 현황 (`전체기록: true` 면 원본 포함) |
| `/api/admin/teams` | POST `{관리키, 항목:[{코드,팀명}]}` | 팀명 일괄 입력 |
| `/api/admin/deadline` | POST `{관리키, 마감: true/false/null}` | 강제 마감 / 강제 열기 / 자동 |
| `/api/admin/reopen` | POST `{관리키, 코드, 회차, 사유}` | 한 회차 기록을 취소하고 그 칸을 다시 연다 |

오류는 `{ error, detail? }` 로 온다. 형식 오류는 400 에 `detail` 배열, 시도 소진은 429, 마감·미등록 코드는 403,
같은 팀의 동시 제출 충돌은 409 (기록되지 않았으니 다시 내면 된다).

## 기사를 여기 두는 것이 괜찮은 이유

참가자는 대회 시작 시점에 이미 기사 36편을 받아 갖고 있다. 조작 위치는
`articles/` 어디에도 없고, 정답표는 저장소 B 에만 있다.
