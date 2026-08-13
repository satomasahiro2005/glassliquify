# Put Spotify's window on a chosen display, centred in its working area.
#
# Not CDP's Browser.setWindowBounds. Those bounds are device-independent
# pixels, and with --force-device-scale-factor=2 across displays of different
# DPI they do not map to Windows screen coordinates by any fixed ratio: asking
# for -1810 put the window at -5540, straddling two monitors. MoveWindow takes
# real screen coordinates, so this is the one that lands where it says.
#
#   .\tools\place-window.ps1                 # centre on the largest display
#   .\tools\place-window.ps1 -Device DISPLAY3
#   .\tools\place-window.ps1 -Fill           # fill the working area instead

param(
  [string]$Device = '',
  [int]$Width = 3400,
  [int]$Height = 1920,
  [switch]$Fill
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct LgRect { public int L, T, R, B; }
public class LgWin {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out LgRect r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
}
"@

$screens = [System.Windows.Forms.Screen]::AllScreens
if ($Device) {
  $screen = $screens | Where-Object { $_.DeviceName -like "*$Device" } | Select-Object -First 1
} else {
  $screen = $screens | Sort-Object { $_.Bounds.Width * $_.Bounds.Height } -Descending | Select-Object -First 1
}
if (-not $screen) { throw "no display matching '$Device'" }

$area = $screen.WorkingArea
if ($Fill) {
  $Width = $area.Width
  $Height = $area.Height
}
$Width = [Math]::Min($Width, $area.Width)
$Height = [Math]::Min($Height, $area.Height)
$x = $area.X + [int](($area.Width - $Width) / 2)
$y = $area.Y + [int](($area.Height - $Height) / 2)

$proc = Get-Process Spotify -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1
if (-not $proc) { throw "Spotify has no window yet" }

[void][LgWin]::MoveWindow($proc.MainWindowHandle, $x, $y, $Width, $Height, $true)
Start-Sleep -Milliseconds 500
$r = New-Object LgRect
[void][LgWin]::GetWindowRect($proc.MainWindowHandle, [ref]$r)
"{0}: ({1},{2})-({3},{4}) {5}x{6}" -f $screen.DeviceName, $r.L, $r.T, $r.R, $r.B, ($r.R - $r.L), ($r.B - $r.T)
