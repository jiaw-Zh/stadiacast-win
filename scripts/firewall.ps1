<#
Windows Firewall rules for stadiacast. RUN IN AN ADMINISTRATOR POWERSHELL.

    .\firewall.ps1            # open the receiver's ports to the controllers in ..\webui\config.json
    .\firewall.ps1 -RemoveAutoRules

The rules accept the controllers' IPs only: stadiacast's endpoints have no authentication.
Run it again after changing a controller's IP.

-RemoveAutoRules also deletes the rules Windows creates by itself for the Python that runs
stadiacast, the first time it listens. On a network Windows calls "Public" those are Block rules,
which win over any Allow rule and keep the controllers out; once allowed in the prompt, they are
Allow rules for every source. The rules made here are enough without them.
#>
param([switch] $RemoveAutoRules)

$ErrorActionPreference = 'Stop'
$ConfigPath = Join-Path $PSScriptRoot '..\webui\config.json'
if (-not (Test-Path $ConfigPath)) { $ConfigPath = Join-Path $PSScriptRoot '..\webui\config.example.json' }
$controllers = @((Get-Content $ConfigPath -Raw -Encoding utf8 | ConvertFrom-Json).controllers.ip)
if (-not $controllers) { throw "no controller IPs in $ConfigPath" }

# UDP 53 and TCP 53: the DNS sink. TCP 443: the endpoints the controller calls.
# UDP 40000-40007: the WebRTC sockets, two per controller, enough for four.
Get-NetFirewallRule -DisplayName 'stadiacast *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'stadiacast UDP (Stadia controllers)' -Direction Inbound -Action Allow `
    -Protocol UDP -LocalPort 53, '40000-40007' -RemoteAddress $controllers -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'stadiacast TCP (Stadia controllers)' -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort 53, 443 -RemoteAddress $controllers -Profile Any | Out-Null
Write-Host "Inbound rules open to: $($controllers -join ', ')"

if ($RemoveAutoRules) {
    # The interpreter uv installed for the stadiacast tool, whatever its exact version.
    $removed = Get-NetFirewallApplicationFilter |
        Where-Object { $_.Program -like '*\uv\python\cpython-*\python.exe' } |
        Get-NetFirewallRule | Where-Object { $_.DisplayName -like 'python*' }
    $removed | ForEach-Object { Write-Host "Removing: $($_.DisplayName) $($_.Action) $($_.Profile) ($((($_ | Get-NetFirewallApplicationFilter).Program)))" }
    $removed | Remove-NetFirewallRule
}
