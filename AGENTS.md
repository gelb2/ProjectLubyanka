# 작업 진입

<!-- lubyanka-managed -->

모든 업무와 질문에서 [프로젝트 자아비판문](LUBYANKA-SELF-CRITIQUE.md)과 [방법론 정본](governance/LUBYANKA.md) 전문부터 읽는다. 계획 전에 [최상위 기획 정본](governance/PROJECT-CHARTER.md)에서 문서 위계를 확인한다. 해당 범위의 정본과 [정답지](lubyanka-oracle.json)를 최신 요구·근거로 작성하거나 보강한다. 계획이 자아비판의 지적을 어떻게 반영했는지 설명한다.

패키지 개발은 `develop`에서 분기한다. 피처 브랜치는 `develop`으로 병합한다. `main`은 `develop`만 병합한다. 계획 수립 뒤, 기능별 개발 완료 후 커밋 전, `develop` 병합 직전에 관련 시험을 실행한다. 미통과나 보고 범위의 실행 증거가 없으면 전문을 다시 읽고 새 계획을 세운다. [시험 범위와 확인 방법](verification/README.md)

파일·기록 확인과 실제 제품 검증을 구분한다. 기존 정답과 자료를 보존한다. 현재 스캐폴드·설계 문서·실제 실행 결과의 범위를 구분해 보고한다.

패키지 공개 직전에 [main 후보 검증](verification/README.md)을 실행한다. 사용 앱에는 공식 npm에서 설치한 버전만 허용한다.
