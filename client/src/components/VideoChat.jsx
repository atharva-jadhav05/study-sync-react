import React, { useEffect, useState, useRef } from 'react';
import DailyIframe from '@daily-co/daily-js';
import './VideoChat.css'; // We will create this CSS file next

const VideoChat = ({ roomUrl, onLeave }) => {
  const [callObject, setCallObject] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [pinnedId, setPinnedId] = useState(null); // The "Stage" user

  // Control States
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  
  const callRef = useRef(null);
  const initializedRef = useRef(false);
  // 1. Initialize Call
  useEffect(() => {
    if (!roomUrl) return;

    if (initializedRef.current) return;
    initializedRef.current = true;
    
    callRef.current = DailyIframe.createCallObject();
    setCallObject(callRef.current);

    callRef.current.join({ url: roomUrl });

    const updateParticipants = () => {
      const p = callRef.current.participants();
      setParticipants(Object.values(p));
    };

    // Auto-Pin Screen Shares
    const handleTrackStart = (event) => {
        if (event.track.kind === 'video' && event.participant.screen) {
            setPinnedId(event.participant.session_id);
        }
        updateParticipants();
    };

    callRef.current.on('joined-meeting', updateParticipants);
    callRef.current.on('participant-joined', updateParticipants);
    callRef.current.on('participant-updated', updateParticipants);
    callRef.current.on('participant-left', updateParticipants);
    callRef.current.on('track-started', handleTrackStart);

    return () => {
      callRef.current.leave();
      callRef.current.destroy();
    };
  }, [roomUrl]);

  // 2. Control Functions
  const toggleAudio = () => {
    callObject.setLocalAudio(!isMuted);
    setIsMuted(!isMuted);
  };

  const toggleVideo = () => {
    callObject.setLocalVideo(!isCameraOff);
    setIsCameraOff(!isCameraOff);
  };

  const leaveCall = () => {
    if (callObject) callObject.leave();
    if (onLeave) onLeave(); // Trigger parent redirect
  };

  const handlePin = (id) => {
      setPinnedId(pinnedId === id ? null : id); // Toggle pin
  };

  // 3. Layout Logic
  const renderTile = (p, isPinnedView = false) => {
      return (
        <div 
            key={p.session_id} 
            className={`video-tile ${isPinnedView ? 'pinned' : ''}`} 
            onClick={() => handlePin(p.session_id)}
        >
            <VideoTile participant={p} />
            <div className="user-name">{p.user_name || "Guest"} {p.local && "(You)"}</div>
            {p.screen && <div className="screen-badge">Presenting</div>}
        </div>
      );
  };

  // If someone is pinned, separate them from the rest
  const pinnedParticipant = participants.find(p => p.session_id === pinnedId);
  const otherParticipants = participants.filter(p => p.session_id !== pinnedId);

  return (
    <div className="video-chat-container">
      
      {/* --- VIDEO AREA --- */}
      <div className={`video-stage ${pinnedId ? 'has-pin' : 'grid-mode'}`}>
        
        {/* Pinned Mode: The Big Stage */}
        {pinnedId && pinnedParticipant && (
            <div className="main-stage">
                {renderTile(pinnedParticipant, true)}
            </div>
        )}

        {/* Filmstrip or Grid */}
        <div className={`participant-list ${pinnedId ? 'filmstrip' : 'grid'}`}>
            {(pinnedId ? otherParticipants : participants).map(p => renderTile(p))}
            
            {/* Empty Placeholders (Only in grid mode to fill space) */}
            {!pinnedId && participants.length < 2 && (
                <div className="video-tile placeholder">Waiting for friends...</div>
            )}
        </div>
      </div>

      {/* --- CONTROL BAR --- */}
      <div className="control-bar">
        <button onClick={toggleAudio} className={isMuted ? "red" : ""}>
          {isMuted ? "Unmute" : "Mute"}
        </button>
        <button onClick={toggleVideo} className={isCameraOff ? "red" : ""}>
          {isCameraOff ? "Start Cam" : "Stop Cam"}
        </button>
        <button onClick={leaveCall} className="leave-btn">
          Leave Room
        </button>
      </div>
    </div>
  );
};

// Sub-component for the actual <video> tag
const VideoTile = ({ participant }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    if (!participant.video || !videoRef.current) return;
    const track = participant.videoTrack || participant.tracks?.video?.persistentTrack;
    if (track) {
      videoRef.current.srcObject = new MediaStream([track]);
    }
  }, [participant, participant.videoTrack]);

  return (
    <video 
      ref={videoRef} 
      autoPlay 
      muted={participant.local} 
      playsInline 
    />
  );
};

export default VideoChat;