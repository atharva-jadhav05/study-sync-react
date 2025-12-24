import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const LandingPage = () => {
  const navigate = useNavigate();
  const [joinId, setJoinId] = useState('');
  const [isCreating, setIsCreating] = useState(false); // Added loading state

  const createRoom = async () => {
    setIsCreating(true);
    try {
      // 1. Ask Server for a new ID AND the Daily URL
      const response = await fetch('http://localhost:3000/api/create-room');
      const data = await response.json();
      
      console.log("Server Response:", data); // Check console to see if dailyUrl is here

      // 2. Go to that room and PASS the dailyUrl so the next page has it immediately
      // This prevents the "Invalid URL" error because we hand-deliver the link
      navigate(`/room/${data.roomId}`, { 
        state: { 
          dailyUrl: data.dailyUrl 
        } 
      });

    } catch (error) {
      console.error("Failed to create room:", error);
      alert("Error connecting to server. Is 'node server.js' running?");
    } finally {
      setIsCreating(false);
    }
  };

  const joinRoom = () => {
    if (joinId.trim()) {
      // When joining manually, we don't have the URL yet. 
      // The Room component will catch it via the Socket listener later.
      navigate(`/room/${joinId}`);
    }
  };

  return (
    <div className="landing-container">
      <div className="landing-card">
        <h1>Study Sync 📚</h1>
        <p>Listen to music, watch videos, and study with friends.</p>
        
        <div style={{ marginTop: '30px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {/* Create Button */}
          <button 
            onClick={createRoom} 
            disabled={isCreating}
            style={{ 
              padding: '15px', 
              background: isCreating ? '#555' : '#7289da', 
              color: 'white', 
              border: 'none', 
              borderRadius: '8px', 
              cursor: isCreating ? 'not-allowed' : 'pointer', 
              fontSize: '1.1rem' 
            }}
          >
            {isCreating ? "Creating Room..." : "Create New Room"}
          </button>
          
          <div style={{ margin: '10px 0', color: '#888' }}>-- OR --</div>
          
          {/* Join Section */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <input 
              type="text" 
              placeholder="Enter Room ID..." 
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              style={{ padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#222', color: 'white', flex: 1 }}
            />
            <button onClick={joinRoom} style={{ padding: '10px 20px', background: '#444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
              Join
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default LandingPage;