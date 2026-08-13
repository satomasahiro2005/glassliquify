@echo off
rem ASCII only - a .cmd with non-ASCII bytes breaks under CP932.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0spicetify-guard.ps1" %*
