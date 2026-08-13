"""Rewrite this fork's commit messages in English. Upstream's stay untouched."""
import sys

MAP = {
    "fork: 追記パッチ方式の作業場を用意し、歌詞の横幅を広げる":
        "Set up the fork as append-only patches\n\n"
        "Upstream's files are never edited. Changes live in patches/*.css and are\n"
        "concatenated onto user.css at build time, so CSS's last-wins rule does the\n"
        "overriding and merging upstream never conflicts.",
    "guard: 自動再適用の guard を作り直してリポジトリで持つ":
        "Rebuild the reapply guard and keep its source here\n\n"
        "The guard's files had gone missing and the Startup shortcut pointed at\n"
        "nothing. Its only copy being the installed one was the problem, so the\n"
        "source lives in guard/ and install-guard.ps1 puts it back.",
    "lab: ブラウザで詰めるための実験台と SDF レンズの変位マップ":
        "Add a browser test bench and an SDF displacement map\n\n"
        "Restarting Spotify for every tweak is no way to work on a look. The bench\n"
        "reproduces the same conditions in a page.\n\n"
        "The shipped map is not a distance field: it is two linear gradients over the\n"
        "whole box, and it writes the vertical ramp into blue while the filter reads\n"
        "green. The result is a translation, not a refraction.",
    "lab: SVG フィルタをやめて AGSL を GLSL に移植した WebGL 実装にする":
        "Port the AGSL shaders to GLSL and drop the SVG filter route\n\n"
        "With a known backdrop there is nothing to read back from the compositor, so\n"
        "backdrop-filter buys nothing and costs an 8-bit displacement map, filter\n"
        "subregion quirks and an approximated blur.\n\n"
        "Dispersion is the original's seven weighted taps, not a three-tap stand-in.\n"
        "Each channel's weights sum to 1, so brightness is unchanged.",
    "patches: WebGL のガラスを Spicetify 拡張として再生バーに適用":
        "Ship the WebGL glass as an extension, starting with the playbar\n\n"
        "The backdrop is rebuilt from .liquify-bg-layer: the cover at background-size\n"
        "cover with the theme's blur and brightness. The cover URL comes from the\n"
        "player metadata and loads cross-origin, which the theme already relies on.",
    "patches: 全89面へ適用し、背景のぼかしをゼロにする":
        "Apply to all 89 surfaces and stop pre-blurring the wallpaper\n\n"
        "Selectors are generated from the theme's own list; writing them by hand\n"
        "means missing whatever upstream adds. A lens has nothing to bend if the\n"
        "wallpaper was blurred before it got there.",
    "patches: 全面をWebGLで積み、色収差を縁全体へ、角をsquircleに":
        "Composite every surface in WebGL, with superellipse corners",
    "patches: 黒箱の真因を潰し、対象を実行時判定にしてトグルを付ける":
        "Fix the black panels, decide targets at runtime, add a toggle\n\n"
        "The panels were refracting a flat fallback fill, not the wallpaper: the\n"
        "backdrop was built once before any cover had loaded and never rebuilt.\n\n"
        "Surfaces are chosen by testing the current layout rather than by a list, so\n"
        "a floating player or a Spotify layout change falls out of it on its own.",
    "patches: キャンバスの重なりを直し、描画コストとはみ出しを潰す":
        "Fix the canvas stacking, the per-frame cost and the overspill\n\n"
        "At z-index 1 the canvas covered the main view's content; at -1 it fell behind\n"
        "an opaque ancestor. Only the position the theme already uses works.",
    "lab: 移植が原典と一致することを画素で検証する":
        "Check the port against the original, pixel by pixel\n\n"
        "The AGSL source is extracted from Shaders.kt mechanically, translated by\n"
        "type name only, and rendered beside the hand-written port with the same\n"
        "inputs. 72000 pixels, maximum channel difference 1/255.",
    "patches: 動いていないフレームは矩形も読まない":
        "Read no geometry on frames where nothing moved\n\n"
        "Building the signature was itself forcing layout every frame. Now a scroll,\n"
        "a resize or a mutation sets a flag and idle frames cost nothing.",
    "patches: 上下反転・残った元スタイル・低解像度の背景・弱すぎる色収差を直す":
        "Fix the flipped backdrop, leftover styling, cover resolution and dispersion\n\n"
        "Pixel y maps to framebuffer row 0 and sampling uses v = y/H, so flipping on\n"
        "upload turned the wallpaper upside down; the one flip belongs in the final\n"
        "blit. The API tops out at 640px but the CDN serves 2000px for the same id.\n"
        "Dispersion was running at a seventh of the original's strength.",
    "設定パネル、背後の輝度への適応、帰属表示":
        "Add the settings panel, luminance adaptation and attribution\n\n"
        "Legibility follows the backdrop's luminance rather than a fixed darkening:\n"
        "over a bright cover the material lifts its brightness, crushes contrast and\n"
        "blurs harder. NOTICE.md records which files come from Liquify (AGPL-3.0) and\n"
        "which from Backdrop (Apache-2.0).",
    "設定ボタンをLiquifyの歯車の左へ、既定をクリアに、固定面を除外":
        "Move the settings button beside the gear, default to clear\n\n"
        "Surfaces pinned inside a scroller are left to the theme: this canvas only\n"
        "knows the wallpaper, so it would blur a still image while the real content\n"
        "slid past underneath.",
    "セクションに残っていたテーマのぼかしを剥がす":
        "Take the theme's blur off the sections it was left on\n\n"
        "Stripping only what this pass drew left anything off screen or skipped still\n"
        "frosted while the rest went clear.",
    "灰色の霞、消えた枠、オーバーレイのぼかしを直す":
        "Fix the grey haze, the missing frames and the overlay blur\n\n"
        "The haze was a texture unit left bound: after the first surface, unit 0 still\n"
        "held the blurred copy, so everything drawn afterwards read it as its sharp\n"
        "backdrop.",
    "ガラスの角を要素の角丸に合わせる":
        "Match the glass corner to the element's own radius",
    "Appleの角に戻し、枠をシェーダ側で描く":
        "Go back to the superellipse corner and draw the frame in the shader\n\n"
        "A CSS border follows the element's circular radius, so it cannot coexist with\n"
        "a superellipse edge without doubling the outline.",
    "角の二重線を消し、検索バーと素の角丸も揃える":
        "Remove the doubled outline; match the search bar and plain corners\n\n"
        "The theme draws its shadow on the element's circular radius, which sits on\n"
        "top of the superellipse along the straight edges and separates at the corner.",
    "フルスクリーン中はガラスを止める":
        "Stand down during full screen",
    "フルスクリーンをガラスにし、はみ出す情報行を隠す":
        "Give full screen its own sheet and hide the row that overflows it\n\n"
        "Measured at 1600x900: the panel ends at 791 but the row starts at 719 and\n"
        "runs to 1127, so it overlaps by 72px and then leaves the window.",
    "フェードに追従させ、矢印の地を戻す":
        "Follow the bars' fade; give the carousel arrows their fill back\n\n"
        "Full screen fades the top bar and the playbar on separate timers, and drawing\n"
        "from a 400ms cache left empty frames behind them. The arrows' visible pill is\n"
        "their background, so taking it away left an icon on the wallpaper.",
    "楽曲クレジットを戻し、小さいコントロールは手を出さない":
        "Put the credits back and leave small controls alone\n\n"
        "Hiding them was wrong: the cinema view scrolls, so they were reachable all\n"
        "along.",
    "LICENSE を GitHub が読める名前で置き、フォークの README を足す":
        "Add a LICENSE file GitHub can recognise, and a README for the fork",
    "README を差し替え、上に before/after を置く":
        "Put the fork's README above upstream's, with before and after shots",
    "README を英語にし、親を突き抜ける枠を切る":
        "Write the README in English; clip sheets to their parent",
    "クリップを毎フレーム取り直し、オーバーレイを読めるようにする":
        "Recompute the clip every frame; make overlays readable",
}


def main():
    msg = sys.stdin.read()
    first = msg.strip().split("\n")[0]
    out = MAP.get(first)
    sys.stdout.write(out + "\n" if out else msg)


if __name__ == "__main__":
    main()
