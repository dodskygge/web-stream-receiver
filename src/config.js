'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  publicHost: os.hostname(),
  httpPort: 8080,
  httpsPort: 8443,
  displayIndex: 0,
  autoStart: false,
  allowAudio: true
});

function integerInRange(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function loadConfig(userDataPath) {
  const configPath = process.env.WSR_CONFIG_PATH || path.join(userDataPath, 'config.json');
  let fromDisk = {};

  try {
    fromDisk = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Nie można odczytać konfiguracji ${configPath}: ${error.message}`);
    }
  }

  const publicHost = typeof fromDisk.publicHost === 'string' && /^[a-z0-9.-]+$/i.test(fromDisk.publicHost)
    ? fromDisk.publicHost
    : DEFAULTS.publicHost;

  return {
    publicHost,
    httpPort: integerInRange(fromDisk.httpPort, DEFAULTS.httpPort, 1, 65535),
    httpsPort: integerInRange(fromDisk.httpsPort, DEFAULTS.httpsPort, 1, 65535),
    displayIndex: integerInRange(fromDisk.displayIndex, DEFAULTS.displayIndex, 0, 32),
    autoStart: typeof fromDisk.autoStart === 'boolean' ? fromDisk.autoStart : DEFAULTS.autoStart,
    allowAudio: typeof fromDisk.allowAudio === 'boolean' ? fromDisk.allowAudio : DEFAULTS.allowAudio,
    configPath
  };
}

module.exports = { DEFAULTS, loadConfig };
