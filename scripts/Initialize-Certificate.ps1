param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [Parameter(Mandatory = $false)]
    [ValidatePattern('^[a-zA-Z0-9.-]+$')]
    [string]$PublicHost = [System.Net.Dns]::GetHostName()
)

$ErrorActionPreference = 'Stop'
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null

$machineName = [System.Net.Dns]::GetHostName()
$dnsNames = @($PublicHost, $machineName, 'localhost') | Select-Object -Unique
$rootCertificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject 'CN=web-stream-receiver Local CA' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -FriendlyName 'web-stream-receiver Local CA' `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyUsage CertSign, CRLSign, DigitalSignature `
    -KeyUsageProperty Sign `
    -NotAfter (Get-Date).AddYears(10) `
    -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=0')

$serverCertificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject "CN=$PublicHost" `
    -DnsName $dnsNames `
    -Signer $rootCertificate `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -FriendlyName 'web-stream-receiver HTTPS' `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -NotAfter (Get-Date).AddYears(2) `
    -TextExtension @(
        '2.5.29.19={critical}{text}ca=0',
        '2.5.29.37={text}1.3.6.1.5.5.7.3.1'
    )

$password = [Guid]::NewGuid().ToString('N')
$securePassword = ConvertTo-SecureString -String $password -AsPlainText -Force
$pfxPath = Join-Path $outputPath 'server.pfx'
$cerPath = Join-Path $outputPath 'web-stream-receiver.cer'
$infoPath = Join-Path $outputPath 'certificate.json'

Export-PfxCertificate -Cert $serverCertificate -FilePath $pfxPath -Password $securePassword -Force | Out-Null
Export-Certificate -Cert $rootCertificate -FilePath $cerPath -Type CERT -Force | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null

$info = [ordered]@{
    password = $password
    thumbprint = $serverCertificate.Thumbprint
    rootThumbprint = $rootCertificate.Thumbprint
    expires = $serverCertificate.NotAfter.ToString('o')
    dnsNames = $dnsNames
}
$info | ConvertTo-Json | Set-Content -LiteralPath $infoPath -Encoding UTF8
