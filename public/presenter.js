'use strict';

const statusBox = document.getElementById('statusBox');
const statusTitle = document.getElementById('statusTitle');
const statusDetail = document.getElementById('statusDetail');
const shareButton = document.getElementById('shareButton');
const stopButton = document.getElementById('stopButton');
const buttonLabel = document.getElementById('buttonLabel');
const shareAudio = document.getElementById('shareAudio');
const audioOption = document.getElementById('audioOption');

let socket = null;
let peer = null;
let mediaStream = null;
let sharing = false;
let receiverOnline = false;
let presenterActive = false;
let youAreActive = false;
let reconnectTimer = null;
let claimResolver = null;
let disconnectTimer = null;
const pendingIce = [];

function setStatus(state, title, detail) {
  statusBox.dataset.state = state;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

function updateControls() {
  const socketReady = socket && socket.readyState === WebSocket.OPEN;
  const available = socketReady && receiverOnline && (!presenterActive || youAreActive) && !sharing;
  shareButton.disabled = !available;
  shareButton.hidden = sharing;
  stopButton.hidden = !sharing;
  audioOption.hidden = sharing;

  if (sharing) return;
  if (!socketReady) {
    setStatus('connecting', 'Łączenie z odbiornikiem…', 'Sprawdzam dostępność odbiornika.');
  } else if (!receiverOnline) {
    setStatus('error', 'Odbiornik jest offline', 'Sprawdź, czy aplikacja web-stream-receiver działa.');
  } else if (presenterActive && !youAreActive) {
    setStatus('busy', 'Odbiornik jest teraz zajęty', 'Ktoś już prezentuje. Przycisk odblokuje się automatycznie.');
  } else {
    setStatus('ready', 'Odbiornik jest gotowy', 'Kliknij przycisk i wybierz ekran albo okno.');
  }
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/ws?role=presenter`);

  socket.addEventListener('open', updateControls);
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'state') {
      receiverOnline = message.receiverOnline;
      presenterActive = message.presenterActive;
      youAreActive = message.youAreActive;
      audioOption.hidden = !message.allowAudio || sharing;
      if (!message.allowAudio) shareAudio.checked = false;
      updateControls();
    } else if (message.type === 'claimed') {
      if (claimResolver) claimResolver(true);
      claimResolver = null;
    } else if (message.type === 'claim-rejected') {
      if (claimResolver) claimResolver(false);
      claimResolver = null;
      const reason = message.reason === 'busy' ? 'Odbiornik jest już zajęty.' : 'Odbiornik jest offline.';
      setStatus('busy', 'Nie można rozpocząć', reason);
    } else if (message.type === 'answer' && peer) {
      await peer.setRemoteDescription(message.answer);
      while (pendingIce.length) await peer.addIceCandidate(pendingIce.shift());
    } else if (message.type === 'ice' && peer) {
      if (peer.remoteDescription) await peer.addIceCandidate(message.candidate);
      else pendingIce.push(message.candidate);
    } else if (message.type === 'receiver-playing') {
      setStatus('sharing', 'Prezentacja jest widoczna na odbiorniku', 'Nie zamykaj tej karty.');
    } else if (message.type === 'receiver-left') {
      stopSharing(false, 'Odbiornik został rozłączony.');
    } else if (message.type === 'receiver-error') {
      stopSharing(true, 'Odbiornik nie mógł odtworzyć transmisji.');
    }
  });

  socket.addEventListener('close', () => {
    receiverOnline = false;
    presenterActive = false;
    youAreActive = false;
    if (sharing) stopSharing(false, 'Utracono połączenie z odbiornikiem.');
    updateControls();
    reconnectTimer = setTimeout(connect, 2000);
  });
  socket.addEventListener('error', () => socket.close());
}

function claimPresenter() {
  return new Promise((resolve) => {
    claimResolver = resolve;
    send({ type: 'claim' });
    setTimeout(() => {
      if (claimResolver === resolve) {
        claimResolver = null;
        resolve(false);
      }
    }, 5000);
  });
}

function createPeer() {
  const connection = new RTCPeerConnection({ iceServers: [] });
  connection.addEventListener('icecandidate', (event) => {
    if (event.candidate) send({ type: 'ice', candidate: event.candidate });
  });
  connection.addEventListener('connectionstatechange', () => {
    clearTimeout(disconnectTimer);
    if (connection.connectionState === 'connected') {
      setStatus('sharing', 'Połączono z odbiornikiem', 'Uruchamiam obraz na odbiorniku…');
    } else if (connection.connectionState === 'failed') {
      stopSharing(true, 'Połączenie WebRTC nie powiodło się.');
    } else if (connection.connectionState === 'disconnected') {
      disconnectTimer = setTimeout(() => {
        if (connection.connectionState === 'disconnected') {
          stopSharing(true, 'Połączenie z odbiornikiem zostało przerwane.');
        }
      }, 5000);
    }
  });
  return connection;
}

async function startSharing() {
  if (sharing || !receiverOnline || presenterActive) return;
  buttonLabel.textContent = 'Wybierz ekran…';
  shareButton.disabled = true;
  setStatus('connecting', 'Wybierz ekran lub okno', 'Windows pokaże bezpieczne okno wyboru.');

  const claimPromise = claimPresenter();
  let capturedStream;
  try {
    capturedStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: shareAudio.checked
    });
  } catch (error) {
    send({ type: 'release' });
    buttonLabel.textContent = 'Udostępnij ekran';
    if (error.name === 'NotAllowedError') {
      setStatus('ready', 'Udostępnianie anulowane', 'Możesz spróbować ponownie.');
    } else {
      setStatus('error', 'Nie można przechwycić ekranu', error.message);
    }
    updateControls();
    return;
  }

  const claimed = await claimPromise;
  if (!claimed) {
    capturedStream.getTracks().forEach((track) => track.stop());
    buttonLabel.textContent = 'Udostępnij ekran';
    updateControls();
    return;
  }

  sharing = true;
  mediaStream = capturedStream;
  peer = createPeer();
  for (const track of mediaStream.getTracks()) peer.addTrack(track, mediaStream);
  mediaStream.getVideoTracks()[0].addEventListener('ended', () => stopSharing(true));
  updateControls();
  setStatus('connecting', 'Łączenie z odbiornikiem…', 'Wybrany obraz za chwilę pojawi się na odbiorniku.');

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    send({ type: 'offer', offer: peer.localDescription });
  } catch (error) {
    stopSharing(true, `Błąd połączenia: ${error.message}`);
  }
}

function stopSharing(notify = true, message = '') {
  if (notify) send({ type: 'hangup' });
  clearTimeout(disconnectTimer);
  if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
  if (peer) peer.close();
  mediaStream = null;
  peer = null;
  pendingIce.length = 0;
  sharing = false;
  youAreActive = false;
  presenterActive = false;
  buttonLabel.textContent = 'Udostępnij ekran';
  updateControls();
  if (message) setStatus('error', 'Prezentacja zakończona', message);
}

shareButton.addEventListener('click', startSharing);
stopButton.addEventListener('click', () => stopSharing(true));
window.addEventListener('beforeunload', () => {
  if (sharing) send({ type: 'hangup' });
  if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
});

if (!window.isSecureContext && location.protocol === 'http:') {
  // Brak polityki przeglądarki dla tego adresu — wróć do HTTPS (wymaga certyfikatu).
  fetch('/api/info')
    .then((response) => response.json())
    .then((info) => location.replace(`${info.httpsUrl}${location.pathname}${location.search}`))
    .catch(() => setStatus('error', 'Brak połączenia z odbiornikiem', 'Odśwież stronę.'));
} else if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
  setStatus('error', 'Wymagane bezpieczne połączenie HTTPS', 'Zainstaluj certyfikat odbiornika zgodnie z instrukcją administratora.');
  shareButton.disabled = true;
} else {
  connect();
}
