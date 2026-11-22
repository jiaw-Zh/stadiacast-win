<#
Stop the web console. stadiacast is not touched: stop it from the page, or with .\stop-stadiacast.ps1.

    .\stop-webui.ps1
#>
try {
    Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8090/api/quit' -TimeoutSec 5 `
        -ContentType 'application/json' -Headers @{ 'X-Stadia-Console' = '1' } -Body '{}' | Out-Null
    Write-Host 'Web console stopped.'
} catch {
    Write-Host 'The web console does not answer on http://127.0.0.1:8090 (not running?).'
}
