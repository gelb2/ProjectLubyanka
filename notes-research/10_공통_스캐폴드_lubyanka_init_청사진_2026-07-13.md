# 공통 스캐폴드 — 8개 프로젝트가 Claude 작업환경을 세우는 공통 골격 (Document 10)
### = `lubyanka init` 청사진 + 소프트웨어편 뼈대

> 도입: 2026-07-13
> 사용자 질문: 내가 만든 프로젝트들의 문서·하네스·스킬·에이전트에서 — **정본·디자인·아키텍처·ADR·동기화 규칙·브랜치 규칙·센서** 등 "Claude가 보고 건드는 영역"을 어떻게 설정했는지 **공통점**이 보이나? (이게 스캐폴딩의 첫 시작 단서이자 루비얀카 패키지 구현 단서.)
> 근거: Phase1(4프로젝트 심층) + 수집(RoadRage·STT·SendPr·Wickiho) + 8프로젝트 카논파일 실측 그렙.

---

## §0. 한 줄 답

**YES — 8개 프로젝트가 거의 동일한 골격을 쓴다. 가장 강한 증거: 여러 프로젝트의 `.claude/knowledge/`에 같은 파일 세트가 반복된다** — `doc-pyramid` · `doc-registry` · `docs-sync` · `git-branch-strategy` · `sensors` · `agent-system` · `workflows` · `pre-deploy-checklist`. 이건 우연이 아니라 **손으로 8번 이식한 스캐폴드**다. 그러므로 `lubyanka init`은 이 골격을 자동 생성하면 된다.

---

## §1. 공통 골격 전체도 (반복되는 파일·구조)

```
<project>/
├── CLAUDE.md                    # §0 절대율법(제로톨러런스) + 분할정본 포인터  ← 8/8
├── PLANNING_<NAME>.md           # 피라미드 최상위(Why/전략)                  ← 대부분
├── .claude/
│   ├── AGENTS.md                # 하네스·메모리·다중에이전트 정본            ← 다수
│   ├── shared-contracts.md      # 에이전트 간 리포트 스키마(원본 stdout 강제) ← Grimoire·STT·Wickiho
│   ├── knowledge/               # ★방법론 정본 세트(아래 §2 차원과 1:1)
│   │   ├── doc-pyramid.md        doc-registry.md   docs-sync.md
│   │   ├── git-branch-strategy.md  sensors.md      agent-system.md
│   │   └── workflows.md          pre-deploy-checklist.md
│   ├── agents/*.md              # 로스터: planner·researcher·qa·server·web
│   │                            #  + visual-canon-keeper·cost-accountant·(도메인)
│   ├── skills/*/SKILL.md        # orchestration-decision·verification-before-completion
│   │                            #  ·systematic-debugging·visual-canon-diff
│   ├── scripts/*.sh             # 센서(verdict+exit) + 훅(pre/post/stop/precompact)
│   └── settings.json            # 훅 배선
├── docs/
│   ├── canon/                   # 코드가 인용하는 사실 정본(design-reference 등)
│   ├── incident/                # 장애/자백 리포트(고정 골격) ← 자백 스택
│   └── planning/                # 개발/기획/리팩토링/배포 계획(+승인대기 상태)
├── HANDOVER_*.md                # 세션 핸드오버(고정 섹션, 날짜 체인 or NEXT)
├── PROGRESS.md / STATUS.md      # "지금 무엇이 참인가"
├── SYNC_STATUS.md               # 크로스레포/플랫폼 동기화 매트릭스
├── CHANGELOG.md / TODO.md       # 이력
├── ACCOUNTS.md / account.md     # 비밀 대체(ID만, git 미추적)
└── .githooks/{pre-commit,pre-push}  # 무는 게이트
```
+ repo 밖 `~/.claude/projects/<slug>/memory/` 세션 메모리(전 프로젝트 공통).

---

## §2. 7차원별 공통 패턴 (사용자가 콕 집은 것)

| 차원 | 공통 문서 | 공통 강제장치 | 공통 규칙 | 변형(도메인) |
|---|---|---|---|---|
| **정본(SSOT)** | `knowledge/doc-pyramid.md` + `doc-registry.md` | 번호 하드코딩 금지 센서 | **"한 곳에만 있다 + 나머지는 참조"** · 수정은 위→아래 단방향 | — |
| **디자인** | `docs/…/design-tokens`·`theme-spec`·`design-reference` | `visual-canon-keeper` 에이전트 + `visual-canon-diff` 스킬 + `sensor-visual-canon-drift` | 시각 무공차(§2): 픽셀 달라지면 회귀 | 시각 없는 프로젝트(STT·SendPr)는 생략 |
| **아키텍처** | `docs/architecture-*`(FSD) / 서버 헥사고날 | 의존성 경계 린트(dependency-cruiser) + `server-architect` 역할 | 레이어 경계·SOLID(=Context Rot 방지) | web=FSD / server=hexagonal / mobile=MVVM |
| **ADR** | ⚠️ 전용 폴더 **없음** | — | **"잠긴 결정 — 재론 금지"** / "설계결정 필요→보류" | 핸드오버·기획 문서 안에 산다(§3) |
| **동기화** | `knowledge/docs-sync.md` | `sensor-docs-sync`(SHA256/`diff -q` 바이트 대조) + `SYNC_STATUS.md` | canonical-repo-first, copy second, same session | 단일레포는 생략 / 멀티레포·멀티플랫폼은 필수 |
| **브랜치** | `knowledge/git-branch-strategy.md` + `.githooks/AGENTS.md` | `pre-push`(tsc+test+build 차단) + GitHub Actions | `feature→develop→main` 단방향 · **main은 인간만** · `--no-verify` 금지 | — |
| **센서** | `knowledge/sensors.md` | `scripts/sensor-*.sh`(verdict+exit) + 훅 배선 | **강제력 4단계**: 산문 < 도구제한 에이전트 < 결정론 센서 < PreToolUse 훅 | 도메인 센서(결제·i18n·안전) |

**관통 원리 3개(전 차원 공통):**
1. **단일 진실 + 참조** — 사실은 한 곳, 나머지는 링크. 복사본이 없으면 어긋날 게 없다.
2. **선언 ≠ 강제** — 문서에 "필수"라 적는 것과 실제 강제는 다르다. 그래서 4단계 강제력 사다리(산문→훅).
3. **증거만 인정** — verdict+exit code·바이트 대조·원본 stdout. "요약만 남기면 거짓 PASS."

---

## §3. 정직한 발견 — ADR은 아직 "구멍"이자 기회

네가 콕 집은 7개 중 **ADR(아키텍처 결정 기록)만 전용 형식이 없다.** 대신 결정은 여기저기 흩어져 산다 — 핸드오버의 "잠긴 결정 — 재론 금지"(재론 방지), 기획 문서의 "구현 승인 대기", 대화 중 "설계결정 필요 → 보류". 즉 **결정을 잠그는 문화는 있는데, 그걸 담는 단일 정본(ADR)이 없다.**

→ 이건 스캐폴드가 **형식화할 기회**다. `lubyanka init`이 `docs/decisions/`(ADR)를 만들어 "잠긴 결정"을 한 곳에 모으면, 지금 흩어진 것을 정본화한다. (단 §5: 결정 *내용*은 인간이 채운다 — 구조만 자동.)

---

## §4. → `lubyanka init` 청사진

스캐폴드가 생성할 것(구조=자동) vs 인간이 채울 것(실질=수동, 이론편·인간편):

| init이 **생성**(구조) | 인간이 **채움**(실질) |
|---|---|
| `CLAUDE.md` §0 율법 템플릿(빈 프로젝트 정체성) | 프로젝트 정체성·도메인 규칙 |
| `PLANNING_<NAME>.md` 스텁 | Why/전략 |
| `.claude/knowledge/` 8종 세트(위 §1) | (대부분 그대로 재사용 가능 — 방법론이라 도메인 무관) |
| `.claude/agents/` 기본 로스터(planner·qa·verifier…) | 도메인 에이전트(안전·결제·커머스…) |
| `.claude/skills/` 기본 3종(verification-before-completion 등) | — |
| `.claude/scripts/` 센서·훅 스텁 + `settings.json` 배선 | 도메인 센서 |
| `docs/{canon,incident,planning,decisions}/` 폴더 + 템플릿 | 사실·결정 내용 |
| `HANDOVER`·`PROGRESS`·`SYNC_STATUS` 템플릿 | 상태 |
| `.githooks/{pre-commit,pre-push}` | — |
| `account.md` 스텁(ID만) | — |
| **`SSOT`는 빈칸으로** | ★SSOT 실질(무엇이 옳음·완료) — 절대 자동 금지(그려진 문 방지) |

**핵심**: `.claude/knowledge/` 8종은 방법론 문서라 **도메인 무관 → 거의 그대로 이식**된다(네가 8번 손이식한 게 증거). 이게 스캐폴드의 90%. 나머지(도메인 에이전트·센서·SSOT 실질)만 프로젝트마다 채운다.

---

## §5. → 패키지 ① 구현 단서 (Doc6 연결)

- 이 골격이 곧 Doc6 §2.2의 **1층 "방법"**(어디서나 동일한 스켈레톤)의 실체다. `.claude/knowledge/` 8종 + 에이전트/스킬/센서 템플릿 = 패키지가 ship하는 "뇌".
- **어댑터(3층)**로 스택별 변형: 디자인 차원=시각 프로젝트만, 동기화=멀티레포만, 아키텍처=web(FSD)/server(hexagonal)/mobile(MVVM). init이 감지해 켜고 끈다(Ouroboros brownfield식).
- **ADR 형식화**(§3)는 패키지가 기존 관행보다 *개선*하는 지점 — 파는 이유가 된다.
- 경계(§4·이론편): 구조는 자동, **SSOT 실질은 인간**. init이 SSOT를 추측해 채우면 그 자체가 security theater.

---

## §6. → 소프트웨어편과의 관계

이 §1·§2 골격이 곧 **소프트웨어편 §3 "시키는 법 = 문서"의 뼈대**다. 소프트웨어편은 이 7차원을 "왜 각 문서가 필요한가"로 풀어 가르친다(익명·teach-by-reading):
- 정본 → SSOT를 정하는 법·왜
- 피라미드 → 문서 위계가 필요한 이유
- 핸드오버·PROGRESS → 세션이 기억을 잃으니까
- 동기화 → 복사본이 어긋나니까
- 브랜치 → 되돌리기 어려운 걸 인간이 쥐니까
- 센서 → 선언은 강제가 아니니까(4단계)
- ADR → 결정을 잠가야 재론이 안 도니까

→ **이 검토가 소프트웨어편의 목차를 사실상 확정했다.** 이제 소프트웨어편을 이 골격 위에 쓴다.

---

## 부록. 실측 근거(카논 파일 그렙, 8프로젝트)
- `.claude/knowledge/` 방법론 세트 반복: Zenith·STT(+Grimoire 등가) — doc-pyramid/doc-registry/docs-sync/git-branch-strategy/sensors/agent-system/workflows/pre-deploy-checklist.
- `visual-canon-keeper` 에이전트: Grimoire·Funnel·Zenith(designer)·Wickiho·(RoadRage safety-auditor 계열).
- `docs/{canon,incident,planning}/` taxonomy: Candidate(가장 선명)·SendPr(HANDOVER 체인+기획docs)·Wickiho.
- `shared-contracts.md`(원본 stdout 강제): Grimoire·STT·Wickiho.
- `SYNC_STATUS.md`·docs-sync: Candidate·RoadRage·Zenith·SendPr(멀티레포).
- 원 분석: `scratchpad/phase1/*` + `scratchpad/gather/*`.
