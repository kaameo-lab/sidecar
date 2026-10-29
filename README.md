# sidecar

Claude Code 옆에 붙는 pane입니다. Claude가 선택지나 질문을 내놓으면 버튼으로 바로 답할 수 있고, 세션의 요약과 작업 그림, 턴별 로그를 함께 보여 줍니다.

sidecar는 TypeScript hooks 모듈로 된 Claude Code **mod**입니다. 화면 문구와 모델 프롬프트는 한국어입니다.

## pane에 보이는 것

- **선택지**: Claude의 마지막 답에 있는 선택지를 버튼으로 보여 줍니다. 누르면 사용자가 직접 입력한 것처럼 보내집니다.
  - `a) b) c)`나 `1. 2.` 목록 (숫자 목록은 근처에 질문이 있거나, 바로 앞 줄이 "다음 중에서 고르시면", "방법은 두 가지" 같은 말일 때만)
  - `Q1 - …` 질문 블록과 `➡️` 추천 답: 질문마다 고르거나 직접 적은 뒤 한 번에 보내고, "모두 추천대로 보내기"도 할 수 있습니다.
  - 답변 끝의 번호 질문 목록 (`1. …할까요?`): `1번: 답` 형식으로 답합니다.
  - `**A. 안**`처럼 문자로 매긴 제목 아래 설명이 있는 대안
- **요약**: 세션의 목표, 정한 것, 남은 일, 이 세션에 바뀐 파일. 5턴마다, 또는 `↻ 갱신`을 누르면 새로 만듭니다.
- **작업 그림**: 이 세션에서 만들거나 고친 파일과 모듈을 상자와 선으로 그립니다. 요약을 갱신할 때 함께 그려집니다.
- **로그**: 메인 대화의 턴마다 한 줄씩, 무엇을 물었고 Claude가 무엇을 했는지 보여 줍니다.

pane은 대화형 세션이 시작될 때와 답에서 선택지가 잡혔을 때 열립니다. `/sidecar`로 언제든 열 수 있습니다.

## 설치

저장소를 받은 뒤 둘 중 하나로 불러옵니다.

```sh
# 한 세션에서만 쓰기
git clone https://github.com/kaameo-lab/sidecar.git
claude --plugin-dir ./sidecar

# 다음 세션부터 늘 쓰기
git clone https://github.com/kaameo-lab/sidecar.git ~/.claude/skills/sidecar
```

## 동작과 데이터

- **모델 호출**: 턴마다 Haiku로 로그 한 줄을 만들고, 5턴마다(또는 `↻ 갱신` 때) 현재 세션을 fork해 요약과 작업 그림을 만듭니다. 이 호출은 사용 중인 Claude Code 계정으로 나갑니다.
- **git**: 세션이 시작될 때 작업 트리 상태를 `git stash create`(변경이 없으면 HEAD)로 기억해 두고, 턴이 끝날 때마다 `git diff`와 추적하지 않는 파일 목록으로 바뀐 파일을 찾습니다. 작업 트리, 인덱스, stash 목록은 건드리지 않습니다. git 저장소가 아니면 Edit·Write 도구로 바뀐 파일만 셉니다.
- **저장**: pane의 로그(최근 30줄), 요약, 바뀐 파일을 세션별로 Claude Code 설정 폴더 안의 sidecar 전용 store에 저장합니다. 최근 20개 세션만 남깁니다. `claude --resume`으로 세션을 다시 열면 pane이 복원됩니다. Claude Code 안에서 `/clear`나 `/resume`을 하면 pane은 빈 상태로 시작합니다.

## 개발

package.json과 빌드 단계는 없습니다. host 바이너리가 `claude-code`와 `claude-code/testing` 모듈을 제공합니다.

```sh
claude plugin test          # tests/ 아래 모든 테스트 실행
claude plugin validate .    # 매니페스트와 hooks 검사
```

구조와 규칙은 [CLAUDE.md](CLAUDE.md)에 있습니다.

## 라이선스

[MIT](LICENSE)
