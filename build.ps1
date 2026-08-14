# Build dist/ = upstream theme files + patches/*.css appended to user.css.
# Upstream files are never edited, so `git merge upstream/main` never conflicts.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

# color.ini / theme.js are copied verbatim.
foreach ($f in @('color.ini', 'theme.js')) {
    Copy-Item (Join-Path $root $f) (Join-Path $dist $f)
}

$sb = [System.Text.StringBuilder]::new()
[void]$sb.Append((Get-Content (Join-Path $root 'user.css') -Raw))

$patches = Get-ChildItem (Join-Path $root 'patches') -Filter '*.css' -File | Sort-Object Name
foreach ($p in $patches) {
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("/* ===== fork patch: $($p.Name) ===== */")
    [void]$sb.Append((Get-Content $p.FullName -Raw))
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("/* ===== /fork patch: $($p.Name) ===== */")
    Write-Host "  + $($p.Name)"
}

# UTF-8 without BOM, LF - spicetify reads this as-is.
$text = $sb.ToString() -replace "`r`n", "`n"
[System.IO.File]::WriteAllText((Join-Path $dist 'user.css'), $text, (New-Object System.Text.UTF8Encoding $false))

Write-Host "built: $dist  ($($patches.Count) patch(es), $($text.Length) bytes user.css)"

# theme/ is the distributable copy, and unlike dist/ it is committed: the
# Marketplace installs a theme by reading files out of the repository, so what
# it needs has to be in there rather than produced on someone's machine.
$theme = Join-Path $root 'theme'
if (Test-Path $theme) { Remove-Item $theme -Recurse -Force }
New-Item -ItemType Directory -Path $theme | Out-Null
foreach ($f in @('user.css', 'color.ini', 'theme.js')) {
    Copy-Item (Join-Path $dist $f) (Join-Path $theme $f)
}
# Our own screenshot, not upstream's. preview.png at the root is Liquify's and
# shows Liquify; shipping it under this theme's name would be both a
# misrepresentation and a redistribution of someone else's screenshot.
Copy-Item (Join-Path $root 'docs\preview.png') (Join-Path $theme 'preview.png')

# Generated data files first: the consumers read their globals at startup.
$js = Get-ChildItem (Join-Path $root 'patches\js') -Filter '*.js' -File |
      Sort-Object @{ Expression = { if ($_.Name -like '*.generated.js') { 0 } else { 1 } } }, Name
foreach ($f in $js) { Copy-Item $f.FullName (Join-Path $theme $f.Name) }

# The Marketplace installs a theme by fetching exactly what manifest.json
# names - usercss, schemes, include[], preview, readme - and nothing else. So
# LICENSE, NOTICE.md and licenses/ never reach an installer, and the notices
# AGPL section 4 and section 5(a) require have to travel inside the files that
# do. Anything that already carries Kyant's Apache notice is left alone rather
# than stamped twice.
$stamp = @"
/* GlassLiquify - Liquify with liquid glass drawn in WebGL.
 *
 * Copyright (c) 2026 nemut.ai
 * Modified from NMWplays/Liquify (upstream 69dbb54, 2026-08-10), 2026-08.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. It is distributed WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See the GNU Affero General Public License for more details.
 *
 *   Licence, source and full attribution:
 *   https://github.com/satomasahiro2005/glassliquify
 *   Licence text: https://www.gnu.org/licenses/agpl-3.0.txt
 *
 * Parts of the glass shaders are ported from Backdrop (Copyright 2025 Kyant,
 * Apache-2.0) - see NOTICE.md in the repository above.
 */

"@

foreach ($name in @('user.css') + ($js | ForEach-Object { $_.Name })) {
    $f = Join-Path $theme $name
    $body = [System.IO.File]::ReadAllText($f)
    if ($body -match 'Copyright 2025 Kyant') { continue }
    [System.IO.File]::WriteAllText($f, ($stamp -replace "`r`n", "`n") + $body,
        (New-Object System.Text.UTF8Encoding $false))
}

# Upstream's own files go out unchanged in substance, so they say that rather
# than claiming a modification that is not theirs - but they still have to
# carry the licence and a pointer, because they reach an installer with
# nothing else attached. The copies in the repository root stay pristine.
$upstreamStamp = @"
%%CS%% GlassLiquify redistributes this file from NMWplays/Liquify unchanged.
%%C%%
%%C%% Liquify: Copyright NMWplays, GNU Affero General Public License v3.0.
%%C%% This distribution: https://github.com/satomasahiro2005/glassliquify
%%C%% Licence text: https://www.gnu.org/licenses/agpl-3.0.txt
%%CE%%

"@

foreach ($pair in @(@('theme.js', 'js'), @('color.ini', 'ini'))) {
    $f = Join-Path $theme $pair[0]
    $body = [System.IO.File]::ReadAllText($f)
    if ($pair[1] -eq 'js') {
        $head = $upstreamStamp -replace '%%CS%%', '/*' -replace '%%CE%%', ' */' -replace '%%C%%', ' *'
        $head = $head -replace '(?m)^/\* ', '/* '
    } else {
        $head = $upstreamStamp -replace '%%CS%%', ';' -replace '%%CE%%', ';' -replace '%%C%%', ';'
    }
    [System.IO.File]::WriteAllText($f, ($head -replace "`r`n", "`n") + $body,
        (New-Object System.Text.UTF8Encoding $false))
}

Write-Host "packaged: $theme  ($($js.Count) extension(s), notices stamped)"

