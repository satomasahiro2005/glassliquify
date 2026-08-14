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

Write-Host "packaged: $theme  ($($js.Count) extension(s))"

