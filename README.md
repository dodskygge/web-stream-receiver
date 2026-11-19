# web-stream-receiver

**English** | [Polski](README.pl.md)

Local screen-sharing receiver for Windows. A presenter opens the receiver PC's address in
Chrome or Edge, clicks **Share screen** and picks a screen or window. The image goes
over WebRTC straight to the receiver PC and covers its whole display; when sharing
stops, the window hides and the dashboard underneath is visible again.

No accounts, no cloud — traffic stays in the LAN. One presenter at a time.

## How it works

```text
Presenter laptop (Chrome/Edge)          Receiver PC (web-stream-receiver)
http://<IP>:8080  ── page + WebSocket ─> HTTP server  :8080
https://<IP>:8443 ── page + WebSocket ─> HTTPS server :8443
getDisplayMedia() ══ WebRTC video ═════> hidden receiver window → fullscreen on top
```

Browsers allow screen capture only on a *secure* page. Each presenter laptop must
therefore either have a **browser policy** marking `http://<IP>:8080` as secure
(recommended, no certificate), or **trust the receiver's certificate** and use HTTPS.
Video is always encrypted by WebRTC.

## Install on the receiver PC

Unzip `web-stream-receiver-windows-x64-<version>.zip`. Run scripts with
`powershell -ExecutionPolicy Bypass -File .\Setup\<script>.ps1`.

1. Give the receiver PC a **static IP** (DHCP reservation) and set the network profile to **Private**.
2. As **administrator**: `Configure-Firewall.ps1` — before the first app start
   (allows TCP 8080/8443 from the local subnet only).
3. Install `web-stream-receiver-setup-<version>-x64.exe`. Close the app if it starts.
4. On the account that will run the app: `Configure-IpCertificate.ps1 -IpAddress <IP>`.
   It creates a local CA and server certificate for the IP and `localhost`, trusts the
   CA for this user and writes `config.json`. Click **Yes** if Windows asks to install
   the certificate.
5. Start web-stream-receiver (runs in the background). Optional autostart:
   `Set-Autostart.ps1` → type `Enable`, then restart the app.

Use the installer, not the portable `.exe`, for daily use — the portable build runs
from a temp folder, which breaks autostart.

## Prepare presenter laptops (once, pick one)

| Method | For | How |
|---|---|---|
| **A. GPO** | domain laptops | Chrome and Edge policy `OverrideSecurityRestrictionsOnInsecureOrigin` = `http://<IP>:8080` |
| **B. `.reg` file** | non-domain, local admin | registry keys below, then restart the browser |
| **C. Browser flag** | no admin rights | `chrome://flags/#unsafely-treat-insecure-origin-as-secure` (Edge: `edge://flags/...`) → enter `http://<IP>:8080` → Enabled → Relaunch |
| **D. Certificate** | when A–C are not possible | open `http://<IP>:8080/install-certificate.cmd`, run it, click **Yes** |

```text
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\OverrideSecurityRestrictionsOnInsecureOrigin]
"1"="http://192.168.2.104:8080"

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\OverrideSecurityRestrictionsOnInsecureOrigin]
"1"="http://192.168.2.104:8080"
```

Check A/B at `chrome://policy` / `edge://policy` (status **OK**). The address must match
exactly what presenters type. Without a policy, `http://<IP>:8080` redirects to HTTPS,
which works only with method D. After a new certificate (IP change, 2-year expiry),
method D must be repeated; A–C only need a new address when the IP changes.

## Usage

Open `http://<IP>:8080` → **Share screen** →
pick a screen/window. Stop with **End presentation**, the
browser's Stop sharing bar, or by closing the tab.
Emergency hide on the receiver PC: `Ctrl+Alt+Shift+Q`.

## Configuration

`%APPDATA%\web-stream-receiver\config.json` (restart the app after changes):

| Key | Default | Meaning |
|---|---|---|
| `publicHost` | set by `Configure-IpCertificate.ps1` | IP or name presenters use (must be in the certificate) |
| `httpPort` / `httpsPort` | `8080` / `8443` | server ports |
| `displayIndex` | `0` | receiver monitor, zero-based |
| `autoStart` | `false` | start with Windows (set via `Set-Autostart.ps1`) |
| `allowAudio` | `true` | show the share-audio option |

Certificates live in `%APPDATA%\web-stream-receiver\certs\`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Status **Receiver offline**, page loads | The hidden receiver window does not trust the certificate. Close the app, rerun `Configure-IpCertificate.ps1` on the app's account, start the app. Also make sure an old version is not still running. |
| Page does not load | App not running, firewall (if Windows' firewall prompt was cancelled it created a block rule), Public network profile, or Wi-Fi client isolation. |
| Message **Secure HTTPS connection required** | Laptop has no policy (A–C) or certificate (D); check `chrome://policy`. |
| Certificate error on `https://…:8443` | Install the certificate (D) or use a policy. |
| Wrong monitor | Change `displayIndex`. |

Health check: `http://<IP>:8080/health` → `receiverOnline: true` means the receiver
window is connected.

## Development

Node.js 22+.

```powershell
npm install
npm test
npm start          # run from source
npm run build      # dist\: NSIS installer + portable exe
```

`src\` – Electron main process and server, `public\` – presenter and receiver pages,
`scripts\` – PowerShell scripts (shipped as `Setup\`), `vendor\ws\` – WebSocket library.

## Security

No login by design: anyone on the subnet can present while the receiver is free — never
expose ports 8080/8443 outside the LAN. With methods A–C the page and signalling use
plain HTTP inside the LAN. The local CA's private key stays on the receiver PC; a laptop that
trusts this CA trusts everything it signs, so prefer browser policies over the
certificate. No TURN server: designed for a single network/VLAN.

## License

MIT
