# Corner Todo

화면 구석에 작게 띄워두는 오버레이 Todo 리스트 + 집중 타이머. Windows / macOS.

- **설정 창**: 할 일 추가·수정·삭제·드래그 정렬, 타이머 조작, 오버레이 옵션
- **오버레이**: 프레임 없는 투명 창, 항상 위, 작업표시줄에 표시 안 됨
- **타이머**: 집중/휴식(기본 25/5분), 휴식 자동 시작, 종료 알림·알림음, 할 일별 집중 시간 누적
- **클릭 통과(잠금)**: 오버레이가 마우스를 가로채지 않는 보기 전용 모드
- 트레이 상주 — 설정 창을 닫아도 계속 실행, 종료는 트레이 메뉴

## 다운로드

[Releases](https://github.com/ImGdevel/Todo/releases)에서 받는다.

- Windows: `Corner Todo Setup x.y.z.exe`(설치) 또는 `Corner Todo x.y.z.exe`(포터블)
- macOS: `Corner Todo-x.y.z.dmg` (Intel: x64, Apple Silicon: arm64)

코드 서명이 없어서 첫 실행 때 경고가 뜬다.
Windows는 SmartScreen에서 "추가 정보 → 실행", macOS는 앱 우클릭 → "열기".

## 단축키

| 동작 | Windows | macOS |
|---|---|---|
| 오버레이 표시 / 숨김 | `Ctrl+Shift+O` | `⌘⇧O` |
| 클릭 통과 켜기 / 끄기 | `Ctrl+Shift+L` | `⌘⇧L` |
| 타이머 시작 / 일시정지 | `Ctrl+Shift+P` | `⌘⇧P` |

## 개발

Node.js 22 이상.

```bash
npm install
npm start
```

로컬 빌드 (결과물은 `dist/`, git 추적 안 함):

```bash
npm run dist:win   # Windows에서
npm run dist:mac   # macOS에서
```

데이터는 OS 사용자 데이터 폴더의 `state.json`에 저장된다 (Windows: `%APPDATA%\corner-todo`).

## 릴리스

빌드 결과물은 커밋하지 않고 GitHub Releases로 배포한다.

1. `package.json`의 `version` 올리고 커밋
2. 같은 버전으로 태그 push

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. GitHub Actions(`.github/workflows/release.yml`)가 Windows·macOS 빌드를 **초안(draft) 릴리스**에 올린다
4. Releases 페이지에서 초안 확인 후 Publish

## 구조

```
src/
  main.js        메인 프로세스: 상태·타이머·창·트레이·단축키
  preload.js     렌더러에 노출하는 IPC API
  shared.js      두 창 공용 (아이콘, 시간 포맷, 타이머 계산)
  settings.*     설정 창
  overlay.*      오버레이 창
```
