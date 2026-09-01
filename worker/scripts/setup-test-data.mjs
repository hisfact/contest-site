/**
 * 테스트용 정답표·픽스처를 contest-private 에서 복사해 온다.
 *
 * 정답표는 이 저장소에 커밋하면 안 된다(Pages 에 연결되어 전부 공개된다).
 * .gitignore 가 막고 있고, 이 스크립트가 테스트 직전에 채워 넣는다.
 *
 *   npm test  →  setup:test 가 먼저 돈다
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, '..', 'test');

// contest-site 와 contest-private 가 나란히 있다고 본다.
// 다른 곳에 뒀다면 PRIVATE_DIR 로 알려준다.
const src = process.env.PRIVATE_DIR
  ? resolve(process.env.PRIVATE_DIR, 'test-data')
  : resolve(here, '..', '..', '..', 'contest-private', 'test-data');

if (!existsSync(src)) {
  console.error(`\n테스트 데이터를 찾지 못했습니다: ${src}`);
  console.error('contest-private 를 나란히 두거나, PRIVATE_DIR 환경변수로 위치를 알려주세요.\n');
  process.exit(1);
}

// 덮어쓸 때 파일을 지우고 다시 만들지 않고 내용만 바꾼다 (삭제 권한이 없는 환경에서도 돌게).
function copyInto(from, to) {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const n of readdirSync(from)) copyInto(join(from, n), join(to, n));
  } else {
    copyFileSync(from, to);
  }
}

mkdirSync(dest, { recursive: true });
for (const name of ['answer_key.json', 'fixtures', 'fixtures_README.md']) {
  copyInto(join(src, name), join(dest, name));
}
console.log('테스트 데이터 준비 완료 (커밋되지 않습니다)');
