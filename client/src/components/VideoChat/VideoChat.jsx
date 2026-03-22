import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Room, RoomEvent, ParticipantEvent, Track } from 'livekit-client';
import { VideoOff, MicOff } from 'lucide-react';
import './VideoChat.css';

const VideoChat = ({ roomId, socket, onLeave, onControlsReady, onStatesChange }) => {
  const location = useLocation();
  const { initialMic = true, initialCam = true, userName = 'Guest' } = location.state || {};

  const [currentRoom, setCurrentRoom] = useState(null);
  const [participants, setParticipants] = useState([]);

  const [isMicOn, setIsMicOn] = useState(initialMic);
  const [isCameraOn, setIsCameraOn] = useState(initialCam);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [pinnedParticipant, setPinnedParticipant] = useState(null);
  const [remoteHands, setRemoteHands] = useState({});

  // PAGINATION STATE
  const [currentPage, setCurrentPage] = useState(0);
  const REMOTE_PER_PAGE = 8; // 8 remote participants per page (9 total tiles - 1 for you)

  const localVideoRef = useRef(null);
  const localScreenRef = useRef(null);
  const lastScreenShareTimestamp = useRef(0);


  // Pagination helpers
  const getTotalPages = () => {
    return Math.max(1, Math.ceil(participants.length / REMOTE_PER_PAGE));
  };

  const canGoNext = () => currentPage < getTotalPages() - 1;
  const canGoPrev = () => currentPage > 0;
  const goToNextPage = () => { if (canGoNext()) setCurrentPage(p => p + 1); };
  const goToPrevPage = () => { if (canGoPrev()) setCurrentPage(p => p - 1); };

  // Reset to page 0 when participants change
  useEffect(() => {
    const totalPages = getTotalPages();
    if (currentPage >= totalPages && totalPages > 0) {
      setCurrentPage(Math.max(0, totalPages - 1));
    }
  }, [participants.length]);

  useEffect(() => {
    if (!socket || !roomId) return;

    socket.emit('get-livekit-token', { roomId, userName });

    const handleToken = async (token) => {
      const finalToken = (typeof token === 'object' && token.token) ? token.token : token;

      const newRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: {
            width: 1920,
            height: 1080,
            frameRate: 30
          }
        },
        publishDefaults: {
          simulcast: true,
          videoCodec: 'vp9',
          videoEncoding: {
            maxBitrate: 3000000, // 3 Mbps for high quality
            maxFramerate: 30
          },
          audioBitrate: 128000,
          dtx: false,
          red: true
        },
        audioPreset: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
          channelCount: 2 // Stereo audio
        }
      });
      setCurrentRoom(newRoom);

      try {
        await newRoom.connect('ws://localhost:7880', finalToken);

        if (initialCam) {
          const { track: videoTrack } = await newRoom.localParticipant.setCameraEnabled(true);
          if (localVideoRef.current && videoTrack) {
            videoTrack.attach(localVideoRef.current);
          }
        }

        await newRoom.localParticipant.setMicrophoneEnabled(initialMic);

        newRoom.localParticipant.on(ParticipantEvent.IsSpeakingChanged, setIsSpeaking);

        newRoom.localParticipant.on(ParticipantEvent.LocalTrackPublished, async (publication) => {
          if (publication.track?.source === Track.Source.ScreenShare) {
            setIsScreenSharing(true);

            const timestamp = Date.now();
            lastScreenShareTimestamp.current = timestamp;
            const data = JSON.stringify({
              type: 'screen-share-start',
              identity: newRoom.localParticipant.identity,
              timestamp
            });
            const encoder = new TextEncoder();
            await newRoom.localParticipant.publishData(encoder.encode(data), { reliable: true });

            setTimeout(() => {
              setPinnedParticipant(`${newRoom.localParticipant.identity}-screen`);
            }, 150);
          }
        });

        newRoom.localParticipant.on(ParticipantEvent.LocalTrackUnpublished, async (publication) => {
          if (publication.track?.source === Track.Source.ScreenShare) {
            setIsScreenSharing(false);

            setPinnedParticipant(prev =>
              prev === `${newRoom.localParticipant.identity}-screen` ? null : prev
            );

            const data = JSON.stringify({
              type: 'screen-share-stop',
              identity: newRoom.localParticipant.identity
            });
            const encoder = new TextEncoder();
            await newRoom.localParticipant.publishData(encoder.encode(data), { reliable: true });
          }
        });

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
            else if (data.type === 'screen-share-start' && participant) {
              const screenShareId = `${participant.identity}-screen`;

              if (data.timestamp > lastScreenShareTimestamp.current) {
                lastScreenShareTimestamp.current = data.timestamp;
                setPinnedParticipant(screenShareId);
              }
            }
            else if (data.type === 'screen-share-stop' && participant) {
              setPinnedParticipant(prev =>
                prev === `${participant.identity}-screen` ? null : prev
              );
            }
          } catch (err) {
            console.error("Failed to parse data message:", err);
          }
        });

        const updateParticipants = () => {
          const remotes = Array.from(newRoom.remoteParticipants.values());
          setParticipants(remotes);
        };
        updateParticipants();

        newRoom.on(RoomEvent.ParticipantConnected, updateParticipants);
        newRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
          updateParticipants();
          setPinnedParticipant(prev => {
            if (prev === participant.identity || prev === `${participant.identity}-screen`) {
              return null;
            }
            return prev;
          });
        });
        newRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          updateParticipants();

          if (track.source === Track.Source.ScreenShare) {
            const timestamp = Date.now();
            if (timestamp > lastScreenShareTimestamp.current) {
              lastScreenShareTimestamp.current = timestamp;
              setPinnedParticipant(`${participant.identity}-screen`);
            }
          }
        });
        newRoom.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
          updateParticipants();

          if (track.source === Track.Source.ScreenShare) {
            setPinnedParticipant(prev =>
              prev === `${participant.identity}-screen` ? null : prev
            );
          }
        });

      } catch (error) {
        console.error("Failed to connect:", error);
      }
    };

    socket.on('livekit-token', handleToken);

    return () => {
      socket.off('livekit-token', handleToken);
      if (currentRoom) currentRoom.disconnect();
    };
  }, [roomId, socket, initialMic, initialCam, userName]);

  const toggleMic = useCallback(async () => {
    if (!currentRoom) return;
    const newState = !isMicOn;
    await currentRoom.localParticipant.setMicrophoneEnabled(newState);
    setIsMicOn(newState);
  }, [currentRoom, isMicOn]);

  const toggleCamera = useCallback(async () => {
    if (!currentRoom) return;
    const newState = !isCameraOn;

    if (newState) {
      const { track: videoTrack } = await currentRoom.localParticipant.setCameraEnabled(true);
      if (localVideoRef.current && videoTrack) {
        videoTrack.attach(localVideoRef.current);
      }
    } else {
      await currentRoom.localParticipant.setCameraEnabled(false);
    }

    setIsCameraOn(newState);
  }, [currentRoom, isCameraOn]);

  const toggleScreenShare = useCallback(async () => {
    if (!currentRoom) return;
    const newState = !isScreenSharing;

    try {
      await currentRoom.localParticipant.setScreenShareEnabled(newState);
    } catch (error) {
      console.error("Screen share toggle failed:", error);
      setIsScreenSharing(false);
    }
  }, [currentRoom, isScreenSharing]);

  const toggleHandRaise = useCallback(async () => {
    if (!currentRoom) return;
    const newState = !isHandRaised;
    setIsHandRaised(newState);

    const data = JSON.stringify({ type: 'hand-raise', value: newState });
    const encoder = new TextEncoder();
    await currentRoom.localParticipant.publishData(encoder.encode(data), { reliable: true });
  }, [currentRoom, isHandRaised]);

  const togglePin = (participantId) => {
    setPinnedParticipant(prev => prev === participantId ? null : participantId);
  };

  // Expose control handlers to parent (AFTER functions are defined)
  useEffect(() => {
    if (onControlsReady) {
      onControlsReady({
        toggleMic,
        toggleCamera,
        toggleScreenShare,
        toggleHandRaise
      });
    }
  }, [onControlsReady, toggleMic, toggleCamera, toggleScreenShare, toggleHandRaise]);

  // Notify parent of state changes
  useEffect(() => {
    if (onStatesChange) {
      onStatesChange({
        isMicOn,
        isCameraOn,
        isScreenSharing,
        isHandRaised
      });
    }
  }, [isMicOn, isCameraOn, isScreenSharing, isHandRaised, onStatesChange]);


  // Compute displayed participants for the current page (when not pinned)
  const startIdx = currentPage * REMOTE_PER_PAGE;
  const displayedParticipants = pinnedParticipant
    ? participants // show all in thumbnails when pinned
    : participants.slice(startIdx, startIdx + REMOTE_PER_PAGE);

  // Tile counting for grid class
  const getTotalTiles = () => {
    if (pinnedParticipant) {
      return 1; // Just return 1 to trigger has-pinned class
    }

    let count = 1; // Your camera
    if (isScreenSharing) count++;

    displayedParticipants.forEach(p => {
      count++;
      const hasScreenShare = Array.from(p.trackPublications.values()).some(
        pub => pub.track?.source === Track.Source.ScreenShare
      );
      if (hasScreenShare) count++;
    });

    return count;
  };

  const totalTiles = getTotalTiles();

  const getGridClass = () => {
    if (pinnedParticipant) return 'has-pinned';
    if (totalTiles === 1) return 'participants-1';
    if (totalTiles === 2) return 'participants-2';
    if (totalTiles === 3) return 'participants-3';
    if (totalTiles <= 6) return `participants-${totalTiles}`;
    if (totalTiles <= 9) return `participants-${totalTiles}`;
    return 'participants-many';
  };

  const myIdentity = currentRoom?.localParticipant?.identity;
  const myScreenShareId = myIdentity ? `${myIdentity}-screen` : null;

  return (
    <div className="video-container-relative">
      <div className={`custom-video-grid ${getGridClass()}`}>
        {/* PINNED VIDEO */}
        {pinnedParticipant && (
          <div className="pinned-main">
            {/* If pinned is my screen */}
            {pinnedParticipant === myScreenShareId && (
              <div className="video-wrapper screen-share pinned sharing-indicator">
                <div className="sharing-message">
                  <div className="sharing-icon">💻</div>
                  <div className="sharing-text">You are currently sharing your screen</div>
                  <button
                    className="stop-sharing-link"
                    onClick={toggleScreenShare}
                  >
                    Stop screen sharing
                  </button>
                </div>
                <button
                  className="pin-btn active"
                  onClick={() => togglePin(myScreenShareId)}
                >
                  📌
                </button>
              </div>
            )}

            {/* If pinned is a remote participant camera */}
            {!pinnedParticipant.includes('-screen') &&
              participants.find(p => p.identity === pinnedParticipant) && (
                <RemoteParticipant
                  key={`pinned-${pinnedParticipant}`}
                  participant={participants.find(p => p.identity === pinnedParticipant)}
                  isHandRaised={remoteHands[pinnedParticipant] || false}
                  isPinned={true}
                  onTogglePin={togglePin}
                />
              )}

            {/* If pinned is a remote screen share */}
            {pinnedParticipant.includes('-screen') && pinnedParticipant !== myScreenShareId && (() => {
              const identity = pinnedParticipant.replace('-screen', '');
              const participant = participants.find(p => p.identity === identity);
              return participant ? (
                <RemoteScreenShare
                  key={pinnedParticipant}
                  participant={participant}
                  screenShareId={pinnedParticipant}
                  isPinned={true}
                  onTogglePin={togglePin}
                />
              ) : null;
            })()}
          </div>
        )}

        {/* THUMBNAILS / GRID */}
        <div className={pinnedParticipant ? "thumbnail-strip" : "grid-tiles"}>
          {/* YOUR CAMERA */}
          <div className={`video-wrapper local ${isSpeaking ? 'speaking' : ''}`}>
            <video
              ref={localVideoRef}
              className={`video-player ${!isCameraOn ? 'hidden' : ''}`}
              muted
              autoPlay
              playsInline
            />

            {/* Camera Off Placeholder */}
            {!isCameraOn && (
              <div className="camera-off-placeholder">
                <VideoOff size={40} className="status-icon" />
                <p>You</p>
              </div>
            )}

            <div className="name-tag">You {isHandRaised ? '✋' : ''}</div>
            {isHandRaised && <div className="hand-badge">✋</div>}

            {/* Mic Off Indicator (Bottom Right) */}
            {!isMicOn && (
              <div className="mic-status-badge" title="Microphone Off">
                <MicOff size={16} />
              </div>
            )}
          </div>

          {/* Your screen share thumbnail - show only when not pinned to your screen */}
          {isScreenSharing && pinnedParticipant !== myScreenShareId && (
            <div className="video-wrapper screen-share sharing-indicator">
              <div className="sharing-message-small">
                <div className="sharing-icon-small">💻</div>
                <div className="sharing-text-small">Sharing screen</div>
              </div>
              <button className="pin-btn" onClick={() => togglePin(myScreenShareId)}>📍</button>
            </div>
          )}

          {/* REMOTE PARTICIPANTS (paginated or all if pinned) */}
          {displayedParticipants.map((p) => {
            const hasScreenShare = Array.from(p.trackPublications.values()).some(
              pub => pub.track?.source === Track.Source.ScreenShare
            );
            const screenShareId = `${p.identity}-screen`;

            return (
              <React.Fragment key={p.identity}>
                {/* Remote camera - hide if pinned */}
                {pinnedParticipant !== p.identity && (
                  <RemoteParticipant
                    participant={p}
                    isHandRaised={remoteHands[p.identity] || false}
                    isPinned={false}
                    onTogglePin={togglePin}
                  />
                )}

                {/* Remote screen share - hide if pinned */}
                {hasScreenShare && pinnedParticipant !== screenShareId && (
                  <RemoteScreenShare
                    participant={p}
                    screenShareId={screenShareId}
                    isPinned={false}
                    onTogglePin={togglePin}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* PAGE NAVIGATION - show only if not pinned and more remotes than REMOTE_PER_PAGE */}
      {!pinnedParticipant && participants.length > REMOTE_PER_PAGE && (
        <div className="page-nav-buttons">
          <button
            className="page-nav-btn"
            onClick={goToPrevPage}
            disabled={!canGoPrev()}
          >
            ←
          </button>
          <span className="page-indicator">
            {currentPage + 1} / {getTotalPages()}
          </span>
          <button
            className="page-nav-btn"
            onClick={goToNextPage}
            disabled={!canGoNext()}
          >
            →
          </button>
        </div>
      )}


    </div>
  );
};

// Remote Participant Component
const RemoteParticipant = ({ participant, isHandRaised, isPinned, onTogglePin }) => {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Track media state
  const [isCamOn, setIsCamOn] = useState(participant.isCameraEnabled);
  const [isMicOn, setIsMicOn] = useState(participant.isMicrophoneEnabled);

  useEffect(() => {
    const attachTrack = (track) => {
      if (track.kind === 'video' && track.source === Track.Source.Camera && videoRef.current) {
        track.attach(videoRef.current);
      } else if (track.kind === 'audio' && audioRef.current) {
        track.attach(audioRef.current);
      }
    };

    // Attach existing tracks
    participant.trackPublications.forEach(pub => {
      if (pub.track && pub.track.source !== Track.Source.ScreenShare) {
        attachTrack(pub.track);
      }
    });

    participant.on(RoomEvent.TrackSubscribed, attachTrack);

    const handleSpeaking = (speaking) => setIsSpeaking(speaking);
    participant.on(ParticipantEvent.IsSpeakingChanged, handleSpeaking);

    // Update state on mute/unmute/subscribe/unsubscribe
    const updateMediaState = () => {
      setIsCamOn(participant.isCameraEnabled);
      setIsMicOn(participant.isMicrophoneEnabled);
    };

    participant.on(ParticipantEvent.TrackMuted, updateMediaState);
    participant.on(ParticipantEvent.TrackUnmuted, updateMediaState);
    participant.on(ParticipantEvent.TrackSubscribed, updateMediaState);
    participant.on(ParticipantEvent.TrackUnsubscribed, updateMediaState);

    return () => {
      participant.off(RoomEvent.TrackSubscribed, attachTrack);
      participant.off(ParticipantEvent.IsSpeakingChanged, handleSpeaking);
      participant.off(ParticipantEvent.TrackMuted, updateMediaState);
      participant.off(ParticipantEvent.TrackUnmuted, updateMediaState);
      participant.off(ParticipantEvent.TrackSubscribed, updateMediaState);
      participant.off(ParticipantEvent.TrackUnsubscribed, updateMediaState);
    };
  }, [participant]);


  return (
    <div className={`video-wrapper remote ${isSpeaking ? 'speaking' : ''} ${isPinned ? 'pinned' : ''}`}>
      {/* Video Element (Always present but hidden if off) */}
      <video
        ref={videoRef}
        className={`video-player ${!isCamOn ? 'hidden' : ''}`}
        autoPlay
        playsInline
      />

      {/* Camera Off Placeholder */}
      {!isCamOn && (
        <div className="camera-off-placeholder">
          <VideoOff size={40} className="status-icon" />
          <p>Camera is off</p>
        </div>
      )}

      <audio ref={audioRef} autoPlay />

      <div className="name-tag">
        {participant.identity} {isSpeaking ? '🔊' : ''} {isPinned ? '(Pinned)' : ''}
      </div>

      {isHandRaised && <div className="hand-badge">✋</div>}

      {/* Mic Off Indicator (Bottom Right) */}
      {!isMicOn && (
        <div className="mic-status-badge" title="Microphone Off">
          <MicOff size={16} />
        </div>
      )}

      <button
        className={`pin-btn ${isPinned ? 'active' : ''}`}
        onClick={() => onTogglePin(participant.identity)}
      >
        {isPinned ? '📌' : '📍'}
      </button>
    </div>
  );
};

// Remote Screen Share Component
const RemoteScreenShare = ({ participant, screenShareId, isPinned, onTogglePin }) => {
  const screenRef = useRef(null);

  useEffect(() => {
    const attachScreenTrack = (track) => {
      if (!track) return;
      if (track.source === Track.Source.ScreenShare && screenRef.current) {
        track.attach(screenRef.current);
      }
    };

    participant.trackPublications.forEach(pub => {
      if (pub.track?.source === Track.Source.ScreenShare) {
        attachScreenTrack(pub.track);
      }
    });

    participant.on(RoomEvent.TrackSubscribed, attachScreenTrack);

    return () => {
      participant.off(RoomEvent.TrackSubscribed, attachScreenTrack);
    };
  }, [participant]);

  return (
    <div className={`video-wrapper screen-share ${isPinned ? 'pinned' : ''}`}>
      <video ref={screenRef} className="video-player" autoPlay playsInline />
      <div className="name-tag">
        {participant.identity}'s Screen {isPinned ? '(Pinned)' : ''}
      </div>
      <button
        className={`pin-btn ${isPinned ? 'active' : ''}`}
        onClick={() => onTogglePin(screenShareId)}
      >
        {isPinned ? '📌' : '📍'}
      </button>
    </div>
  );
};

export default VideoChat;