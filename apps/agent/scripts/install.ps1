<#
.SYNOPSIS
  YourStack agent installer for Windows (native Windows Service).

.DESCRIPTION
  Idempotent install of the yourstack-agent.exe binary, its config under
  %ProgramData%\YourStack, node registration, and a Windows Service that runs the
  agent (auto-start at boot, restart on failure). Re-running upgrades the binary
  and re-applies configuration without duplicating state.

  Required environment (or -ApiUrl / -JoinToken parameters):
    YOURSTACK_API_URL     Base URL of the control-plane API.
    YOURSTACK_JOIN_TOKEN  One-time join token (ysj_...) from the dashboard/CLI.
  Optional:
    YOURSTACK_NODE_NAME      Node display name (default: the computer name).
    YOURSTACK_REGION         Region label.
    YOURSTACK_RUNTIME        Container runtime: "docker" (default) or "podman".
    YOURSTACK_ENGINE_SOCKET  Explicit Engine API socket/URL override.
    YOURSTACK_BINARY_URL     URL to download yourstack-agent.exe from. If unset,
                             the script uses .\yourstack-agent.exe next to it or
                             an already-installed binary.

.EXAMPLE
  $env:YOURSTACK_API_URL='https://api.yourstack.dev'
  $env:YOURSTACK_JOIN_TOKEN='ysj_xxx'
  .\install.ps1
#>
[CmdletBinding()]
param(
  [string]$ApiUrl    = $env:YOURSTACK_API_URL,
  [string]$JoinToken = $env:YOURSTACK_JOIN_TOKEN,
  [string]$NodeName  = $env:YOURSTACK_NODE_NAME,
  [string]$Region    = $env:YOURSTACK_REGION,
  [string]$Runtime   = $env:YOURSTACK_RUNTIME,
  [string]$EngineSocket = $env:YOURSTACK_ENGINE_SOCKET,
  [string]$BinaryUrl = $env:YOURSTACK_BINARY_URL
)

$ErrorActionPreference = 'Stop'
function Log($m) { Write-Host "[install] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[install] $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "[install] $m" -ForegroundColor Red; exit 1 }

# ---- 0. preconditions -------------------------------------------------------
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Die "must run as Administrator (open an elevated PowerShell and re-run)"
}
if (-not $ApiUrl)    { Die "set YOURSTACK_API_URL (or pass -ApiUrl)" }
if (-not $JoinToken) { Die "set YOURSTACK_JOIN_TOKEN (or pass -JoinToken)" }
if (-not $NodeName)  { $NodeName = $env:COMPUTERNAME }
if (-not $Runtime)   { $Runtime = 'docker' }
if ($Runtime -notin @('docker','podman')) { Die "runtime must be 'docker' or 'podman' (got '$Runtime')" }

$ServiceName = 'yourstack-agent'
$InstallDir  = Join-Path $env:ProgramFiles 'YourStack'
$BinPath     = Join-Path $InstallDir 'yourstack-agent.exe'
$ConfigDir   = Join-Path $env:ProgramData 'YourStack'
$ConfigPath  = Join-Path $ConfigDir 'agent.toml'
$DataDir     = Join-Path $ConfigDir 'data'
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path

# Container engine must be reachable for the agent to run apps.
if (-not (Get-Command $Runtime -ErrorAction SilentlyContinue)) {
  Warn "$Runtime not found on PATH - install Docker Desktop (or 'podman machine') so the agent can manage containers"
}

# ---- 1. directories ---------------------------------------------------------
Log "ensuring directories"
New-Item -ItemType Directory -Force -Path $InstallDir, $ConfigDir, $DataDir | Out-Null

# ---- 2. binary --------------------------------------------------------------
if ($BinaryUrl) {
  Log "downloading binary from $BinaryUrl"
  # Stop the service first so the file isn't locked during upgrade.
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  }
  Invoke-WebRequest -Uri $BinaryUrl -OutFile $BinPath -UseBasicParsing
} elseif (Test-Path (Join-Path $ScriptDir 'yourstack-agent.exe')) {
  Log "installing bundled binary"
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  }
  Copy-Item -Force (Join-Path $ScriptDir 'yourstack-agent.exe') $BinPath
} elseif (Test-Path $BinPath) {
  Log "reusing existing binary at $BinPath"
} else {
  Die "no binary found: set YOURSTACK_BINARY_URL or place yourstack-agent.exe next to this script"
}

# ---- 3. config --------------------------------------------------------------
if (-not (Test-Path $ConfigPath)) {
  Log "writing initial config to $ConfigPath"
  # Single-quoted format strings keep the literal TOML double-quotes unescaped.
  # TOML basic strings need backslashes doubled, so escape the Windows data dir.
  $dataEsc = $DataDir -replace '\\', '\\'
  $lines = @(
    ('api_url = "{0}"' -f $ApiUrl),
    'node_id = ""',
    'agent_token = ""',
    'command_verify_key = ""',
    ('data_dir = "{0}"' -f $dataEsc),
    ('runtime = "{0}"' -f $Runtime)
  )
  if ($EngineSocket) { $lines += ('engine_socket = "{0}"' -f $EngineSocket) }
  if ($Region)       { $lines += ('region = "{0}"' -f $Region) }
  $lines += @('', '[labels]')
  Set-Content -Path $ConfigPath -Value $lines -Encoding UTF8
}
# Lock down the config (it will hold the agent token + HMAC key after register).
icacls $ConfigPath /inheritance:r /grant:r "SYSTEM:(F)" "Administrators:(F)" | Out-Null

# ---- 4. register (if not already) ------------------------------------------
$needsRegister = (Select-String -Path $ConfigPath -Pattern 'node_id = ""' -Quiet)
if ($needsRegister) {
  Log "registering node with the control plane"
  $regArgs = @(
    'register',
    '--api-url', $ApiUrl,
    '--join-token', $JoinToken,
    '--name', $NodeName,
    '--config', $ConfigPath,
    '--runtime', $Runtime
  )
  if ($Region)       { $regArgs += @('--region', $Region) }
  if ($EngineSocket) { $regArgs += @('--engine-socket', $EngineSocket) }
  & $BinPath @regArgs
  if ($LASTEXITCODE -ne 0) { Die "registration failed (exit $LASTEXITCODE)" }
} else {
  Log "node already registered; skipping join"
}

# ---- 5. Windows service -----------------------------------------------------
$binaryPathName = '"' + $BinPath + '" run-service --config "' + $ConfigPath + '"'
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Log "updating existing service"
  Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  # sc.exe (NOT the `sc` alias) updates the binPath in place.
  & sc.exe config $ServiceName binPath= $binaryPathName start= auto | Out-Null
} else {
  Log "creating service $ServiceName"
  New-Service -Name $ServiceName -BinaryPathName $binaryPathName `
    -DisplayName 'YourStack Agent' -StartupType Automatic `
    -Description 'YourStack node agent: executes signed deployment commands and reports telemetry.' | Out-Null
}

# Restart on failure: three attempts, 5s apart; reset the counter daily.
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null

Log "starting $ServiceName"
Start-Service -Name $ServiceName
Log "done. Check status with: Get-Service $ServiceName   (logs: Get-EventLog / run '$BinPath run' to debug interactively)"
