'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { presenterInstaller, createReceiverServer } = require('../src/server');
const { loadConfig } = require('../src/config');
const { WebSocket } = require('../vendor/ws');

test('HTTP serwuje stronę prezentera i WebSocket bez przekierowania', async () => {
  const server = createReceiverServer({
    publicDirectory: path.join(__dirname, '..', 'public'),
    certificate: { pfx: fs.readFileSync(path.join(__dirname, 'fixtures', 'test.pfx')), passphrase: 'test' },
    publicHost: 'localhost',
    httpPort: 18080,
    httpsPort: 18443,
    receiverToken: 'x',
    logger: { log() {}, warn() {} }
  });
  await server.start();
  try {
    const page = await fetch('http://127.0.0.1:18080/', { redirect: 'manual' });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /presenter\.js/);

    const info = await (await fetch('http://127.0.0.1:18080/api/info')).json();
    assert.equal(info.httpsUrl, 'https://localhost:18443');

    const socket = new WebSocket('ws://127.0.0.1:18080/ws?role=presenter');
    const message = await new Promise((resolve, reject) => {
      socket.once('message', (data) => resolve(JSON.parse(data.toString())));
      socket.once('error', reject);
    });
    assert.equal(message.type, 'state');
    socket.close();
  } finally {
    await server.stop();
  }
});

test('instalator certyfikatu używa skonfigurowanego hosta i portu', () => {
  const script = presenterInstaller('192.168.2.104', 8080);
  assert.ok(script.includes("http://192.168.2.104:8080/certificate"));
  assert.ok(script.includes('Cert:\\CurrentUser\\Root'));
});

test('konfiguracja używa bezpiecznych wartości domyślnych', () => {
  const config = loadConfig(path.join(__dirname, 'fixtures', 'missing'));
  assert.equal(config.publicHost, require('node:os').hostname());
  assert.equal(config.httpPort, 8080);
  assert.equal(config.httpsPort, 8443);
  assert.equal(config.displayIndex, 0);
  assert.equal(config.autoStart, false);
});
