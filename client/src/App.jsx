import { BrowserRouter, Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import io from 'socket.io-client';

// Pages & Components
import LandingPage from './pages/LandingPage/LandingPage';
import Whiteboard from './components/WhiteBoard/Whiteboard';
import YouTubePlayer from './components/YouTubePlayer/YouTubePlayer';
import ChatBox from './components/ChatBox/ChatBox';
import Timer from './components/Timer/Timer';
import VideoChat from './components/VideoChat/VideoChat';
import TodoList from "./components/ToDoList/TodoList";
import ControlBar from './components/ControlBar/ControlBar';
import './App.css';

// --- THE MAIN ROOM COMPONENT ---
const StudyRoom = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [socket, setSocket] = useState(null);
  const [isInCall, setIsInCall] = useState(false);
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [showYouTube, setShowYouTube] = useState(false); // New state for YouTube popup

  // Control bar states (lifted from VideoChat)
  const [controlHandlers, setControlHandlers] = useState(null);
  const [controlStates, setControlStates] = useState({
    isMicOn: true,
    isCameraOn: true,
    isScreenSharing: false,
    isHandRaised: false
  });

  useEffect(() => {
    // Connect to server
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);

    // Join the specific room
    newSocket.emit('join-room', roomId);

    setIsInCall(true);

    // Cleanup on exit
    return () => {
      setIsInCall(false);
      newSocket.disconnect();
    };
  }, [roomId]);

  const handleLeaveRoom = () => {
    setIsInCall(false);
    if (socket) socket.disconnect();
    navigate('/');
    window.location.reload();
  };

  if (!socket) return <div className="loading">Connecting to Study Sync...</div>;

  return (
    <div className="app-container">
      {/* Top Bar */}
      <div className="top-bar">
        <Timer socket={socket} roomId={roomId} />
        <TodoList socket={socket} roomId={roomId} />
      </div>

      {/* Main Video Grid */}
      <div className="main-content">
        <div className="video-grid">
          <VideoChat
            roomId={roomId}
            socket={socket}
            onLeave={handleLeaveRoom}
            onControlsReady={setControlHandlers}
            onStatesChange={setControlStates}
          />
        </div>

        {/* Whiteboard Overlay */}
        <div
          className="whiteboard-overlay"
          style={{ display: showWhiteboard ? 'flex' : 'none' }}
        >
          <Whiteboard
            socket={socket}
            roomId={roomId}
            onClose={() => setShowWhiteboard(false)}
          />
        </div>

        {/* YouTube Popup Overlay - Hidden by default */}
        <div className={`youtube-popup-container ${showYouTube ? 'visible' : 'hidden'}`}>
          <YouTubePlayer
            socket={socket}
            roomId={roomId}
            onClose={() => setShowYouTube(false)}
          />
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="bottom-bar">
        {/* Left Side: YouTube & Whiteboard Toggles */}
        <div className="bottom-left-buttons">
          <button
            className={`icon-btn ${showYouTube ? 'active' : ''}`}
            onClick={() => setShowYouTube(!showYouTube)}
            title="Toggle YouTube Player"
          >
            📺
          </button>
          <button
            className={`icon-btn ${showWhiteboard ? 'active' : ''}`}
            onClick={() => setShowWhiteboard(!showWhiteboard)}
            title="Toggle Whiteboard"
          >
            ✏️
          </button>
        </div>

        <ControlBar
          isMicOn={controlStates.isMicOn}
          isCameraOn={controlStates.isCameraOn}
          isScreenSharing={controlStates.isScreenSharing}
          isHandRaised={controlStates.isHandRaised}
          onToggleMic={controlHandlers?.toggleMic}
          onToggleCamera={controlHandlers?.toggleCamera}
          onToggleScreenShare={controlHandlers?.toggleScreenShare}
          onToggleHandRaise={controlHandlers?.toggleHandRaise}
          onLeave={handleLeaveRoom}
        />

        <ChatBox socket={socket} roomId={roomId} />
      </div>
    </div>
  );
};

// --- THE ROUTER ---
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/room/:roomId" element={<StudyRoom />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;