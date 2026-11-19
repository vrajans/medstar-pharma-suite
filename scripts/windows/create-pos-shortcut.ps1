<#
.SYNOPSIS
  Creates a "MedStar POS" desktop shortcut that opens the billing screen in its own Chrome window
  with silent printing (bills go straight to the default printer, no print dialog).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\create-pos-shortcut.ps1
  powershell -ExecutionPolicy Bypass -File scripts\windows\create-pos-shortcut.ps1 -Url https://app.medstar.in/pos

.NOTES
  - Uses a separate Chrome profile (%LOCALAPPDATA%\MedStarPOS\Chrome) so the --kiosk-printing flag always applies,
    even when your normal Chrome is already open.
  - Chrome prints to the Windows DEFAULT printer: set the thermal printer as default first (Settings > Printers).
  - Run once with -Setup to open the same profile WITHOUT silent printing, print one bill, and in the dialog choose
    the printer, paper 80 mm (or 58 mm) and Margins: None. Chrome remembers those settings for the silent shortcut.
#>
param(
  [string]$Url = "http://localhost:3000/pos",
  [switch]$Setup
)

$ErrorActionPreference = "Stop"
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Error "Google Chrome was not found. Install Chrome and run this script again."; exit 1 }

$profileDir = Join-Path $env:LOCALAPPDATA "MedStarPOS\Chrome"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
$common = "--app=$Url --user-data-dir=`"$profileDir`" --no-first-run --disable-features=Translate"

if ($Setup) {
  Write-Host "Opening the POS profile WITHOUT silent printing. Print one bill, pick the printer, paper size and Margins: None, then close the window."
  Start-Process -FilePath $chrome -ArgumentList $common
  exit 0
}

$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path $desktop "MedStar POS.lnk"))
$lnk.TargetPath = $chrome
$lnk.Arguments = "--kiosk-printing $common"
$lnk.WorkingDirectory = Split-Path $chrome
$lnk.IconLocation = "$chrome,0"
$lnk.Description = "MedStar POS — billing with silent printing"
$lnk.Save()

Write-Host "Created 'MedStar POS' on the desktop -> $Url"
Write-Host "First time on this PC? Run again with -Setup to choose the printer, paper size and margins."
