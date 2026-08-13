# Install spicetify-guard into %LOCALAPPDATA%\spicetify-guard and start it.
#   .\install-guard.ps1              install + Startup shortcut + start now
#   .\install-guard.ps1 -NoStart     install only
#   .\install-guard.ps1 -Uninstall   remove the Startup shortcut and stop it
[CmdletBinding()]
param(
    [switch]$NoStart,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$src       = $PSScriptRoot
$dest      = Join-Path $env:LOCALAPPDATA 'spicetify-guard'
$startup   = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$shortcut  = Join-Path $startup 'spicetify-guard.lnk'
$lockFile  = Join-Path $dest 'guard.lock'

function Stop-Guard {
    if (Test-Path $lockFile) {
        $pidText = Get-Content $lockFile -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($pidText -match '^\d+$') {
            $p = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
            if ($p) { Stop-Process -Id $p.Id -Force; Write-Host "stopped running guard (pid $($p.Id))" }
        }
        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    }
}

if ($Uninstall) {
    Stop-Guard
    if (Test-Path $shortcut) { Remove-Item $shortcut -Force; Write-Host "removed $shortcut" }
    Write-Host "uninstalled. $dest was left in place (log lives there)."
    return
}

Stop-Guard

New-Item -ItemType Directory -Path $dest -Force | Out-Null
foreach ($f in @('spicetify-guard.ps1', 'run-guard.cmd', 'spicetify-guard.vbs')) {
    Copy-Item (Join-Path $src $f) (Join-Path $dest $f) -Force
}
Write-Host "installed -> $dest"

$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($shortcut)
$lnk.TargetPath       = "$env:SystemRoot\System32\wscript.exe"
$lnk.Arguments        = '"' + (Join-Path $dest 'spicetify-guard.vbs') + '"'
$lnk.WorkingDirectory = $dest
$lnk.Description      = 'Keep spicetify applied and Spotify auto-update blocked'
$lnk.Save()
Write-Host "startup shortcut -> $shortcut"

if (-not $NoStart) {
    Start-Process -FilePath "$env:SystemRoot\System32\wscript.exe" `
                  -ArgumentList ('"' + (Join-Path $dest 'spicetify-guard.vbs') + '"') `
                  -WorkingDirectory $dest
    Write-Host "started. log: $(Join-Path $dest 'guard.log')"
}
