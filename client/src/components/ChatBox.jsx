import { useState, useEffect, useRef } from 'react';

const ChatBox = ({ socket, roomId }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const chatEndRef = useRef(null);

  useEffect(() => {
    socket.on('chat-message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    return () => socket.off('chat-message');
  }, [socket]);

  // Auto-scroll to bottom when new message arrives
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = () => {
    if (input.trim()) {
      socket.emit('chat-message', { roomId, message: input });
      setInput('');
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-messages" id="chat-box">
        {messages.map((m, i) => (
          <div key={i} className="message">
             {/* Matches your "Sender: Message" format */}
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
            placeholder="Type a message..."
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
};

export default ChatBox;