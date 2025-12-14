import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

// Pages & Components
import LandingPage from './pages/LandingPage';
import MusicMixer from './components/MusicMixer';
import YouTubePlayer from './components/YouTubePlayer';
import ChatBox from './components/ChatBox';
import Timer from './components/Timer';
import VideoChat from './components/VideoChat';
import './App.css';

// --- THE MAIN ROOM COMPONENT ---
const StudyRoom = () => {
  const { roomId } = useParams(); // Get ID from URL (e.g., /room/abc-123)
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Connect to server
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);

    // Join the specific room
    newSocket.emit('join-room', roomId);

    // Cleanup on exit
    return () => newSocket.disconnect();
  }, [roomId]);

  if (!socket) return <div className="loading">Connecting...</div>;

  return (
    <div className="app-container">
      {/* Top Bar */}
      <div className="top-bar">
        <Timer socket={socket} roomId={roomId} />
        <MusicMixer />
      </div>

      {/* Main Video Grid */}
      <div className="main-content">
        <div className="video-grid">
            <VideoChat roomUrl='i5pmr0'/>
           {/* <div className="user-box">You</div>
           <div className="user-box">Friend 1</div>
           <div className="user-box">Friend 2</div> */}
        </div>
      </div>

      {/* Bottom Widgets */}
      <ChatBox socket={socket} roomId={roomId} />
      <YouTubePlayer socket={socket} roomId={roomId} />
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