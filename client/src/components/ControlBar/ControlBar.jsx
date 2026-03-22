import React from 'react';
import './ControlBar.css';

const ControlBar = ({
    isMicOn,
    isCameraOn,
    isScreenSharing,
    isHandRaised,
    onToggleMic,
    onToggleCamera,
    onToggleScreenShare,
    onToggleHandRaise,
    onLeave
}) => {
    return (
        <div className="controls-bar">
            <button
                className={`control-btn ${!isMicOn ? 'off' : ''}`}
                onClick={onToggleMic}
                title={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}
            >
                {isMicOn ? '🎤' : '🔇'}
            </button>

            <button
                className={`control-btn ${!isCameraOn ? 'off' : ''}`}
                onClick={onToggleCamera}
                title={isCameraOn ? 'Turn Off Camera' : 'Turn On Camera'}
            >
                {isCameraOn ? '📹' : '🚫'}
            </button>

            <button
                className={`control-btn ${isScreenSharing ? 'active' : ''}`}
                onClick={onToggleScreenShare}
                title={isScreenSharing ? 'Stop Sharing Screen' : 'Share Screen'}
            >
                {isScreenSharing ? '💻' : '📺'}
            </button>

            <button
                className={`control-btn ${isHandRaised ? 'active' : ''}`}
                onClick={onToggleHandRaise}
                title={isHandRaised ? 'Lower Hand' : 'Raise Hand'}
            >
                ✋
            </button>

            <button
                className="control-btn leave-btn-icon"
                onClick={onLeave}
                title="Leave Room"
            >
                📞
            </button>
        </div>
    );
};

export default ControlBar;
