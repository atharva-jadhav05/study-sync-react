import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import './ChatBox.css';

const ChatBox = ({ socket, roomId }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0); 
  
  // Refs for "Click Outside" logic
  const chatWindowRef = useRef(null);
  const toggleBtnRef = useRef(null);

  // Ref to track state inside event listeners
  const isOpenRef = useRef(false);
  const chatEndRef = useRef(null);
  
  const location = useLocation();
  const userName = location.state?.userName || 'Guest'; 

  // 1. Socket Listener
  useEffect(() => {
    socket.on('chat-message', (msg) => {
      setMessages((prev) => [...prev, msg]);
      
      // Increment badge only if chat is CLOSED
      if (!isOpenRef.current) {
        setUnreadCount(prev => prev + 1);
      }
    });
    return () => socket.off('chat-message');
  }, [socket]);

  // 2. Auto-scroll
  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // 3. 🚀 NEW: Click Outside to Close
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        isOpen && 
        chatWindowRef.current && 
        !chatWindowRef.current.contains(event.target) && // Clicked outside window
        toggleBtnRef.current && 
        !toggleBtnRef.current.contains(event.target)     // Clicked outside toggle button
      ) {
        setIsOpen(false);
        isOpenRef.current = false;
      }
    };

    // Bind the event listener
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      // Unbind the event listener on cleanup
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const sendMessage = () => {
    if (input.trim()) {
      socket.emit('chat-message', { 
        roomId, 
        message: input,
        sender: userName 
      });
      setInput('');
    }
  };

  const toggleChat = () => {
    setIsOpen(prev => {
      const newState = !prev;
      isOpenRef.current = newState;
      if (newState) setUnreadCount(0);
      return newState;
    });
  };

  return (
    <div className="chat-widget">
      
      {/* THE CHAT WINDOW */}
      {/* Attached ref={chatWindowRef} so we know if clicks are inside here */}
      <div 
        className={`chat-window ${isOpen ? 'open' : ''}`} 
        ref={chatWindowRef}
      >
        <div className="chat-header">
            <span>Chat Room</span>
            <button onClick={() => setIsOpen(false)} className="close-mini-btn">×</button>
        </div>

        <div className="chat-messages">
          {messages.map((m, i) => (
            <div key={i} className="message">
               <strong>{m.sender}:</strong> {m.message}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="chat-input-area">
          <input 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder={`Chat as ${userName}...`}
          />
          <button onClick={sendMessage}>Send</button>
        </div>
      </div>

      {/* THE TOGGLE BUTTON */}
      {/* Attached ref={toggleBtnRef} so clicking this doesn't trigger the 'close' logic immediately */}
      <button 
        className="chat-toggle-btn" 
        onClick={toggleChat}
        ref={toggleBtnRef}
      >
        💬
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount}</span>
        )}
      </button>

    </div>
  );
};

export default ChatBox;