# Corner Todo

목표·할 일·루틴을 관리하고, 집중 시간을 기록하고, 지금 할 일을 화면 구석 오버레이로 띄워두는 PC 앱. Windows / macOS. 로그인·클라우드 없이 로컬에만 저장한다.

## 기능

**메인 화면** (오늘 · 목표 · 할 일·루틴 · 기록 · 설정)
- **목표**: 월간·주간·일일 목표. 독립적으로 두거나 상위 목표에 연결. 연결된 하위 목표·할 일의 진행량이 상위로 올라간다 — 단위가 같으면 양을 합산, 다르면 달성률 평균
- **할 일 / 반복 루틴**: 루틴은 매일 또는 요일 선택. 다음 날이면 새로 시작하고, 지난 날 기록은 그대로 남는다. 끝내지 못한 할 일은 오늘로 이월
- **서브 할 일**, **목표량과 단위**(쪽·회·분 등), **일정 시각**(그 시각에 알림·오버레이 표시, 원하면 타이머 자동 시작)
- **진행량**: 체크 한 번으로 완료, +1 버튼이나 숫자 직접 입력으로 일부 진행 기록. 목표량에 도달해도 완료는 직접 체크
- **집중 타이머**: 할 일과 계획 시간을 정해 시작·일시정지·종료. 계획 시간이 지나도 멈추지 않고 초과 시간으로 기록. 할 일별 실제 집중 시간과 오늘의 **Work Time** 누적
- **기록**: 날짜별 완료·진행량·집중 시간, 계획 대비 실제와 초과 시간

**오버레이**
- 지금 할 일과 서브 할 일, 진행량, 집중 타이머, Work Time, 다음 할 일, 다가오는 일정
- 일정 시각이 되면 배너로 표시
- 오버레이에서 바로 완료 체크·진행량 입력·타이머 조작. 클릭해도 쓰던 앱의 입력 포커스를 가져가지 않는다 (Windows)
- 윗줄을 끌어 이동, 오른쪽 아래 모서리로 크기 조절, 위치·크기 잠금과 기억, 모니터 선택, 클릭 통과

**기타**
- 단축키로 어디서든 빠른 할 일 추가: `영단어 외우기 /50개 @21:00` → 목표 50개, 21시 일정
- 메인 창을 닫아도 트레이에서 계속 실행. 트레이에서 메인 화면 열기·오버레이 표시/숨김·완전 종료
- PC 시작 시 자동 실행(설치판), 알림음 선택

## 단축키

| 동작 | Windows | macOS |
|---|---|---|
| 빠른 할 일 추가 | `Ctrl+Shift+Space` | `⌘⇧Space` |
| 오버레이 표시 / 숨김 | `Ctrl+Shift+O` | `⌘⇧O` |
| 조작 모드 / 클릭 통과 전환 | `Ctrl+Shift+L` | `⌘⇧L` |
| 타이머 시작 / 일시정지 | `Ctrl+Shift+P` | `⌘⇧P` |

다른 앱이 이미 쓰고 있는 단축키는 설정 화면에 표시된다.

## 다운로드

[Releases](https://github.com/ImGdevel/Todo/releases)에서 받는다.

- Windows: `Corner-Todo-Setup-x.y.z.exe`(설치) 또는 `Corner-Todo-x.y.z.exe`(포터블)
- macOS: `Corner-Todo-x.y.z-arm64.dmg`(Apple Silicon) 또는 `Corner-Todo-x.y.z-x64.dmg`(Intel)

코드 서명이 없어서 첫 실행 때 경고가 뜬다. Windows는 SmartScreen에서 "추가 정보 → 실행", macOS는 앱 우클릭 → "열기".

## 데이터와 로그

OS 사용자 데이터 폴더(Windows: `%APPDATA%\corner-todo`)에 저장된다.

- `state.json` — 현재 목표·할 일·날짜별 기록·설정. v0.1 데이터는 처음 실행할 때 자동 변환
- `logs/YYYY-MM.jsonl` — 추가만 하는 활동 로그. 한 줄에 이벤트 하나 `{ ts, date, type, ... }`
  - `task.*`, `progress`, `subtask`, `goal.*`, `focus.start|pause|resume|planReached|session`, `schedule.due`
  - `day.summary` — 하루가 지나면 그날의 할 일별 완료·진행량·계획/실제/초과 시간, 집중 세션, 목표 진행률
  - 나중에 AI 분석에 그대로 넘길 수 있는 형식. 현재 분석 기능은 없다

## 개발

Node.js 22 이상.

```bash
npm install
npm start
```

```bash
npm test          # 도메인 로직·저장소 단위 테스트
npm run smoke     # 샘플 데이터로 앱을 띄워 주요 흐름을 자동 점검하고 스크린샷을 남긴다
```

로컬 빌드 (결과물은 `dist/`, git 추적 안 함):

```bash
npm run dist:win   # Windows에서
npm run dist:mac   # macOS에서
```

## 릴리스

빌드 결과물은 커밋하지 않고 GitHub Releases로 배포한다.

1. `package.json`의 `version` 올리고 커밋
2. 같은 버전으로 태그 push: `git tag v0.2.0 && git push origin v0.2.0`
3. GitHub Actions가 Windows·macOS 빌드를 **초안(draft) 릴리스**에 올린다
4. Releases 페이지에서 확인 후 Publish

## 구조

```
src/
  shared/model.js    날짜·반복·진행량·목표 집계·타이머 계산 (메인/렌더러 공용, 순수 함수)
  main/
    index.js         창(메인·오버레이·빠른 입력), 트레이, 단축키, IPC
    store.js         상태 저장·마이그레이션·모든 상태 변경 액션
    timer.js         집중 타이머와 일정 스케줄러
    logger.js        JSONL 활동 로그
    winfocus.js      Windows: 오버레이 클릭 후 원래 앱으로 포커스 반환
    preload.js
  renderer/          app.* (메인 화면), overlay.*, quick.* (빠른 입력), ui.js
test/                단위 테스트 (node --test)
tools/               스모크 테스트 하네스
```
