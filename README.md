# 저장소 A — contest-site

Cloudflare Pages 에 연결한다. **여기 커밋한 파일은 전부 웹으로 열린다.**
비공개 저장소로 만들어도 마찬가지다. 이미 확인된 사실이므로 비밀값을 두지 않는다.

```
public/          ← Pages 빌드 출력 디렉터리로 지정
├─ index.html      제출
├─ board.html      리더보드
├─ admin.html      운영자 (실제 방어는 Worker 의 ADMIN_KEY)
├─ app.js  style.css
└─ articles/       배포한 기사 36편. 인용 위치 대조에 쓴다

worker/          ← Pages 가 아니라 Worker 로 따로 배포한다
├─ wrangler.toml
├─ src/index.js    라우팅·GitHub 연동 (뼈대)
├─ src/scoring.js  채점 로직 (완성·검증됨)
├─ src/schema.json 제출 JSON 스키마
├─ scripts/        테스트 데이터 준비 스크립트
└─ test/           골든테스트 (정답표·픽스처는 커밋하지 않는다)
```

## 정답표는 이 저장소에 들어가면 안 된다

Pages 에 연결하면 커밋한 파일이 전부 웹으로 열린다. 테스트에 쓰는 정답표와 픽스처는
`contest-private/test-data/` 에 있고 `.gitignore` 가 막고 있다.
`npm test` 가 `setup:test` 를 먼저 돌려 알아서 복사해 온다.

## 채점 로직은 이미 검증돼 있다

`src/scoring.js` 는 파이썬 원본을 그대로 옮긴 것이고, 골든테스트 14건이 기대 점수와
소수점까지 일치하는 것을 확인했다.

```
cd worker && npm test
```

`contest-site` 와 `contest-private` 가 나란히 있어야 한다.
다른 곳에 뒀다면 `PRIVATE_DIR=/경로/contest-private npm test`.

**이 테스트가 깨지면 채점 규칙이 바뀐 것이다.** 왜 바뀌었는지 설명할 수 있어야 한다.
기대 점수의 출처는 `test/fixtures_README.md`.

## 기사를 여기 두는 것이 괜찮은 이유

참가자는 대회 시작 시점에 이미 기사 36편을 받아 갖고 있다. 조작 위치는
`articles/` 어디에도 없고, 정답표는 저장소 B 에만 있다.
