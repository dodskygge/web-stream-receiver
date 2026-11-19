param(
    [int]$HttpPort = 8080,
    [int]$HttpsPort = 8443
)

# Ten skrypt wymaga uruchomienia jako administrator.
$ErrorActionPreference = 'Stop'
$ruleName = 'web-stream-receiver (LAN)'
$oldRuleName = 'TV-IT Receiver (LAN)'

Get-NetFirewallRule -DisplayName $ruleName, $oldRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort @($HttpPort, $HttpsPort) `
    -Profile Private `
    -RemoteAddress LocalSubnet | Out-Null

Write-Host "Zapora zezwala na TCP $HttpPort i $HttpsPort wylacznie z podsieci lokalnej (profil prywatny)." -ForegroundColor Green
