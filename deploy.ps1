# Build, install dist/ as the spicetify theme, and apply.
#   .\deploy.ps1            -> build + install + spicetify apply
#   .\deploy.ps1 -NoApply   -> build + install only
[CmdletBinding()]
param(
    [string]$ThemeName = 'Liquify-fork',
    [switch]$NoApply
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

& (Join-Path $root 'build.ps1')

$spicetify = Join-Path $env:LOCALAPPDATA 'spicetify\spicetify.exe'
if (-not (Test-Path $spicetify)) { throw "spicetify.exe not found: $spicetify" }

$target = Join-Path $env:APPDATA "spicetify\Themes\$ThemeName"
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item (Join-Path $root 'dist\*') $target -Recurse -Force
Write-Host "installed -> $target"

$current = (& $spicetify config current_theme) -join '' -replace '.*current_theme\s*', '' -replace '\s', ''
if ($current -ne $ThemeName) {
    & $spicetify config current_theme $ThemeName | Out-Null
    Write-Host "current_theme: $current -> $ThemeName"
}

if (-not $NoApply) {
    & $spicetify apply
    Write-Host "done. restart Spotify to see the change."
}
