# web-stream-receiver

[English](README.md) | **Polski**

Lokalny odbiornik udostępniania ekranu dla Windows. Prezenter otwiera adres komputera odbiornika w
Chrome lub Edge, klika **Udostępnij ekran** i wybiera ekran lub okno. Obraz trafia
przez WebRTC bezpośrednio do komputera odbiornika i przykrywa cały ekran; po zakończeniu
okno znika i wraca dashboard.

Bez kont i chmury — ruch zostaje w sieci lokalnej. Jeden prezenter naraz.

## Jak to działa

```text
Laptop prezentera (Chrome/Edge)         Komputer odbiornika (web-stream-receiver)
http://<IP>:8080  ── strona + WebSocket ─> serwer HTTP  :8080
https://<IP>:8443 ── strona + WebSocket ─> serwer HTTPS :8443
getDisplayMedia() ══ obraz WebRTC ══════> ukryte okno odbiornika → pełny ekran
```

Przeglądarka pozwala przechwycić ekran tylko na stronie *bezpiecznej*. Dlatego każdy
laptop prezentera musi mieć albo **politykę przeglądarki**, która uznaje
`http://<IP>:8080` za bezpieczny (zalecane, bez certyfikatu), albo **zaufany
certyfikat odbiornika** i HTTPS. Obraz WebRTC jest zawsze szyfrowany.

## Instalacja na komputerze odbiornika

Rozpakuj `web-stream-receiver-windows-x64-<wersja>.zip`. Skrypty uruchamiaj poleceniem
`powershell -ExecutionPolicy Bypass -File .\Setup\<skrypt>.ps1`.

1. Ustaw **stały adres IP** (rezerwacja DHCP) i profil sieci **Prywatna**.
2. Jako **administrator**: `Configure-Firewall.ps1` — przed pierwszym uruchomieniem
   aplikacji (wpuszcza TCP 8080/8443 tylko z podsieci lokalnej).
3. Zainstaluj `web-stream-receiver-setup-<wersja>-x64.exe`. Jeśli aplikacja się uruchomi,
   zamknij ją.
4. Na koncie, na którym ma działać aplikacja:
   `Configure-IpCertificate.ps1 -IpAddress <IP>`. Skrypt tworzy lokalny CA i
   certyfikat dla adresu IP i `localhost`, dodaje CA do zaufanych dla tego użytkownika
   i zapisuje `config.json`. Gdy Windows zapyta o instalację certyfikatu — **Tak**.
5. Uruchom web-stream-receiver (działa w tle). Autostart (opcjonalnie):
   `Set-Autostart.ps1` → wpisz `Enable`, potem uruchom aplikację ponownie.

Do stałej pracy używaj instalatora, nie wersji portable — portable działa z folderu
tymczasowego, przez co autostart nie działa poprawnie.

## Przygotowanie laptopów prezenterów (raz, jedna metoda)

| Metoda | Dla kogo | Jak |
|---|---|---|
| **A. GPO** | laptopy w domenie | polityka Chrome i Edge `OverrideSecurityRestrictionsOnInsecureOrigin` = `http://<IP>:8080` |
| **B. Plik `.reg`** | spoza domeny, admin lokalny | klucze poniżej, potem restart przeglądarki |
| **C. Flaga przeglądarki** | bez uprawnień admina | `chrome://flags/#unsafely-treat-insecure-origin-as-secure` (Edge: `edge://flags/...`) → wpisz `http://<IP>:8080` → Enabled → Relaunch |
| **D. Certyfikat** | gdy A–C niemożliwe | otwórz `http://<IP>:8080/install-certificate.cmd`, uruchom, kliknij **Tak** |

```text
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\OverrideSecurityRestrictionsOnInsecureOrigin]
"1"="http://192.168.2.104:8080"

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\OverrideSecurityRestrictionsOnInsecureOrigin]
"1"="http://192.168.2.104:8080"
```

Sprawdzenie A/B: `chrome://policy` / `edge://policy` (status **OK**). Adres musi być
identyczny z tym, który wpisuje prezenter. Bez polityki `http://<IP>:8080`
przekierowuje na HTTPS, co działa tylko z metodą D. Po wygenerowaniu nowego
certyfikatu (zmiana IP, wygaśnięcie po 2 latach) metodę D trzeba powtórzyć; A–C
wymagają zmiany tylko przy zmianie adresu IP.

## Użycie

Otwórz `http://<IP>:8080` → **Udostępnij ekran** → wybierz ekran lub okno. Zakończ
przyciskiem **Zakończ prezentację**, paskiem „Przestań udostępniać” w przeglądarce
albo zamykając kartę. Awaryjne ukrycie obrazu na odbiorniku: `Ctrl+Alt+Shift+Q`.

## Konfiguracja

`%APPDATA%\web-stream-receiver\config.json` (po zmianie uruchom aplikację ponownie):

| Pole | Domyślnie | Znaczenie |
|---|---|---|
| `publicHost` | ustawia `Configure-IpCertificate.ps1` | IP lub nazwa, której używają prezenterzy (musi być w certyfikacie) |
| `httpPort` / `httpsPort` | `8080` / `8443` | porty serwera |
| `displayIndex` | `0` | monitor odbiornika, liczony od zera |
| `autoStart` | `false` | start z Windows (ustawiany przez `Set-Autostart.ps1`) |
| `allowAudio` | `true` | pokazuje opcję udostępniania dźwięku |

Certyfikaty są w `%APPDATA%\web-stream-receiver\certs\`.

## Rozwiązywanie problemów

| Objaw | Rozwiązanie |
|---|---|
| **Odbiornik jest offline**, strona działa | Ukryte okno odbiornika nie ufa certyfikatowi. Zamknij aplikację, uruchom ponownie `Configure-IpCertificate.ps1` na koncie aplikacji, uruchom aplikację. Sprawdź też, czy nie działa stara wersja. |
| Strona się nie otwiera | Aplikacja nie działa, zapora (anulowanie okna zapory Windows tworzy regułę blokującą), profil sieci Publiczna albo izolacja klientów Wi-Fi. |
| **Wymagane bezpieczne połączenie HTTPS** | Laptop nie ma polityki (A–C) ani certyfikatu (D); sprawdź `chrome://policy`. |
| Błąd certyfikatu na `https://…:8443` | Zainstaluj certyfikat (D) albo użyj polityki. |
| Obraz na złym monitorze | Zmień `displayIndex`. |

Kontrola: `http://<IP>:8080/health` → `receiverOnline: true` oznacza, że okno
odbiornika jest połączone.

## Rozwój

Node.js 22+.

```powershell
npm install
npm test
npm start          # uruchomienie ze źródeł
npm run build      # dist\: instalator NSIS + portable
```

`src\` – proces główny Electron i serwer, `public\` – strony prezentera i odbiornika,
`scripts\` – skrypty PowerShell (w paczce jako `Setup\`), `vendor\ws\` – biblioteka
WebSocket.

## Bezpieczeństwo

Brak logowania jest celowy: każdy w podsieci może prezentować, gdy odbiornik jest wolny —
nie wystawiaj portów 8080/8443 poza LAN. Przy metodach A–C strona i sygnalizacja idą
zwykłym HTTP w sieci lokalnej. Klucz prywatny lokalnego CA zostaje na komputerze odbiornika; laptop,
który ufa temu CA, ufa wszystkiemu, co CA podpisze — dlatego wybieraj politykę
przeglądarki zamiast certyfikatu. Brak serwera TURN: rozwiązanie dla jednej sieci/VLAN.

## Licencja

MIT
