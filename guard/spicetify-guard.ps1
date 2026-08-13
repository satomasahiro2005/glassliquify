# spicetify-guard
#
# Keeps two things true, forever:
#   1. %LOCALAPPDATA%\Spotify\Update stays a DENY-locked *file* so Spotify
#      cannot download an update into it.
#   2. spicetify stays injected into %APPDATA%\Spotify\Apps\xpui.
#
# Runs as a hidden loop started from the Startup folder via wscript.
# Drop a file named PAUSE next to this script to make it stand down
# (needed when you deliberately let Spotify update).
#
# ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 as the ANSI code
# page (CP932 here) unless there is a BOM, so non-ASCII comments corrupt it.

[CmdletBinding()]
param(
    [switch]$Once,
    [int]$IntervalSec = 300
)

$ErrorActionPreference = 'Stop'

$GuardDir   = Join-Path $env:LOCALAPPDATA 'spicetify-guard'
$LogFile    = Join-Path $GuardDir 'guard.log'
$PauseFile  = Join-Path $GuardDir 'PAUSE'
$LockFile   = Join-Path $GuardDir 'guard.lock'

$SpotifyApp   = Join-Path $env:APPDATA 'Spotify'
$SpotifyExe   = Join-Path $SpotifyApp 'Spotify.exe'
$XpuiIndex    = Join-Path $SpotifyApp 'Apps\xpui\index.html'
$SpotifyLocal = Join-Path $env:LOCALAPPDATA 'Spotify'
$UpdateEntry  = Join-Path $SpotifyLocal 'Update'

$SpicetifyExe = Join-Path $env:LOCALAPPDATA 'spicetify\spicetify.exe'
$ConfigFile   = Join-Path $env:APPDATA 'spicetify\config-xpui.ini'
$BackupDir    = Join-Path $env:APPDATA 'spicetify\Backup'
$ExtractedDir = Join-Path $env:APPDATA 'spicetify\Extracted'

# The string spicetify injects into index.html. Its absence means Spotify
# replaced xpui with the stock build.
$InjectMarker = 'spicetifyWrapper.js'

# --------------------------------------------------------------------------

function Write-Log {
    param([string]$Message, [string]$Level = 'info')
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    try {
        if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 512KB) {
            Move-Item $LogFile "$LogFile.1" -Force
        }
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    } catch { }
    Write-Verbose $line
}

function Test-Paused {
    Test-Path $PauseFile
}

# --- update block ----------------------------------------------------------

function Test-UpdateBlocked {
    if (-not (Test-Path $UpdateEntry)) { return $false }
    if (Test-Path $UpdateEntry -PathType Container) { return $false }
    $acl = & icacls.exe $UpdateEntry 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    # A deny ACE on this account is the whole point; match loosely because
    # icacls prints the rights in whatever order it stored them.
    return [bool]($acl -match '\(DENY\)')
}

function Set-UpdateBlock {
    # Order matters. The parent's DENY(DC) blocks deleting the child, so it has
    # to come off first and go back on last.
    Write-Log 'update block missing - rebuilding'

    & icacls.exe $SpotifyLocal /remove:d $env:USERNAME | Out-Null

    if (Test-Path $UpdateEntry -PathType Container) {
        Write-Log 'Update is a directory - removing'
        Remove-Item $UpdateEntry -Recurse -Force
    } elseif (Test-Path $UpdateEntry) {
        & icacls.exe $UpdateEntry /remove:d $env:USERNAME | Out-Null
        Remove-Item $UpdateEntry -Force
    }

    Set-Content -Path $UpdateEntry -Value 'blocked by spicetify-guard' -Encoding ASCII

    & icacls.exe $UpdateEntry /inheritance:r /grant "$($env:USERNAME):(RX)" | Out-Null
    & icacls.exe $UpdateEntry /grant 'SYSTEM:(F)' 'Administrators:(F)' | Out-Null
    & icacls.exe $UpdateEntry /deny "$($env:USERNAME):(W,D,WDAC,WO)" | Out-Null
    & icacls.exe $SpotifyLocal /deny "$($env:USERNAME):(DC)" | Out-Null

    if (Test-UpdateBlocked) {
        Write-Log 'update block restored'
    } else {
        Write-Log 'update block FAILED to restore' 'warn'
    }
}

# --- spicetify injection ---------------------------------------------------

function Test-SpicetifyApplied {
    if (-not (Test-Path $XpuiIndex)) { return $false }
    return [bool](Select-String -Path $XpuiIndex -SimpleMatch $InjectMarker -Quiet)
}

function Get-BackupVersion {
    if (-not (Test-Path $ConfigFile)) { return '' }
    $inBackup = $false
    foreach ($line in (Get-Content $ConfigFile)) {
        if ($line -match '^\s*\[(.+)\]\s*$') { $inBackup = ($Matches[1] -eq 'Backup'); continue }
        if ($inBackup -and $line -match '^\s*version\s*=\s*(.*)$') { return $Matches[1].Trim() }
    }
    return ''
}

function Clear-BackupVersion {
    if (-not (Test-Path $ConfigFile)) { return }
    $out = @()
    $inBackup = $false
    foreach ($line in (Get-Content $ConfigFile)) {
        if ($line -match '^\s*\[(.+)\]\s*$') { $inBackup = ($Matches[1] -eq 'Backup') }
        elseif ($inBackup -and $line -match '^\s*version\s*=') { $line = 'version = ' }
        $out += $line
    }
    Set-Content -Path $ConfigFile -Value $out -Encoding UTF8
}

function Test-BackupCurrent {
    if (-not (Test-Path (Join-Path $BackupDir 'xpui.spa'))) { return $false }
    if (-not (Test-Path $SpotifyExe)) { return $false }
    $exeVer = (Get-Item $SpotifyExe).VersionInfo.FileVersion
    $bakVer = Get-BackupVersion
    if ([string]::IsNullOrWhiteSpace($bakVer) -or [string]::IsNullOrWhiteSpace($exeVer)) { return $false }
    # config stores "1.2.96.518.g366879e1", the exe reports "1.2.96.518"
    return $bakVer.StartsWith($exeVer)
}

function Invoke-Spicetify {
    param([string[]]$SpicetifyArgs)
    Write-Log ("spicetify {0}" -f ($SpicetifyArgs -join ' '))
    $out = & $SpicetifyExe @SpicetifyArgs 2>&1
    $code = $LASTEXITCODE
    foreach ($l in $out) {
        $t = ($l -replace "`e\[[0-9;]*m", '').Trim()
        # spicetify redraws a spinner on the same line; keep only the outcomes
        if ($t -match '^[-\\|/]\s') { continue }
        if ($t) { Write-Log "  | $t" }
    }
    if ($code -ne 0) { Write-Log "spicetify exited $code" 'warn' }
    return $code
}

function Restore-Spicetify {
    if (-not (Test-Path $SpicetifyExe)) {
        Write-Log "spicetify.exe not found: $SpicetifyExe" 'warn'
        return
    }

    $stale = -not (Test-BackupCurrent)
    Write-Log ('injection lost (backup {0})' -f $(if ($stale) { 'stale' } else { 'current' }))

    if (-not $stale) {
        # Same Spotify build, so the extracted copy still matches. Cheap path.
        Invoke-Spicetify @('apply') | Out-Null
        if (Test-SpicetifyApplied) {
            Write-Log 'reapplied (apply)'
            return
        }
        Write-Log 'apply did not take - falling back to a full rebackup'
    }

    # Spotify moved to a new build. The old backup and extracted tree describe
    # the previous version, so throw both away and take a fresh backup.
    foreach ($d in @($BackupDir, $ExtractedDir)) {
        if (Test-Path $d) {
            Write-Log "removing $d"
            Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    Clear-BackupVersion
    Invoke-Spicetify @('backup', 'apply') | Out-Null

    if (Test-SpicetifyApplied) {
        Write-Log 'reapplied (backup apply)'
        if (Get-Process -Name 'Spotify' -ErrorAction SilentlyContinue) {
            Write-Log 'Spotify is running - restart it to see the theme'
        }
    } else {
        Write-Log 'STILL not applied after backup apply' 'warn'
    }
}

# --- main ------------------------------------------------------------------

$script:LastState = ''

function Invoke-Check {
    if (Test-Paused) {
        if ($script:LastState -ne 'paused') { Write-Log 'PAUSE present - standing down' }
        $script:LastState = 'paused'
        return
    }

    $blocked = Test-UpdateBlocked
    $applied = Test-SpicetifyApplied
    if (-not $blocked) { Set-UpdateBlock }
    if (-not $applied) { Restore-Spicetify }

    # Log the healthy state once per transition so the log shows the guard is
    # awake without one line every interval.
    $state = 'update={0} spicetify={1}' -f $blocked, $applied
    if ($state -ne $script:LastState) { Write-Log "checked: $state" }
    $script:LastState = $state
}

New-Item -ItemType Directory -Path $GuardDir -Force | Out-Null

# Single instance. A stale lock from a killed run is ignored.
if (Test-Path $LockFile) {
    $old = (Get-Content $LockFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($old -match '^\d+$' -and (Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue)) {
        Write-Log "already running (pid $old) - exiting"
        return
    }
}
Set-Content -Path $LockFile -Value $PID -Encoding ASCII

Write-Log ("guard started (pid {0}, interval {1}s{2})" -f $PID, $IntervalSec, $(if ($Once) { ', once' } else { '' }))

try {
    while ($true) {
        try { Invoke-Check } catch { Write-Log "check failed: $_" 'warn' }
        if ($Once) { break }
        Start-Sleep -Seconds $IntervalSec
    }
} finally {
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
    Write-Log 'guard stopped'
}
