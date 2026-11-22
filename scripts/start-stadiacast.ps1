<#
Start the stadiacast receiver in the background, without the web console.

    .\start-stadiacast.ps1

The upstream DNS and the controllers' IPs come from ..\webui\config.json, the same settings the
web console starts the receiver with (start the console once, or copy config.example.json to
config.json). Then wake the first controller, and the next once its light is steady. Console
output goes to ..\logs\, the receiver's own logs to <work_dir>\captures\<stamp>.
Stop it with .\stop-stadiacast.ps1.
#>
$ErrorActionPreference = 'Stop'

$ConfigPath = Join-Path $PSScriptRoot '..\webui\config.json'
if (-not (Test-Path $ConfigPath)) { $ConfigPath = Join-Path $PSScriptRoot '..\webui\config.example.json' }
$Config = Get-Content $ConfigPath -Raw -Encoding utf8 | ConvertFrom-Json
$WorkDir = Join-Path (Join-Path $PSScriptRoot '..') $Config.work_dir
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$LogDir = Join-Path $PSScriptRoot '..\logs'
$Arguments = @(
    '--preset', 'live',                                 # the flag set proven end to end
    '--no-sntp',                                        # w32time holds UDP 123; the controller takes the time from HTTP
    '--dns-upstream', $Config.dns_upstream,             # where the DNS sink forwards every other name
    '--controller-ip', $Config.controllers[0].ip,       # picks the network interface that faces the controllers
    '--dns-redirect', 'time.google.com,clients3.google.com',
    '--stadiaconfig', 'json:{}',                        # answer the configuration request locally
    '--gamepad', 'vigem'                                # one Xbox 360 pad per controller (ViGEmBus)
)

function Test-Receiver {
    try { Invoke-RestMethod -Uri 'http://127.0.0.1/_status' -TimeoutSec 2 | Out-Null; return $true }
    catch { return $false }
}

if (Test-Receiver) {
    Write-Host 'stadiacast is already running (http://127.0.0.1/_status answers).'
    exit 0
}

$exe = (Get-Command stadiacast -ErrorAction SilentlyContinue).Source
if (-not $exe) {
    Write-Host 'stadiacast is not on PATH. Install it with (docs\guide.md, step 1):' -ForegroundColor Red
    Write-Host '  uv tool install "stadiacast[ble,gamepad]"'
    exit 1
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $LogDir "console-$stamp.out"
$err = Join-Path $LogDir "console-$stamp.err"
$env:PYTHONIOENCODING = 'utf-8'
$proc = Start-Process -FilePath $exe -ArgumentList $Arguments -WorkingDirectory (Resolve-Path $WorkDir).Path `
    -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru

for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { break }
    if (Test-Receiver) {
        Get-Content $out -Encoding utf8 | Where-Object { $_ -like 'stadiacast * ready:*' } | ForEach-Object { Write-Host $_ }
        Write-Host "Running as pid $($proc.Id). Wake the first controller, then the next."
        exit 0
    }
}

Write-Host 'stadiacast did not come up. Last lines of its error output:' -ForegroundColor Red
Get-Content $err -Encoding utf8 -Tail 10 | ForEach-Object { Write-Host "  $_" }
exit 1
