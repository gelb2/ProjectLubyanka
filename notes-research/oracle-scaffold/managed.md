# 루비얀카와 샤라시카 실행 절차

`lubyanka` 명령은 Git 저장소에서 계획과 코드 후보를 묶고, Docker에서 실행한 실측을 정답지로 판정한다. `lubyanka-oracle`은 문서 양식과 JSON 정답지 기입 검사를 제공한다.

## 방법론이 없는 프로젝트에 도입

1. `lubyanka adopt <Git 루트>`로 프로젝트 지침, 정본문서, 자아비판문, 정답지, 설정을 준비한다. 기존 파일을 보존하고 `AGENTS.md`에 작업 절차를 한 번 추가한다. 기존 다른 경로의 정본은 `lubyanka.json`의 `contract`, `oracle`, `selfCritique`, `pathCritiques`로 지정한다.
2. 프로젝트 소유자가 기존 요구의 독립 근거를 확인하고 정본문서의 미기입 표시를 없앤다. 정답지에 기대값과 실행 규칙을 작성하고, 설정에 로컬 Docker 이미지, 독립 계획 검토 명령 `reviewPlan`, 단계별 시험 명령을 넣는다. 이 첫 도입 설정과 시험 도구를 프로젝트의 기준 커밋에 보관한다. `reviewPlan`은 프로젝트가 정한 판단 기준으로 `LUBYANKA_PLAN_JSON`의 계획을 검토하고 `{"accepted": true, "reasons": ["선택의 근거"], "coverage": [{"quote":"검토한 사용자 지시 구절","ids":["대응하는 요구 ID"]}]}`를 출력한다. 실제 근거가 빠진 계획은 `false`로 판정한다. 실행기는 기준 커밋의 검토 코드와 명령을 사용한다.
3. Docker가 사용할 이미지를 로컬에 준비한다. 검증기는 시험 시 이미지를 자동으로 가져오지 않는다.
4. `lubyanka install-hooks <Git 루트>`는 그 복제본의 Git 훅을 연결한다. 기존 훅은 이어서 실행한다. 통합 브랜치는 `integrationBranch`로 지정한다. 기존 브랜치 이름을 사용한다.

## 정답지와 시험 입력

기본 필드와 함께 `phases`로 요구를 `plan`, `feature`, `merge`에 연결한다. 생략하면 `feature`와 `merge`에 연결된다. 각 단계의 명령 배열은 해당 단계에 등록된 요구 ID를 키로 하는 JSON 객체를 표준 출력에 쓴다. 명령이 여러 개면 각각 격리 실행하고, 중복·미등록 ID나 관측 누락은 통과를 막는다.

| 비교 방식 | 정답지의 `assertion` | 관측 |
| --- | --- | --- |
| `exact` | `{"expected": 값}` | JSON 값 |
| `range` | `{"min": 1, "max": 2}`. 하나만 써도 된다. | 유한한 숫자 |
| `invariant` | 관측 조건을 `expectedOrRule`에 기입한다. | 정확히 `true`여야 한다. |
| `relation` | `{"operator": "lte"}`. `eq`, `lte`, `gte`, `lt`, `gt`를 지원한다. | 비교할 왼쪽·오른쪽 값의 배열 |
| `manual` | 확인 조건을 `expectedOrRule`에 기입한다. | 자동 판정에서 미판정으로 남긴다. |

예를 들어 설정의 `checks.plan`은 `[["node", "tests/check-plan.mjs"]]`처럼 쓴다. 정답지의 기대값은 사용자 지시나 독립 출처에서 결정한다. 후보 코드의 출력은 관측값으로만 사용한다. 동시 실행 요구는 병합 단계 명령 안에서 실제로 동시에 실행한다.

## 업무 시작과 종료

1. 사용자 원문을 파일로 보관하고 `lubyanka begin <Git 루트> <지시 파일>`을 실행한다. 출력한 자아비판문 전문, 정본문서와 정답지를 실제 작업 문맥에 넣는다. 질문이나 비개발 검증은 `--kind answer`를 사용한다.
2. 계획 JSON에는 사용자 원문 `instruction`과 `decisions`를 적는다. 결정마다 요구 ID `id`, 자아비판문 `path`와 원문 `quote`, 바뀐 `decision`, `reason`, 결과가 계획을 뒤집는 조건 `falsifier`를 쓴다. `lubyanka plan <루트> <계획.json>`으로 문서·계획 연결을 확인하고 필요한 계획 시험 파일을 스테이징한 뒤 `lubyanka verify <루트> plan`을 실행한다. 호스트는 `lubyanka permit <루트> <작업 ID>`의 허용 응답을 확인한 뒤 본 작업 도구를 연다.
3. 기능을 구현해 스테이징한 뒤 `lubyanka verify <루트> feature`를 통과한다. 시험한 내용으로 커밋한다. `lubyanka verify <루트> merge <기능 브랜치>`로 현재 통합 브랜치와 합친 후보를 검사한 뒤 병합한다. 대상이나 내용이 바뀌면 다시 시험한다.
4. 두 문서의 변경·유지와 근거를 `begin`이 출력한 `reviewPath`에 적는다. 정본을 갱신한 경우 같은 지시로 `begin --resume`을 실행하면 기존 문서 변경의 비교 지점이 보존된다. 최신 전문을 읽고 계획과 시험을 다시 거친다. `lubyanka finish <루트> <plan|feature|merge>`는 보고 범위의 시험과 변경 기록을 함께 확인한다.
5. 필수 시험이 실패하거나 미판정이면 그 시도의 통과 기록을 폐기한다. 원본 관측을 남기고 같은 사용자 지시로 `begin --resume`부터 다시 시작한다. 실제로 실행한 이전 실패를 보고해야 하면 최신 전문을 읽고 검토 파일을 작성한 뒤 `lubyanka finish <루트> failure`를 실행한다.

`lubyanka judge <정답지.json> <단계> <실측.json>`과 npm의 `evaluateOracle` API는 구조와 값을 판정한다. Git이나 Docker 없이 사용할 수 있다.

## 적용 범위

Docker 시험은 로컬 이미지의 ID를 고정하고 호스트 마운트와 네트워크 없이 Git의 시험 대상 트리만 읽는다. 아카이브는 권한을 제한한 임시 파일을 거쳐 전달하고 실행 뒤 정리한다. 컨테이너의 `/work`는 128 MiB이며 후보 파일과 시험 중 `/work`에 쓰는 파일이 이 범위에 들어가야 한다. 배포용 제외·치환 속성은 시험 내용에 적용하지 않는다. 트리에 실행 내용이 없는 Git 서브모듈은 미통과다. 명령과 정답지는 프로젝트 소유자가 검증한 입력을 사용한다. 시험 기록은 복제본의 Git 관리 영역에 보관한다.

이 CLI는 지정한 문서 전문을 전달하고 계획의 원문 인용, 요구 누락, 실제 시험 결과를 판정한다. 프로젝트의 독립 검토기가 실제 논증에 근거해 90% 기준을 판정한다. 이 CLI는 점수나 문장 일치 수를 계산하지 않는다. AI가 전문을 이해했는지는 실제 적용과 검증 결과를 대조해 확인한다. Git 훅을 설치한 복제본에서 기존 기능 브랜치의 커밋·통합 브랜치 갱신을 검사한다. 현재는 저장소 루트에서 한 시도씩 실행하고 검증한 한 부모 기능 커밋을 병합한다. 원격에서 이미 다른 복제본이 만든 커밋과 병합을 차단하려면 서버의 필수 검사와 보호 브랜치에 연결한다. 로컬 Git 설정을 바꿀 수 있는 환경은 별도의 신뢰 경계다. 관리 CLI에 연결되지 않은 채팅의 출력은 해당 실행 환경의 제어가 필요하다.

## 0.2 종료 검증 도입

통합 브랜치에서 정답지의 모든 실행 요구에 `reportCases`를 등록한다. 각 키는 그 요구의 조건이나 동선이고 배열에는 독립 검토기가 검사할 증거 종류를 넣는다. 일반·자료 누락·오류·복구를 하나의 관측으로 대체하기 어려우면 각각 키를 둔다. 다음 예시는 작품 상세의 실행 정답지에 추가할 필드다.

```json
{
  "reportCases": {
    "arrival": ["source", "reference-source", "motion", "interaction"],
    "missing-description": ["source", "interaction"],
    "handoff": ["delivery"]
  }
}
```

`lubyanka.json`의 `reportReview`에 예를 들어 `["node", "verification/review-report.mjs"]`를 등록한다. 검토기의 소스와 설정을 통합 브랜치에 먼저 반영한다. 후보의 명령과 Docker 이미지 설정은 그 기준과 일치해야 한다. 등록한 정답지 동선과 증거 종류, 시험 명령은 후보에서 제거할 수 없다. `checkSources`에 독립 시험 진입점과 보조 파일을 등록하면 바이트가 바뀐 후보도 거부한다. 시험 계약을 의도적으로 개정할 경우 신뢰 기준을 먼저 검토해 갱신한다.

`begin`이 만든 검토 파일의 `review.target`에는 현재 `task`, 시험 `phase`, 그 단계가 반환한 Git `tree`를 넣는다. 각 `reportCases` 키마다 `review.claims` 항목을 하나 쓴다.

```json
{
  "id": "WORK-DETAIL",
  "case": "missing-description",
  "outcome": "verified",
  "target": "실제 검토 주소와 브라우저·빌드",
  "statement": "작품 목록에서 작품을 열고 해설 조회가 실패할 때에도 그림과 크레디트를 확인했다.",
  "evidence": [
    {"kind": "source", "path": "src/detail.mjs", "sha256": "파일의 SHA-256"},
    {"kind": "interaction", "path": "evidence/detail-fallback.json", "sha256": "파일의 SHA-256"}
  ]
}
```

근거 종류는 `source`, `reference-source`, `screenshot`, `motion`, `interaction`, `delivery`, `skill-run`, `inventory`, `artifact`, `recovery`, `measurement`다. `source`는 로컬에서 읽은 파일과 시험 트리의 같은 경로가 바이트 단위로 일치해야 한다. 자료 원본 총량은 14 MiB까지 받는다. 대형 영상 대신 필요한 구간의 원본 관측과 식별값을 넣고, 검토기는 그 자료가 주장에 충분한지 판단한다.

검토기는 격리된 통합 브랜치에서 표준 입력으로 `mode`, `task`, `instruction`, `phase`, `tree`, `failed`, `verdict`, `rules`, `claims`, `recovery`, `files` JSON을 받는다. `files`는 저장소 상대 경로를 키로 하고 Base64 파일 바이트를 값으로 갖는다. 각 주장에 대해 실제 동작의 입력·측정값·실패 경로·출처 판본과 전달 주소를 대조한다. stdout으로 모든 `{id, case, accepted, reason}`을 배열로 출력한다. 단순 파일 존재, 같은 이름, 숫자 하나만으로 승인하는 검토기는 바사리에서 발견한 오류를 거르지 못한다.

수동 판정의 실제 근거를 확보했다면 `verify … --manual-file 증거.json`에 `{target, claims}`를 전달한다. 현재 단계의 `manual` 요구에 해당하는 모든 사례를 담는다. 검토기는 `mode: "manual"`에서 원본을 판정해야 한다. 받아들인 결과만 해당 단계에 기록한다. 종료 때는 `mode: "finish"`에서 전체 주장과 원본을 다시 확인한다. `judge`와 직접 API 호출에서 근거 없이 제공한 수동 통과값은 미판정이다.

자아비판을 다시 수행한 개발 작업은 `review.recovery`에 `reason`, `technicalCause`, 실행한 `action`, 실제로 바꾼 소스 `path`를 기록한다. 이유와 원인을 자아비판문에도 적고, 해당 소스와 실제 재시험 원본 `recovery`를 주장에 연결한다. 교정할 수 있는 검사는 보고 전에 수행한다. 실제 제한으로 남은 실패 보고에는 확인한 `blocker`와 제한의 증거를 쓴다. 검증된 실패 보고는 JSON을 출력하고 실패·미판정의 종료 코드 1·2를 유지한다.

기존 프로젝트를 올릴 때는 새 설정과 실행 정답지를 통합 브랜치에 반영하고 `install-hooks`를 실행한다. 이전 훅 위치 기록이 없는 0.1.1 설치는 Git 설정을 원래 훅 디렉터리로 되돌린 뒤 설치한다. 읽기 전용 `lubyanka-oracle check`는 기존 정답지 양식 검사로 사용할 수 있다. `finish`는 확인한 보고서를 Git 관리 영역의 `lubyanka/report-<task>-<stage>.json`에 쓴다. 호스트 연동에서는 `verification.report.claims`와 `decisions`를 사용자 답변에 넘기고 독립 판정을 받지 않은 완료 문장을 추가하지 않는다.

## 0.3 시나리오 원장과 문서 검산

`scenarioInventory`를 등록한 프로젝트는 독립 검토 명령을 `scenarioReview`에 지정한다. 원장은 `version: 1`과 `scenarios` 배열을 갖는다. 항목마다 `id`, 시험 `mode`, 환경 `target`, 준비 조건 `input`, `assertions`가 필요하다. 비교는 `{metric, operator, expected}`이며 연산자는 `eq`, `gte`, `lte`다. 모드는 `normal`, `opened`, `denied`, `boundary`, `failure`, `recovery`, `parallel`, `layout`, `performance`, `memory`다.

프로젝트 실행기는 `verify … --scenario-file`에 `{target:{task, phase, tree}, observations, details}`를 전달한다. 관측마다 `id`, `mode`, `target`, `entry`, `actions`, `result`, `measurements`를 기록한다. 제한이 확인된 경우 `{id, blocked, attempt}`를 기록한다. 독립 검토기는 격리 실행에서 `{matrix, run}`을 표준 입력으로 받아 원본 관측으로 요약값을 다시 만들고 `{accepted, reasons}`를 응답한다. 선언만 있거나 누락·잘못된 후보·불일치가 발견되면 통과하지 않는다. 기능·병합에는 관측이 필요하다. 계획에서는 범위를 검증하며 동일한 형식의 사전 실험을 제출할 수도 있다.

`methodAudit`와 `methodReview`를 등록한 프로젝트는 `lubyanka audit <Git 루트>`로 문서·정답지를 검산할 수 있다. `verify` 각 단계도 이 검사를 실행한다. 검산 기준은 `version: 1`, `requirements`, `incidents`를 갖는다. 요구마다 `id`, 독립 근거 `basis`, 승인한 규칙 서술 `approved`, 실제 합격·탈락 입력 `accept`와 `reject`를 등록한다. 수동 판정은 독립 검토기의 조건을 따른다. 자아비판 사건은 `path`, `requirement`, `reason`, `technicalCause`, `correction`, `verification`에 원문과 연결한다. 독립 검토기는 `{oracle, critique, contract, basis}`를 받아 출처의 실제 의미와 실행 코드를 대조하고 `{accepted, reasons}`를 응답한다. 시나리오 원장, 검산 기준, 독립 검토기는 통합 브랜치에 둔다.

프로젝트 고유의 검토가 호스트 자료를 읽어야 한다면 `selfCritiqueFollowup`에 로컬 종료 확장을 등록할 수 있다. 통합 브랜치의 `checkSources`에 확장과 그 의존 소스를 함께 등록한다. 종료 직전에 후보와 작업 폴더의 소스가 일치할 때만 확장의 `requireFollowup(root, state, review, docs)` 함수를 호출한다. 독립 Docker 검토도 계속 실행한다.

## 0.3.1 보고 초안 재검증

`lubyanka review-draft <Git 루트> <초안.txt>`는 사용자가 지정한 두 표현인 “근거는 없습니다”, “철회합니다”를 검사한다. 하나라도 발견하면 기존 단계의 통과 기록을 비우고, 초안 지문과 감지한 표현을 Git 관리 영역에 저장한다. `begin --resume`부터 전문 재독·이유와 기술 원인 기록·실제 교정 및 재시험이 필요하다. `finish`도 `review.draft`와 사용자에게 전달하는 결론·요약 필드를 같은 규칙으로 검사한다. 호스트는 외부로 보낼 실제 초안을 `review-draft`에 전달한다.

## 0.4.0 계획 검토기 이관

기준 커밋의 `reviewPlan`이 사용자 원문의 각 구절을 실제 결정·시험에 대조한 뒤 `coverage`를 반환한다. 원문 순서대로 모든 구절과 대응하는 결정 ID를 기록한다. 기존 검토기의 accepted와 reasons만으로는 계획을 승인하지 않는다. 원문을 무조건 되돌려 쓰면 내용 검토 효과가 없다. 도입 프로젝트에서 기존 지시, 새 요구를 빠뜨린 계획, 새 요구의 시험까지 추가한 계획을 각각 실행한다.
