# 루비얀카 실행 계약 v1

`lubyanka contract <gost.json> [scope.json]`은 지시 계층의 규격과 선택한 작업 범위의 형식을 검사한다. 종료 코드 0은 형식 검사 통과, 1은 입력 오류다.

개발자의 원문과 상위 기획 정본이 목적·보존 조건을 정한다. 고스플란은 번호별 계약을 고정하고 샤라시카는 허용 범위에서 후보를 생산한다. 보옌프레드가 독립 시험에 서명하고 폴리트루크가 원문과 결과를 대조한다. 작업자는 합격 조건이나 두 서명을 발급할 권한이 없다. 이 문서가 계층 간 교환 형식의 정본이다. 데이터 형식 확인과 실제 판정 발급은 별개의 동작이다.

| 소유자와 자료 | 필드와 의미 |
| --- | --- |
| 사용자 · `orders.md` | UTF-8 원문. 각 최상위 항목의 원래 번호, 시작 바이트(포함), 끝 바이트(제외)를 보관한다. 모든 구간을 원래 순서대로 합친 결과의 SHA-256이 수신본과 같아야 한다. |
| 사용자 · `gost.json` | `version: 1`, 문자열 배열 `method_locks`, `forbidden_shortcuts`, Git 상대 경로 배열 `protected_paths`, 이름과 기준값의 객체 `visual_tokens`. 해당 규칙이 없으면 빈 배열·객체로 명시한다. |
| 고스플란 · 범위 | `write`는 변경을 허용한 파일, `read`는 읽기 전용 인접 파일, `snapshots`는 기준 커밋의 특성화 관측 파일, `intentional_constraints`는 원문에서 명시한 제약의 인용이다. 각 필드는 배열이다. 보호 경로나 하위 파일에 대한 쓰기, 상위 규칙 덮어쓰기, 미등록 필드는 거부한다. |
| 고스플란 · 원장과 잠금 | 원장 판본 1. 작업 묶음은 원문·GOST 지문으로 식별하고 항목은 TASK-ID로 구분한다. 각 배차는 기준 커밋·시도 번호·잠금 지문에 결합한다. 태스크 카드는 원문 구간과 규격을 상속한다. 최초 원문·기존 자아비판·구버전 작업 기록을 보존한다. |
| 샤라시카 · 후보 | 시도별 기준 커밋과 생성한 Git 트리를 함께 인계한다. 작업자가 제출한 코드나 설명에는 시험 결과를 서명할 권한이 없다. |
| 보옌프레드 · 기계 판정 | 동일 TASK-ID·시도·잠금 지문·기준 커밋·후보 트리에 검사 단계·실측·성공 또는 실패를 연결한다. 필수 입력 누락과 판정 불능은 실패로 기록한다. |
| 폴리트루크 · 의미 판정 | 응답은 `verdict`, `category`, 한 줄 `evidence`를 갖는다. PASS에는 NONE, REJECT에는 MISSING_REQ·SCOPE_SHRINK·REGRESSION·CHEAT·OVERREACH·VISUAL_DRIFT 중 하나를 쓴다. 관리 계층이 응답을 실제 근거 및 같은 후보의 기계 판정에 연결한다. |

## 샤라시카 실행

`lubyanka worker <Git 루트> run`이 배차된 태스크에서 Codex를 일회용 작업자로 호출한다. 서비스·인증·할당량·호출 시간 초과로 사용할 수 없으면 Claude를 새로 호출하고 실제 배정과 이유를 기록한다. 잘못된 응답과 반려는 다른 모델의 승인으로 바꿀 수 없다. 임시 빈 디렉터리에서 실행하며 모델은 허용한 파일의 전체 변경 제안만 제출한다. 관리자가 별도 인덱스에서 후보를 만든다. 선택 사항인 범위 필드 `candidates: 2`는 같은 태스크의 독립 후보를 두 번 생산한다. 각 프로세스는 고유 작업공간을 사용한다.

같은 명령 끝에 격리 시험용 JSON 경로를 붙이면 관리자가 지정한 로컬 Docker 이미지와 명령을 실행한다. 이 결과에는 `provider: fixture`가 기록된다. 공급자 실행 방식은 [Codex 비대화형 실행](https://developers.openai.com/codex/noninteractive/)과 [Claude CLI](https://code.claude.com/docs/en/cli-reference)를 따른다.

## 고스플란 실행

`lubyanka gosplan <Git 루트> prepare <지시 폴더>`는 지시 폴더의 `orders.md`, `gost.json`, `scope.json`, `basis.json`을 봉인한다. `scope.json`은 TASK-01부터 원문 순서대로 각 ID에 위 표의 범위를 연결한 객체다. 번호는 첫 열에서 `1. 본문`으로 시작한다. 들여쓴 번호와 코드 블록은 상위 항목의 본문에 포함한다. 새 파일도 쓰기 범위에 명시할 수 있다.

정본이 있는 프로젝트는 `basis.json`에 `{"contract":"docs/contract.md"}`를 지정한다. 브라운필드는 `{"image":"이미지 ID","command":["node","characterize.mjs"]}`와 같이 검토한 관측기를 지정한다. 관측기는 기준 커밋의 격리 환경에서 표준 입력으로 기준 커밋·범위를 받고, 실제 `cases`(input·output)와 공개 `signatures`를 JSON으로 반환한다.

`lubyanka gosplan <Git 루트> dispatch`가 첫 미완료 태스크의 배차권을 한 번 발급한다. `status`는 현재 원장을 읽는다. 각 판본의 `ledger.json`과 배차 시점의 `lock/<TASK-ID>/`는 Git 공용 관리 디렉터리의 `lubyanka/gosplan/<판본>/`에 있다. CLI가 출력한 lock 경로는 관리자가 읽는다. 워커 입력은 그중 허용된 부분으로 구성한다.

PENDING → IN_PROGRESS → VOENPRED_PASS → POLITRUK_PASS → DONE 순서로 진행한다. 원장이 두 판정과 같은 후보의 병합을 확인한 뒤 다음 태스크를 연다. 재시도는 PURGED, 사용자 개입이 필요한 중단은 QUARANTINED로 기록한다. 관리 계층이 원문과 기획 정본을 읽고 필수 시험과 종료 보고를 담당한다. 작업자와 감찰관에는 해당 계약과 필요한 근거만 전달한다.
