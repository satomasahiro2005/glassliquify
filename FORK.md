# Liquify fork（作業メモ）

[NMWplays/Liquify](https://github.com/NMWplays/Liquify) の個人パッチ置き場。

## 方針

**upstream のファイル（`user.css` / `theme.js` / `color.ini`）は絶対に編集しない。**
変更は `patches/*.css` に独立した断片として置き、ビルド時に `user.css` の末尾へ連結する。
CSS は後勝ちなので、追記だけで上書きできる。upstream を取り込んでもコンフリクトしない。

```
patches/010-lyrics-width.css   パッチ本体（ファイル名の数字で連結順）
build.ps1                      dist/ を作る（user.css + patches、色とJSはコピー）
deploy.ps1                     build → Themes\Liquify-fork へ設置 → spicetify apply
dist/                          生成物。git 管理外
```

## 使い方

```powershell
cd ~\workspace\liquify-fork
.\deploy.ps1          # ビルドして適用（Spotify の再起動が要る）
.\deploy.ps1 -NoApply # 中身だけ確認したいとき
```

適用先のテーマ名は `Liquify-fork`。素の `Liquify` は
`%APPDATA%\spicetify\Themes\Liquify\` にそのまま残してあるので、戻すときは

```powershell
& "$env:LOCALAPPDATA\spicetify\spicetify.exe" config current_theme Liquify
& "$env:LOCALAPPDATA\spicetify\spicetify.exe" apply
```

## upstream の取り込み

```powershell
git fetch upstream
git checkout main; git merge --ff-only upstream/main
git checkout fork;  git merge main      # patches/ しか触っていないので衝突しない
.\deploy.ps1
```

取り込み後は、パッチが当てている Spotify 側のクラス名（例
`.lyrics-lyrics-contentWrapper`）が生きているかだけ確認する。壊れるとしたら
upstream ではなく **Spotify 本体の更新でクラス名が変わったとき**。

## パッチを足すとき

Spotify 側の既定値は展開済みの CSS にある。ここを読んでから書く。

```bash
grep -o "\.lyrics-lyrics-[a-zA-Z]*[^{]*{[^}]*}" \
  "$APPDATA/Spotify/Apps/xpui/xpui-snapshot.css"
```

クラス名がハッシュ（`.Wzl40f9FIUD91O2o` みたいなの）のものは Spotify の更新で
変わる。安定しているのは `lyrics-lyrics-*` や `main-*` のような意味のある名前だけ。

## 現状のパッチ

| ファイル | 内容 |
| --- | --- |
| `010-lyrics-width.css` | 歌詞の横幅。既定 `min(100% - 128px, 1024px)` → 幅いっぱい |

## 環境まわり

- 分岐点は upstream `69dbb54`（2026-08-10 "style fix"）。この時点の3ファイルは、
  導入済みの `Themes\Liquify\` の中身とバイト一致していた。
- このリポジトリは `core.autocrlf false` / `core.eol lf`。CRLF で checkout すると
  upstream の blob とハッシュが合わなくなって差分の確認ができない。
- Spotify は winget 版（`%APPDATA%\Spotify`）。Store 版に戻すと spicetify が
  一切効かなくなる。
- 自動再適用の guard（`%LOCALAPPDATA%\spicetify-guard\`）は**消えている**。
  Startup の `spicetify-guard.lnk` はリンク切れの状態。
