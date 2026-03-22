import { useEffect, useRef, useState } from 'react';
import './YouTubePlayer.css';

// --- STABILITY CONFIGURATION ---
const FULLSCREEN_DEBOUNCE_MS = 250;
const SYNC_LATENCY_SEC = 0.5;       // Even more conservative
const DRIFT_THRESHOLD = 2.0;
const REMOTE_LOCK_MS = 2000;        // Increased from 1500

const YouTubePlayer = ({ socket, roomId, onClose }) => {
  const playerRef = useRef(null);
  const [inputUrl, setInputUrl] = useState('');
  const [isPlayingUI, setIsPlayingUI] = useState(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  // --- MASTER STATE ---
  const shouldPlay = useRef(false);
  const isRemote = useRef(false);
  const isBuffering = useRef(false);
  const lastVideoId = useRef(null); // Track current video

  const pauseTimer = useRef(null);
  const boxRef = useRef(null);
  const [size, setSize] = useState({ width: 450, height: 300 });

  const pendingSyncRef = useRef(null);

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
          autoplay: 0,
          mute: 1,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          enablejsapi: 1
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
      if (!isVideoLoaded || !isPlayerReady) return;
      if (isRemote.current || isBuffering.current) return;

      const state = playerRef.current.getPlayerState();

      if (shouldPlay.current) {
        if (state !== 1 && state !== 3) {
          console.log('🔧 Enforcer: Playing video');
          playerRef.current.mute();
          playerRef.current.playVideo();
        }
      } else {
        if (state === 1) {
          console.log('🔧 Enforcer: Pausing video');
          playerRef.current.pauseVideo();
        }
      }
    }, 500);

    return () => clearInterval(enforcer);
  }, [isVideoLoaded, isPlayerReady]);

  // Helper function to safely load video
  const safeLoadVideo = (videoId, startTime, shouldAutoplay) => {
    if (!playerRef.current) return;

    console.log('🎬 Safe load:', { videoId, startTime, shouldAutoplay });
    lastVideoId.current = videoId;

    // First, stop any existing video
    try {
      playerRef.current.stopVideo();
    } catch (e) {
      console.log('Stop failed (ok if no video loaded)');
    }

    // Small delay to ensure stop completed
    setTimeout(() => {
      try {
        if (shouldAutoplay) {
          playerRef.current.loadVideoById({
            videoId: videoId,
            startSeconds: Math.max(0, startTime)
          });
          // Force unmute and play after load
          setTimeout(() => {
            if (playerRef.current) {
              playerRef.current.unMute();
              playerRef.current.playVideo();
            }
          }, 500);
        } else {
          playerRef.current.cueVideoById({
            videoId: videoId,
            startSeconds: Math.max(0, startTime)
          });
        }
      } catch (e) {
        console.error('Load failed:', e);
      }
    }, 100);
  };

  // 3. SOCKET LISTENERS
  useEffect(() => {
    socket.on('video-sync-join', ({ videoId, isPlaying, seekTime }) => {
      console.log('📥 Received sync:', { videoId, isPlaying, seekTime });

      if (!playerRef.current || !isPlayerReady) {
        console.warn('⚠️ Player not ready, storing sync data');
        pendingSyncRef.current = { videoId, isPlaying, seekTime };
        return;
      }

      isRemote.current = true;
      setIsVideoLoaded(true);
      shouldPlay.current = isPlaying;
      setIsPlayingUI(isPlaying);

      // More conservative time adjustment
      let adjustedTime = seekTime;
      if (isPlaying) {
        adjustedTime += SYNC_LATENCY_SEC;
      }
      adjustedTime = Math.max(0, adjustedTime);

      console.log('🎯 Loading video at:', adjustedTime);

      safeLoadVideo(videoId, adjustedTime, isPlaying);

      setTimeout(() => {
        isRemote.current = false;
        console.log('🔓 Remote lock released');
      }, REMOTE_LOCK_MS);
    });

    socket.on('video-load', (videoId) => {
      console.log('📥 Received video-load:', videoId);

      if (!playerRef.current || !isPlayerReady) {
        pendingSyncRef.current = { videoId, isPlaying: true, seekTime: 0 };
        return;
      }

      isRemote.current = true;
      setIsVideoLoaded(true);
      shouldPlay.current = true;
      setIsPlayingUI(true);

      safeLoadVideo(videoId, 0, true);

      setTimeout(() => {
        isRemote.current = false;
        console.log('🔓 Remote lock released');
      }, REMOTE_LOCK_MS);
    });

    socket.on('video-action', ({ action, time }) => {
      console.log('📥 Received action:', action, 'at', time);

      if (!playerRef.current || !isPlayerReady) return;
      if (pauseTimer.current) clearTimeout(pauseTimer.current);

      isRemote.current = true;

      try {
        const current = playerRef.current.getCurrentTime();
        const duration = playerRef.current.getDuration();

        let clampedTime = time;
        if (duration > 0) {
          clampedTime = Math.max(0, Math.min(time, duration - 0.5));
        }

        if (Math.abs(current - clampedTime) > DRIFT_THRESHOLD) {
          console.log('🔄 Seeking from', current, 'to', clampedTime);
          playerRef.current.seekTo(clampedTime, true);
        }

        if (action === 'play') {
          shouldPlay.current = true;
          setIsPlayingUI(true);
          playerRef.current.unMute();
          playerRef.current.playVideo();
        } else {
          shouldPlay.current = false;
          setIsPlayingUI(false);
          playerRef.current.pauseVideo();
        }
      } catch (e) {
        console.error('Action failed:', e);
      }

      setTimeout(() => {
        isRemote.current = false;
        console.log('🔓 Remote lock released (action)');
      }, 800);
    });

    socket.on('video-clear', () => {
      console.log('📥 Received video-clear');
      setIsVideoLoaded(false);
      setInputUrl('');
      shouldPlay.current = false;
      pendingSyncRef.current = null;
      lastVideoId.current = null;
      if (playerRef.current && playerRef.current.stopVideo) {
        try {
          playerRef.current.stopVideo();
        } catch (e) {
          console.log('Clear stop failed (ok)');
        }
      }
    });

    return () => {
      socket.off('video-sync-join');
      socket.off('video-load');
      socket.off('video-action');
      socket.off('video-clear');
    };
  }, [socket, isPlayerReady]);

  // 4. HANDLERS
  const onPlayerReady = () => {
    console.log('✅ Player ready');
    setIsPlayerReady(true);

    // Wait a bit before processing pending sync
    setTimeout(() => {
      if (pendingSyncRef.current) {
        console.log('🔄 Processing pending sync');
        const { videoId, isPlaying, seekTime } = pendingSyncRef.current;

        isRemote.current = true;
        setIsVideoLoaded(true);
        shouldPlay.current = isPlaying;
        setIsPlayingUI(isPlaying);

        let adjustedTime = seekTime;
        if (isPlaying) {
          adjustedTime += SYNC_LATENCY_SEC;
        }
        adjustedTime = Math.max(0, adjustedTime);

        safeLoadVideo(videoId, adjustedTime, isPlaying);

        pendingSyncRef.current = null;
        setTimeout(() => { isRemote.current = false; }, REMOTE_LOCK_MS);
      } else {
        // Request state from server
        console.log('📤 Requesting video state');
        socket.emit('request-video-state', roomId);
      }
    }, 500);
  };

  const onPlayerStateChange = (event) => {
    const stateNames = {
      '-1': 'UNSTARTED',
      '0': 'ENDED',
      '1': 'PLAYING',
      '2': 'PAUSED',
      '3': 'BUFFERING',
      '5': 'CUED'
    };
    console.log('🎬 State change:', stateNames[event.data] || event.data);

    // Handle buffering
    if (event.data === 3) {
      isBuffering.current = true;
      // If stuck buffering for too long, try to recover
      setTimeout(() => {
        if (isBuffering.current && playerRef.current) {
          console.log('⚠️ Buffering timeout, attempting recovery');
          try {
            if (shouldPlay.current) {
              playerRef.current.playVideo();
            }
          } catch (e) {
            console.error('Recovery failed:', e);
          }
        }
      }, 5000);
      return;
    }

    if (isBuffering.current && event.data !== 3) {
      isBuffering.current = false;
      console.log('✅ Buffering ended');
    }

    if (isRemote.current) {
      console.log('⏭️ Ignoring state change (remote locked)');
      return;
    }

    // Playing
    if (event.data === 1) {
      if (pauseTimer.current) {
        clearTimeout(pauseTimer.current);
        pauseTimer.current = null;
      }

      if (!shouldPlay.current) {
        shouldPlay.current = true;
        setIsPlayingUI(true);
        const currentTime = playerRef.current.getCurrentTime();
        console.log('📤 Emitting play at', currentTime);
        socket.emit('video-action', { roomId, action: 'play', time: currentTime });
      }
    }

    // Paused
    if (event.data === 2) {
      if (shouldPlay.current) {
        pauseTimer.current = setTimeout(() => {
          shouldPlay.current = false;
          setIsPlayingUI(false);
          const currentTime = playerRef.current.getCurrentTime();
          console.log('📤 Emitting pause at', currentTime);
          socket.emit('video-action', { roomId, action: 'pause', time: currentTime });
        }, FULLSCREEN_DEBOUNCE_MS);
      }
    }

    // Ended
    if (event.data === 0) {
      shouldPlay.current = false;
      setIsPlayingUI(false);
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
    console.log('📤 Manual toggle:', newStatus ? 'play' : 'pause', 'at', time);

    if (newStatus) {
      playerRef.current.unMute();
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
    if (id) {
      console.log('📤 Loading video:', id);
      setIsVideoLoaded(true);
      socket.emit('video-load', { roomId, videoId: id });
    } else {
      alert('Invalid YouTube URL');
    }
  };

  const handleClearBtn = () => {
    console.log('📤 Clearing video');
    setIsVideoLoaded(false);
    setInputUrl('');
    shouldPlay.current = false;
    pendingSyncRef.current = null;
    lastVideoId.current = null;
    if (playerRef.current) {
      try {
        playerRef.current.stopVideo();
      } catch (e) {
        console.log('Clear stop failed (ok)');
      }
    }
    socket.emit('video-clear', roomId);
  };

  const handleMouseDown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.width;
    const startH = size.height;

    const onMouseMove = (ev) => {
      setSize({
        width: Math.max(300, startW + (ev.clientX - startX)), // Drag Right -> Increase Width
        height: Math.max(100, startH + (startY - ev.clientY))  // Drag Up -> Increase Height
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
    <div className="youtube-box" ref={boxRef} style={{ width: size.width, height: isVideoLoaded ? size.height : 'auto' }}>
      <div className="resize-handle" onMouseDown={handleMouseDown}>
        <span>📐</span>
        {onClose && (
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="yt-close-btn"
            title="Close Popup"
          >
            ✕
          </button>
        )}
      </div>

      <div className="yt-controls">
        <input
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          placeholder="Paste YouTube Link..."
          onKeyPress={(e) => {
            if (e.key === 'Enter' && !isVideoLoaded) {
              handleLoadBtn();
            }
          }}
        />

        {isVideoLoaded ? (
          <>
            <button
              onClick={toggleMasterPlay}
              style={{ backgroundColor: isPlayingUI ? '#444' : '#28a745', minWidth: '40px' }}
            >
              {isPlayingUI ? '⏸' : '▶'}
            </button>
            <button onClick={handleClearBtn} style={{ backgroundColor: '#dc3545' }}>Clear</button>
          </>
        ) : (
          <button onClick={handleLoadBtn}>Load</button>
        )}
      </div>

      <div className="player-wrapper" style={{ display: isVideoLoaded ? 'block' : 'none', flexGrow: 1 }}>
        <div id="yt-player-frame"></div>
      </div>
    </div>
  );
};

export default YouTubePlayer;