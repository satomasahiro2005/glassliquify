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
