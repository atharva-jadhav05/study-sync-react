import React, { useEffect, useState, useRef } from 'react';
import { Room, RoomEvent, ParticipantEvent } from 'livekit-client';
import './VideoChat.css';

const VideoChat = ({ roomId, socket, onLeave }) => {
  const [currentRoom, setCurrentRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  
  // 🎛️ Control States
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // ✋ Track Remote Hand Raises: { "user_identity": true/false }
  const [remoteHands, setRemoteHands] = useState({});
  
  const localVideoRef = useRef(null);

  useEffect(() => {
    if (!socket || !roomId) return;

    const userName = "User_" + Math.floor(Math.random() * 1000);
    socket.emit('get-livekit-token', { roomId, userName });

    const handleToken = async (token) => {
        const finalToken = (typeof token === 'object' && token.token) ? token.token : token;
        
        const newRoom = new Room({
            adaptiveStream: true,
            dynacast: true,
            publishDefaults: { simulcast: true }
        });
        setCurrentRoom(newRoom);

        try {
            await newRoom.connect('ws://localhost:7880', finalToken);
            
            // 1. Initial Media Setup
            const { track: videoTrack } = await newRoom.localParticipant.setCameraEnabled(true);
            if (localVideoRef.current) {
                videoTrack.attach(localVideoRef.current);
            }
            await newRoom.localParticipant.setMicrophoneEnabled(true);

            // 2. Event Listeners (Self)
            newRoom.localParticipant.on(ParticipantEvent.IsSpeakingChanged, setIsSpeaking);

            // 3. Handle Data Messages (Raise Hand from OTHERS)
            newRoom.on(RoomEvent.DataReceived, (payload, participant, _kind, _topic) => {
                const strData = new TextDecoder().decode(payload);
                try {
                    const data = JSON.parse(strData);
                    if (data.type === 'hand-raise' && participant) {
                        setRemoteHands(prev => ({
                            ...prev,
                            [participant.identity]: data.value
                        }));
                    }
                } catch (err) {
                    console.error("Failed to parse data message:", err);
                }
            });

            // 4. Handle Participants
            const updateParticipants = () => {
                const remotes = Array.from(newRoom.remoteParticipants.values());
                setParticipants(remotes);
            };
            updateParticipants();

            newRoom.on(RoomEvent.ParticipantConnected, updateParticipants);
            newRoom.on(RoomEvent.ParticipantDisconnected, updateParticipants);
            newRoom.on(RoomEvent.TrackSubscribed, updateParticipants);
            newRoom.on(RoomEvent.TrackUnsubscribed, updateParticipants);

        } catch (error) {
            console.error("Failed to connect:", error);
        }
    };

    socket.on('livekit-token', handleToken);

    return () => {
        socket.off('livekit-token', handleToken);
        if (currentRoom) currentRoom.disconnect();
    };
  }, [roomId, socket]);

  // --- BUTTON HANDLERS ---

  const toggleMic = async () => {
      if (!currentRoom) return;
      const newState = !isMicOn;
      await currentRoom.localParticipant.setMicrophoneEnabled(newState);
      setIsMicOn(newState);
  };

  const toggleCamera = async () => {
      if (!currentRoom) return;
      const newState = !isCameraOn;
      await currentRoom.localParticipant.setCameraEnabled(newState);
      setIsCameraOn(newState);
  };

  const toggleScreenShare = async () => {
      if (!currentRoom) return;
      const newState = !isScreenSharing;
      await currentRoom.localParticipant.setScreenShareEnabled(newState);
      setIsScreenSharing(newState);
  };

  const toggleHandRaise = async () => {
      if (!currentRoom) return;
      const newState = !isHandRaised;
      setIsHandRaised(newState);

      // Send to everyone else
      const data = JSON.stringify({ type: 'hand-raise', value: newState });
      const encoder = new TextEncoder();
      await currentRoom.localParticipant.publishData(encoder.encode(data), { reliable: true });
  };

  return (
    <div className="video-container-relative"> 
      <div className="custom-video-grid">
        {/* YOUR FACE */}
        {/* 🟢 ADDED: 'screen-share' class logic to fix flipping */}
        <div className={`video-wrapper local ${isScreenSharing ? 'screen-share' : ''} ${isSpeaking ? 'speaking' : ''}`}>
            <video ref={localVideoRef} className="video-player" muted />
            <div className="name-tag">
                You {isHandRaised ? '✋' : ''}
            </div>
            {isHandRaised && <div className="hand-badge">✋</div>}
        </div>

        {/* FRIENDS FACES */}
        {participants.map((p) => (
            <RemoteParticipant 
                key={p.identity} 
                participant={p} 
                isHandRaised={remoteHands[p.identity] || false} // Pass the state down
            />
        ))}
      </div>
      
      {/* 🎛️ CONTROL BAR */}
      <div className="controls-bar">
        <button className={`control-btn ${!isMicOn ? 'off' : ''}`} onClick={toggleMic}>
            {isMicOn ? '🎤' : '🔇'}
        </button>

        <button className={`control-btn ${!isCameraOn ? 'off' : ''}`} onClick={toggleCamera}>
            {isCameraOn ? '📹' : '🚫'}
        </button>

        <button className={`control-btn ${isScreenSharing ? 'active' : ''}`} onClick={toggleScreenShare}>
            {isScreenSharing ? '💻' : '📺'}
            {/* 🟢 ADDED: Popup Text */}
            {isScreenSharing && (
                <div className="screen-share-popup">You are sharing screen</div>
            )}
        </button>

        <button className={`control-btn ${isHandRaised ? 'active' : ''}`} onClick={toggleHandRaise}>
            ✋
        </button>

        <button className="control-btn leave-btn-icon" onClick={onLeave}>
            📞
        </button>
      </div>
    </div>
  );
};

// --- Helper Component for Remote Users ---
const RemoteParticipant = ({ participant, isHandRaised }) => {
    const videoRef = useRef(null);
    const audioRef = useRef(null);
    const [isSpeaking, setIsSpeaking] = useState(false);

    useEffect(() => {
        // 1. Media Tracks
        const attachTrack = (track) => {
            if (track.kind === 'video' && videoRef.current) {
                track.attach(videoRef.current);
            }
            if (track.kind === 'audio' && audioRef.current) {
                track.attach(audioRef.current);
            }
        };

        participant.trackPublications.forEach(pub => {
            if (pub.track) attachTrack(pub.track);
        });

        participant.on(RoomEvent.TrackSubscribed, attachTrack);

        // 2. Speaking Detection
        const handleSpeaking = (speaking) => setIsSpeaking(speaking);
        participant.on(ParticipantEvent.IsSpeakingChanged, handleSpeaking);
        
        return () => {
            participant.off(RoomEvent.TrackSubscribed, attachTrack);
            participant.off(ParticipantEvent.IsSpeakingChanged, handleSpeaking);
        };
    }, [participant]);

    return (
        <div className={`video-wrapper remote ${isSpeaking ? 'speaking' : ''}`}>
            <video ref={videoRef} className="video-player" />
            <audio ref={audioRef} autoPlay />
            
            <div className="name-tag">
                {participant.identity} {isSpeaking ? '🔊' : ''}
            </div>

            {/* Hand Raise Badge */}
            {isHandRaised && <div className="hand-badge">✋</div>}
        </div>
    );
};

export default VideoChat;