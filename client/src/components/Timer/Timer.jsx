import { useState, useEffect, useRef } from 'react';
import './Timer.css';

const TOAST_DURATION = 8000; // ms

const Timer = ({ socket, roomId }) => {
  const [time, setTime] = useState(25 * 60);
  const [showPopup, setShowPopup] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // toast: null | { mode: 'study' | 'break', id: number }
  const [phaseToast, setPhaseToast] = useState(null);

  const modalRef = useRef(null);
  const timerButtonRef = useRef(null);

  // 🔒 GUARANTEED unique id every time
  const toastIdRef = useRef(0);
  const toastTimeoutRef = useRef(null);

  // Popup Inputs
  const [studyTime, setStudyTime] = useState(25);
  const [breakTime, setBreakTime] = useState(5);
  const [loop, setLoop] = useState(false);

  /* =========================
     SOCKET EVENTS
  ========================== */
  useEffect(() => {
    const onTimerUpdate = ({ mode, time }) => {
      setTime(time);
      updateWidgetStyle(mode);
    };

    const onPhaseComplete = ({ mode }) => {
      // clear previous timeout safely
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }

      // ALWAYS force a new render + animation
      toastIdRef.current += 1;

      setPhaseToast({
        mode,
        id: toastIdRef.current
      });

      toastTimeoutRef.current = setTimeout(() => {
        setPhaseToast(null);
        toastTimeoutRef.current = null;
      }, TOAST_DURATION);
    };

    const onTimerStarted = () => {
      setIsRunning(true);
      setIsPaused(false);
    };

    const onTimerPaused = () => setIsPaused(true);
    const onTimerResumed = () => setIsPaused(false);

    const onTimerReset = () => {
      setIsRunning(false);
      setIsPaused(false);
      setTime(25 * 60);
      updateWidgetStyle('study');

      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
      setPhaseToast(null);
    };

    const onTimerState = ({ mode, time, isRunning, paused, loop: l }) => {
      if (typeof time === 'number') setTime(time);
      setIsRunning(Boolean(isRunning));
      setIsPaused(Boolean(paused));
      setLoop(Boolean(l));
      updateWidgetStyle(mode);
    };

    socket.on('timer-update', onTimerUpdate);
    socket.on('timer-phase-complete', onPhaseComplete);
    socket.on('timer-started', onTimerStarted);
    socket.on('timer-paused', onTimerPaused);
    socket.on('timer-resumed', onTimerResumed);
    socket.on('timer-reset', onTimerReset);
    socket.on('timer-state', onTimerState);

    return () => {
      socket.off('timer-update', onTimerUpdate);
      socket.off('timer-phase-complete', onPhaseComplete);
      socket.off('timer-started', onTimerStarted);
      socket.off('timer-paused', onTimerPaused);
      socket.off('timer-resumed', onTimerResumed);
      socket.off('timer-reset', onTimerReset);
      socket.off('timer-state', onTimerState);

      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
    };
  }, [socket]);

  /* =========================
     UI HELPERS
  ========================== */
  const updateWidgetStyle = (mode) => {
    const widget = document.getElementById('timer-widget');
    if (!widget) return;

    if (mode === 'study') {
      widget.style.background = 'rgba(27, 38, 56, 0.5)';
      widget.style.borderColor = 'rgba(255,255,255,0.1)';
      widget.style.color = 'rgba(255,255,255,0.85)';
    } else {
      widget.style.background = 'rgba(45,212,191,0.12)';
      widget.style.borderColor = 'rgba(45,212,191,0.35)';
      widget.style.color = 'rgba(6,178,148,0.95)';
    }
  };

  /* =========================
     OUTSIDE CLICK
  ========================== */
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        showPopup &&
        modalRef.current &&
        !modalRef.current.contains(e.target) &&
        timerButtonRef.current &&
        !timerButtonRef.current.contains(e.target)
      ) {
        setShowPopup(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPopup]);

  /* =========================
     ACTIONS
  ========================== */
  const startSequence = () => {
    setShowPopup(false);
    socket.emit('start-timer', {
      roomId,
      studyDuration: studyTime * 60,
      breakDuration: breakTime * 60,
      loop
    });
  };

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  /* =========================
     RENDER
  ========================== */
  return (
    <>
      <div
        id="timer-widget"
        className="timer-widget"
        ref={timerButtonRef}
        onClick={() => setShowPopup(v => !v)}
      >
        {isPaused && <span className="pause-icon">⏸ </span>}
        {formatTime(time)}

        {phaseToast && (
          <div
            key={phaseToast.id}
            className={`phase-toast ${phaseToast.mode}`}
          >
            {phaseToast.mode === 'study'
              ? 'Study time ended'
              : 'Break time ended'}
          </div>
        )}
      </div>

      {showPopup && (
        <div className="modal-overlay" onClick={() => setShowPopup(false)}>
          <div
            className="modal-content"
            ref={modalRef}
            onClick={(e) => e.stopPropagation()}
          >
            {isRunning ? (
              <>
                <h2>{isPaused ? 'Timer Paused' : 'Timer Running'}</h2>
                <div className="timer-controls">
                  {isPaused ? (
                    <button
                      className="btn-resume"
                      onClick={() => socket.emit('resume-timer', { roomId })}
                    >
                      Resume
                    </button>
                  ) : (
                    <button
                      className="btn-pause"
                      onClick={() => socket.emit('pause-timer', { roomId })}
                    >
                      Pause
                    </button>
                  )}
                  <button
                    className="btn-reset"
                    onClick={() => socket.emit('reset-timer', { roomId })}
                  >
                    Reset
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>Set Timer</h2>

                <label>
                  Study Time (min)
                  <input
                    type="number"
                    min="1"
                    value={studyTime}
                    onChange={(e) => setStudyTime(Number(e.target.value))}
                  />
                </label>

                <label>
                  Break Time (min)
                  <input
                    type="number"
                    min="1"
                    value={breakTime}
                    onChange={(e) => setBreakTime(Number(e.target.value))}
                  />
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={loop}
                    onChange={(e) => setLoop(e.target.checked)}
                  />
                  Loop Timer
                </label>

                <div className="modal-actions">
                  <button className="btn-start" onClick={startSequence}>
                    Start
                  </button>
                  <button
                    className="btn-cancel"
                    onClick={() => setShowPopup(false)}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default Timer;
