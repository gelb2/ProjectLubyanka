# 독립 저장소 이관 검증

## 정답과 재현 방법

기준 원본은 Sass Control의 `9e12d5d`다. 검증 대상은 새 저장소가 제공하는 문서와 패키지다. [프로젝트 정답지](../lubyanka-oracle.json)

```sh
npm --prefix notes-research/oracle-scaffold test --offline
node verification/standalone.mjs
```

첫 명령은 소스에 포함된 전체 Node 테스트를 실행한다. 둘째 명령은 설치용 패키지를 만든 뒤 빈 임시 폴더에 오프라인으로 설치한다. 사용자가 지정한 JSON 정답지로 `init`, `start`, `check`, `finish`를 실행하고 미지원 명령의 실제 응답도 출력한다. 릴리스 요구의 관측은 아래 판정과 대조한다.

## 이관 시험 결과

- macOS에서 Node.js 20.15.0과 22.19.0의 소스 테스트가 각각 14개 전부 통과했다. 22.19.0에서 tarball을 오프라인 설치해 CLI 진입점과 설치본의 정상·미판정·손상 입력을 대조했다.
- 스캐폴드 파일 7개의 바이트를 기준 Git 원본과 대조했다. 독립 진입 문서에서 참조하는 상대 링크와 Markdown 제목 앵커 81개가 모두 새 저장소에서 해소됐다.

## 판정

| 범위 | 관측과 판정 |
| --- | --- |
| 정답지 CLI | 사용자 지정 JSON 기입 확인 0, 미판정 2, 손상 JSON 및 잘못된 스키마로 착수 1. 손상 원본은 보존하고 검토 파일을 만들지 않는다. |
| 전문 읽기·계획 심사 | `start`는 자아비판문의 경로를 출력한다. 설치본의 `plan`은 지원하지 않는다. 전문 전달·실제 적용·계획 심사 강제는 구현되지 않았다. |
| 샤라시카 실행·보고 | `verify`, `submit`, `lab`은 사용법을 출력하고 종료 코드 1로 끝난다. 실행 증거가 없거나 정답지가 미판정이어도 `finish --json`이 종료 코드 0으로 문서 검토를 출력한다. 별도 임시 Git 저장소에 시험 기록 없는 합성 기능을 커밋하고 `dev`에 병합했을 때 두 명령 모두 0으로 끝났다. 기능 시험·커밋·병합·종료 보고 차단은 릴리스 요구 미충족이다. |
| 라이브러리 API | 설치한 패키지의 import는 `ERR_MODULE_NOT_FOUND`로 끝난다. 현재 제공 범위는 CLI다. |
| npm 공개 게시 | tarball에는 CLI 2개, 양식 2개, README와 패키지 설정이 들어간다. 매니페스트는 `private: true`다. 실제 게시 검증은 릴리스 구현 범위다. [npm 게시 보호](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#private) |

통제 실행기와 호스트 연동의 통과 기준은 [npm 구현 계획](../notes-research/LUBYANKA-SHARASHKA-IMPLEMENTATION-PLAN.md)에 둔다. 문서 검토 성공, 실제 시험 결과, 릴리스 판정을 각각 근거로 확인한다.
