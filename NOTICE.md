# 由来と権利表示

このリポジトリは2つの別々の作品を含む。ライセンスが違うので混ぜないこと。

## Liquify（このフォークの土台）

- 出所: https://github.com/NMWplays/Liquify
- 著作権: NMWplays
- ライセンス: **AGPL-3.0**（`LICENSE`）
- 該当ファイル: `user.css`, `theme.js`, `color.ini`, `preview.png`,
  `discord-icon.png`, `README.md`

`manifest.json` だけは Marketplace 用にこのフォークのものへ差し替えてある
（配布物の名前・作者・読み込むファイルを書くファイルなので、upstream のままでは
別のテーマを指してしまう）。

これらは**一切編集していない**。変更は `patches/` に分けてあり、ビルド時に
連結する（`FORK.md` 参照）。

## Backdrop（旧 AndroidLiquidGlass）

- 出所: https://github.com/Kyant0/AndroidLiquidGlass
- 著作権: Copyright 2025 Kyant
- ライセンス: **Apache-2.0**

`patches/js/liquid-glass.js` のフラグメントシェーダのうち、屈折・7タップの色収差・
縁のハイライトの各関数は、同リポジトリの
`backdrop/src/commonMain/kotlin/com/kyant/backdrop/internal/Shaders.kt` にある
AGSL ランタイムシェーダを GLSL へ移植したもの。具体的には

- `radiusAt` / `sdRoundedRect` / `gradSdRoundedRect`（`RoundedRectSDF`）
- `circleMap` と屈折の本体（`RoundedRectRefractionShaderString`）
- 7タップの色収差（`RoundedRectRefractionWithDispersionShaderString`）
- 縁のハイライト `pow(abs(dot(grad, lightDir)), falloff)`（`DefaultHighlightShaderString`）
- `colorControls` の色行列（`ColorFilter.kt`）
- 背後の輝度に応じた brightness / contrast / blur の連動
  （`app/.../catalog/destinations/AdaptiveLuminanceGlassContent.kt`）

AGSL は GLSL とスカラー名が違うだけなので、移植は型名の置換と
`content.eval(coord)` のテクスチャ参照化が主。移植が原典と一致することは
`lab/verify.html` で画素単位で検証している（`tools/gen-agsl.py` が原文を
機械抽出し、型名を置換したものと手書きの移植版を同じ入力で描いて差分を取る。
72000画素で最大差 1/255）。

原典と意図的に変えた点:

- 角を superellipse にした（`superness`、既定 4）。原典は円弧。
- 色収差の重みを定数にも切り替えられるようにした（`dispersionCorner`）。
  既定は原典と同じ `(x*y)/(hw*hh)`。

## このフォークで書いた部分

- 著作権: **Copyright (c) 2026 nemut.ai**
- ライセンス: **AGPL-3.0**（`LICENSE`）
- 該当ファイル: `patches/`, `tools/`, `lab/`, `guard/`, `build.ps1`, `deploy.ps1`,
  `FORK.md`, `NOTICE.md`, および `README.md` のうちフォークについて書いた部分

土台の Liquify が AGPL-3.0 なので、この派生物も AGPL-3.0 で配布する。AGPL は
派生物に同じライセンスを要求し、変更点の明示も求めるので、何をどう変えたかは
`FORK.md` とコミット履歴に残してある。

ライセンス本文は `LICENSE` の1つだけ。upstream は同じ内容を `LICENSE.txt` という
名前で置いているが、GitHub がライセンスとして認識するのは `LICENSE` なので、
同一のバイト列を2つ持つのをやめてこちらに寄せた。本文も条件も upstream のまま。

---

# Attribution and licensing (English)

This repository contains three things with different owners.

**Liquify**, the theme this forks — https://github.com/NMWplays/Liquify —
Copyright NMWplays, AGPL-3.0. Its files (`user.css`, `theme.js`, `color.ini`,
`manifest.json`, `preview.png`, `discord-icon.png`) are unmodified; every change
lives in `patches/` and is concatenated at build time.

**Backdrop** — https://github.com/Kyant0/AndroidLiquidGlass — Copyright 2025
Kyant, Apache-2.0. The refraction, seven-tap dispersion and rim highlight in
`patches/js/liquid-glass.js` are a GLSL port of its AGSL runtime shaders. The
port is checked against the original pixel by pixel in `lab/verify.html`:
72000 pixels, maximum channel difference 1/255.

**This fork** — Copyright (c) 2026 nemut.ai, AGPL-3.0. Because Liquify is
AGPL-3.0, so is this derivative.
