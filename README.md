# 루비얀카 · 샤라시카

루비얀카는 자아비판문을 읽고 사용자 요구와 정답지에 근거해 계획을 세우는 방법론이다. 샤라시카는 계획·기능·병합 후보를 격리된 조건에서 실행해 시험한다. 이 저장소에는 방법론 정본, 실행 정답지 API, 도입·격리 시험·Git 검증을 수행하는 npm CLI가 있다.

- [방법론 정본](governance/LUBYANKA.md)
- [라이브러리 구현 계획](notes-research/LUBYANKA-SHARASHKA-IMPLEMENTATION-PLAN.md)
- [정답지 연구와 사례](notes-research/README.md)
- [이관 검증과 릴리스 판정](verification/README.md)
- [프로젝트 자아비판문](LUBYANKA-SELF-CRITIQUE.md) · [프로젝트 정답지](lubyanka-oracle.json)

## 로컬 실행

```sh
npm --prefix notes-research/oracle-scaffold test --offline
node verification/standalone.mjs
node verification/release.mjs
```

`lubyanka-oracle`은 양식과 문서 검토를 제공한다. `lubyanka`는 등록한 프로젝트의 사용자 지시, 계획, Docker 시험, 커밋·병합·보고 기록을 연결한다. 전체 검증에는 실행 중인 Docker와 로컬 `node:22-bookworm-slim` 이미지가 필요하다. [도입과 실행 절차](notes-research/oracle-scaffold/managed.md)

독립 저장소의 검증 출발점은 Sass Control의 `docs/lubyanka-library-plan-20261123` 브랜치 `9e12d5dcf632573d01a38899de92c3216aa0e5cd`다. 현행 문서와 직접 연결된 연구 원고를 가져왔다. 초기 통합 브랜치는 `dev`다.
