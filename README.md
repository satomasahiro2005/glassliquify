# GlassLiquify

A fork of [Liquify](https://github.com/NMWplays/Liquify) that replaces the
theme's glass with a WebGL port of [Backdrop](https://github.com/Kyant0/AndroidLiquidGlass)'s
refraction, dispersion and highlight shaders.

**This fork**

![after](https://raw.githubusercontent.com/satomasahiro2005/glassliquify/fork/docs/images/after.jpg)

**Liquify as it ships**

![before](https://raw.githubusercontent.com/satomasahiro2005/glassliquify/fork/docs/images/before.jpg)

`Ctrl+Shift+G` switches between the two at runtime.


---

## What it replaces

Liquify's glass is a `backdrop-filter` driven by an SVG displacement map. That
map is not a distance field: it is two linear gradients across the whole box, so
the offset follows absolute x/y rather than the distance to the edge. The result
is the backdrop sliding sideways rather than the rim bending.

Its chromatic aberration gives each channel a different `scale` on
`feDisplacementMap`. In Chromium a different scale changes the filter primitive
subregion, so the three channel surfaces land on different pixels: **an element
gets a 1px RGB split across its whole area even when the map is perfectly
neutral.** Reproduced here with an all-128 map.

This fork rebuilds the backdrop itself for the surfaces whose backdrop really is
the album-art layer, and draws them in WebGL. The wallpaper is drawn first, then
each surface back to front, copying what was drawn back into the sampled texture
between quads — so a card refracts the panel it sits on rather than the
wallpaper two layers down.

- Refraction magnitude comes straight from the signed distance:
  `circleMap(1 - (-sd)/height) * amount`. Shape (`height`) and strength
  (`amount`) stay independent.
- Dispersion is the seven weighted taps of the original
  (red/orange/yellow/green/cyan/blue/purple). Each channel's weights sum to 1,
  so brightness is unchanged and only the colours separate.
- Corners are superellipses.
- The blur is a true Gaussian, baked once. Skia approximates large sigma with a
  triple box blur, so doing it offline is strictly better than asking CSS.
- The wallpaper uses the CDN's 2000px cover. The API only exposes 640px.

## Checking the port against the original

Open `lab/verify.html`. `tools/gen-agsl.py` extracts the AGSL source straight out
of Backdrop's `Shaders.kt`, the page translates the scalar type names to GLSL,
and both that and the hand-written port are rendered with the same inputs and
compared pixel by pixel.

**Over 72,000 pixels: maximum channel difference 1/255, mean 0.0000278, and no
pixel differs by more than 1.** That is inside 8-bit rounding.

![verify](https://raw.githubusercontent.com/satomasahiro2005/glassliquify/fork/docs/images/24-verify.jpg)

## Installing

```powershell
git clone https://github.com/satomasahiro2005/glassliquify
cd glassliquify
.\deploy.ps1
```

It installs as `Themes\Liquify-fork`, switches `current_theme` and runs
`spicetify apply`. Restart Spotify to see it. Stock `Liquify` is left untouched,
so `spicetify config current_theme Liquify` puts everything back.

- `Ctrl+Shift+G` — this glass vs. Liquify's own
- The button left of the gear in the top bar — clear / adaptive / frosted
  presets, plus refraction width and amount, dispersion, corner shape,
  saturation, blur, rim strength and light angle

See [FORK.md](https://github.com/satomasahiro2005/glassliquify/blob/fork/FORK.md) for how the fork is structured and [NOTICE.md](https://github.com/satomasahiro2005/glassliquify/blob/fork/NOTICE.md)
for what came from where.

## Licence

GlassLiquify is a fork of [Liquify](https://github.com/NMWplays/Liquify)
(Copyright NMWplays) and is distributed under the
**[GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.txt)**,
as that licence requires of a derivative work.

Copyright (c) 2026 nemut.ai for this fork's own work.

The refraction, dispersion and rim shaders are ported from
[Backdrop](https://github.com/Kyant0/AndroidLiquidGlass) (Copyright 2025 Kyant),
**Apache License 2.0** — a copy travels with the source at
[`licenses/Apache-2.0-Backdrop.txt`](https://github.com/satomasahiro2005/glassliquify/blob/fork/licenses/Apache-2.0-Backdrop.txt).
Apache-2.0 combines into AGPL-3.0 in that direction; the combined work is
AGPL-3.0 and Kyant's terms continue to apply to their part.

Which file came from where, and what was changed, is in
[NOTICE.md](https://github.com/satomasahiro2005/glassliquify/blob/fork/NOTICE.md).

---
---

Below is the upstream Liquify README, unchanged.

<h1 align="center"> ✨ Liquify Theme Spicetify ✨ </h1>

<p align="center">
  <b>A modern, rounded and liquified theme for spicetify</b><br>
</p>

## Contents

<!-- toc -->

- [Introduction](#introduction)
- [Theme screenshots](#theme-screenshots)
- [Features](#features)
<!-- tocstop -->

## Introduction

**Liquify** - is a glassmorphic Spicetify theme for Spotify featuring a modern, luminous interface and smooth animations.

Liquify is inspired by [Glassify](https://github.com/sanoojes/spicetify-glassify) from [Sanoojes](https://github.com/sanoojes).

If your transparent controls don’t look fully transparent — for example when zooming in on Spotify — you can easily change the width and height of them in the Glowify Settings to make them fully transparent again.

If you like the theme, consider starring the repository on GitHub! ⭐

**For support join the Discord!**:

<a href="https://discord.gg/QRMnrgjhvq" target="_blank">
  <img src="discord-icon.png" alt="Discord-server-link" width="64" />
</a>

## Theme screenshots

<details>
<summary>Click to watch screenshots</summary>
<img width="1919" height="1029" alt="Homescreen" src="https://github.com/user-attachments/assets/a7d50e6e-56be-4a8b-8ea6-8835655d4cdf" />

<img width="1919" height="1029" alt="Playlist" src="https://github.com/user-attachments/assets/5375a463-10a4-428e-8e5c-f43d76e03509" />

<img width="1919" height="1030" alt="Search" src="https://github.com/user-attachments/assets/71d1c7a5-bca6-47d3-880c-8c0e85c45bce" />

<img width="1919" height="1030" alt="Artist-Page" src="https://github.com/user-attachments/assets/60151e06-8a6a-4548-a882-1c267c18e7ca" />

<img width="1919" height="1028" alt="Artist-Page2" src="https://github.com/user-attachments/assets/fa9bdb4f-666e-4380-9ee3-2da6b33be730" />

<img width="1919" height="1030" alt="Liquify-Settings" src="https://github.com/user-attachments/assets/0ab96146-4868-468c-8a22-7cb03fa992c1" />

<img width="1919" height="1030" alt="Popup" src="https://github.com/user-attachments/assets/59b2f2e9-b273-4f2a-9d06-7e562be21f8d" />

<img width="1919" height="1029" alt="Settings" src="https://github.com/user-attachments/assets/f37cfbef-7d3e-4ed4-bab5-0dfeae4362aa" />

<img width="1919" height="1030" alt="Fullscreen" src="https://github.com/user-attachments/assets/7b147a4f-6f48-4123-bf65-96b4a94d44e0" />

</details>

---

## Features

**Liquify offers:**

- Many customization options
-  `Beatiful Lyrics`, `Spicy Lyrics` and `Lucid Lyrics` are supported by default
- Beautiful dynamic colors (Just enable dynamic button colors in the settings and your good to go)
- Modern, rounded UI
- And much more!

## Credits

Created by NMW.

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See the LICENSE file for details.
