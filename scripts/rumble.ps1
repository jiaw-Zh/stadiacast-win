<#
Make one controller rumble, to test the motors or to tell the controllers apart.
Controllers are named in ..\webui\config.json.

    .\rumble.ps1 A                  # controller A, 1 s at 40000
    .\rumble.ps1 B -Ms 500 -Strength 65535

Strength is 0 to 65535 for both motors. The rumble path needs the game session, which --gamepad starts.
#>
param(
    [string] $Controller = 'A',
    [ValidateRange(0, 65535)] [int] $Strength = 40000,
    [ValidateRange(1, 10000)] [int] $Ms = 1000
)

$ConfigPath = Join-Path $PSScriptRoot '..\webui\config.json'
if (-not (Test-Path $ConfigPath)) { $ConfigPath = Join-Path $PSScriptRoot '..\webui\config.example.json' }
$Config = Get-Content $ConfigPath -Raw -Encoding utf8 | ConvertFrom-Json
$entry = $Config.controllers | Where-Object { $_.name -eq $Controller } | Select-Object -First 1
if (-not $entry) {
    Write-Host "Unknown controller '$Controller'. Known: $(($Config.controllers.name) -join ', ')" -ForegroundColor Red
    exit 1
}
$ip = $entry.ip
$body = @{ left = $Strength; right = $Strength; ms = $Ms } | ConvertTo-Json -Compress

try {
    $r = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1/_rumble?controller=$ip" `
        -ContentType 'application/json' -Body $body -TimeoutSec 10
} catch {
    Write-Host "Rumble failed: $($_.ErrorDetails.Message) $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

if ($r.sent) {
    Write-Host "Rumble sent to $($entry.name) ($ip): strength $Strength for $Ms ms."
} else {
    $r | ConvertTo-Json -Depth 5
}
