// LandingPage.jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Mic, 
  MicOff, 
  Video, 
  VideoOff,
  Sparkles,
  ArrowRight,
  Loader2
} from 'lucide-react';
import './LandingPage.css';

const LandingPage = () => {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  
  // State for Inputs
  const [userName, setUserName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // State for Media
  const [stream, setStream] = useState(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Toast notification state
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  // Show toast notification
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 3000);
  };

  // Get User Media on Mount
  useEffect(() => {
    const startCamera = async () => {
      try {
        const userStream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        
        setStream(userStream);
        
        if (videoRef.current) {
          videoRef.current.srcObject = userStream;
        }
        
        setIsLoading(false);
      } catch (err) {
        console.error("Error accessing media:", err);
        showToast("Camera access denied. Please allow camera permissions.", "error");
        setIsLoading(false);
      }
    };

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Audio level detection for speaking indicator
  useEffect(() => {
    if (!stream || !isMicOn) {
      setIsSpeaking(false);
      return;
    }
    
    const audioContext = new AudioContext();
    const audioSource = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioSource.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const checkAudioLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setIsSpeaking(average > 30);
    };
    
    const interval = setInterval(checkAudioLevel, 100);
    
    return () => {
      clearInterval(interval);
      audioContext.close();
    };
  }, [stream, isMicOn]);

  // Handle mic state changes
  useEffect(() => {
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = isMicOn;
      });
    }
  }, [isMicOn, stream]);

  // Toggle Functions
  const toggleMic = () => {
    setIsMicOn(!isMicOn);
  };

  const toggleCam = async () => {
    if (!isCamOn) {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
        
        setStream(newStream);
        
        if (videoRef.current) {
          videoRef.current.srcObject = newStream;
        }
        
        // Reapply mic state
        newStream.getAudioTracks().forEach(track => {
          track.enabled = isMicOn;
        });
        
        setIsCamOn(true);
      } catch (err) {
        console.error("Error starting camera:", err);
        showToast("Failed to start camera", "error");
      }
    } else {
      if (stream) {
        stream.getVideoTracks().forEach(track => {
          track.stop();
        });
        setIsCamOn(false);
      }
    }
  };

  // Stop camera before navigating
  const stopLandingPageCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
      });
      setStream(null);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }
  };

  // Create room handler
  const handleCreate = async () => {
    const finalName = userName.trim() || `Guest_${Math.floor(Math.random() * 1000)}`;
    
    setIsCreating(true);
    try {
      const response = await fetch('http://localhost:3000/api/create-room');
      const data = await response.json();
      
      showToast("Room created successfully!");
      
      stopLandingPageCamera();
      
      navigate(`/room/${data.roomId}`, { 
        state: { 
          dailyUrl: data.dailyUrl,
          initialMic: isMicOn,
          initialCam: isCamOn,
          userName: finalName
        } 
      });
    } catch (error) {
      console.error("Failed:", error);
      showToast("Failed to create room. Please try again.", "error");
    } finally {
      setIsCreating(false);
    }
  };

  // Join room handler
  const handleJoin = () => {
    if (joinId.trim()) {
      const finalName = userName.trim() || `Guest_${Math.floor(Math.random() * 1000)}`;
      
      showToast("Joining room...");
      stopLandingPageCamera();
      
      navigate(`/room/${joinId}`, {
        state: { 
          initialMic: isMicOn,
          initialCam: isCamOn,
          userName: finalName
        } 
      });
    } else {
      showToast("Please enter a room ID", "error");
    }
  };

  // Handle Enter key press
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleJoin();
    }
  };

  return (
    <div className="landing-layout">
      
      {/* Toast Notification */}
      {toast.show && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? '✓' : '⚠️'}
          <span>{toast.message}</span>
        </div>
      )}

      {/* HEADER */}
      <div className="landing-header">
        <div className="logo-container">
          <Sparkles className="logo-icon" size={40} />
          <h1>Study Sync</h1>
        </div>
        <p className="tagline">Connect, collaborate, and study together in real-time</p>
      </div>

      <div className="landing-content">
        
        {/* LEFT: VIDEO PREVIEW */}
        <div className="preview-section">
          <div className={`video-container ${isSpeaking ? 'speaking' : ''}`}>
            {isLoading && (
              <div className="loading-overlay">
                <Loader2 className="spinner" size={48} />
                <p>Loading camera...</p>
              </div>
            )}
            <video 
              ref={videoRef} 
              autoPlay 
              muted 
              playsInline 
              className={isCamOn ? '' : 'hidden'} 
            />
            {!isCamOn && !isLoading && (
              <div className="camera-off-placeholder">
                <VideoOff size={48} />
                <p>Camera is off</p>
              </div>
            )}
            
            {/* Video overlay info */}
            {!isLoading && (
              <div className="video-overlay">
                <div className="preview-badge"></div>
                {isSpeaking && <div className="speaking-indicator">Speaking...</div>}
              </div>
            )}

            {/* Media Controls - Inside video container */}
            <div className="media-controls">
              <button 
                onClick={toggleMic} 
                className={`media-btn ${!isMicOn ? 'off' : ''}`}
                disabled={isLoading}
              >
                {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
              </button>
              <button 
                onClick={toggleCam} 
                className={`media-btn ${!isCamOn ? 'off' : ''}`}
                disabled={isLoading}
              >
                {isCamOn ? <Video size={20} /> : <VideoOff size={20} />}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: JOIN/CREATE CARD */}
        <div className="auth-card">
          <h2>Welcome Back! 👋</h2>
          <p>Enter your name and create a new study room or join an existing one.</p>

          <div className="action-group">
            {/* NAME INPUT */}
            <div className="input-wrapper">
              <label htmlFor="username" className="input-label">
                Your Name
              </label>
              <input 
                id="username"
                type="text" 
                placeholder="Enter your name (optional)" 
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                maxLength={20}
                className="name-input"
              />
              {userName.length > 0 && (
                <span className="char-counter">{userName.length}/20</span>
              )}
            </div>

            <button 
              onClick={handleCreate} 
              disabled={isCreating || isLoading}
              className="create-btn"
            >
              {isCreating ? (
                <>
                  <Loader2 className="btn-spinner" size={20} />
                  <span>Creating Room...</span>
                </>
              ) : (
                <>
                  <Sparkles size={20} />
                  <span>Create New Room</span>
                  <ArrowRight size={20} />
                </>
              )}
            </button>

            <div className="divider">
              <span>or join existing room</span>
            </div>

            <div className="input-wrapper">
              <label htmlFor="roomid" className="input-label">
                Room ID
              </label>
              <div className="join-group">
                <input 
                  id="roomid"
                  type="text" 
                  placeholder="Enter Room ID" 
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="join-input"
                />
                <button 
                  onClick={handleJoin} 
                  className="join-btn"
                  disabled={!joinId.trim() || isLoading}
                >
                  <span>Join</span>
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default LandingPage;