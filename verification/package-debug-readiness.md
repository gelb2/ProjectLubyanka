# 루비얀카 패키지 자체 개발 점검

2026-11-28 · 로컬 `develop`의 `bcdf934` · `lubyanka-oracle-scaffold@0.4.0`

**이 소스에서 패키지 디버깅과 방법론 고도화를 시작할 수 있다.** 중단점에서 실제 입력을 읽고, 결함을 재현하고, 변경한 엔진과 계획 검토 절차를 다시 패킹해 설치본 동작까지 확인했다. 아래 변경 실험은 기준 커밋의 임시 사본에서 실행했다. [측정 결과](package-debug-observations.json)

## 점검 범위

기준 커밋의 추적 파일 54개를 조사했다. 패키지 폴더 19개는 실행 모듈 11개, 단위 시험 파일 3개, 문서 4개, 패키지 명세 1개다. JavaScript 파일 17개와 셸 파일 4개의 구문, JSON 3개의 파싱, Markdown 27개의 본문에서 찾은 저장소 내부 링크 119개를 검사했다. 링크 대상 및 검사한 제목 참조가 모두 존재했다. 설립 원전과 향후 계획은 문서로 분류하고, 현재 패키지 동작은 소스·공개 진입점·설치 파일·시험 결과를 대조해 판정했다.

| 패키지 소스 | 확인한 동작 |
| --- | --- |
| `engine.mjs`, `managed.mjs` | 공개 API와 관리 CLI의 판정, 경계값, 종료 코드, 새 판정 모듈의 설치 여부 |
| `oracle.mjs`, `lifecycle.mjs`, `project.mjs` | 문서 CLI 중단점, 초기화·재도입, 정본 변경·손상 입력 처리, 작업 기록 |
| `gate.mjs`, `lab.mjs`, `hooks.mjs` | 설치한 후보로 계획 검토, 구현 허가, 격리 시험, 기능 커밋·통합 검증. 계획 검토 조건을 바꿔 허용·차단 양쪽 재현 |
| `method-audit.mjs`, `sharashka.mjs`, `report.mjs` | 문서 검토기의 정상·오류 종료, 시나리오 누락·기준 미달·합격, 종료 확장의 거부와 결과 반환 |

## 디버깅과 변경 실험

1. **기준선.** Node 20.15.0과 22.19.0에서 기존 단위 시험이 각각 20/20 통과했다. 두 버전에서 오프라인 설치·공개 API 시험이 통과했다. Node 22에서는 패킹한 설치본으로 Docker·Git 통합 시험을 실행했다. V8 실행 기록에서 기준 단위·통합 시험을 합쳐 런타임 모듈 11개 모두의 함수 호출을 관측했다. 함수 호출 여부로 모든 분기의 정답을 보장할 수는 없다.
2. **중단점.** 원본과 깨끗한 설치본에서 각각 공개 API, `lubyanka judge`, `lubyanka-oracle check`를 실행했다. `judge`의 `main`에서 명령·단계·입력값 `judge / feature / 2`, `engine.mjs`의 `holds`에서 요구 ID·실측·상한 `BOUND / 2 / 2`를 읽었다. 문서 CLI에서는 스키마 버전 1과 요구 1건을 읽었다. [Node Inspector](https://nodejs.org/docs/latest-v22.x/api/inspector.html)
3. **기존 결함 검출 능력.** 임시 사본에서 범위 상한 비교를 `<=`에서 `<`로 바꾸자 기존 엔진 시험이 실패했다. 원복 후 같은 시험이 통과했다. 다시 패킹한 설치본의 엔진 파일이 원래 소스와 바이트 단위로 일치했고, API가 경계값 2를 승인했다.
4. **새 코드 모듈.** 시험용 관계 연산자 `ne`를 먼저 시험에 추가해 실패를 확인했다. 새 소스 모듈을 연결하자 단위 시험 21/21이 통과했다. 새 파일을 배포 목록에서 빼고 설치하자 API import가 `ERR_MODULE_NOT_FOUND`로 실패했다. 패키지 명세와 설치 검사의 파일 목록을 갱신하자 17개 파일짜리 설치본에서 API와 관리 CLI 모두 다른 두 값을 승인하고 같은 두 값을 거부했다. [배포 명세](../notes-research/oracle-scaffold/package.json) · [설치 검사](standalone.mjs)
5. **방법론의 필수 단계.** 임시 패키지의 계획 심사에 독립 검토 결과 한 항목을 추가했다. 그 항목이 없는 검토기에서 `verify plan`이 실패하고 `permit`이 거부됐다. 같은 계획에 해당 항목을 반환한 검토기를 연결하자 두 단계가 통과했다. 이는 임시 시험 조건이며 개발자가 제공할 새 방법론의 명세는 원문 대기 중이다. [계획 심사 코드](../notes-research/oracle-scaffold/gate.mjs)
6. **기존 확장 지점.** 제품 코드를 그대로 둔 설치본에서 기능 시나리오 파일 누락과 기대값 2에 대한 실측 1을 각각 거부하고 실측 2는 승인했다. 등록한 종료 확장에서 오류를 내면 해당 오류가 전달됐고, 정상 반환 때는 같은 작업 ID가 종료 보고에 남았다. [확장 계약](../notes-research/oracle-scaffold/managed.md)

## 개발자가 마주치는 한계

- **설치본에서 시험 0건이 성공으로 표시된다.** 공개용 tarball은 시험 파일을 제외하지만 `npm test` 스크립트는 포함한다. 설치한 패키지 안에서 실행한 결과는 종료 코드 0, 시험 0건이었다. 저장소 루트에는 `package.json`이 없어서 `npm test`가 종료 코드 254로 끝났다. 패키지 소스의 단위 시험 명령은 아래와 같다. [패키지 명세](../notes-research/oracle-scaffold/package.json)
- **독립 검토기가 실패한 원인이 CLI 출력에서 사라진다.** 정상 검토기는 `lubyanka audit`에서 승인됐다. 같은 시험 프로젝트에서 검토기가 표준 오류에 식별 문구를 쓰고 코드 7로 종료하자 CLI는 일반 오류 문장과 코드 1만 반환했다. 문서 검토기의 오류 진단을 개선할 때는 이 입력을 회귀 시험으로 사용할 수 있다. [검토기 오류 처리](../notes-research/oracle-scaffold/method-audit.mjs)
- **저장소 자체에는 관리형 작업 설정이 없다.** 새 복제본에서 `lubyanka audit .`는 루트 `lubyanka.json` 부재로 종료 코드 1을 반환했다. 이 저장소에서 실행하는 단위·설치·통합 시험은 작동한다. 패키지 자체 개발을 매번 관리형 `begin → verify → permit` 절차로 강제하려면 생산자용 설정·정답지·검토기를 연결해야 한다.
- **기본 CI는 브랜치 경로만 검사한다.** 추적된 GitHub Actions 워크플로에는 단위·설치·Docker 시험을 호출하는 단계가 없다. 위 시험 결과는 이번 로컬 실행에서 얻었다. [워크플로](../.github/workflows/branch-route.yml)

저장소 루트에서 기준판을 재시험하는 명령이다.

```sh
npm --prefix notes-research/oracle-scaffold test --offline
node --test notes-research/oracle-scaffold/engine.test.mjs
node verification/standalone.mjs
node verification/release.mjs
```

기존 정답지의 CLI·정답 엔진·샤라시카·종료 보고 기준을 사용했다. 자아비판문에 기록된 설치 성공의 과대 해석을 피하기 위해 소스 시험만으로 잡히지 않는 배포 파일 누락도 따로 재현했다. 이 판정은 패키지의 개발 가능성에 한정한다. [프로젝트 정답지](../lubyanka-oracle.json) · [자아비판문](../LUBYANKA-SELF-CRITIQUE.md)
