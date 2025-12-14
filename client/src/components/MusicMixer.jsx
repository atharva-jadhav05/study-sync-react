import { useState, useRef } from 'react';

const MusicMixer = () => {
  const [showMenu, setShowMenu] = useState(false);
  
  const [volumes, setVolumes] = useState({
    lofi: 0,
    waves: 0,
    rain: 0,
    fireplace: 0,
    birds: 0
  });

  const audioRefs = {
    lofi: useRef(null),
    waves: useRef(null),
    rain: useRef(null),
    fireplace: useRef(null),
    birds: useRef(null)
  };

  const toggleMenu = () => setShowMenu(!showMenu);

  const handleVolumeChange = (sound, val) => {
    const newVolume = parseFloat(val);
    setVolumes(prev => ({ ...prev, [sound]: newVolume }));

    const audio = audioRefs[sound].current;
    if (audio) {
      audio.volume = newVolume;
      if (newVolume > 0 && audio.paused) audio.play().catch(console.error);
      else if (newVolume === 0) audio.pause();
    }
  };

  return (
    <div className="music-wrapper">
      <button className="music-btn" onClick={toggleMenu} style={{ fontWeight: 'bold', fontSize: '0.9rem', width: 'auto', padding: '0 15px' }}>
        Music 🎵
      </button>

      {showMenu && (
        <div className="music-menu">
          <div className="sound-row">
            <label>Lofi Beats</label>
            <input type="range" min="0" max="1" step="0.01" value={volumes.lofi} onChange={(e) => handleVolumeChange('lofi', e.target.value)} className="volume-slider" />
          </div>
          <div className="sound-row">
            <label>Ocean Waves</label>
            <input type="range" min="0" max="1" step="0.01" value={volumes.waves} onChange={(e) => handleVolumeChange('waves', e.target.value)} className="volume-slider" />
          </div>
          <div className="sound-row">
            <label>Heavy Rain</label>
            <input type="range" min="0" max="1" step="0.01" value={volumes.rain} onChange={(e) => handleVolumeChange('rain', e.target.value)} className="volume-slider" />
          </div>
          <div className="sound-row">
            <label>Fireplace</label>
            <input type="range" min="0" max="1" step="0.01" value={volumes.fireplace} onChange={(e) => handleVolumeChange('fireplace', e.target.value)} className="volume-slider" />
          </div>
          <div className="sound-row">
            <label>Forest Birds</label>
            <input type="range" min="0" max="1" step="0.01" value={volumes.birds} onChange={(e) => handleVolumeChange('birds', e.target.value)} className="volume-slider" />
          </div>
        </div>
      )}

      <audio ref={audioRefs.lofi} loop src="/sounds/lofi.mp3" />
      <audio ref={audioRefs.waves} loop src="/sounds/waves.mp3" />
      <audio ref={audioRefs.rain} loop src="/sounds/rain.mp3" />
      <audio ref={audioRefs.fireplace} loop src="/sounds/fireplace.mp3" />
      <audio ref={audioRefs.birds} loop src="/sounds/birds.mp3" />
    </div>
  );
};

export default MusicMixer;