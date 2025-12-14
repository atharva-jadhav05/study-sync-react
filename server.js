const express = require('express');
const path = require('path');
const cors = require('cors'); 
const axios = require('axios'); // NEW: For talking to Daily.co
const app = express();
const http = require('http').createServer(app);

// --- CONFIGURATION ---
const DAILY_API_KEY = "73da74f9603b09d53589bf377c409547b2f2ba25f62212154b00c94622a6a6ff"; // <--- PASTE KEY HERE

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
const roomDailyUrls = {}; // NEW: Stores the video link for each room

// --- HELPER: Create Daily Room ---
async function createDailyRoom(roomId) {
  try {
    const response = await axios.post(
      'https://api.daily.co/v1/rooms',
      {
        name: `study-${roomId}`, // Unique name: study-o3pipg
        properties: {
          enable_chat: false, // We use our own chat
          start_video_off: false,
          start_audio_off: false,
          exp: Math.round(Date.now() / 1000) + 86400 // Expire in 24 hours
        }
      },
      {
        headers: {
          Authorization: `Bearer ${DAILY_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.url;
  } catch (error) {
    // If room already exists, we might get an error, but that's okay (user re-creating same room)
    // We can just log it.
    console.log("Daily API Note:", error.response?.data?.error || error.message);
    return null; 
  }
}

// 1. CREATE ROOM ENDPOINT
app.get('/api/create-room', async (req, res) => {
  const roomId = Math.random().toString(36).substr(2, 6);
  
  // Create the video room on Daily.co
  const dailyUrl = await createDailyRoom(roomId);
  
  // Even if API fails, we proceed (the video chat just won't work, but app won't crash)
  if (dailyUrl) {
    roomDailyUrls[roomId] = dailyUrl; 
  }
  
  res.json({ roomId, dailyUrl });
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

    // NEW: Send Video Chat URL to the joiner
    const dailyUrl = roomDailyUrls[roomId];
    if (dailyUrl) {
        socket.emit('daily-url', dailyUrl);
    }
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
        delete roomDailyUrls[roomId]; // Clean up the URL
        delete roomCleanupTimers[roomId];
      }, 5000);
    }
  });
});
   
http.listen(port, () => console.log(`✅ Server running at http://localhost:${port}`));