/**
 * VideoChat.jsx
 *
 * Owns LiveKit connection + media state only.
 * Zero layout code here — VideoGrid handles everything visual.
 *
 * ─── BLACK VIDEO FIX ────────────────────────────────────────
 *
 * Problem:
 *   When you pin a participant, <LocalTile> moves between JSX branches
 *   (e.g. from the grid to the thumbnail strip). React destroys the old
 *   <video> DOM node and creates a brand new one. The LiveKit camera track
 *   is still attached to the destroyed node → new node shows nothing (black).
 *   Toggle camera off/on happened to re-attach the track as a side-effect.
 *
 * Fix — two refs + one callback ref:
 *
 *   localCamTrackRef  — stores the active LocalVideoTrack object
 *   localVideoElRef   — stores the current <video> DOM element
 *   setLocalVideoRef  — a CALLBACK REF passed as `localVideoRef` to VideoGrid
 *
 * React calls a callback ref function every time the element it's attached
 * to mounts or unmounts (with the element or null respectively).
 *
 * So every time <LocalTile> renders a new <video ref={setLocalVideoRef}>,
 * setLocalVideoRef fires with the new DOM element, and we immediately call:
 *
 *   localCamTrackRef.current.attach(newVideoElement)
 *
 * Result: track always follows the live DOM node — no black video, ever.
 *
 * IMPORTANT: setLocalVideoRef must have a STABLE identity (empty useCallback
 * deps). If it changes on every render, React treats it as unmount+remount
 * and the element flickers. Empty deps guarantees identity stability.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Room, RoomEvent, ParticipantEvent, Track } from 'livekit-client';
import VideoGrid from './VideoGrid';

const VideoChat = ({ roomId, socket, onLeave, onControlsReady, onStatesChange }) => {
  const location = useLocation();
  const {
    initialMic = true,
    initialCam = true,
    userName = 'Guest',
  } = location.state || {};

  /* ── LiveKit state ─────────────────────────────────────── */
  const [participants,    setParticipants]    = useState([]);
  const [isMicOn,         setIsMicOn]         = useState(initialMic);
  const [isCameraOn,      setIsCameraOn]      = useState(initialCam);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isHandRaised,    setIsHandRaised]    = useState(false);
  const [isSpeaking,      setIsSpeaking]      = useState(false);
  const [remoteHands,     setRemoteHands]     = useState({});

  /* ── Stable refs ───────────────────────────────────────── */
  const roomRef          = useRef(null); // current Room instance
  const localCamTrackRef = useRef(null); // current camera LocalVideoTrack
  const localVideoElRef  = useRef(null); // current <video> DOM element

  /**
   * setLocalVideoRef — the CALLBACK REF passed to VideoGrid → LocalTile.
   *
   * React calls this with the DOM element on mount, null on unmount.
   * On every mount we immediately attach the stored track to the new element.
   *
   * Must have empty deps so React never recreates this function (stable identity).
   */
  const setLocalVideoRef = useCallback((videoEl) => {
    localVideoElRef.current = videoEl;

    // New <video> mounted — reattach the live camera track right now
    if (videoEl && localCamTrackRef.current) {
      localCamTrackRef.current.attach(videoEl);
    }
  }, []); // ← intentionally empty — do NOT add deps here

  /* ── Connect to LiveKit ─────────────────────────────────── */
  useEffect(() => {
    if (!socket || !roomId) return;

    socket.emit('get-livekit-token', { roomId, userName });

    const handleToken = async (payload) => {
      const token = typeof payload === 'object' && payload.token
        ? payload.token
        : payload;

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: { width: 1920, height: 1080, frameRate: 30 },
        },
        publishDefaults: {
          simulcast: true,
          videoCodec: 'vp9',
          videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
          audioBitrate: 128_000,
          dtx: false,
          red: true,
        },
        audioPreset: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48_000,
          channelCount: 2,
        },
      });

      roomRef.current = room;

      try {
        await room.connect('ws://localhost:7880', token);

        /* Enable camera */
        if (initialCam) {
          const { track } = await room.localParticipant.setCameraEnabled(true);
          if (track) {
            localCamTrackRef.current = track;
            // If the <video> element is already in the DOM, attach now
            if (localVideoElRef.current) track.attach(localVideoElRef.current);
          }
        }

        /* Enable mic */
        await room.localParticipant.setMicrophoneEnabled(initialMic);

        /* Speaking detection */
        room.localParticipant.on(ParticipantEvent.IsSpeakingChanged, setIsSpeaking);

        /* Screen share started */
        room.localParticipant.on(ParticipantEvent.LocalTrackPublished, async (pub) => {
          if (pub.track?.source !== Track.Source.ScreenShare) return;
          setIsScreenSharing(true);
          await room.localParticipant.publishData(
            enc({ type: 'screen-share-start', identity: room.localParticipant.identity, timestamp: Date.now() }),
            { reliable: true }
          );
        });

        /* Screen share stopped */
        room.localParticipant.on(ParticipantEvent.LocalTrackUnpublished, async (pub) => {
          if (pub.track?.source !== Track.Source.ScreenShare) return;
          setIsScreenSharing(false);
          await room.localParticipant.publishData(
            enc({ type: 'screen-share-stop', identity: room.localParticipant.identity }),
            { reliable: true }
          );
        });

        /* Data channel messages (hand raise, etc.) */
        room.on(RoomEvent.DataReceived, (payload, participant) => {
          try {
            const data = JSON.parse(new TextDecoder().decode(payload));
            if (data.type === 'hand-raise' && participant) {
              setRemoteHands((prev) => ({ ...prev, [participant.identity]: data.value }));
            }
          } catch { /* ignore malformed */ }
        });

        /* Participant roster */
        const sync = () =>
          setParticipants(Array.from(room.remoteParticipants.values()));

        sync();
        room.on(RoomEvent.ParticipantConnected,    sync);
        room.on(RoomEvent.ParticipantDisconnected, (p) => {
          sync();
          setRemoteHands((prev) => {
            const next = { ...prev };
            delete next[p.identity];
            return next;
          });
        });
        room.on(RoomEvent.TrackSubscribed,   sync);
        room.on(RoomEvent.TrackUnsubscribed, sync);

      } catch (err) {
        console.error('LiveKit connect failed:', err);
      }
    };

    socket.on('livekit-token', handleToken);

    return () => {
      socket.off('livekit-token', handleToken);
      roomRef.current?.disconnect();
    };
  }, [roomId, socket, initialMic, initialCam, userName]);

  /* ── Media controls ─────────────────────────────────────── */

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !isMicOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setIsMicOn(next);
  }, [isMicOn]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !isCameraOn;

    if (next) {
      const { track } = await room.localParticipant.setCameraEnabled(true);
      if (track) {
        localCamTrackRef.current = track;
        if (localVideoElRef.current) track.attach(localVideoElRef.current);
      }
    } else {
      await room.localParticipant.setCameraEnabled(false);
      localCamTrackRef.current = null;
    }

    setIsCameraOn(next);
  }, [isCameraOn]);

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setScreenShareEnabled(!isScreenSharing);
    } catch (err) {
      console.error('Screen share failed:', err);
      setIsScreenSharing(false);
    }
  }, [isScreenSharing]);

  const toggleHandRaise = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !isHandRaised;
    setIsHandRaised(next);
    await room.localParticipant.publishData(
      enc({ type: 'hand-raise', value: next }),
      { reliable: true }
    );
  }, [isHandRaised]);

  /* ── Expose to parent ───────────────────────────────────── */
  useEffect(() => {
    onControlsReady?.({ toggleMic, toggleCamera, toggleScreenShare, toggleHandRaise });
  }, [onControlsReady, toggleMic, toggleCamera, toggleScreenShare, toggleHandRaise]);

  useEffect(() => {
    onStatesChange?.({ isMicOn, isCameraOn, isScreenSharing, isHandRaised });
  }, [isMicOn, isCameraOn, isScreenSharing, isHandRaised, onStatesChange]);

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <VideoGrid
      localVideoRef={setLocalVideoRef}                  /* callback ref — fixes black video */
      localParticipant={roomRef.current?.localParticipant}
      participants={participants}
      isMicOn={isMicOn}
      isCameraOn={isCameraOn}
      isScreenSharing={isScreenSharing}
      isHandRaised={isHandRaised}
      isSpeaking={isSpeaking}
      remoteHands={remoteHands}
      onStopSharing={toggleScreenShare}
    />
  );
};

export default VideoChat;

/* ─── helper ─── */
function enc(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}