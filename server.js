const express = require('express');
const path = require('path');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk'); // NEW: LiveKit SDK
const app = express();
const http = require('http').createServer(app);

// --- CONFIGURATION ---
// These match the keys shown in your terminal when running livekit-server --dev
const LIVEKIT_API_KEY = "devkey";
const LIVEKIT_API_SECRET = "secret";

app.use(cors({ origin: "http://localhost:5173", methods: ["GET", "POST"] }));

const io = require('socket.io')(http, {
  cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] }
});

const port = process.env.PORT || 3000;
console.log("✅ server.js is running");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// --- MEMORY STORAGE ---
const roomTimers = {};
const chatHistory = {};
const roomVideos = {};
const roomCleanupTimers = {};
// Note: We don't need roomDailyUrls anymore because LiveKit rooms are created on-demand

// 1. CREATE ROOM ENDPOINT (Simplified)
app.get('/api/create-room', (req, res) => {
  // We just generate an ID. The room is created automatically when the first person joins.
  const roomId = Math.random().toString(36).substr(2, 6);
  res.json({ roomId });
});

io.on('connection', (socket) => {

  // 1. JOIN ROOM
  socket.on('join-room', (roomId) => {
    if (roomCleanupTimers[roomId]) {
      clearTimeout(roomCleanupTimers[roomId]);
      delete roomCleanupTimers[roomId];
    }

    socket.join(roomId);
    socket.roomId = roomId;

    // Send Chat
    if (chatHistory[roomId]) chatHistory[roomId].forEach(msg => socket.emit('chat-message', msg));

    // Send Timer
    const state = roomTimers[roomId];
    if (state) {
      const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
      const remaining = Math.max(state.remaining - elapsed, 0);
      socket.emit('timer-update', { mode: state.mode, time: remaining });
    }

    // Send Video Sync
    const videoState = roomVideos[roomId];
    if (videoState) {
      let currentSeek = videoState.timestamp;
      if (videoState.isPlaying) {
        currentSeek += (Date.now() - videoState.lastUpdated) / 1000;
      }
      socket.emit('video-sync-join', {
        videoId: videoState.videoId,
        isPlaying: videoState.isPlaying,
        seekTime: currentSeek
      });
    }
  });

 // --- LIVEKIT TOKEN GENERATION ---
  // 👇 1. Add 'async' here
  socket.on('get-livekit-token', async ({ roomId, userName }) => {
    if (!roomId) return;
    
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: userName,
    });

    at.addGrant({ roomJoin: true, room: roomId });

    // 👇 2. Add 'await' here so the Promise finishes
    const token = await at.toJwt();
    
    console.log("🔑 Generated Token:", token); // This should now be a long string "eyJ..."

    // Send the plain string
    socket.emit('livekit-token', token);
  });
  // 2. VIDEO REQUEST (Backup)
  socket.on('request-video-state', (roomId) => {
    const videoState = roomVideos[roomId];
    if (videoState) {
      let currentSeek = videoState.timestamp;
      if (videoState.isPlaying) {
        currentSeek += (Date.now() - videoState.lastUpdated) / 1000;
      }
      socket.emit('video-sync-join', {
        videoId: videoState.videoId,
        isPlaying: videoState.isPlaying,
        seekTime: currentSeek
      });
    }
  });

  // 3. CHAT
  socket.on('chat-message', ({ roomId, message }) => {
    const msg = { sender: 'Anonymous', message };
    if (!chatHistory[roomId]) chatHistory[roomId] = [];
    chatHistory[roomId].push(msg);
    io.to(roomId).emit('chat-message', msg);
  });

  // 4. LOAD VIDEO
  socket.on('video-load', ({ roomId, videoId }) => {
    roomVideos[roomId] = { videoId, isPlaying: true, timestamp: 0, lastUpdated: Date.now() };
    io.to(roomId).emit('video-load', videoId);
  });

  // 5. VIDEO ACTION
  socket.on('video-action', ({ roomId, action, time }) => {
    if (!roomVideos[roomId]) return;
    roomVideos[roomId].isPlaying = (action === 'play');
    roomVideos[roomId].timestamp = time;
    roomVideos[roomId].lastUpdated = Date.now();
    socket.to(roomId).emit('video-action', { action, time });
  });

  // 6. TIMER
  socket.on('start-timer', ({ roomId, studyDuration, breakDuration, loop }) => {
    if (roomTimers[roomId]?.intervalId) clearInterval(roomTimers[roomId].intervalId);
    const startTime = Date.now();
    roomTimers[roomId] = {
      mode: 'study', remaining: Number(studyDuration), studyDuration: Number(studyDuration),
      breakDuration: Number(breakDuration), loop: !!loop, startTime, intervalId: null
    };
    const tick = () => {
      if (!roomTimers[roomId]) return;
      const elapsed = Math.floor((Date.now() - roomTimers[roomId].startTime) / 1000);
      const timeLeft = Math.max(roomTimers[roomId].remaining - elapsed, 0);
      io.to(roomId).emit('timer-update', { mode: roomTimers[roomId].mode, time: timeLeft });
      if (timeLeft <= 0) {
        io.to(roomId).emit('timer-end', roomTimers[roomId].mode);
        const isStudy = roomTimers[roomId].mode === 'study';
        if (!isStudy && !roomTimers[roomId].loop) {
          clearInterval(roomTimers[roomId].intervalId); delete roomTimers[roomId]; return;
        }
        roomTimers[roomId].mode = isStudy ? 'break' : 'study';
        roomTimers[roomId].remaining = isStudy ? roomTimers[roomId].breakDuration : roomTimers[roomId].studyDuration;
        roomTimers[roomId].startTime = Date.now();
      }
    };
    roomTimers[roomId].intervalId = setInterval(tick, 1000);
    tick();
  });

  // 7. CLEANUP
  socket.on('disconnecting', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = io.sockets.adapter.rooms.get(roomId);
    if (!room || room.size <= 1) {
      roomCleanupTimers[roomId] = setTimeout(() => {
        if (roomTimers[roomId]) { clearInterval(roomTimers[roomId].intervalId); delete roomTimers[roomId]; }
        delete chatHistory[roomId];
        delete roomVideos[roomId];
        delete roomCleanupTimers[roomId];
      }, 5000);
    }
  });
});

http.listen(port, () => console.log(`✅ Server running at http://localhost:${port}`));