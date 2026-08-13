# 由来と権利表示

このリポジトリは2つの別々の作品を含む。ライセンスが違うので混ぜないこと。

## Liquify（このフォークの土台）

- 出所: https://github.com/NMWplays/Liquify
- 著作権: NMWplays
- ライセンス: **AGPL-3.0**（`LICENSE.txt`）
- 該当ファイル: `user.css`, `theme.js`, `color.ini`, `manifest.json`, `preview.png`,
  `discord-icon.png`, `README.md`

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

`patches/`, `tools/`, `lab/`, `guard/`, `build.ps1`, `deploy.ps1`, `FORK.md`。
土台が AGPL-3.0 なので、全体を配布する場合は AGPL-3.0 に従う。
