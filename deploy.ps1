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

# patches/js/*.js ship as spicetify extensions
$jsDir = Join-Path $root 'patches\js'
if (Test-Path $jsDir) {
    $extDir = Join-Path $env:APPDATA 'spicetify\Extensions'
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null
    # generated data files first: the consumers read their globals at startup
    $names = @()
    $files = Get-ChildItem $jsDir -Filter '*.js' -File |
             Sort-Object @{ Expression = { if ($_.Name -like '*.generated.js') { 0 } else { 1 } } }, Name
    foreach ($f in $files) {
        Copy-Item $f.FullName (Join-Path $extDir $f.Name) -Force
        $names += $f.Name
        Write-Host "  extension: $($f.Name)"
    }
    if ($names.Count -gt 0) {
        $cfg = Join-Path $env:APPDATA 'spicetify\config-xpui.ini'
        $line = (Get-Content $cfg | Where-Object { $_ -match '^\s*extensions\s*=' }) -join ''
        $have = ($line -replace '^\s*extensions\s*=\s*', '') -split '\|' | Where-Object { $_ }
        $missing = $names | Where-Object { $have -notcontains $_ }
        if ($missing) {
            $all = (@($have) + @($missing)) -join '|'
            & $spicetify config extensions $all | Out-Null
            Write-Host "registered extensions: $all"
        }
    }
}

$current = (& $spicetify config current_theme) -join '' -replace '.*current_theme\s*', '' -replace '\s', ''
if ($current -ne $ThemeName) {
    & $spicetify config current_theme $ThemeName | Out-Null
    Write-Host "current_theme: $current -> $ThemeName"
}

if (-not $NoApply) {
    & $spicetify apply
    Write-Host "done. restart Spotify to see the change."
}
