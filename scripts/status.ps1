<#
Show each connected controller: which one it is, its link state, battery, XInput player and held buttons.
The names come from ..\webui\config.json.

    .\status.ps1
#>
$ConfigPath = Join-Path $PSScriptRoot '..\webui\config.json'
if (-not (Test-Path $ConfigPath)) { $ConfigPath = Join-Path $PSScriptRoot '..\webui\config.example.json' }
$Config = Get-Content $ConfigPath -Raw -Encoding utf8 | ConvertFrom-Json
$names = @{}
foreach ($c in $Config.controllers) { $names[$c.ip] = if ($c.note) { "$($c.name) ($($c.note))" } else { $c.name } }

try {
    $state = Invoke-RestMethod -Uri 'http://127.0.0.1/_input' -TimeoutSec 5
    $full = Invoke-RestMethod -Uri 'http://127.0.0.1/_status' -TimeoutSec 5
} catch {
    Write-Host 'stadiacast is not running. Start it with .\start-stadiacast.ps1 or from the web console.'
    exit 1
}

# The controller reports its battery only when the level moves by a percent. Until it does, take
# the level it connected with: field 10 of its GetControllerStateResponse, a float 0..1 that
# stadiacast keeps as the integer f10 (see ..\webui\server.py, battery_from_status).
function Get-ConnectBattery([string] $label) {
    $raw = $full.controllers.$label.session.display.controller_state.f10
    if ($null -eq $raw) { return $null }
    $level = [BitConverter]::ToSingle([BitConverter]::GetBytes([uint32]$raw), 0)
    if ($level -ge 0 -and $level -le 1) { return [int][Math]::Round($level * 100) }
    return $null
}

$rows = foreach ($prop in $state.controllers.PSObject.Properties) {
    $c = $prop.Value
    $battery = if ($null -ne $c.battery_percent) { "$($c.battery_percent)%" }
               elseif ($c.display_state -in 'ready', 'input' -and $null -ne ($b = Get-ConnectBattery $prop.Name)) { "$b% (at connect)" }
               else { '' }
    [pscustomobject]@{
        Label    = $prop.Name
        Name     = $names[[string]$c.ip]
        IP       = $c.ip
        State    = $c.display_state
        Battery  = $battery
        Player   = if ($null -ne $c.gamepad -and $null -ne $c.gamepad.slot) { $c.gamepad.slot + 1 } else { '' }
        Held     = ($c.input.held -join ' ')
        LastSeen = "$($c.last_seen_s) s"
    }
}

if ($rows) {
    $rows | Format-Table -AutoSize
} else {
    Write-Host 'No controller yet: wake one with about 1 s on the Stadia button.'
}
