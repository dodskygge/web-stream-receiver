'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { URL } = require('node:url');
const { WebSocketServer, WebSocket } = require('../vendor/ws');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

const STATIC_ROUTES = Object.freeze({
  '/': 'presenter.html',
  '/presenter': 'presenter.html',
  '/presenter.js': 'presenter.js',
  '/presenter.css': 'presenter.css',
  '/receiver': 'receiver.html',
  '/receiver.js': 'receiver.js',
  '/receiver.css': 'receiver.css'
});

function sendJson(response, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store'
  });
  response.end(payload);
}

function commonHeaders() {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'display-capture=(self)',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self' wss:; media-src 'self' blob:; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  };
}

function presenterInstaller(publicHost, httpPort) {
  const safeHost = publicHost.replace(/[^a-z0-9.-]/gi, '');
  return `@echo off\r\nsetlocal\r\nset "WSR_CERT=%TEMP%\\web-stream-receiver.cer"\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri 'http://${safeHost}:${httpPort}/certificate' -OutFile '%WSR_CERT%'; Import-Certificate -FilePath '%WSR_CERT%' -CertStoreLocation 'Cert:\\CurrentUser\\Root' | Out-Null"\r\nif errorlevel 1 (\r\n  echo Nie udalo sie zainstalowac certyfikatu.\r\n  pause\r\n  exit /b 1\r\n)\r\necho Certyfikat odbiornika zostal zainstalowany dla tego uzytkownika.\r\necho Otwieram strone prezentera...\r\nstart "" "http://${safeHost}:${httpPort}"\r\ntimeout /t 3 >nul\r\ndel "%WSR_CERT%" >nul 2>&1\r\nendlocal\r\n`;
}

function createReceiverServer(options) {
  const {
    publicDirectory,
    certificate,
    publicHost,
    httpPort,
    httpsPort,
    receiverToken,
    allowAudio = true,
    logger = console
  } = options;

  let receiver = null;
  const presenters = new Set();
  let activePresenter = null;
  let closing = false;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  function safeSend(socket, message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function stateFor(presenter) {
    return {
      type: 'state',
      receiverOnline: Boolean(receiver && receiver.readyState === WebSocket.OPEN),
      presenterActive: Boolean(activePresenter),
      youAreActive: activePresenter === presenter,
      allowAudio
    };
  }

  function broadcastState() {
    for (const presenter of presenters) {
      safeSend(presenter, stateFor(presenter));
    }
    safeSend(receiver, {
      type: 'server-state',
      presenterActive: Boolean(activePresenter)
    });
  }

  function releasePresenter(presenter, reason = 'released') {
    if (activePresenter !== presenter) return;
    activePresenter = null;
    safeSend(receiver, { type: 'presenter-left', reason });
    broadcastState();
  }

  function handlePresenterMessage(socket, message) {
    if (message.type === 'claim') {
      if (!receiver || receiver.readyState !== WebSocket.OPEN) {
        safeSend(socket, { type: 'claim-rejected', reason: 'receiver-offline' });
      } else if (activePresenter && activePresenter !== socket) {
        safeSend(socket, { type: 'claim-rejected', reason: 'busy' });
      } else {
        activePresenter = socket;
        safeSend(socket, { type: 'claimed' });
        safeSend(receiver, { type: 'presenter-claimed' });
        broadcastState();
      }
      return;
    }

    if (message.type === 'release' || message.type === 'hangup') {
      releasePresenter(socket, message.type);
      return;
    }

    if (activePresenter !== socket) return;
    if (['offer', 'ice'].includes(message.type)) {
      safeSend(receiver, message);
    }
  }

  function handleReceiverMessage(message) {
    if (!activePresenter) return;
    if (['answer', 'ice', 'receiver-playing', 'receiver-error'].includes(message.type)) {
      safeSend(activePresenter, message);
    }
  }

  function registerSocket(socket, requestUrl) {
    const role = requestUrl.searchParams.get('role');
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });

    if (role === 'receiver') {
      if (requestUrl.searchParams.get('token') !== receiverToken || receiver) {
        socket.close(1008, 'receiver rejected');
        return;
      }
      receiver = socket;
      logger.log('Odbiornik WebRTC połączony.');
      broadcastState();
    } else if (role === 'presenter') {
      presenters.add(socket);
      safeSend(socket, stateFor(socket));
    } else {
      socket.close(1008, 'unknown role');
      return;
    }

    socket.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        socket.close(1003, 'invalid json');
        return;
      }
      if (!message || typeof message.type !== 'string') return;
      if (role === 'receiver') handleReceiverMessage(message);
      else handlePresenterMessage(socket, message);
    });

    socket.on('close', () => {
      if (role === 'receiver' && receiver === socket) {
        receiver = null;
        if (activePresenter) safeSend(activePresenter, { type: 'receiver-left' });
        activePresenter = null;
        broadcastState();
      } else if (role === 'presenter') {
        presenters.delete(socket);
        releasePresenter(socket, 'socket-closed');
      }
    });

    socket.on('error', (error) => logger.warn(`WebSocket ${role}: ${error.message}`));
  }

  function httpsHandler(request, response) {
    const requestUrl = new URL(request.url, `https://${publicHost}:${httpsPort}`);
    if (requestUrl.pathname === '/health') {
      sendJson(response, 200, {
        ok: true,
        receiverOnline: Boolean(receiver),
        presenterActive: Boolean(activePresenter)
      });
      return;
    }

    if (requestUrl.pathname === '/api/info') {
      sendJson(response, 200, {
        name: 'web-stream-receiver',
        receiverOnline: Boolean(receiver),
        presenterActive: Boolean(activePresenter),
        allowAudio,
        httpsUrl: `https://${publicHost}:${httpsPort}`
      });
      return;
    }

    if (requestUrl.pathname === '/certificate') {
      const contents = fs.readFileSync(certificate.publicCertificatePath);
      response.writeHead(200, {
        'Content-Type': 'application/pkix-cert',
        'Content-Disposition': 'attachment; filename="web-stream-receiver.cer"',
        'Content-Length': contents.length,
        ...commonHeaders()
      });
      response.end(contents);
      return;
    }

    const fileName = STATIC_ROUTES[requestUrl.pathname];
    if (!fileName) {
      response.writeHead(404, commonHeaders());
      response.end('Nie znaleziono');
      return;
    }

    const filePath = path.join(publicDirectory, fileName);
    const contents = fs.readFileSync(filePath);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Content-Length': contents.length,
      ...commonHeaders()
    });
    response.end(contents);
  }

  // HTTP serwuje to samo co HTTPS. Działa bez certyfikatu na laptopach z polityką
  // OverrideSecurityRestrictionsOnInsecureOrigin; pozostałe przekierowuje presenter.js.
  function httpHandler(request, response) {
    const requestUrl = new URL(request.url, `http://${publicHost}:${httpPort}`);
    if (requestUrl.pathname === '/install-certificate.cmd') {
      const contents = Buffer.from(presenterInstaller(publicHost, httpPort), 'utf8');
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="zaufaj-web-stream-receiver.cmd"',
        'Content-Length': contents.length
      });
      response.end(contents);
      return;
    }

    httpsHandler(request, response);
  }

  const secureServer = https.createServer({
    pfx: certificate.pfx,
    passphrase: certificate.passphrase,
    minVersion: 'TLSv1.2'
  }, httpsHandler);
  const redirectServer = http.createServer(httpHandler);

  function handleUpgrade(request, socket, head) {
    const requestUrl = new URL(request.url, `https://${publicHost}:${httpsPort}`);
    if (requestUrl.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => registerSocket(webSocket, requestUrl));
  }
  secureServer.on('upgrade', handleUpgrade);
  redirectServer.on('upgrade', handleUpgrade);

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 15_000);

  function listen(server, port) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
  }

  async function start() {
    await listen(secureServer, httpsPort);
    try {
      await listen(redirectServer, httpPort);
    } catch (error) {
      await new Promise((resolve) => secureServer.close(resolve));
      throw error;
    }
    logger.log(`Strona prezentera: http://${publicHost}:${httpPort}`);
  }

  async function stop() {
    if (closing) return;
    closing = true;
    clearInterval(heartbeat);
    for (const socket of wss.clients) socket.close(1001, 'server shutdown');
    await Promise.all([
      new Promise((resolve) => secureServer.close(resolve)),
      new Promise((resolve) => redirectServer.close(resolve))
    ]);
  }

  return {
    start,
    stop,
    getState: () => ({ receiverOnline: Boolean(receiver), presenterActive: Boolean(activePresenter) })
  };
}

module.exports = { createReceiverServer, presenterInstaller };
