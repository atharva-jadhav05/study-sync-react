require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');
const { nanoid } = require('nanoid');

const app = express();
const http = require('http').createServer(app);

// --- CONFIGURATION FROM ENVIRONMENT ---
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173'];

// Validate required environment variables
if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('❌ FATAL ERROR: Missing required environment variables!');
  console.error('Please set LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env file');
  console.error('Copy .env.example to .env and add your credentials');
  process.exit(1);
}

console.log('✅ Environment variables loaded successfully');
console.log(`📡 CORS allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
console.log(`🔧 Environment: ${NODE_ENV}`);

// --- MIDDLEWARE ---
app.use(cors({ 
  origin: ALLOWED_ORIGINS, 
  methods: ["GET", "POST"],
  credentials: true
}));

const io = require('socket.io')(http, {
  cors: { 
    origin: ALLOWED_ORIGINS, 
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// --- MEMORY STORAGE ---
const roomTimers = {};
const chatHistory = {};
const roomVideos = {};
const roomCleanupTimers = {};
const whiteboardHistory = {};
const roomTodos = {};

// Configuration constants
const MAX_CHAT_HISTORY = 1000;
const MAX_WHITEBOARD_HISTORY = 10000;
const ROOM_CLEANUP_DELAY = 5000;

// --- HEALTH CHECK ENDPOINT ---
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    activeRooms: Object.keys(chatHistory).length,
    environment: NODE_ENV,
    version: '1.0.0'
  });
});

// --- CREATE ROOM ENDPOINT ---
app.get('/api/create-room', (req, res) => {
  try {
    const roomId = nanoid(10); // Secure random ID
    console.log('🎉 New room created:', roomId);
    res.json({ roomId });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// --- SOCKET.IO CONNECTION ---
io.on('connection', (socket) => {
  console.log('👤 Client connected:', socket.id);

  // 1. JOIN ROOM
  socket.on('join-room', (roomId) => {
    try {
      if (!roomId || typeof roomId !== 'string') {
        socket.emit('error', { message: 'Invalid room ID' });
        return;
      }

      // Cancel cleanup if room was about to be cleaned
      if (roomCleanupTimers[roomId]) {
        clearTimeout(roomCleanupTimers[roomId]);
        delete roomCleanupTimers[roomId];
      }

      socket.join(roomId);
      socket.roomId = roomId;
      console.log(`📥 ${socket.id} joined room: ${roomId}`);

      // Send chat history
      if (chatHistory[roomId]) {
        chatHistory[roomId].forEach(msg => socket.emit('chat-message', msg));
      }

      // Send timer state
      const timerState = roomTimers[roomId];
      if (timerState) {
        const elapsed = Math.floor((Date.now() - timerState.startTime) / 1000);
        const remaining = Math.max(timerState.remaining - elapsed, 0);

        socket.emit('timer-state', {
          mode: timerState.mode,
          time: remaining,
          isRunning: !!timerState.intervalId,
          paused: !!timerState.paused,
          loop: !!timerState.loop,
          studyDuration: timerState.studyDuration,
          breakDuration: timerState.breakDuration
        });
      }

      // Send video state
      const videoState = roomVideos[roomId];
      if (videoState) {
        let currentSeek = videoState.timestamp;
        if (videoState.isPlaying) {
          const elapsedSeconds = (Date.now() - videoState.lastUpdated) / 1000;
          currentSeek += elapsedSeconds;
        }
        currentSeek = Math.max(0, currentSeek);

        console.log('📤 Sending video sync:', {
          videoId: videoState.videoId,
          isPlaying: videoState.isPlaying,
          seekTime: currentSeek
        });

        socket.emit('video-sync-join', {
          videoId: videoState.videoId,
          isPlaying: videoState.isPlaying,
          seekTime: currentSeek
        });
      }

      // Send whiteboard history
      if (whiteboardHistory[roomId]) {
        socket.emit('load-history', whiteboardHistory[roomId]);
      }

      // Send todos
      if (roomTodos[roomId]) {
        socket.emit('todos-updated', { todos: roomTodos[roomId] });
      }

    } catch (error) {
      console.error('Error in join-room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // 2. LIVEKIT TOKEN GENERATION
  socket.on('get-livekit-token', async ({ roomId, userName }) => {
    try {
      if (!roomId || !userName) {
        socket.emit('error', { message: 'Missing roomId or userName' });
        return;
      }

      // Sanitize userName
      const sanitizedUserName = userName.trim().substring(0, 50);

      const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: sanitizedUserName,
      });

      at.addGrant({ roomJoin: true, room: roomId });
      const token = await at.toJwt();

      console.log(`🔑 Token generated for "${sanitizedUserName}" in room ${roomId}`);
      socket.emit('livekit-token', token);
    } catch (error) {
      console.error('❌ Token generation failed:', error);
      socket.emit('error', { message: 'Failed to generate access token' });
    }
  });

  // 3. VIDEO STATE REQUEST
  socket.on('request-video-state', (roomId) => {
    try {
      if (!roomId) return;

      const videoState = roomVideos[roomId];
      if (videoState) {
        let currentSeek = videoState.timestamp;
        if (videoState.isPlaying) {
          const elapsedSeconds = (Date.now() - videoState.lastUpdated) / 1000;
          currentSeek += elapsedSeconds;
        }
        currentSeek = Math.max(0, currentSeek);

        socket.emit('video-sync-join', {
          videoId: videoState.videoId,
          isPlaying: videoState.isPlaying,
          seekTime: currentSeek
        });
      }
    } catch (error) {
      console.error('Error in request-video-state:', error);
    }
  });

  // 4. CHAT
  socket.on('chat-message', ({ roomId, message, sender }) => {
    try {
      if (!roomId || !message || !sender) return;

      // Sanitize inputs
      const sanitizedMessage = message.trim().substring(0, 500);
      const sanitizedSender = sender.trim().substring(0, 20);

      if (!sanitizedMessage) return;

      const msg = { 
        sender: sanitizedSender, 
        message: sanitizedMessage,
        timestamp: Date.now()
      };

      if (!chatHistory[roomId]) chatHistory[roomId] = [];
      
      // Limit chat history to prevent memory bloat
      if (chatHistory[roomId].length >= MAX_CHAT_HISTORY) {
        chatHistory[roomId].shift(); // Remove oldest message
      }
      
      chatHistory[roomId].push(msg);
      io.to(roomId).emit('chat-message', msg);
    } catch (error) {
      console.error('Error in chat-message:', error);
    }
  });

  // 5. VIDEO LOAD
  socket.on('video-load', ({ roomId, videoId }) => {
    try {
      if (!roomId || !videoId) return;

      // Validate YouTube video ID format (11 characters, alphanumeric + _ -)
      if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        socket.emit('error', { message: 'Invalid YouTube video ID' });
        return;
      }

      roomVideos[roomId] = {
        videoId,
        isPlaying: true,
        timestamp: 0,
        lastUpdated: Date.now()
      };

      io.to(roomId).emit('video-load', videoId);
      console.log(`📺 Video loaded in room ${roomId}: ${videoId}`);
    } catch (error) {
      console.error('Error in video-load:', error);
    }
  });

  // 6. VIDEO CLEAR
  socket.on('video-clear', (roomId) => {
    try {
      if (!roomId) return;
      
      if (roomVideos[roomId]) {
        delete roomVideos[roomId];
      }
      
      io.to(roomId).emit('video-clear');
      console.log(`🗑️ Video cleared in room ${roomId}`);
    } catch (error) {
      console.error('Error in video-clear:', error);
    }
  });

  // 7. VIDEO ACTION
  socket.on('video-action', ({ roomId, action, time }) => {
    try {
      if (!roomId || !action) return;

      if (!roomVideos[roomId]) {
        roomVideos[roomId] = {
          videoId: null,
          isPlaying: false,
          timestamp: 0,
          lastUpdated: Date.now()
        };
      }

      roomVideos[roomId].isPlaying = (action === 'play');
      roomVideos[roomId].timestamp = Math.max(0, time || 0);
      roomVideos[roomId].lastUpdated = Date.now();

      socket.to(roomId).emit('video-action', { action, time });
    } catch (error) {
      console.error('Error in video-action:', error);
    }
  });

  // 8. START TIMER
  socket.on('start-timer', ({ roomId, studyDuration, breakDuration, loop }) => {
    try {
      if (!roomId) return;

      // Clear existing timer
      if (roomTimers[roomId]?.intervalId) {
        clearInterval(roomTimers[roomId].intervalId);
      }

      const startTime = Date.now();
      roomTimers[roomId] = {
        mode: 'study',
        remaining: Number(studyDuration) || 1500,
        studyDuration: Number(studyDuration) || 1500,
        breakDuration: Number(breakDuration) || 300,
        loop: !!loop,
        startTime,
        intervalId: null,
        paused: false
      };

      const tick = () => {
        if (!roomTimers[roomId] || roomTimers[roomId].paused) return;
        
        const elapsed = Math.floor((Date.now() - roomTimers[roomId].startTime) / 1000);
        const timeLeft = Math.max(roomTimers[roomId].remaining - elapsed, 0);
        
        io.to(roomId).emit('timer-update', { 
          mode: roomTimers[roomId].mode, 
          time: timeLeft 
        });

        if (timeLeft <= 0) {
          const currentMode = roomTimers[roomId].mode;
          io.to(roomId).emit('timer-phase-complete', { mode: currentMode });
          
          const isStudy = currentMode === 'study';
          
          // Stop if break ended and no loop
          if (!isStudy && !roomTimers[roomId].loop) {
            clearInterval(roomTimers[roomId].intervalId);
            delete roomTimers[roomId];
            io.to(roomId).emit('timer-reset');
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

          io.to(roomId).emit('timer-state', {
            mode: roomTimers[roomId].mode,
            time: roomTimers[roomId].remaining,
            isRunning: true,
            paused: false,
            loop: roomTimers[roomId].loop
          });
        }
      };

      roomTimers[roomId].intervalId = setInterval(tick, 1000);
      tick();

      io.to(roomId).emit('timer-started');
      io.to(roomId).emit('timer-state', {
        mode: roomTimers[roomId].mode,
        time: roomTimers[roomId].remaining,
        isRunning: true,
        paused: false,
        loop: roomTimers[roomId].loop
      });

      console.log(`⏱️ Timer started in room ${roomId} (${studyDuration}s study, ${breakDuration}s break)`);
    } catch (error) {
      console.error('Error in start-timer:', error);
    }
  });

  // 9. PAUSE TIMER
  socket.on('pause-timer', ({ roomId }) => {
    try {
      if (!roomId || !roomTimers[roomId]) return;

      if (!roomTimers[roomId].paused) {
        const elapsed = Math.floor((Date.now() - roomTimers[roomId].startTime) / 1000);
        roomTimers[roomId].remaining = Math.max(roomTimers[roomId].remaining - elapsed, 0);
        roomTimers[roomId].paused = true;
        
        io.to(roomId).emit('timer-paused');
        io.to(roomId).emit('timer-state', {
          mode: roomTimers[roomId].mode,
          time: roomTimers[roomId].remaining,
          isRunning: !!roomTimers[roomId].intervalId,
          paused: true,
          loop: roomTimers[roomId].loop
        });

        console.log(`⏸️ Timer paused in room ${roomId}`);
      }
    } catch (error) {
      console.error('Error in pause-timer:', error);
    }
  });

  // 10. RESUME TIMER
  socket.on('resume-timer', ({ roomId }) => {
    try {
      if (!roomId || !roomTimers[roomId]) return;

      if (roomTimers[roomId].paused) {
        roomTimers[roomId].startTime = Date.now();
        roomTimers[roomId].paused = false;
        
        io.to(roomId).emit('timer-resumed');
        io.to(roomId).emit('timer-state', {
          mode: roomTimers[roomId].mode,
          time: roomTimers[roomId].remaining,
          isRunning: true,
          paused: false,
          loop: roomTimers[roomId].loop
        });

        console.log(`▶️ Timer resumed in room ${roomId}`);
      }
    } catch (error) {
      console.error('Error in resume-timer:', error);
    }
  });

  // 11. RESET TIMER
  socket.on('reset-timer', ({ roomId }) => {
    try {
      if (!roomId) return;

      if (roomTimers[roomId]) {
        clearInterval(roomTimers[roomId].intervalId);
        delete roomTimers[roomId];
      }
      
      io.to(roomId).emit('timer-reset');
      io.to(roomId).emit('timer-state', {
        mode: 'study',
        time: 25 * 60,
        isRunning: false,
        paused: false,
        loop: false
      });

      console.log(`🔄 Timer reset in room ${roomId}`);
    } catch (error) {
      console.error('Error in reset-timer:', error);
    }
  });

  // 12. WHITEBOARD - DRAW
  socket.on('draw-line', (data) => {
    try {
      const { roomId } = data;
      if (!roomId) return;

      if (!whiteboardHistory[roomId]) {
        whiteboardHistory[roomId] = [];
      }
      
      // Limit whiteboard history to prevent memory issues
      if (whiteboardHistory[roomId].length >= MAX_WHITEBOARD_HISTORY) {
        whiteboardHistory[roomId].shift(); // Remove oldest
        console.log(`⚠️ Whiteboard history limit reached in room ${roomId}, removing oldest entry`);
      }
      
      whiteboardHistory[roomId].push(data);
      socket.to(roomId).emit('draw-line', data);
    } catch (error) {
      console.error('Error in draw-line:', error);
    }
  });

  // 13. WHITEBOARD - CLEAR
  socket.on('clear-board', ({ roomId }) => {
    try {
      if (!roomId) return;

      if (whiteboardHistory[roomId]) {
        whiteboardHistory[roomId] = [];
      }
      
      socket.to(roomId).emit('clear-board');
      console.log(`🎨 Whiteboard cleared in room ${roomId}`);
    } catch (error) {
      console.error('Error in clear-board:', error);
    }
  });

  // 14. TODO - GET
  socket.on('get-todos', ({ roomId }) => {
    try {
      if (!roomId) return;

      if (!roomTodos[roomId]) {
        roomTodos[roomId] = [];
      }
      
      socket.emit('todos-updated', { todos: roomTodos[roomId] });
    } catch (error) {
      console.error('Error in get-todos:', error);
    }
  });

  // 15. TODO - ADD
  socket.on('add-todo', ({ roomId, todo }) => {
    try {
      if (!roomId || !todo || !todo.text) return;

      const sanitizedText = todo.text.trim().substring(0, 100);
      if (!sanitizedText) return;

      if (!roomTodos[roomId]) {
        roomTodos[roomId] = [];
      }

      const newTodo = {
        id: Date.now() + Math.random(),
        text: sanitizedText,
        completed: false,
        createdBy: socket.id,
        createdAt: Date.now()
      };

      roomTodos[roomId].push(newTodo);
      io.to(roomId).emit('todos-updated', { todos: roomTodos[roomId] });
      console.log(`✅ Todo added in room ${roomId}: "${sanitizedText}"`);
    } catch (error) {
      console.error('Error in add-todo:', error);
    }
  });

  // 16. TODO - TOGGLE
  socket.on('toggle-todo', ({ roomId, todoId }) => {
    try {
      if (!roomId || !todoId) return;
      if (!roomTodos[roomId]) return;

      const todo = roomTodos[roomId].find(t => t.id === todoId);
      if (todo) {
        todo.completed = !todo.completed;
        io.to(roomId).emit('todos-updated', { todos: roomTodos[roomId] });
        console.log(`✅ Todo toggled in room ${roomId}`);
      }
    } catch (error) {
      console.error('Error in toggle-todo:', error);
    }
  });

  // 17. TODO - DELETE
  socket.on('delete-todo', ({ roomId, todoId }) => {
    try {
      if (!roomId || !todoId) return;
      if (!roomTodos[roomId]) return;

      roomTodos[roomId] = roomTodos[roomId].filter(t => t.id !== todoId);
      io.to(roomId).emit('todos-updated', { todos: roomTodos[roomId] });
      console.log(`🗑️ Todo deleted from room ${roomId}`);
    } catch (error) {
      console.error('Error in delete-todo:', error);
    }
  });

  // 18. DISCONNECT HANDLER
  socket.on('disconnecting', () => {
    try {
      const roomId = socket.roomId;
      if (!roomId) return;

      console.log(`👋 ${socket.id} disconnecting from room: ${roomId}`);

      const room = io.sockets.adapter.rooms.get(roomId);
      
      // If last person in room, schedule cleanup
      if (!room || room.size <= 1) {
        roomCleanupTimers[roomId] = setTimeout(() => {
          console.log(`🧹 Cleaning up empty room: ${roomId}`);
          
          // Clear timer interval
          if (roomTimers[roomId]?.intervalId) {
            clearInterval(roomTimers[roomId].intervalId);
          }
          
          // Delete all room data
          delete roomTimers[roomId];
          delete chatHistory[roomId];
          delete roomVideos[roomId];
          delete whiteboardHistory[roomId];
          delete roomTodos[roomId];
          delete roomCleanupTimers[roomId];
        }, ROOM_CLEANUP_DELAY);
      }
    } catch (error) {
      console.error('Error in disconnect:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('👤 Client disconnected:', socket.id);
  });
});

// --- GRACEFUL SHUTDOWN ---
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM signal received, shutting down gracefully...');
  
  // Clear all timer intervals
  Object.values(roomTimers).forEach(timer => {
    if (timer.intervalId) {
      clearInterval(timer.intervalId);
    }
  });
  
  // Clear all cleanup timers
  Object.values(roomCleanupTimers).forEach(timer => {
    clearTimeout(timer);
  });
  
  // Close server
  http.close(() => {
    console.log('✅ Server closed gracefully');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.error('❌ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT signal received, shutting down gracefully...');
  process.emit('SIGTERM');
});

// --- START SERVER ---
http.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🎓 Study Sync Server');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  🚀 Server:  http://localhost:${PORT}`);
  console.log(`  💚 Health:  http://localhost:${PORT}/health`);
  console.log(`  🔑 LiveKit: ${LIVEKIT_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  console.log(`  🌍 Mode:    ${NODE_ENV}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});