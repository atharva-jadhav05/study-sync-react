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
import TodoList from "./components/ToDoList/TodoList"; // ← ADDED
import './App.css';

// --- THE MAIN ROOM COMPONENT ---
const StudyRoom = () => {
  const { roomId } = useParams(); 
  const navigate = useNavigate();
  
  const [socket, setSocket] = useState(null);
  const [isInCall, setIsInCall] = useState(false);
  const [showWhiteboard, setShowWhiteboard] = useState(false); 
  
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
        
        {/* TodoList Button ← ADDED */}
        <TodoList socket={socket} roomId={roomId} />
        
        {/* Toggle Button: Only visible when whiteboard is CLOSED */}
        {!showWhiteboard && (
            <button 
              className="whiteboard-toggle-btn" 
              onClick={() => setShowWhiteboard(true)}
              style={{ marginLeft: '15px' }} 
            >
              ✏️ Open Whiteboard
            </button>
        )}
      </div>

      {/* Main Video Grid */}
      <div className="main-content">
        <div className="video-grid">
           <VideoChat 
               roomId={roomId} 
               socket={socket} 
               onLeave={handleLeaveRoom} 
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