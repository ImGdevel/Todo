# 디자인 시스템 선정

결정: **IBM Carbon의 기반(foundations)을 이름과 값 그대로 채택**하고, Corner Todo 오버레이 계층만 그 위에 얹는다. Carbon 컴포넌트 모양은 가져오지 않는다.

- 디자인 시스템: https://claude.ai/artifact/MjSh4sZyAUK9xk7U5T4LMy
- 원본 패키지 (2주 이상 지난 버전): `@carbon/colors` 11.62.0, `@carbon/themes` 11.85.0, `@carbon/layout` 11.63.0, `@carbon/type` 11.71.0 — Apache-2.0. 서체 IBM Plex Sans KR · IBM Plex Mono — OFL.

## 왜 직접 만들지 않나

전문 디자이너 팀이 수년간 검증한 체계(색 대비, 글자 단계, 간격, 어두운 테마의 레이어 규칙)를 혼자 다시 만드는 것은 품질도 낮고 근거도 약하다. 검증된 기반을 쓰고, 이 제품에만 있는 결정(오버레이 상태·밀도·조작 모드)에 노력을 쓴다.

## 후보 비교

| 기준 | Fluent 2 | **Carbon** | Radix Colors | Primer | Material 3 |
|---|---|---|---|---|---|
| 범위 | 토큰·서체·아이콘·컴포넌트 | 토큰·테마·서체·아이콘·컴포넌트 | 색만 | 토큰 | 토큰·동적 색 |
| Windows·macOS 중립 | 아니오 (Windows 정체성) | 예 | 예 | 예 | 모바일 중심 |
| 한글 서체 | 없음 (Segoe UI Variable, 재배포 불가) | **IBM Plex Sans KR** | — | 없음 | — |
| 고정폭 숫자 서체 | 별도 | **IBM Plex Mono (같은 가족)** | — | 별도 | — |
| 어두운 테마 레이어 규칙 | 있음 | **Gray 100/90 단계별 레이어** | 12단계 용도 | 있음 | 있음 |
| 라이선스 | MIT (코드·아이콘), 상표 별도 | Apache-2.0 / OFL | MIT | MIT | — |
| 데스크톱 가이드 | 있음 | 있음 (생산성 글자 체계) | — | 웹 | 사실상 없음 |

Carbon을 고른 이유:
1. 한글과 고정폭 숫자가 한 서체 가족 → 원칙 ④ "숫자가 주인공"과 한글 UI를 동시에 해결 (후보 중 유일)
2. 어두운 테마 레이어 규칙이 오버레이 판 구조(대기 판 → 집중 판)에 그대로 대응
3. 두 OS에서 중립적, 라이선스 명확
4. 오버레이 타이머 42px이 Carbon 글자 단계(… 36, 42, 48 …)에 이미 있음

위험과 대응: Carbon 컴포넌트를 그대로 쓰면 IBM 제품처럼 보인다 → 컴포넌트 모양은 가져오지 않고, 강조색(미정)과 오버레이 컴포넌트로 정체성을 만든다.

## 대응표

| Corner Todo 용도 | Carbon 토큰 | 어두움 (g100) | 밝음 (g10) |
|---|---|---|---|
| 메인 창 바탕 | `background` | #161616 | #f4f4f4 |
| 패널, 오버레이 판(대기·일시정지) | `layer-01` | #262626 | #ffffff |
| 오버레이 판(집중·초과), 선택 행 | `layer-selected-01` | #393939 | #e0e0e0 |
| 할 일·타이머 | `text-primary` | #f4f4f4 | #161616 |
| 대기 이름·계획·일시정지 숫자 | `text-secondary` | #c6c6c6 | #525252 |
| 라벨·단위 (`layer-01` 위에서만) | `text-helper` | #a8a8a8 | #6f6f6f |
| 대기 점선·체크박스 | `border-strong-01` | #6f6f6f | #8d8d8d |
| 구분선 | `border-subtle-01` | #525252 | #e0e0e0 |
| 일정 도래 띠 | `background-inverse` / `text-inverse` | #f4f4f4 / #161616 | #393939 / #ffffff |
| 포커스 링 | `focus` | #ffffff | #0f62fe |

## 대비 검증

모든 글자 조합이 4.5:1, 의미 있는 테두리가 3:1을 넘는다. 예외는 `text-helper` on `layer-selected-01`(밝은 테마 3.81:1) 하나 → 집중 판 위에서는 `text-secondary`를 쓰도록 규칙화. Carbon 원래 값은 바꾸지 않았다.

## 강조색: Carbon Cyan 40 / Cyan 60

뜻은 "집중 세션 진행 중" 하나. 집중 중의 ● 기호와 진행 막대에만 쓴다.

| 후보 (Carbon) | 파랑-노랑 축 비중 b/(a+b) | 판단 |
|---|---|---|
| 노랑 | 0.90–0.97 | Carbon 경고색, 초과를 실패처럼 보이게 함 → 제외 |
| **시안** | **0.86–0.99** | 경고·성공·링크와 겹치지 않음 → **선택** |
| 파랑 | 0.69–0.95 | Carbon 동작색·IBM 정체성·링크 → 제외 |
| 주황 | ~0.6 | 따뜻하고 채도 높음(각성), 경고에 가까움 → 제외 |
| 보라 | ~0.56 | 빨강 성분 |
| 초록 | ~0.4 | 빨강-초록 축, '성공' 의미 |
| 청록·자홍 | 0.1–0.2 | 빨강-초록 축 |

- 근거: 주변 시야에서는 빨강-초록 구별이 급격히 약해지고 파랑-노랑 구별은 오래 유지된다 (Mullen & Kingdom 2002 https://www.mvr.mcgill.ca/Fred/Papers/Mullen&Kingdom_2002.pdf · Hansen 외 2009 https://pmc.ncbi.nlm.nih.gov/articles/PMC6725021/). 채도·밝기가 높고 붉을수록 각성이 높다는 결과가 많다 (Wilms & Oberfeld 2018 https://pubmed.ncbi.nlm.nih.gov/28612080/, 연구 간 차이 있음).
- 대비: 어두운 테마 Cyan 40 `#33b1ff` — 집중 판 4.88:1, 트랙 3.30:1. 밝은 테마 Cyan 60 `#0072c3` — 집중 판 3.79:1, 흰 판 5.01:1. 그래픽 3:1 기준(WCAG 1.4.11) 통과, 밝은 테마는 글자 4.5:1 미달이라 글자에 쓰지 않는다.
- 링크 파랑과의 색차 ΔE 33(어두움) / 47(밝음).

## 아직 정하지 않은 것

- 아이콘: Carbon 아이콘을 쓰기로 하되 파일은 아직 넣지 않았다.

## 출처

- Carbon 테마·색·토큰: https://carbondesignsystem.com/elements/themes/overview/ · https://carbondesignsystem.com/elements/color/tokens · 저장소(Apache-2.0) https://github.com/carbon-design-system/carbon
- IBM Plex Sans KR (OFL): https://fontsource.org/fonts/ibm-plex-sans-kr/about
- Fluent 2: https://fluent2.microsoft.design/design-tokens · 아이콘 https://github.com/microsoft/fluentui-system-icons · Windows 타이포그래피 https://learn.microsoft.com/windows/apps/design/signature-experiences/typography
- Radix Colors: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- Primer Primitives (MIT): https://github.com/primer/primitives
- Pretendard (OFL): https://github.com/orioncactus/pretendard
