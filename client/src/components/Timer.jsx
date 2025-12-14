import { useState, useEffect } from 'react';

const Timer = ({ socket, roomId }) => {
  const [time, setTime] = useState(25 * 60);
  const [showPopup, setShowPopup] = useState(false);
  
  // Popup Inputs
  const [studyTime, setStudyTime] = useState(25);
  const [breakTime, setBreakTime] = useState(5);
  const [loop, setLoop] = useState(false);

  useEffect(() => {
    socket.on('timer-update', ({ mode, time }) => {
      setTime(time);
      // Optional: Change color based on mode
      const widget = document.getElementById('timer-widget');
      if(widget) widget.style.background = mode === 'study' ? '#111121' : '#2d1b02';
    });
    return () => socket.off('timer-update');
  }, [socket]);

  const startSequence = () => {
    setShowPopup(false);
    socket.emit('start-timer', {
      roomId,
      studyDuration: studyTime * 60,
      breakDuration: breakTime * 60,
      loop
    });
  };

  const formatTime = (s) => {
    const min = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  };

  return (
    <>
      <div id="timer-widget" className="timer-widget" onClick={() => setShowPopup(true)}>
        {formatTime(time)}
      </div>

      {showPopup && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Set Timer</h2>
            
            <label>
              Study Time (min):
              <input type="number" value={studyTime} onChange={e => setStudyTime(e.target.value)} />
            </label>
            
            <label>
              Break Time (min):
              <input type="number" value={breakTime} onChange={e => setBreakTime(e.target.value)} />
            </label>
            
            <label style={{justifyContent: 'flex-start', gap: '10px'}}>
              <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />
              Loop Timer
            </label>

            <div className="modal-actions">
              <button className="btn-start" onClick={startSequence}>Start</button>
              <button className="btn-cancel" onClick={() => setShowPopup(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Timer;