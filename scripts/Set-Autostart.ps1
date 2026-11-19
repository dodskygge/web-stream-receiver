param(
    [ValidateSet('Enable', 'Disable')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'

while (-not $Mode) {
    Write-Host 'Autostart web-stream-receiver po zalogowaniu do Windows:' -ForegroundColor Cyan
    Write-Host '  Enable  - wlacz autostart'
    Write-Host '  Disable - wylacz autostart'
    $answer = "$(Read-Host 'Wpisz Enable lub Disable')".Trim()
    if ($answer -in 'Enable', 'Disable') {
        $Mode = $answer
    } else {
        Write-Host "Nieznana wartosc: '$answer'. Sprobuj ponownie.`n" -ForegroundColor Yellow
    }
}
$configDirectory = Join-Path $env:APPDATA 'web-stream-receiver'
$configPath = Join-Path $configDirectory 'config.json'
[System.IO.Directory]::CreateDirectory($configDirectory) | Out-Null

$config = @{}
if (Test-Path -LiteralPath $configPath) {
    $existing = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $existing.PSObject.Properties | ForEach-Object { $config[$_.Name] = $_.Value }
}
$config['autoStart'] = ($Mode -eq 'Enable')
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

Write-Host "Autostart ustawiony na: $($config['autoStart']). Uruchom ponownie web-stream-receiver." -ForegroundColor Green
