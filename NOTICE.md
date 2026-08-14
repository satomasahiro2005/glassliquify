# 由来と権利表示

このリポジトリは3つの別々の作品を含む。ライセンスが違うので混ぜないこと。

## Liquify（このフォークの土台）

- 出所: https://github.com/NMWplays/Liquify
- 著作権: NMWplays
- ライセンス: **AGPL-3.0**（`LICENSE`）
- 無改変で持っているファイル: `user.css`, `theme.js`, `color.ini`, `preview.png`,
  `discord-icon.png`
- 変更したファイル: `README.md`（先頭にこのフォークの説明を足した。以降は
  upstream のまま）、`manifest.json`（下記）
- upstream の `user.css` には reactbits.dev の GlassSurface の移植が含まれる
  （`user.css` 冒頭のコメント）。Liquify から引き継いだもので、こちらが
  加えたものではない。

`manifest.json` だけは Marketplace 用にこのフォークのものへ差し替えてある
（配布物の名前・作者・読み込むファイルを書くファイルなので、upstream のままでは
別のテーマを指してしまう）。

上の「無改変」の5つは**一切編集していない**。変更は `patches/` に分けてあり、
ビルド時に連結する（`FORK.md` 参照）。

配布用の `theme/` に入る写しは、内容は同じだが完全に同一のバイト列ではない。
`user.css` は BOM が落ち、`theme.js` と `color.ini` には先頭にライセンス表示の
コメントが付く。Marketplace はマニフェストに書いたファイルしか配らないので、
`LICENSE` や `NOTICE.md` がインストール先に届かないため。

## Backdrop（旧 AndroidLiquidGlass）

- 出所: https://github.com/Kyant0/AndroidLiquidGlass
- 著作権: Copyright 2025 Kyant
- ライセンス: **Apache-2.0**（本文の写しは `licenses/Apache-2.0-Backdrop.txt`。
  Kyant のリポジトリの LICENSE をそのまま同梱している。NOTICE ファイルは
  向こうに存在しない）

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
- 該当ファイル: `patches/`, `tools/`, `guard/`, `build.ps1`, `deploy.ps1`,
  `FORK.md`, `NOTICE.md`, `lab/` のうち下記を除いたもの、および `README.md` の
  うちフォークについて書いた部分
- **`lab/agsl-source.js` は含まない。**あれは Kyant の AGSL 原文を Kotlin から
  取り出しただけのもので、中身は Backdrop のコードそのもの。著作権は Kyant に
  あり、Apache-2.0 のまま。ファイル冒頭に向こうの表示を入れてある。

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
Copyright NMWplays, AGPL-3.0. `user.css`, `theme.js`, `color.ini`, `preview.png`
and `discord-icon.png` are unmodified; every change lives in `patches/` and is
concatenated at build time. `README.md` has this fork's description prepended,
and `manifest.json` is replaced, because it names the theme and the files to
load and upstream's would have the Marketplace install Liquify under this name.
Upstream's `user.css` itself contains a port of reactbits.dev's GlassSurface,
inherited rather than written here.

**Backdrop** — https://github.com/Kyant0/AndroidLiquidGlass — Copyright 2025
Kyant, Apache-2.0; a verbatim copy of their LICENSE is in
`licenses/Apache-2.0-Backdrop.txt`. The refraction, seven-tap dispersion and rim highlight in
`patches/js/liquid-glass.js` are a GLSL port of its AGSL runtime shaders. The
port is checked against the original pixel by pixel in `lab/verify.html`:
72000 pixels, maximum channel difference 1/255.

**This fork** — Copyright (c) 2026 nemut.ai, AGPL-3.0, except
`lab/agsl-source.js`, which is Kyant's shader source lifted out of Kotlin and
stays Apache-2.0 under their copyright. Because Liquify is
AGPL-3.0, so is this derivative.
