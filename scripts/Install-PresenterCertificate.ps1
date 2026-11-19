param(
    [Parameter(Mandatory = $true)]
    [string]$Receiver,
    [int]$HttpPort = 8080
)

$ErrorActionPreference = 'Stop'
$temporaryCertificate = Join-Path $env:TEMP 'web-stream-receiver.cer'
$certificateUrl = "http://${Receiver}:${HttpPort}/certificate"

Write-Host "Pobieranie certyfikatu z $certificateUrl ..."
Invoke-WebRequest -UseBasicParsing -Uri $certificateUrl -OutFile $temporaryCertificate
Import-Certificate -FilePath $temporaryCertificate -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
Remove-Item -LiteralPath $temporaryCertificate -Force

Write-Host 'Certyfikat odbiornika zostal zainstalowany dla biezacego uzytkownika.' -ForegroundColor Green
Start-Process "http://${Receiver}:${HttpPort}"
