# sidecar

[![Release](https://img.shields.io/github/v/release/kaameo-lab/sidecar)](https://github.com/kaameo-lab/sidecar/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code 2.1.312](https://img.shields.io/badge/Claude%20Code-2.1.312%20mod-d97757.svg)](https://claude.com/blog/claude-code-mods)

**Claude Code 옆에 붙는 pane.** Claude가 선택지나 질문을 내놓으면 버튼으로 바로 답하고, 이 세션에서 정한 것과 남은 일, 손댄 파일의 구조, 턴별로 한 일을 한눈에 봅니다.

<!-- 대표 GIF: docs/media/demo.gif -->

<p align="center">
  <a href="#설치">설치</a> · <a href="#보이는-것">보이는 것</a> · <a href="#사용">사용</a> · <a href="#접근-범위">접근 범위</a> · <a href="#문제-해결">문제 해결</a> · <a href="CHANGELOG.md">변경 기록</a>
</p>

## 설치

Claude Code 안에서:

```
/plugin install sidecar --marketplace kaameo-lab/sidecar
/reload-plugins
/sidecar
```

<details>
<summary><strong>터미널에서, 또는 clone해서</strong></summary>

```sh
claude plugin marketplace add kaameo-lab/sidecar
claude plugin install sidecar@kaameo-lab
```

설치하지 않고 한 세션에서만 써 보려면:

```sh
git clone https://github.com/kaameo-lab/sidecar
claude --plugin-dir ./sidecar
```

업데이트는 `claude plugin update sidecar@kaameo-lab`, 제거는 `claude plugin uninstall sidecar@kaameo-lab`입니다.

</details>

**사전 요구사항**: Claude Code 2.1.312에서 확인했습니다. mod는 Claude Code의 early access 기능이라 API가 버전마다 바뀔 수 있습니다. 바뀐 파일 추적에는 git이 필요합니다(없으면 Edit·Write 도구로 바뀐 파일만 셉니다).

## 보이는 것

<!-- 전체 화면: docs/media/docked-session.png -->

| 섹션 | 보여 주는 것 | 언제 바뀌나 |
| --- | --- | --- |
| **선택지** | 마지막 답에 있는 선택지와 질문을 버튼으로. 누르면 사용자가 입력한 것처럼 보내집니다. 추천 답에는 `✓추천` 표시가 붙습니다. | Claude가 답을 마칠 때마다 |
| **요약** | 세션의 목표, 정한 것, 남은 일, 이 세션에 바뀐 파일 | 5턴마다, 또는 `↻ 갱신`을 누를 때 |
| **작업 그림** | 이 세션에서 만들거나(초록) 고친(노랑) 파일과 모듈을 상자와 선으로 | 요약을 갱신할 때 |
| **로그** | 턴마다 한 줄: 무엇을 물었고 Claude가 무엇을 했는지. 누르면 자세한 줄이 펼쳐집니다. | 턴이 끝날 때마다 |

<!-- 섹션별: docs/media/choices.png, docs/media/summary.png, docs/media/log.png -->

pane은 대화형 세션이 시작될 때와 답에서 선택지를 찾았을 때 열립니다. 색은 사용 중인 Claude Code 테마를 따릅니다.

## 사용

| 명령·키 | 하는 일 |
| --- | --- |
| `/sidecar` | pane 열기 |
| `ctrl+x tab` | pane으로 포커스 옮기기 |
| `a` `b` `c` … | (포커스가 pane에 있을 때) 단순 선택지 고르기 |
| 섹션 제목 누르기 | 섹션 접기·펴기 |

### 선택지로 인식하는 형식

| 형식 | 예 | 보내는 답 |
| --- | --- | --- |
| 문자 목록 | `a) 세션 쿠키` `b) JWT` | `b) JWT` |
| 숫자 목록 | 근처에 `?`가 있거나, 바로 앞 줄이 "다음 중에서 고르시면", "방법은 두 가지"일 때 | `1) …` |
| Q 블록 | `❓ Q1 - 제목: 질문` 아래 `➡️ 추천 답`과 `a) b)` | `Q1: …` 줄을 모아 한 번에 |
| 번호 질문 목록 | 답 끝의 `1. 닫을까요?` `2. 만들까요?` | `1번: …` 줄을 모아 한 번에 |
| 문자 제목 | `**A. 안**` 아래 설명 문단, 끝에 "어느 쪽으로 할까요?" | `a) 안` |

Q 블록과 번호 질문은 질문마다 고르거나 `✎ 직접`으로 적은 뒤 보냅니다. 추천 답이 있으면 "모두 추천대로 보내기"도 됩니다. pane 폭에 잘려 보인 선택지는 글자 대신 키(`b`)만 보냅니다. 보이지 않은 글자가 사용자 이름으로 나가지 않게 하려는 것입니다.

## 접근 범위

| 하는 일 | 어떻게 |
| --- | --- |
| 턴마다 로그 한 줄 만들기 | Haiku 호출 한 번(`$.model.complete`) |
| 요약과 작업 그림 만들기 | 5턴마다, 또는 `↻ 갱신` 때 현재 세션 fork 한 번(`$.model.fork`) |
| 바뀐 파일 찾기 | `git stash create`, `git diff --name-only`, `git ls-files --others`. 작업 트리, 인덱스, stash 목록은 바꾸지 않습니다. |
| pane 저장과 복원 | 세션별로 로그(최근 30줄), 요약, 바뀐 파일을 Claude Code 설정 폴더 안의 sidecar 전용 store에 저장합니다. 최근 20개 세션만 남깁니다. |
| 답 보내기 | 버튼을 누를 때만 `$.prompt.submit`으로 보냅니다. |

모델 호출은 사용 중인 Claude Code 계정으로 나가고, 그 밖의 네트워크 요청은 하지 않습니다. `claude plugin validate .`가 무엇을 hook하고 호출하는지 그대로 보여 줍니다.

## 추정인 것

- **선택지 인식은 휴리스틱입니다.** 위 형식에 맞지 않으면 놓치고, 드물게 단계 목록을 선택지로 잡습니다. 형식은 로컬 대화 기록(답변 2천여 개)으로 재 보고 오탐이 적은 것만 넣었습니다.
- **요약과 작업 그림은 모델이 쓴 것입니다.** 바뀐 파일 목록은 도구 호출과 git에서 오지만, 목표와 결정, 상자와 선은 모델이 대화를 읽고 정리한 것입니다.

## 문제 해결

**pane이 안 열려요.** `/reload-plugins` 뒤 `/sidecar`를 실행하세요. 터미널이 좁으면 Claude Code가 자동으로 여는 pane을 자리에 앉히지 않을 수 있습니다. `/sidecar`로는 언제든 열립니다.

**선택지가 안 잡혀요.** 위 [형식 표](#선택지로-인식하는-형식)에 맞는지 보세요. 맞는데도 안 잡히면 그 답변을 붙여 [issue](https://github.com/kaameo-lab/sidecar/issues)로 알려 주세요.

**resume했더니 pane이 비어 있어요.** `claude --resume`으로 새로 띄운 세션은 복원됩니다. Claude Code 안에서 `/clear`나 `/resume`을 하면 pane은 빈 상태로 시작합니다. 0.4.0 이전 세션은 저장된 기록이 없습니다.

**바뀐 파일이 비어 있어요.** git 저장소가 아니면 Edit·Write 도구로 바뀐 파일만 셉니다.

## 구조

| 파일 | 내용 |
| --- | --- |
| [`hooks/register.tsx`](hooks/register.tsx) | 이벤트 hook, 상태, 저장과 복원, pane 그리기 |
| [`hooks/parse.ts`](hooks/parse.ts) | 답에서 선택지와 질문 찾기 |
| [`hooks/digest.ts`](hooks/digest.ts) | 로그·요약 프롬프트와 모델 답 해석 |
| [`hooks/diagram.ts`](hooks/diagram.ts) | 작업 그림을 상자와 선(좁으면 트리)으로 그리기 |
| [`hooks/width.ts`](hooks/width.ts) | 한글을 두 칸으로 세는 폭 계산 |
| [`tests/`](tests) | 순수 함수 테스트와, terminal·desktop에 그려 보는 pane 테스트 |

## 개발

```sh
claude --plugin-dir .            # 불러오기, 고치면 다시 불러옵니다
claude plugin test .
claude plugin validate .
npx -p typescript tsc --noEmit -p .
```

규칙과 구조는 [CLAUDE.md](CLAUDE.md)에 있습니다. 버그와 제안은 [GitHub Issues](https://github.com/kaameo-lab/sidecar/issues)로 받습니다.

## 라이선스

[MIT](LICENSE)
