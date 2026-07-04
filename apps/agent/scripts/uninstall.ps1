<#
.SYNOPSIS
  Remove the YourStack agent Windows Service and binary.

.DESCRIPTION
  Stops and deletes the yourstack-agent service and removes the installed
  binary. Config and state under %ProgramData%\YourStack are preserved unless
  -PurgeData is passed (so a re-install keeps the node's identity by default).

.EXAMPLE
  .\uninstall.ps1
  .\uninstall.ps1 -PurgeData
#>
[CmdletBinding()]
param([switch]$PurgeData)

$ErrorActionPreference = 'Stop'
function Log($m) { Write-Host "[uninstall] $m" -ForegroundColor Cyan }
function Die($m) { Write-Host "[uninstall] $m" -ForegroundColor Red; exit 1 }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Die "must run as Administrator"
}

$ServiceName = 'yourstack-agent'
$InstallDir  = Join-Path $env:ProgramFiles 'YourStack'
$BinPath     = Join-Path $InstallDir 'yourstack-agent.exe'
$ConfigDir   = Join-Path $env:ProgramData 'YourStack'

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Log "stopping and deleting service"
  Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  # sc.exe (NOT the `sc` alias) removes the service registration.
  & sc.exe delete $ServiceName | Out-Null
} else {
  Log "service not installed"
}

if (Test-Path $BinPath) {
  Log "removing binary"
  Remove-Item -Force $BinPath -ErrorAction SilentlyContinue
  Remove-Item -Force (Join-Path $InstallDir 'yourstack-agent.old') -ErrorAction SilentlyContinue
  Remove-Item -Force (Join-Path $InstallDir 'yourstack-agent.new') -ErrorAction SilentlyContinue
  if (-not (Get-ChildItem -Path $InstallDir -ErrorAction SilentlyContinue)) {
    Remove-Item -Force -Recurse $InstallDir -ErrorAction SilentlyContinue
  }
}

if ($PurgeData) {
  Log "purging config and state at $ConfigDir"
  Remove-Item -Force -Recurse $ConfigDir -ErrorAction SilentlyContinue
} else {
  Log "kept config/state at $ConfigDir (pass -PurgeData to remove)"
}

Log "done."
