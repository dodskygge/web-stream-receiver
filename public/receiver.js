'use strict';

const remoteVideo = document.getElementById('remoteVideo');
const waiting = document.getElementById('waiting');
const waitingTitle = document.getElementById('waitingTitle');
const badge = document.getElementById('badge');
const token = new URLSearchParams(location.search).get('token') || '';

let socket = null;
let peer = null;
let reconnectTimer = null;
let disconnectTimer = null;
const pendingIce = [];

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function cleanup(notifyHost = true, preserveIce = false) {
  clearTimeout(disconnectTimer);
  if (peer) peer.close();
  peer = null;
  if (!preserveIce) pendingIce.length = 0;
  if (remoteVideo.srcObject) {
    remoteVideo.srcObject.getTracks().forEach((track) => track.stop());
    remoteVideo.srcObject = null;
  }
  waiting.hidden = false;
  waitingTitle.textContent = 'Oczekiwanie na obraz…';
  badge.hidden = true;
  if (notifyHost) window.streamReceiver?.streamEnded();
}

function createPeer() {
  const connection = new RTCPeerConnection({ iceServers: [] });
  connection.addEventListener('icecandidate', (event) => {
    if (event.candidate) send({ type: 'ice', candidate: event.candidate });
  });
  connection.addEventListener('track', async (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    remoteVideo.srcObject = stream;
    badge.hidden = stream.getAudioTracks().length > 0;
    try {
      await remoteVideo.play();
      waiting.hidden = true;
      window.streamReceiver?.streamStarted();
      window.streamReceiver?.reportStatus('strumień jest odtwarzany');
      send({ type: 'receiver-playing' });
    } catch (error) {
      send({ type: 'receiver-error', message: error.message });
      cleanup();
    }
  });
  connection.addEventListener('connectionstatechange', () => {
    clearTimeout(disconnectTimer);
    if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
      cleanup();
    } else if (connection.connectionState === 'disconnected') {
      disconnectTimer = setTimeout(() => {
        if (connection.connectionState === 'disconnected') cleanup();
      }, 5000);
    }
  });
  return connection;
}

async function handleOffer(offer) {
  cleanup(false, true);
  waitingTitle.textContent = 'Uruchamianie prezentacji…';
  peer = createPeer();
  await peer.setRemoteDescription(offer);
  while (pendingIce.length) await peer.addIceCandidate(pendingIce.shift());
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  send({ type: 'answer', answer: peer.localDescription });
}

function connect() {
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/ws?role=receiver&token=${encodeURIComponent(token)}`);
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(event.data);
    try {
      if (message.type === 'offer') {
        await handleOffer(message.offer);
      } else if (message.type === 'ice') {
        if (peer?.remoteDescription) await peer.addIceCandidate(message.candidate);
        else pendingIce.push(message.candidate);
      } else if (message.type === 'presenter-left') {
        cleanup();
      } else if (message.type === 'presenter-claimed') {
        waitingTitle.textContent = 'Prezenter wybiera ekran…';
      }
    } catch (error) {
      send({ type: 'receiver-error', message: error.message });
      cleanup();
    }
  });
  socket.addEventListener('close', () => {
    cleanup();
    reconnectTimer = setTimeout(connect, 2000);
  });
  socket.addEventListener('error', () => socket.close());
}

connect();
