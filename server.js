const express = require('express');
const path = require('path');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');
const app = express();
const http = require('http').createServer(app);

// --- CONFIGURATION ---
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
const whiteboardHistory = {};
const roomTodos = {}; // ← ADDED

// 1. CREATE ROOM ENDPOINT
app.get('/api/create-room', (req, res) => {
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

    // Send Timer (full state if exists)
    const state = roomTimers[roomId];
    if (state) {
      const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
      const remaining = Math.max(state.remaining - elapsed, 0);

      // Emit a full timer-state so new joiners know if the timer is running / paused
      socket.emit('timer-state', {
        mode: state.mode,
        time: remaining,
        isRunning: !!state.intervalId,
        paused: !!state.paused,
        loop: !!state.loop,
        studyDuration: state.studyDuration,
        breakDuration: state.breakDuration
      });
    }

    // Send Video Sync
    const videoState = roomVideos[roomId];
    if (videoState) {
      let currentSeek = videoState.timestamp;
      if (videoState.isPlaying) {
        const elapsedSeconds = (Date.now() - videoState.lastUpdated) / 1000;
        currentSeek += elapsedSeconds;
      }
      currentSeek = Math.max(0, currentSeek);

      console.log('📤 Sending sync to new user:', {
        videoId: videoState.videoId,
        isPlaying: videoState.isPlaying,
        seekTime: currentSeek,
        stored: videoState.timestamp,
        elapsed: videoState.isPlaying ? (Date.now() - videoState.lastUpdated) / 1000 : 0
      });

      socket.emit('video-sync-join', {
        videoId: videoState.videoId,
        isPlaying: videoState.isPlaying,
        seekTime: currentSeek
      });
    }

    // Send Whiteboard History
    if (whiteboardHistory[roomId]) {
      socket.emit('load-history', whiteboardHistory[roomId]);
    }

    // Send Todos ← ADDED
    if (roomTodos[roomId]) {
      socket.emit('todos-updated', { todos: roomTodos[roomId] });
    }
  });

  // --- LIVEKIT TOKEN GENERATION ---
  socket.on('get-livekit-token', async ({ roomId, userName }) => {
    if (!roomId) return;

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: userName,
    });

    at.addGrant({ roomJoin: true, room: roomId });
    const token = await at.toJwt();

    console.log("🔑 Generated Token for", userName);
    socket.emit('livekit-token', token);
  });

  // 2. VIDEO REQUEST (Backup)
  socket.on('request-video-state', (roomId) => {
    const videoState = roomVideos[roomId];
    if (videoState) {
      let currentSeek = videoState.timestamp;
      if (videoState.isPlaying) {
        const elapsedSeconds = (Date.now() - videoState.lastUpdated) / 1000;
        currentSeek += elapsedSeconds;
      }
      currentSeek = Math.max(0, currentSeek);

      console.log('📤 Sending sync (requested):', {
        videoId: videoState.videoId,
        isPlaying: videoState.isPlaying,
        seekTime: currentSeek,
        storedTime: videoState.timestamp,
        elapsedSinceUpdate: videoState.isPlaying ? (Date.now() - videoState.lastUpdated) / 1000 : 0
      });

      socket.emit('video-sync-join', {
        videoId: videoState.videoId,
        isPlaying: videoState.isPlaying,
        seekTime: currentSeek
      });
    } else {
      console.log('📭 No video state to send');
    }
  });

  // 3. CHAT
  socket.on('chat-message', ({ roomId, message, sender }) => {
    const msg = { sender: sender || 'Anonymous', message };

    if (!chatHistory[roomId]) chatHistory[roomId] = [];
    chatHistory[roomId].push(msg);

    io.to(roomId).emit('chat-message', msg);
  });

  // 4. LOAD VIDEO
  socket.on('video-load', ({ roomId, videoId }) => {
    console.log('📥 Video load request:', videoId);

    roomVideos[roomId] = {
      videoId,
      isPlaying: true,
      timestamp: 0,
      lastUpdated: Date.now()
    };

    io.to(roomId).emit('video-load', videoId);
  });

  // 5. VIDEO CLEAR
  socket.on('video-clear', (roomId) => {
    console.log('📥 Video clear request');

    if (roomVideos[roomId]) delete roomVideos[roomId];
    io.to(roomId).emit('video-clear');
  });

  // 6. VIDEO ACTION
  socket.on('video-action', ({ roomId, action, time }) => {
    if (!roomVideos[roomId]) {
      console.warn('⚠️ Video action for unknown room, creating state');
      roomVideos[roomId] = {
        videoId: null,
        isPlaying: false,
        timestamp: 0,
        lastUpdated: Date.now()
      };
    }

    console.log('📥 Video action:', action, 'at', time);

    roomVideos[roomId].isPlaying = (action === 'play');
    roomVideos[roomId].timestamp = time;
    roomVideos[roomId].lastUpdated = Date.now();

    socket.to(roomId).emit('video-action', { action, time });
  });

  // 7. TIMER
  socket.on('start-timer', ({ roomId, studyDuration, breakDuration, loop }) => {
    if (roomTimers[roomId]?.intervalId) clearInterval(roomTimers[roomId].intervalId);
    const startTime = Date.now();
    roomTimers[roomId] = {
      mode: 'study',
      remaining: Number(studyDuration),
      studyDuration: Number(studyDuration),
      breakDuration: Number(breakDuration),
      loop: !!loop,
      startTime,
      intervalId: null,
      paused: false
    };

    const tick = () => {
      if (!roomTimers[roomId] || roomTimers[roomId].paused) return;
      const elapsed = Math.floor((Date.now() - roomTimers[roomId].startTime) / 1000);
      const timeLeft = Math.max(roomTimers[roomId].remaining - elapsed, 0);
      io.to(roomId).emit('timer-update', { mode: roomTimers[roomId].mode, time: timeLeft });

      if (timeLeft <= 0) {
        const currentMode = roomTimers[roomId].mode;

        // Emit phase complete event for beep sound
        io.to(roomId).emit('timer-phase-complete', { mode: currentMode });
        io.to(roomId).emit('timer-end', currentMode);

        const isStudy = currentMode === 'study';

        // Stop timer if break ended and loop is disabled
        if (!isStudy && !roomTimers[roomId].loop) {
          clearInterval(roomTimers[roomId].intervalId);
          delete roomTimers[roomId];
          io.to(roomId).emit('timer-reset');

          // explicit state broadcast so UI shows set-timer for everyone
          io.to(roomId).emit('timer-state', {
            mode: 'study',
            time: 25 * 60,
            isRunning: false,
            paused: false,
            loop: false
          });
          return;
        }

        // Switch mode
        roomTimers[roomId].mode = isStudy ? 'break' : 'study';
        roomTimers[roomId].remaining = isStudy
          ? roomTimers[roomId].breakDuration
          : roomTimers[roomId].studyDuration;
        roomTimers[roomId].startTime = Date.now();

        // After switching mode, broadcast new state so everyone sees the change immediately
        const elapsedAfterSwitch = 0;
        const timeLeftAfterSwitch = Math.max(roomTimers[roomId].remaining - elapsedAfterSwitch, 0);
        io.to(roomId).emit('timer-state', {
          mode: roomTimers[roomId].mode,
          time: timeLeftAfterSwitch,
          isRunning: true,
          paused: false,
          loop: roomTimers[roomId].loop
        });
      }
    };

    roomTimers[roomId].intervalId = setInterval(tick, 1000);
    tick();

    // broadcast started + explicit state
    io.to(roomId).emit('timer-started');
    io.to(roomId).emit('timer-state', {
      mode: roomTimers[roomId].mode,
      time: roomTimers[roomId].remaining,
      isRunning: true,
      paused: false,
      loop: roomTimers[roomId].loop
    });
  });

  socket.on('pause-timer', ({ roomId }) => {
    if (roomTimers[roomId] && !roomTimers[roomId].paused) {
      const elapsed = Math.floor((Date.now() - roomTimers[roomId].startTime) / 1000);
      roomTimers[roomId].remaining = Math.max(roomTimers[roomId].remaining - elapsed, 0);
      roomTimers[roomId].paused = true;
      io.to(roomId).emit('timer-paused');

      // broadcast unified state
      io.to(roomId).emit('timer-state', {
        mode: roomTimers[roomId].mode,
        time: roomTimers[roomId].remaining,
        isRunning: !!roomTimers[roomId].intervalId,
        paused: true,
        loop: roomTimers[roomId].loop
      });
    }
  });

  socket.on('resume-timer', ({ roomId }) => {
    if (roomTimers[roomId] && roomTimers[roomId].paused) {
      roomTimers[roomId].startTime = Date.now();
      roomTimers[roomId].paused = false;
      io.to(roomId).emit('timer-resumed');

      // broadcast unified state
      io.to(roomId).emit('timer-state', {
        mode: roomTimers[roomId].mode,
        time: roomTimers[roomId].remaining,
        isRunning: true,
        paused: false,
        loop: roomTimers[roomId].loop
      });
    }
  });

  socket.on('reset-timer', ({ roomId }) => {
    if (roomTimers[roomId]) {
      clearInterval(roomTimers[roomId].intervalId);
      delete roomTimers[roomId];
      io.to(roomId).emit('timer-reset');
      // broadcast explicit reset state (everyone should show set-timer view)
      io.to(roomId).emit('timer-state', {
        mode: 'study',
        time: 25 * 60,
        isRunning: false,
        paused: false,
        loop: false
      });
    } else {
      // still broadcast a reset state to ensure UI consistency for everyone
      io.to(roomId).emit('timer-state', {
        mode: 'study',
        time: 25 * 60,
        isRunning: false,
        paused: false,
        loop: false
      });
    }
  });

  // 8. WHITEBOARD
  socket.on('draw-line', (data) => {
    const { roomId } = data;
    if (!whiteboardHistory[roomId]) whiteboardHistory[roomId] = [];
    whiteboardHistory[roomId].push(data);
    socket.to(roomId).emit('draw-line', data);
  });

  socket.on('clear-board', ({ roomId }) => {
    if (whiteboardHistory[roomId]) whiteboardHistory[roomId] = [];
    socket.to(roomId).emit('clear-board');
  });

  // 9. TODO LIST ← ADDED
  socket.on('get-todos', ({ roomId }) => {
    if (!roomTodos[roomId]) roomTodos[roomId] = [];
    socket.emit('todos-updated', { todos: roomTodos[roomId] });
  });

  socket.on('add-todo', ({ roomId, todo }) => {
    if (!roomTodos[roomId]) roomTodos[roomId] = [];

    const newTodo = {
      id: Date.now() + Math.random(),
      text: todo.text,
      completed: false,
      createdBy: socket.id,
      createdAt: Date.now()
    };

    roomTodos[roomId].push(newTodo);
    io.to(roomId).emit('todos-updated', { todos: roomTodos[roomId] });
    console.log(`✅ Todo added in room ${roomId}:`, newTodo.text);
  });

  socket.on('toggle-todo', ({ roomId, todoId }) => {
    if (!roomTodos[roomId]) return;

    const todo = roomTodos[roomId].find(t => t.id === todoId);
    if (todo) {
      todo.completed = !todo.completed;
      io.to(roomId).emit('todos-updated', { todos: roomTodos[roomId] });
      console.log(`✅ Todo toggled in room ${roomId}`);
    }
  });

  socket.on('delete-todo', ({ roomId, todoId }) => {
    if (!roomTodos[roomId]) return;

    roomTodos[roomId] = roomTodos[roomId].filter(t => t.id !== todoId);
    io.to(roomId).emit('todos-updated', { todos: roomTodos[roomId] });
    console.log(`🗑️ Todo deleted from room ${roomId}`);
  });

  // 10. CLEANUP
  socket.on('disconnecting', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = io.sockets.adapter.rooms.get(roomId);
    if (!room || room.size <= 1) {
      roomCleanupTimers[roomId] = setTimeout(() => {
        console.log('🧹 Cleaning up room:', roomId);
        if (roomTimers[roomId]) {
          clearInterval(roomTimers[roomId].intervalId);
          delete roomTimers[roomId];
        }
        delete chatHistory[roomId];
        delete roomVideos[roomId];
        delete whiteboardHistory[roomId];
        delete roomTodos[roomId]; // ← ADDED
        delete roomCleanupTimers[roomId];
      }, 5000);
    }
  });
});

http.listen(port, () => console.log(`✅ Server running at http://localhost:${port}`));
