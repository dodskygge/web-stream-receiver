'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('streamReceiver', Object.freeze({
  streamStarted: () => ipcRenderer.send('receiver:stream-started'),
  streamEnded: () => ipcRenderer.send('receiver:stream-ended'),
  reportStatus: (status) => ipcRenderer.send('receiver:status', String(status).slice(0, 120))
}));
