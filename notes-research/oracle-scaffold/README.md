# 루비얀카 CLI와 정답지 API

사용자 지시와 독립 근거를 테스트의 판정 기준으로 옮긴다. npm 의존성 없이 Node.js로 실행한다. 착수 때 정답지와 자아비판문을 준비하고, 작업이 끝나면 두 문서의 실제 변경 여부와 담당 AI의 검토 결과를 안내한다.

`lubyanka adopt`로 방법론을 도입하고 `lubyanka`로 독립 계획 검토와 Docker 시험, Git 차단, 종료 기록을 사용한다. npm 모듈은 `evaluateOracle`을 내보낸다. [도입 후 관리 절차](managed.md)

번호별 지시를 봉인한 뒤 `lubyanka execute <Git 루트> <지시 폴더>`로 생산·검측·독립 감찰을 실행한다. Codex 작업자와 Claude 감찰관을 우선 배정한다. [지시 폴더와 원장 실행 계약](pipeline.md)

## 설치

사용 앱은 공식 npm에 공개된 정확한 버전만 설치한다. 잠금 파일의 공식 tarball 주소와 integrity를 확인하고 재설치에는 `npm ci`를 쓴다. 개발 체크아웃·Git 의존성·로컬 tgz·링크·설치 후 패치를 사용한 앱은 도입 판정을 보류한다.

Node.js 20 이상이 필요하다. Git 저장소에 적용할 때는 Git을, 샤라시카를 실행할 때는 Docker와 프로젝트가 지정한 로컬 이미지를 준비한다.

```sh
npm view lubyanka-oracle-scaffold@0.5.1 dist.integrity --registry=https://registry.npmjs.org/ &&
  npm install --save-dev --save-exact --registry=https://registry.npmjs.org/ lubyanka-oracle-scaffold@0.5.1
npm exec -- lubyanka adopt /path/to/git-root
```

`adopt`로 만든 정본문서와 정답지를 실제 프로젝트 요구에 맞춰 작성하고 기준 커밋에 기록한다. 이후 `npm exec -- lubyanka install-hooks /path/to/git-root`로 해당 복제본의 훅을 연결한다. 프로젝트에 포함된 기존 Git 훅도 이어서 실행한다.

## 문서 스캐폴드

```sh
lubyanka-oracle start /path/to/project /path/to/new-work-review.json
lubyanka-oracle check /path/to/project
lubyanka-oracle finish /path/to/project /path/to/new-work-review.json --json
```

소스에서 실행하려면 `lubyanka-oracle` 대신 `node oracle.mjs`를 쓴다.

- `start`는 빠진 양식을 생성하고 읽을 경로를 출력한다. 담당 AI는 지시와 단순 질문 모두 자아비판문을 읽고, 정본문서와 정답지를 준비한 뒤 계획을 세운다. [착수 절차](procedure.md#모든-업무-지시의-착수-절차)의 근거 심사와 [샤라시카 필수 시험](procedure.md#샤라시카-필수-시험)은 담당 AI가 직접 적용한다. `lubyanka-oracle`은 문서 양식만 다룬다. 새 일마다 새 검토 파일을 쓴다.
- 담당 AI는 종료 전 최신 사용자 지시에 따라 두 원본을 직접 검토하고 수정한다. 작업 검토 파일에는 적용한 지시, 문서별 변경 내용 또는 유지 이유, 검증 근거, 남은 확인을 기록한다. 형식과 순서는 [작업 절차](procedure.md)를 따른다.
- `finish`는 문서의 실제 변경 여부와 코드 검토 기록을 확인한다. 결함 수정 기록에는 외부 출처·논증·재검증 결과가 필요하다. 고칠 코드가 없어 보인 경우에는 전문 재독과 재검토 기록이 있어야 미입증 결과를 출력한다. CLI는 텍스트와 채팅 연동용 JSON을 제공한다. 도입 후에는 시험 기록을 확인하는 `lubyanka finish`로 종료 보고를 만든다.
- `lubyanka-oracle.json`은 요구·판정 기준·필요한 증거를 저장한다. `LUBYANKA-SELF-CRITIQUE.md`는 기존 가정과 확인된 실패, 다음 검토에서 사용할 근거를 저장한다.
- `LUBYANKA-ORACLE.md`는 사용자 지시를 입력·기대 결과·증거로 옮기는 방법을 설명한다.
- 작업 검토 없이 양식만 준비하려면 `init <프로젝트>`를 실행한다. `check <프로젝트>`의 종료 코드 `0`은 JSON 정답지의 판정 기준 기입을 확인한 상태다. `2`는 빈 필수 항목, 미지원 판정 방식 또는 해결할 항목이 있다는 뜻이다. `1`은 사용법·경로·JSON 구조 오류다. `start`는 미판정 항목이 있으면 알리고, 손상된 JSON이나 스키마 오류가 있으면 작업 검토 파일을 만들기 전에 중단한다. 실제 제품의 실행, 출처 검증과 제품 판정은 별도로 진행한다.

기존 정본이 다른 경로에 있으면 `start`나 `init`에 `--oracle 'docs/정답지.json' --self-critique '자아비판_회사배치.md'`를 전달한다. `check`에도 같은 `--oracle`을 전달한다. 프로젝트 내부에 있는 경로를 사용한다. `finish`는 착수 때의 경로를 다시 사용한다. Markdown 정답지는 담당 AI가 해당 프로젝트 기준으로 직접 검토한다. JSON 출력의 `oracleIssues`는 JSON 정답지에서 확인한 미판정 항목이다.

정답지의 출처와 기준선은 서로 다른 필드에 둔다. 예를 들어 재시도 시 중복 저장을 막는 요구는 아래처럼 기록한다.

```json
{
  "schemaVersion": 1,
  "requirements": [{
    "requirementId": "REQ-001",
    "source": "사용자 지시 §1 · 같은 요청을 재시도해도 저장 행을 하나만 유지한다.",
    "scope": "등록 API와 시험 DB",
    "inputs": "빈 시험 DB에 동일한 요청 ID로 두 번 전송",
    "comparator": "exact",
    "expectedOrRule": "요청 ID가 같은 저장 행 1개",
    "requiredEvidence": ["두 응답과 해당 요청 ID의 저장 행 재조회"],
    "baseline": "",
    "unresolved": []
  }]
}
```
