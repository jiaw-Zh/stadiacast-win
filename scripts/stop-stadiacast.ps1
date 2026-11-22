<#
Stop the stadiacast receiver, as Ctrl-C would: its DNS helper, the virtual pads and the controllers' links.

    .\stop-stadiacast.ps1
#>
try {
    Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1/_shutdown' -TimeoutSec 5 | Out-Null
} catch {
    Write-Host 'stadiacast does not answer on http://127.0.0.1 (not running?).'
    exit 0
}

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not (Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue)) {
        Write-Host 'stadiacast stopped.'
        exit 0
    }
}
Write-Host 'Shutdown was requested, but port 443 is still held after 10 s.' -ForegroundColor Yellow
exit 1
