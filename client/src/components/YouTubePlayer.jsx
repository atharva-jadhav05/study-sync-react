import { useEffect, useRef, useState } from 'react';

// --- STABILITY CONFIGURATION ---
const FULLSCREEN_DEBOUNCE_MS = 250; 
const SYNC_LATENCY_SEC = 1.5;       // Relaxed: 1.5s buffer (prevents jumpiness)
const DRIFT_THRESHOLD = 2.0;        // Relaxed: Don't correct unless off by > 2.0s
const REMOTE_LOCK_MS = 1500;        

const YouTubePlayer = ({ socket, roomId }) => {
  const playerRef = useRef(null);
  const [inputUrl, setInputUrl] = useState('');
  const [isPlayingUI, setIsPlayingUI] = useState(false); 
  
  // --- MASTER STATE ---
  const shouldPlay = useRef(false);      
  const isRemote = useRef(false);
  const isBuffering = useRef(false); // NEW: Explicit Buffering Guard
  
  const pauseTimer = useRef(null); 
  const boxRef = useRef(null);
  const [size, setSize] = useState({ width: 450, height: 300 });

  // 1. INITIALIZE API
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }

    window.onYouTubeIframeAPIReady = () => {
      playerRef.current = new window.YT.Player('yt-player-frame', {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 1,
          mute: 1, 
          controls: 1, 
          modestbranding: 1,
          rel: 0
        },
        events: {
          onReady: onPlayerReady,
          onStateChange: onPlayerStateChange
        }
      });
    };

    if (window.YT && window.YT.Player && !playerRef.current) {
        window.onYouTubeIframeAPIReady();
    }
  }, []);

  // 2. THE STRONG ENFORCER (With Buffering Guard)
  useEffect(() => {
    const enforcer = setInterval(() => {
      if (!playerRef.current || !playerRef.current.getPlayerState) return;
      
      // CRITICAL FIX: If we are buffering, DO NOT TOUCH IT. Let it load.
      if (isRemote.current || isBuffering.current) return; 

      const state = playerRef.current.getPlayerState();
      
      if (shouldPlay.current) {
        // If not playing (1) and not buffering (3)
        if (state !== 1 && state !== 3) {
           playerRef.current.mute(); 
           playerRef.current.playVideo();
        }
      } else {
        if (state === 1) {
           playerRef.current.pauseVideo();
        }
      }
    }, 500); 

    return () => clearInterval(enforcer);
  }, []);

  // 3. SOCKET LISTENERS
  useEffect(() => {
    socket.on('video-sync-join', ({ videoId, isPlaying, seekTime }) => {
      if (!playerRef.current) return;

      isRemote.current = true;
      shouldPlay.current = isPlaying;
      setIsPlayingUI(isPlaying);

      // Safe sync: Add 1.5s to ensure we don't start in the past
      const adjustedTime = seekTime + (isPlaying ? SYNC_LATENCY_SEC : 0);

      playerRef.current.loadVideoById({
        videoId: videoId,
        startSeconds: adjustedTime
      });

      if (isPlaying) {
        playerRef.current.mute();
        playerRef.current.playVideo();
      } else {
        playerRef.current.pauseVideo();
      }
      
      setTimeout(() => { isRemote.current = false; }, REMOTE_LOCK_MS);
    });

    socket.on('video-load', (videoId) => {
      if (!playerRef.current) return;
      isRemote.current = true;
      shouldPlay.current = true; 
      setIsPlayingUI(true);

      playerRef.current.loadVideoById(videoId);
      playerRef.current.mute();
      playerRef.current.playVideo();

      setTimeout(() => { isRemote.current = false; }, REMOTE_LOCK_MS);
    });

    socket.on('video-action', ({ action, time }) => {
      if (!playerRef.current) return;
      if (pauseTimer.current) clearTimeout(pauseTimer.current);

      isRemote.current = true;

      // STABILITY FIX: Only seek if we are REALLY far off (> 2 seconds)
      const current = playerRef.current.getCurrentTime();
      if (Math.abs(current - time) > DRIFT_THRESHOLD) {
        playerRef.current.seekTo(time);
      }

      if (action === 'play') {
        shouldPlay.current = true;
        setIsPlayingUI(true);
        playerRef.current.playVideo();
      } else {
        shouldPlay.current = false;
        setIsPlayingUI(false);
        playerRef.current.pauseVideo();
      }

      setTimeout(() => { isRemote.current = false; }, 500);
    });

    return () => {
      socket.off('video-sync-join');
      socket.off('video-load');
      socket.off('video-action');
    };
  }, [socket]);

  // 4. HANDLERS
  const onPlayerReady = () => {
    socket.emit('request-video-state', roomId);
  };

  const onPlayerStateChange = (event) => {
    // STATE 3: BUFFERING -> LOCK EVERYTHING
    if (event.data === 3) {
      isBuffering.current = true;
      console.log("Buffering... holding logic.");
      return; 
    }
    
    // If we leave state 3, unlock
    if (isBuffering.current && event.data !== 3) {
      isBuffering.current = false;
    }

    if (isRemote.current) return;

    // --- PLAYING ---
    if (event.data === 1) {
      if (pauseTimer.current) {
        clearTimeout(pauseTimer.current);
        pauseTimer.current = null;
      }

      if (!shouldPlay.current) {
          shouldPlay.current = true;
          setIsPlayingUI(true);
          socket.emit('video-action', { roomId, action: 'play', time: playerRef.current.getCurrentTime() });
      }
    } 
    
    // --- PAUSED ---
    if (event.data === 2) {
      if (shouldPlay.current) {
         pauseTimer.current = setTimeout(() => {
             shouldPlay.current = false;
             setIsPlayingUI(false);
             socket.emit('video-action', { roomId, action: 'pause', time: playerRef.current.getCurrentTime() });
         }, FULLSCREEN_DEBOUNCE_MS);
      }
    }
  };

  // --- CONTROLS ---
  const toggleMasterPlay = () => {
    if (!playerRef.current) return;
    
    const newStatus = !shouldPlay.current;
    shouldPlay.current = newStatus;
    setIsPlayingUI(newStatus);
    
    if (pauseTimer.current) clearTimeout(pauseTimer.current);

    const time = playerRef.current.getCurrentTime();

    if (newStatus) {
        playerRef.current.playVideo();
        socket.emit('video-action', { roomId, action: 'play', time });
    } else {
        playerRef.current.pauseVideo();
        socket.emit('video-action', { roomId, action: 'pause', time });
    }
  };

  const handleLoadBtn = () => {
    const match = inputUrl.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
    const id = (match && match[2].length === 11) ? match[2] : null;
    if (id) socket.emit('video-load', { roomId, videoId: id });
  };

  const handleMouseDown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.width;
    const startH = size.height;
    
    const onMouseMove = (ev) => {
      setSize({
        width: Math.max(300, startW + (startX - ev.clientX)),
        height: Math.max(200, startH + (startY - ev.clientY))
      });
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className="youtube-box" ref={boxRef} style={{ width: size.width, height: size.height }}>
      <div className="resize-handle" onMouseDown={handleMouseDown}>📐</div>
      <div className="yt-controls">
         <input value={inputUrl} onChange={(e) => setInputUrl(e.target.value)} placeholder="Paste YouTube Link..." />
         <button 
            onClick={toggleMasterPlay} 
            style={{ backgroundColor: isPlayingUI ? '#444' : '#28a745', minWidth: '40px' }}
         >
            {isPlayingUI ? '⏸' : '▶'}
         </button>
         <button onClick={handleLoadBtn}>Load</button>
      </div>
      <div className="player-wrapper">
         <div id="yt-player-frame"></div>
      </div>
    </div>
  );
};

export default YouTubePlayer;