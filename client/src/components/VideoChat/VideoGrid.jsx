/**
 * VideoGrid.jsx
 *
 * Fixes addressed (confirmed from screenshots):
 *
 * ① 2-participant layout stacked vertically  → rowDef [2] = 1 row of 2
 * ② 5-participant wrong layout (2+2+1 cut)   → rowDef [3,2] = 3 top + 2 bottom
 * ③ 7 & 9 participants on one page           → max 6 tiles per page (1 local + 5 remote)
 * ④ Tiles not filling the screen             → computeTileSize fills container exactly
 * ⑤ Local video black when pinning           → CALLBACK REF pattern (see VideoChat.jsx)
 *
 * LAYOUT RULES (per spec):
 *   1 tile  → [1]       single tile centered
 *   2 tiles → [2]       side by side
 *   3 tiles → [2, 1]    2 top, 1 bottom centered
 *   4 tiles → [2, 2]    2×2
 *   5 tiles → [3, 2]    3 top, 2 bottom centered
 *   6 tiles → [3, 3]    3×2 full grid
 */

import React, {
  useEffect, useRef, useState, useCallback, useMemo, memo,
} from 'react';
import { Track, ParticipantEvent } from 'livekit-client';
import { VideoOff, MicOff, Pin, PinOff, Monitor } from 'lucide-react';
import './VideoGrid.css';

/* ─────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────── */

const GAP    = 8;        // px gap between tiles
const PAD    = 12;       // container padding (all sides)
const ASPECT = 16 / 9;  // tile aspect ratio — never distorted

// Page holds max 6 tiles: 1 local + up to 5 remote
const REMOTE_PER_PAGE = 5;

// Thumbnail dimensions in pinned sidebar
const THUMB_W = 156;
const THUMB_H = Math.round(THUMB_W / ASPECT); // 87px

/**
 * LAYOUT_MAP — row definition per tile count.
 *
 * Each number = tiles in that row.
 * Rows with fewer tiles than the widest row are centered
 * automatically by CSS `justify-content: center` on .vg-row.
 *
 * This is the single source of truth for all layout rules.
 */
const LAYOUT_MAP = {
  1: [1],
  2: [2],
  3: [2, 1],  // 2 top + 1 bottom centered
  4: [2, 2],
  5: [3, 2],  // 3 top + 2 bottom centered  ← this was broken before
  6: [3, 3],
};

/* ─────────────────────────────────────────────
   PURE LAYOUT FUNCTIONS
───────────────────────────────────────────── */

/**
 * computeTileSize
 *
 * Given the container pixel dimensions and the active rowDef,
 * returns { tileW, tileH } in pixels that:
 *   — maintain 16:9 exactly
 *   — fill as much of the container as possible
 *   — never overflow either axis
 *
 * Algorithm:
 *   1. Subtract padding + inter-tile gaps from container size
 *   2. Try width-constrained sizing (tileW = usableW / maxCols)
 *   3. If rows would overflow height → switch to height-constrained
 */
function computeTileSize(containerW, containerH, rowDef) {
  const numRows = rowDef.length;
  const maxCols = Math.max(...rowDef);

  // Usable space after padding and gaps
  const usableW = containerW - PAD * 2 - GAP * (maxCols - 1);
  const usableH = containerH - PAD * 2 - GAP * (numRows - 1);

  if (usableW <= 0 || usableH <= 0) return { tileW: 120, tileH: 68 };

  // Width-constrained
  let tileW = usableW / maxCols;
  let tileH = tileW / ASPECT;

  // If all rows at this height would overflow container height → flip to height-constrained
  if (tileH * numRows > usableH) {
    tileH = usableH / numRows;
    tileW = tileH * ASPECT;
  }

  return {
    tileW: Math.floor(tileW),
    tileH: Math.floor(tileH),
  };
}

/**
 * buildRows
 *
 * Splits a flat tile array into rows per rowDef.
 * Example: ([A,B,C,D,E], [3,2]) → [[A,B,C], [D,E]]
 */
function buildRows(tiles, rowDef) {
  const rows = [];
  let i = 0;
  for (const count of rowDef) {
    if (i >= tiles.length) break;
    rows.push(tiles.slice(i, i + count));
    i += count;
  }
  return rows;
}

/* ─────────────────────────────────────────────
   TILE COMPONENTS
───────────────────────────────────────────── */

/**
 * LocalTile
 *
 * ⚠️  videoRef MUST be a CALLBACK REF from VideoChat — not a plain useRef().
 *
 * Why: when pinnedId changes, this component moves between JSX branches.
 * React destroys the old <video> node and creates a new one. A callback ref
 * fires on every mount, letting VideoChat immediately reattach the camera
 * track to the new DOM element. Plain refs don't fire on remount.
 *
 * sizeStyle is:
 *   { width, height } px values in grid / thumbnail mode
 *   undefined         in pinned-main (CSS fills the parent 100%)
 */
const LocalTile = memo(function LocalTile({
  videoRef, isCameraOn, isMicOn, isSpeaking,
  isHandRaised, isPinned, onTogglePin, sizeStyle, isThumb,
}) {
  return (
    <div
      className={cx('vg-tile vg-tile--local', {
        'is-speaking': isSpeaking,
        'is-pinned':   isPinned,
        'is-thumb':    isThumb,
      })}
      style={sizeStyle}
    >
      {/* Callback ref fires on every mount → VideoChat reattaches the track */}
      <video
        ref={videoRef}
        className={`vg-video vg-video--mirror${isCameraOn ? '' : ' vg-video--hidden'}`}
        muted autoPlay playsInline
      />

      {!isCameraOn && (
        <div className="vg-placeholder">
          <VideoOff size={isThumb ? 20 : 32} />
          <span>You</span>
        </div>
      )}

      <span className="vg-nametag">You{isHandRaised ? ' ✋' : ''}</span>
      {!isMicOn && <span className="vg-micbadge"><MicOff size={13} /></span>}
      {isHandRaised && !isThumb && <span className="vg-handbadge">✋</span>}
      <PinBtn isPinned={isPinned} onClick={onTogglePin} />
    </div>
  );
});

/**
 * RemoteTile — remote participant camera.
 *
 * Stable key = participant.identity ensures this never remounts
 * as long as the same person stays on the page.
 */
const RemoteTile = memo(function RemoteTile({
  participant, isHandRaised, isPinned, onTogglePin, sizeStyle, isThumb,
}) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const [speaking, setSpeaking] = useState(false);
  const [camOn,    setCamOn]    = useState(participant.isCameraEnabled);
  const [micOn,    setMicOn]    = useState(participant.isMicrophoneEnabled);

  useEffect(() => {
    const attach = (track) => {
      if (!track) return;
      if (track.source === Track.Source.Camera && videoRef.current)
        track.attach(videoRef.current);
      if (track.kind === 'audio' && audioRef.current)
        track.attach(audioRef.current);
    };

    // Attach any tracks that arrived before this component mounted
    participant.trackPublications.forEach((pub) => {
      if (pub.track && pub.track.source !== Track.Source.ScreenShare)
        attach(pub.track);
    });

    const sync = () => {
      setCamOn(participant.isCameraEnabled);
      setMicOn(participant.isMicrophoneEnabled);
    };
    const onSpeak = (v) => setSpeaking(v);

    participant.on(ParticipantEvent.IsSpeakingChanged,  onSpeak);
    participant.on(ParticipantEvent.TrackSubscribed,    attach);
    participant.on(ParticipantEvent.TrackSubscribed,    sync);
    participant.on(ParticipantEvent.TrackUnsubscribed,  sync);
    participant.on(ParticipantEvent.TrackMuted,         sync);
    participant.on(ParticipantEvent.TrackUnmuted,       sync);

    return () => {
      participant.off(ParticipantEvent.IsSpeakingChanged, onSpeak);
      participant.off(ParticipantEvent.TrackSubscribed,   attach);
      participant.off(ParticipantEvent.TrackSubscribed,   sync);
      participant.off(ParticipantEvent.TrackUnsubscribed, sync);
      participant.off(ParticipantEvent.TrackMuted,        sync);
      participant.off(ParticipantEvent.TrackUnmuted,      sync);
    };
  }, [participant]);

  return (
    <div
      className={cx('vg-tile vg-tile--remote', {
        'is-speaking': speaking,
        'is-pinned':   isPinned,
        'is-thumb':    isThumb,
      })}
      style={sizeStyle}
    >
      <video
        ref={videoRef}
        className={`vg-video${camOn ? '' : ' vg-video--hidden'}`}
        autoPlay playsInline
      />
      {!camOn && (
        <div className="vg-placeholder">
          <VideoOff size={isThumb ? 20 : 32} />
          <span>{isThumb ? cut(participant.identity, 14) : 'Camera off'}</span>
        </div>
      )}
      <audio ref={audioRef} autoPlay />

      <span className="vg-nametag">
        {cut(participant.identity, 22)}{speaking ? ' 🔊' : ''}
      </span>
      {!micOn && <span className="vg-micbadge"><MicOff size={13} /></span>}
      {isHandRaised && !isThumb && <span className="vg-handbadge">✋</span>}
      <PinBtn isPinned={isPinned} onClick={() => onTogglePin(participant.identity)} />
    </div>
  );
});

/**
 * ScreenShareTile
 *
 * isLocal=true  → shows "You are sharing" indicator (no video needed)
 * isLocal=false → attaches the remote screen-share track
 */
const ScreenShareTile = memo(function ScreenShareTile({
  participant, shareId, isLocal, isPinned,
  onTogglePin, onStopSharing, sizeStyle, isThumb,
}) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (isLocal) return;
    const attach = (track) => {
      if (track?.source === Track.Source.ScreenShare && videoRef.current)
        track.attach(videoRef.current);
    };
    participant.trackPublications.forEach((pub) => {
      if (pub.track?.source === Track.Source.ScreenShare) attach(pub.track);
    });
    participant.on(ParticipantEvent.TrackSubscribed, attach);
    return () => participant.off(ParticipantEvent.TrackSubscribed, attach);
  }, [participant, isLocal]);

  return (
    <div
      className={cx('vg-tile vg-tile--screen', {
        'is-pinned': isPinned,
        'is-thumb':  isThumb,
      })}
      style={sizeStyle}
    >
      {isLocal ? (
        <div className="vg-screen-ind">
          <Monitor size={isThumb ? 22 : 46} />
          {isThumb
            ? <small>Sharing</small>
            : <>
                <p className="vg-screen-label">You are sharing your screen</p>
                <button className="vg-stop-btn" onClick={onStopSharing}>
                  Stop sharing
                </button>
              </>
          }
        </div>
      ) : (
        <video ref={videoRef} className="vg-video vg-video--screen" autoPlay playsInline />
      )}

      <span className="vg-nametag">
        {isLocal ? 'Your Screen' : `${cut(participant.identity, 16)}'s Screen`}
      </span>
      <PinBtn isPinned={isPinned} onClick={() => onTogglePin(shareId)} />
    </div>
  );
});

/** Pin / unpin toggle button */
const PinBtn = memo(function PinBtn({ isPinned, onClick }) {
  return (
    <button
      className={`vg-pin-btn${isPinned ? ' is-active' : ''}`}
      onClick={onClick}
      title={isPinned ? 'Unpin' : 'Pin'}
    >
      {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
    </button>
  );
});

/* ─────────────────────────────────────────────
   MAIN VideoGrid COMPONENT
───────────────────────────────────────────── */

function VideoGrid({
  /**
   * localVideoRef — MUST be a callback ref (function) from VideoChat.
   * This is what prevents the black video bug on pin/unpin.
   * See VideoChat.jsx for implementation details.
   */
  localVideoRef,
  localParticipant,
  participants = [],
  isMicOn,
  isCameraOn,
  isScreenSharing,
  isHandRaised,
  isSpeaking,
  remoteHands = {},
  onStopSharing,
}) {
  const containerRef = useRef(null);

  // Container pixel size — updated by ResizeObserver
  const [size, setSize]             = useState({ w: 0, h: 0 });
  const [pinnedId, setPinnedId]     = useState(null);
  const [currentPage, setCurrentPage] = useState(0);

  const myId       = localParticipant?.identity ?? null;
  const myScreenId = myId ? `${myId}-screen` : null;

  /* ── ResizeObserver ──────────────────────────────────────────
     Fires whenever the container is resized (window resize,
     sidebar toggle, etc.). Updates size → triggers tile recalc.
  ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      setSize({ w: Math.floor(w), h: Math.floor(h) });
    });

    ro.observe(el);

    // Sync initial size synchronously to avoid a flash of wrong layout
    const r = el.getBoundingClientRect();
    setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });

    return () => ro.disconnect();
  }, []);

  /* ── Build remote tile list ──────────────────────────────────
     Order:
       1. Local screen share (if active) — always shows on page 0
       2. Remote cameras
       3. Remote screen shares (immediately after their camera tile)
  ──────────────────────────────────────────────────────────── */
  const remoteTiles = useMemo(() => {
    const tiles = [];

    // Local screen goes first so it always lands on page 0
    if (isScreenSharing && myScreenId) {
      tiles.push({ type: 'local-screen', id: myScreenId });
    }

    participants.forEach((p) => {
      tiles.push({ type: 'remote-cam', id: p.identity, participant: p });

      // If this remote is also screen-sharing, add their screen tile next
      const hasScreen = Array.from(p.trackPublications.values()).some(
        (pub) => pub.track?.source === Track.Source.ScreenShare
      );
      if (hasScreen) {
        tiles.push({ type: 'remote-screen', id: `${p.identity}-screen`, participant: p });
      }
    });

    return tiles;
  }, [participants, isScreenSharing, myScreenId]);

  /* ── Pagination ──────────────────────────────────────────────
     Each page shows up to REMOTE_PER_PAGE (5) remote tiles.
     Local tile is ALWAYS on every page (never paginated out).
     Total tiles per page: 1 local + up to 5 remote = max 6.
  ──────────────────────────────────────────────────────────── */
  const totalPages = Math.max(1, Math.ceil(remoteTiles.length / REMOTE_PER_PAGE));

  // Clamp page index when participants leave and totalPages shrinks
  useEffect(() => {
    setCurrentPage((p) => Math.min(p, Math.max(0, totalPages - 1)));
  }, [totalPages]);

  const canGoPrev = currentPage > 0;
  const canGoNext = currentPage < totalPages - 1;
  const goPrev    = useCallback(() => setCurrentPage((p) => p - 1), []);
  const goNext    = useCallback(() => setCurrentPage((p) => p + 1), []);

  // Remote tiles visible on the current page (slice of 5 max)
  const pageRemotes = remoteTiles.slice(
    currentPage * REMOTE_PER_PAGE,
    currentPage * REMOTE_PER_PAGE + REMOTE_PER_PAGE
  );

  /* ── Layout calculation ──────────────────────────────────────
     pageTileCount = 1 (local) + remotes on this page (0–5) = 1–6
     rowDef is looked up from LAYOUT_MAP (always defined for 1–6)
     tileW / tileH are recalculated whenever container or count changes
  ──────────────────────────────────────────────────────────── */
  const pageTileCount = 1 + pageRemotes.length;
  const rowDef        = LAYOUT_MAP[pageTileCount] || LAYOUT_MAP[6];

  const { tileW, tileH } = useMemo(
    () => computeTileSize(size.w, size.h, rowDef),
    // pageTileCount determines rowDef — treat it as a stable key
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [size.w, size.h, pageTileCount]
  );

  // Memoised style objects to avoid per-render allocation churn
  const gridTileStyle = useMemo(() => ({ width: tileW, height: tileH }), [tileW, tileH]);
  const thumbStyle    = useMemo(() => ({ width: THUMB_W, height: THUMB_H }), []);

  /* ── Pin toggle ───────────────────────────────────────────── */
  const togglePin = useCallback((id) => {
    setPinnedId((prev) => (prev === id ? null : id));
  }, []);

  /* ── Page tile list & grid rows ──────────────────────────────
     pageTiles: [local-cam, ...pageRemotes] — flat ordered list
     gridRows:  split into rows per rowDef (e.g. [[A,B,C],[D,E]])
  ──────────────────────────────────────────────────────────── */
  const pageTiles = useMemo(
    () => [{ type: 'local-cam', id: myId }, ...pageRemotes],
    [myId, pageRemotes]
  );

  const gridRows = useMemo(
    () => buildRows(pageTiles, rowDef),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageTiles, pageTileCount]
  );

  /* ── Pinned mode data ─────────────────────────────────────────
     allTiles: every tile across all pages (for the thumbnail strip)
     thumbnailTiles: allTiles minus the pinned tile
     pinnedDesc: the descriptor object for the pinned tile
  ──────────────────────────────────────────────────────────── */
  const allTiles = useMemo(
    () => [{ type: 'local-cam', id: myId }, ...remoteTiles],
    [myId, remoteTiles]
  );

  const thumbnailTiles = useMemo(
    () => (pinnedId ? allTiles.filter((t) => t.id !== pinnedId) : []),
    [pinnedId, allTiles]
  );

  const pinnedDesc = pinnedId
    ? allTiles.find((t) => t.id === pinnedId) ?? null
    : null;

  /* ── Render helpers ───────────────────────────────────────── */

  /**
   * renderLocal — renders the local camera tile.
   *
   * sizeStyle is undefined in pinned-main (tile fills parent via CSS),
   * gridTileStyle in grid, thumbStyle in sidebar strip.
   */
  const renderLocal = useCallback(
    (sizeStyle, isThumb) => (
      <LocalTile
        key="local-cam"
        videoRef={localVideoRef}      // ← callback ref (the black-video fix)
        isCameraOn={isCameraOn}
        isMicOn={isMicOn}
        isSpeaking={isSpeaking}
        isHandRaised={isHandRaised}
        isPinned={pinnedId === myId}
        onTogglePin={() => togglePin(myId)}
        sizeStyle={sizeStyle}
        isThumb={isThumb}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localVideoRef, isCameraOn, isMicOn, isSpeaking, isHandRaised, pinnedId, myId, togglePin]
  );

  /** renderRemote — renders any non-local tile by descriptor */
  const renderRemote = useCallback(
    (tile, sizeStyle, isThumb) => {
      const common = {
        sizeStyle,
        isThumb,
        isPinned:    pinnedId === tile.id,
        onTogglePin: togglePin,
      };

      if (tile.type === 'remote-cam') {
        return (
          <RemoteTile
            key={tile.id}
            participant={tile.participant}
            isHandRaised={remoteHands[tile.participant.identity] || false}
            {...common}
          />
        );
      }

      if (tile.type === 'remote-screen') {
        return (
          <ScreenShareTile
            key={tile.id}
            participant={tile.participant}
            shareId={tile.id}
            isLocal={false}
            onStopSharing={onStopSharing}
            {...common}
          />
        );
      }

      if (tile.type === 'local-screen') {
        return (
          <ScreenShareTile
            key={tile.id}
            participant={localParticipant}
            shareId={tile.id}
            isLocal
            onStopSharing={onStopSharing}
            {...common}
          />
        );
      }

      return null;
    },
    [pinnedId, togglePin, remoteHands, onStopSharing, localParticipant]
  );

  const isPinnedMode = !!pinnedId;

  /* ── Render ───────────────────────────────────────────────── */
  return (
    <div ref={containerRef} className="vg-root">
      {isPinnedMode ? (
        /* ═══════════════════════════════════════════════
           PINNED LAYOUT
           ┌──────────────────────┬──────────┐
           │   large pinned tile  │ thumb    │
           │                      │ strip    │
           └──────────────────────┴──────────┘
        ═══════════════════════════════════════════════ */
        <div className="vg-pinned-layout">
          {/* Main area — tile fills 100% via CSS .vg-pinned-main .vg-tile */}
          <div className="vg-pinned-main">
            {pinnedDesc?.type === 'local-cam'
              ? renderLocal(undefined, false)
              : pinnedDesc
                ? renderRemote(pinnedDesc, undefined, false)
                : null}
          </div>

          {/* Thumbnail strip — all tiles except the pinned one */}
          <div className="vg-thumb-strip">
            {/* Local cam in strip whenever it's not the pinned tile */}
            {pinnedId !== myId && renderLocal(thumbStyle, true)}

            {thumbnailTiles.map((tile) =>
              tile.type === 'local-cam'
                ? null  // already rendered above
                : renderRemote(tile, thumbStyle, true)
            )}
          </div>
        </div>
      ) : (
        /* ═══════════════════════════════════════════════
           GRID LAYOUT — row by row
           Each .vg-row centers its tiles.
           Partial rows are automatically centered:
             3 tiles → [A B] / [  C  ]
             5 tiles → [A B C] / [  D E  ]
        ═══════════════════════════════════════════════ */
        <div
          className="vg-grid"
          style={{ padding: PAD, gap: GAP }}
        >
          {gridRows.map((rowTiles, rowIdx) => (
            <div key={rowIdx} className="vg-row" style={{ gap: GAP }}>
              {rowTiles.map((tile) =>
                tile.type === 'local-cam'
                  ? renderLocal(gridTileStyle, false)
                  : renderRemote(tile, gridTileStyle, false)
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination — grid mode only, shown when >1 page */}
      {!isPinnedMode && totalPages > 1 && (
        <div className="vg-pagination">
          <button className="vg-pg-btn" onClick={goPrev} disabled={!canGoPrev} aria-label="Prev">
            ‹
          </button>
          <span className="vg-pg-label">{currentPage + 1} / {totalPages}</span>
          <button className="vg-pg-btn" onClick={goNext} disabled={!canGoNext} aria-label="Next">
            ›
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(VideoGrid);

/* ─────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────── */

/** Conditional className builder */
function cx(base, conditions) {
  const extras = Object.entries(conditions)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return extras.length ? `${base} ${extras.join(' ')}` : base;
}

/** Clip string to max chars with ellipsis */
function cut(str, max) {
  if (!str) return '';
  return str.length > max ? `${str.slice(0, max)}…` : str;
}