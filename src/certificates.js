'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function certificatePaths(userDataPath) {
  const directory = path.join(userDataPath, 'certs');
  return {
    directory,
    pfx: path.join(directory, 'server.pfx'),
    cer: path.join(directory, 'web-stream-receiver.cer'),
    info: path.join(directory, 'certificate.json')
  };
}

function resolveScriptPath(app) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scripts', 'Initialize-Certificate.ps1')
    : path.join(__dirname, '..', 'scripts', 'Initialize-Certificate.ps1');
}

function ensureCertificate(app, userDataPath, publicHost) {
  const paths = certificatePaths(userDataPath);
  if (fs.existsSync(paths.pfx) && fs.existsSync(paths.cer) && fs.existsSync(paths.info)) {
    return readCertificate(paths);
  }

  fs.mkdirSync(paths.directory, { recursive: true });
  const scriptPath = resolveScriptPath(app);
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-OutputDirectory', paths.directory,
    '-PublicHost', publicHost
  ], { encoding: 'utf8', windowsHide: true });

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || 'nieznany błąd').trim();
    throw new Error(`Nie udało się utworzyć lokalnego certyfikatu HTTPS: ${details}`);
  }

  return readCertificate(paths);
}

function readCertificate(paths) {
  const info = JSON.parse(fs.readFileSync(paths.info, 'utf8').replace(/^\uFEFF/, ''));
  return {
    pfx: fs.readFileSync(paths.pfx),
    passphrase: info.password,
    publicCertificatePath: paths.cer,
    thumbprint: info.thumbprint,
    expires: info.expires
  };
}

module.exports = { certificatePaths, ensureCertificate };
