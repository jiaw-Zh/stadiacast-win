<#
Start the web console (http://127.0.0.1:8090/) in the background and open it in the browser.
If it is already running, only the browser is opened.

    .\start-webui.ps1

It runs on the Python that stadiacast was installed with (uv), or on `python` from PATH.
Stop it with .\stop-webui.ps1; stadiacast itself goes on running until stopped from the page.
#>
$ErrorActionPreference = 'Stop'

$Port = 8090
$Url = "http://127.0.0.1:$Port/"
$Server = Join-Path $PSScriptRoot '..\webui\server.py'
$LogDir = Join-Path $PSScriptRoot '..\logs'

function Test-Console {
    try { Invoke-WebRequest -Uri "${Url}api/state" -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true }
    catch { return $false }
}

if (-not (Test-Console)) {
    $python = $null
    try {
        $candidate = Join-Path (& uv tool dir) 'stadiacast\Scripts\python.exe'
        if (Test-Path $candidate) { $python = $candidate }
    } catch { }
    if (-not $python) {
        $found = Get-Command python -ErrorAction SilentlyContinue
        if (-not $found) {
            Write-Host 'No Python found: install stadiacast first (docs\guide.md, step 1).' -ForegroundColor Red
            exit 1
        }
        $python = $found.Source
    }

    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $err = Join-Path $LogDir "webui-$stamp.err"
    Start-Process -FilePath $python -ArgumentList @("`"$((Resolve-Path $Server).Path)`"", '--port', $Port) `
        -WorkingDirectory (Split-Path $Server) -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir "webui-$stamp.out") -RedirectStandardError $err | Out-Null

    for ($i = 0; $i -lt 25 -and -not (Test-Console); $i++) { Start-Sleep -Milliseconds 300 }
    if (-not (Test-Console)) {
        Write-Host "The web console did not start. Its error output ($err):" -ForegroundColor Red
        if (Test-Path $err) { Get-Content $err -Encoding utf8 -Tail 10 | ForEach-Object { Write-Host "  $_" } }
        exit 1
    }
}

Write-Host "Web console: $Url"
Start-Process $Url
