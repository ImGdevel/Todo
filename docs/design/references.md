# 레퍼런스: 원칙을 잘 푼 사례

전략 문서(`strategy.md`) 10절 2단계. 스타일(색·글꼴)이 아니라 **위계, 상태 표현, 밀도 전환, 방해하지 않는 방식**을 본다. 각 항목은 "무엇을 가져오고 무엇은 가져오지 않는지"로 정리한다.

## 같은 정보를 여러 크기로 (밀도 단계)

### Apple 라이브 액티비티 (Dynamic Island)
- 하나의 라이브 정보를 **최소(minimal) · 축약(compact) · 펼침(expanded)** 세 가지로 표시하고, 시스템이 상황에 따라 고른다. 앱은 셋 다 지원해야 한다 [1]
- 펼침은 축약을 확대한 모양이라서 전환이 예측 가능하다 [1]
- **가져올 것:** 오버레이 밀도 3단계(최소·기본·펼침)의 구조. 큰 단계는 작은 단계에 덧붙이는 방식으로만 커진다 (요소 위치가 바뀌지 않음). 원칙 ③
- **가져오지 않을 것:** 길게 눌러야 펼쳐지는 숨은 제스처. 데스크톱에서는 마우스 올림·단축키로 드러나야 한다

### watchOS 컴플리케이션
- 시계 화면의 작은 칸에 **지금 시점에 맞는, 가치가 큰 정보만** 둔다. 누르면 앱의 해당 화면으로 간다 [2]
- **가져올 것:** 오버레이는 정보를 다 담지 않는다. 누르면 메인 창의 해당 할 일로 이동. 원칙 ②

### Android 위젯
- 화면마다 칸 크기가 달라서 고정 크기 대신 **크기 범위별로 반응하는 레이아웃**을 권한다. 경계(breakpoint)에서 요소를 줄이거나 뺀다. 위젯에는 일부 정보만 두고 자세한 내용은 앱에서 [3]
- **가져올 것:** 오버레이 폭에 따라 자동으로 밀도를 낮추는 규칙 (노트북 S2). 경계에서 빠지는 순서는 위계의 역순

## 얼마나 빨리 읽혀야 하나 (흘끗 보기 예산)

### NHTSA 운전 중 화면 가이드라인
- 운전 중 기기 조작 과업은 **한 번 볼 때 2초 이하, 과업 전체 12초 이하**를 기준으로 한다 (자율 가이드라인) [4]
- **가져올 것:** 평가 기준을 정량화. 오버레이 읽기는 한 번에 1초 목표(2초 상한), 체크·+1·일시정지 같은 조작은 두 번 이하로 보고 끝나야 함
- **주의:** 운전 기준을 그대로 옮기는 것이 아니라, 주 작업이 있는 상태에서 곁눈질하는 상황의 상한으로 참고만 한다

### 주변 디스플레이 연구 (Matthews 외)
- 기대와 일치하는 표현, 핵심만 남긴 추상화, 확실히 구별되는 시각, 일관성. 투명도·크기·색 농도 같은 미묘한 차이는 한눈에 구별되지 않는다 [5]
- **가져올 것:** 상태 5개는 색이 아니라 **형태**로 크게 다르게 (속 빈 판 / 채운 판 / 빗금 / 반전 / 맨 위 띠)

## 평소엔 비키고 필요할 때만 (조작 모드)

### Xbox Game Bar 고정 위젯
- Game Bar가 열려 있을 때 위젯 불투명도는 항상 100%, 고정 상태로 바뀌면 사용자가 정한 불투명도. 고정 위젯은 게임 위에도 보이고, 클릭 통과를 켤 수 있다 [6]
- **가져올 것:** 고정(수동) ↔ 조작 두 모드. 조작 버튼은 조작 모드에서만 보인다

### Windows 시계 앱 집중 세션
- 세션을 시작하면 작은 타이머가 뜨고, 펼치면 전체 기능. 세션 중 방해 금지가 켜진다 [7]
- **가져올 것:** 작게 시작해서 필요할 때 펼침

### Sunsama 집중 바
- 집중 중인 할 일과 경과 시간만 보여준다. 집중 모드를 끄면 사라진다 [8]
- 사용자 피드백: 떠 있는 상자가 거슬리고 자리를 차지한다, 습관이 되려면 늘 같은 위치에 있어야 한다 [9]
- **가져올 것:** 위치는 고정하고 내용만 바뀐다. 가장 작은 상태는 정말 작아야 한다

### Toggl 미니 타이머 (반면교사)
- 항상 위에 뜨는 동작을 끄지 못하고, 다른 창을 누르면 사라져 다시 못 띄운다는 불만 [10]
- **피할 것:** 사용자가 통제하지 못하는 표시 동작. 숨었을 때 다시 부르는 길이 항상 있어야 함 (단축키, 트레이)

## 화면 가장자리의 정보 (HUD)

### 게임 HUD 실무 원칙
- 자리를 얻을 자격이 있는 요소만, 가끔 필요한 정보는 상황에 따라 표시, 지속 정보는 화면 가장자리, 같은 결정에 쓰는 정보는 묶기 [11]
- **가져올 것:** 일정 도래·초과처럼 가끔 필요한 정보는 그때만. 할 일 이름과 남은 시간은 같은 결정("계속할까")에 쓰므로 붙여 둔다

---

## 출처

1. Apple HIG, Live Activities. https://developer.apple.com/design/human-interface-guidelines/live-activities.md · WWDC23 https://developer.apple.com/videos/play/wwdc2023/10184
2. Apple HIG, Complications · WWDC22. https://developer.apple.com/design/human-interface-guidelines/complications.md · https://developer.apple.com/videos/play/wwdc2022/10050
3. Android, Widget sizing · Canonical layouts. https://developer.android.com/design/ui/mobile/guides/widgets/sizing · https://android-developers.googleblog.com/2025/03/design-with-widget-canonical-layouts.html
4. NHTSA, Visual-Manual Driver Distraction Guidelines. https://www.nhtsa.gov/document/visual-manual-nhtsa-driver-distraction-guidelines-vehicle-electronic-devices-0 · https://www.transportation.gov/briefing-room/us-dot-releases-guidelines-minimize-vehicle-distractions
5. Matthews, Forlizzi, Rohrbach (2006). https://www2.eecs.berkeley.edu/Pubs/TechRpts/2006/EECS-2006-113.html
6. Microsoft, Game Bar widget transparency. https://learn.microsoft.com/en-us/gaming/game-bar/guide/transparency
7. Microsoft, Focus in Windows. https://support.microsoft.com/windows/how-to-use-focus-in-windows-11-cbcc9ddb-8164-43fa-8919-b9a2af072382
8. Sunsama, Focus Bar. https://help.sunsama.com/docs/focus-bar
9. Sunsama 로드맵 피드백. https://roadmap.sunsama.com/improvements/p/floatingomnipresent-focus-mode-toolbar
10. Toggl 커뮤니티. https://community.toggl.com/t/windows-toggl-app-how-to-make-the-mini-timer-not-stay-on-top-of-other-windows/723
11. https://bugnet.io/blog/how-to-design-a-readable-hud · https://gamedeveloper.com/design/perceiving-without-looking-designing-huds-for-peripheral-vision
