param(
    [string]$IpAddress = '192.168.2.104',
    [int]$HttpPort = 8080,
    [int]$HttpsPort = 8443
)

$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Text)
    Write-Host "`n==> $Text" -ForegroundColor Cyan
}

function Add-CertificateToCurrentUserRoot {
    param(
        [Parameter(Mandatory = $true)]
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate
    )

    # Dodanie bez Import-Certificate, aby nie pojawialo sie okno UI w trybie
    # NonInteractive. Zapis dotyczy tylko biezacego uzytkownika Windows.
    $rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store(
        'Root',
        [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
    )
    try {
        $rootStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $existing = $rootStore.Certificates.Find(
            [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
            $Certificate.Thumbprint,
            $false
        )
        if ($existing.Count -eq 0) {
            $rootStore.Add($Certificate)
        }
    } finally {
        $rootStore.Close()
    }
}

try {
    $parsedIp = $null
    if (-not [System.Net.IPAddress]::TryParse($IpAddress, [ref]$parsedIp)) {
        throw "Nieprawidlowy adres IP: $IpAddress"
    }
    if ($HttpPort -lt 1 -or $HttpPort -gt 65535) {
        throw "Nieprawidlowy port HTTP: $HttpPort"
    }
    if ($HttpsPort -lt 1 -or $HttpsPort -gt 65535) {
        throw "Nieprawidlowy port HTTPS: $HttpsPort"
    }
    if ($HttpPort -eq $HttpsPort) {
        throw 'Port HTTP i HTTPS nie moga byc takie same.'
    }

    $runningReceiver = Get-Process -Name 'web-stream-receiver' -ErrorAction SilentlyContinue
    if ($runningReceiver) {
        throw 'web-stream-receiver jest uruchomiony. Zamknij aplikacje i uruchom skrypt ponownie.'
    }

    $applicationDirectory = Join-Path $env:APPDATA 'web-stream-receiver'
    $certificateDirectory = Join-Path $applicationDirectory 'certs'
    $configPath = Join-Path $applicationDirectory 'config.json'
    $pfxPath = Join-Path $certificateDirectory 'server.pfx'
    $caPath = Join-Path $certificateDirectory 'web-stream-receiver.cer'
    $infoPath = Join-Path $certificateDirectory 'certificate.json'
    [System.IO.Directory]::CreateDirectory($certificateDirectory) | Out-Null

    $machineName = [System.Net.Dns]::GetHostName()
    $caName = "web-stream-receiver Local CA $IpAddress"

    Write-Step 'Tworzenie lokalnego urzedu certyfikacji'
    $rootCertificate = New-SelfSignedCertificate `
        -Type Custom `
        -Subject "CN=$caName" `
        -CertStoreLocation 'Cert:\CurrentUser\My' `
        -FriendlyName $caName `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -KeyExportPolicy Exportable `
        -KeyUsage CertSign, CRLSign, DigitalSignature `
        -KeyUsageProperty Sign `
        -NotAfter (Get-Date).AddYears(10) `
        -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=0')

    Write-Step "Tworzenie certyfikatu serwera dla $IpAddress i localhost"
    $sanExtension = "2.5.29.17={text}IPAddress=$IpAddress&IPAddress=127.0.0.1&DNS=$machineName&DNS=localhost"
    $serverCertificate = New-SelfSignedCertificate `
        -Type Custom `
        -Subject "CN=$IpAddress" `
        -Signer $rootCertificate `
        -TextExtension @(
            $sanExtension,
            '2.5.29.19={critical}{text}ca=0',
            '2.5.29.37={text}1.3.6.1.5.5.7.3.1'
        ) `
        -CertStoreLocation 'Cert:\CurrentUser\My' `
        -FriendlyName "web-stream-receiver HTTPS ($IpAddress)" `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -KeyExportPolicy Exportable `
        -KeyUsage DigitalSignature, KeyEncipherment `
        -NotAfter (Get-Date).AddYears(2)

    Write-Step 'Dodawanie lokalnego CA do zaufanych certyfikatow uzytkownika'
    Add-CertificateToCurrentUserRoot -Certificate $rootCertificate

    Write-Step 'Eksport plikow wymaganych przez web-stream-receiver'
    $password = [Guid]::NewGuid().ToString('N')
    $securePassword = ConvertTo-SecureString -String $password -AsPlainText -Force
    Export-PfxCertificate -Cert $serverCertificate -FilePath $pfxPath -Password $securePassword -Force | Out-Null
    Export-Certificate -Cert $rootCertificate -FilePath $caPath -Type CERT -Force | Out-Null

    $certificateInfo = [ordered]@{
        password = $password
        thumbprint = $serverCertificate.Thumbprint
        rootThumbprint = $rootCertificate.Thumbprint
        expires = $serverCertificate.NotAfter.ToString('o')
        ipAddress = $IpAddress
        dnsNames = @($machineName, 'localhost')
    }

    Write-Step 'Zapisywanie konfiguracji aplikacji'
    $config = @{}
    if (Test-Path -LiteralPath $configPath) {
        try {
            $existingConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
            $existingConfig.PSObject.Properties | ForEach-Object {
                $config[$_.Name] = $_.Value
            }
        } catch {
            Write-Host 'Istniejaca konfiguracja jest nieprawidlowa; tworzona jest nowa.' -ForegroundColor Yellow
        }
    }
    $config['publicHost'] = $IpAddress
    $config['httpPort'] = $HttpPort
    $config['httpsPort'] = $HttpsPort
    if (-not $config.ContainsKey('displayIndex')) { $config['displayIndex'] = 0 }
    if (-not $config.ContainsKey('autoStart')) { $config['autoStart'] = $false }
    if (-not $config.ContainsKey('allowAudio')) { $config['allowAudio'] = $true }

    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($infoPath, ($certificateInfo | ConvertTo-Json -Depth 4), $utf8WithoutBom)
    [System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 4), $utf8WithoutBom)

    Write-Step 'Weryfikacja konfiguracji'
    foreach ($requiredPath in @($pfxPath, $caPath, $infoPath, $configPath)) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Nie utworzono wymaganego pliku: $requiredPath"
        }
    }

    $pfxCheck = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
        $pfxPath,
        $password,
        [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
    )
    try {
        if (-not $pfxCheck.HasPrivateKey) {
            throw 'Plik server.pfx nie zawiera klucza prywatnego.'
        }
        if ($pfxCheck.Thumbprint -ne $serverCertificate.Thumbprint) {
            throw 'Odcisk certyfikatu PFX nie zgadza sie z konfiguracja.'
        }
    } finally {
        $pfxCheck.Dispose()
    }

    $trustedRoot = Get-ChildItem -Path 'Cert:\CurrentUser\Root' |
        Where-Object { $_.Thumbprint -eq $rootCertificate.Thumbprint }
    if (-not $trustedRoot) {
        throw 'Lokalny CA nie zostal znaleziony w zaufanym magazynie CurrentUser\Root.'
    }

    $savedConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($savedConfig.publicHost -ne $IpAddress -or
        [int]$savedConfig.httpPort -ne $HttpPort -or
        [int]$savedConfig.httpsPort -ne $HttpsPort) {
        throw 'Zapisana konfiguracja portow lub adresu jest nieprawidlowa.'
    }

    Write-Host ''
    Write-Host 'GOTOWE - kompletna konfiguracja zostala zapisana.' -ForegroundColor Green
    Write-Host "Uruchom teraz web-stream-receiver na tym samym koncie Windows." -ForegroundColor Green
    Write-Host "Adres prezentera: http://${IpAddress}:${HttpPort}"
    Write-Host "Adres HTTPS: https://${IpAddress}:${HttpsPort}"
    Write-Host ''
    Write-Host 'Skrypt nie usuwa zadnych starszych certyfikatow.' -ForegroundColor DarkGray
} catch {
    Write-Host ''
    Write-Host 'KONFIGURACJA NIE POWIODLA SIE:' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    Write-Host 'web-stream-receiver pozostaw zamkniety i przekaz powyzszy komunikat.' -ForegroundColor Yellow
    exit 1
}
