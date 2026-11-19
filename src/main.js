'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  screen
} = require('electron');
const { loadConfig } = require('./config');
const { ensureCertificate } = require('./certificates');
const { createReceiverServer } = require('./server');

app.setName('web-stream-receiver');
app.setAppUserModelId('local.webstream.receiver');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

let receiverWindow = null;
let localServer = null;
let config = null;
let quitting = false;

function publicDirectory() {
  return path.join(__dirname, '..', 'public');
}

function pickDisplay() {
  const displays = screen.getAllDisplays();
  return displays[config.displayIndex] || screen.getPrimaryDisplay();
}

function showReceiver() {
  if (!receiverWindow || receiverWindow.isDestroyed()) return;
  const display = pickDisplay();
  receiverWindow.setFullScreen(false);
  receiverWindow.setBounds(display.bounds);
  receiverWindow.setAlwaysOnTop(true, 'screen-saver');
  receiverWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  receiverWindow.showInactive();
  receiverWindow.setFullScreen(true);
  receiverWindow.show();
  receiverWindow.focus();
}

function hideReceiver() {
  if (!receiverWindow || receiverWindow.isDestroyed()) return;
  receiverWindow.setFullScreen(false);
  receiverWindow.hide();
}

function createReceiverWindow(receiverToken) {
  receiverWindow = new BrowserWindow({
    show: false,
    frame: false,
    fullscreenable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: '#030712',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  receiverWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      hideReceiver();
    }
  });
  receiverWindow.setMenu(null);
  receiverWindow.loadURL(`https://localhost:${config.httpsPort}/receiver?token=${encodeURIComponent(receiverToken)}`);
}

async function bootstrap() {
  try {
    const userDataPath = app.getPath('userData');
    config = loadConfig(userDataPath);
    const certificate = ensureCertificate(app, userDataPath, config.publicHost);
    const receiverToken = crypto.randomBytes(32).toString('hex');

    app.setLoginItemSettings({
      openAtLogin: config.autoStart,
      path: process.execPath,
      args: app.isPackaged ? [] : [path.resolve(__dirname, '..')]
    });

    localServer = createReceiverServer({
      publicDirectory: publicDirectory(),
      certificate,
      publicHost: config.publicHost,
      httpPort: config.httpPort,
      httpsPort: config.httpsPort,
      receiverToken,
      allowAudio: config.allowAudio
    });
    await localServer.start();
    createReceiverWindow(receiverToken);

    globalShortcut.register('CommandOrControl+Alt+Shift+Q', hideReceiver);
  } catch (error) {
    dialog.showErrorBox(
      'web-stream-receiver — błąd uruchamiania',
      `${error.message}\n\nSprawdź, czy porty 8080 i 8443 są wolne oraz czy PowerShell może utworzyć certyfikat.`
    );
    app.quit();
  }
}

ipcMain.on('receiver:stream-started', showReceiver);
ipcMain.on('receiver:stream-ended', hideReceiver);
ipcMain.on('receiver:status', (_event, status) => console.log(`Odbiornik: ${status}`));

app.whenReady().then(bootstrap);

app.on('second-instance', () => {
  if (receiverWindow && receiverWindow.isVisible()) receiverWindow.focus();
});

app.on('before-quit', async (event) => {
  if (quitting) return;
  quitting = true;
  if (localServer) {
    event.preventDefault();
    await localServer.stop();
    app.quit();
  }
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {});
