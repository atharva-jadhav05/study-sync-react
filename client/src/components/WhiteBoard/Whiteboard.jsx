import React, { useRef, useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import './Whiteboard.css';

const Whiteboard = ({ socket, roomId, onClose }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  
  // State
  const [tool, setTool] = useState('pencil'); 
  const [selectedShape, setSelectedShape] = useState('rect'); 
  const [isShapeMenuOpen, setIsShapeMenuOpen] = useState(false);
  
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const [textSize, setTextSize] = useState(20); 
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [textInput, setTextInput] = useState({ x: 0, y: 0, canvasX: 0, canvasY: 0, visible: false, value: '' });

  const ctxRef = useRef(null);
  const startPos = useRef({ x: 0, y: 0 });
  const snapshot = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Canvas Setup
    const CANVAS_WIDTH = 2000; 
    const CANVAS_HEIGHT = 3000; 
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    canvas.style.width = `${CANVAS_WIDTH}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctxRef.current = ctx;

    // Background
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (socket) {
      socket.on('load-history', (history) => history.forEach(item => drawShape(item, false)));
      socket.on('draw-line', (data) => drawShape(data, false));
      socket.on('clear-board', () => {
        const ctx = canvasRef.current.getContext('2d');
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        setTextInput(prev => ({ ...prev, visible: false }));
      });
    }

    return () => {
      if (socket) {
        socket.off('draw-line');
        socket.off('load-history');
        socket.off('clear-board');
      }
    };
  }, [socket]);

  // --- DRAWING ENGINE ---
  const drawShape = (data, shouldEmit = false) => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.size;
    ctx.fillStyle = data.color;

    if (data.tool === 'pencil' || data.tool === 'eraser') {
        ctx.moveTo(data.prevX, data.prevY);
        ctx.lineTo(data.currX, data.currY);
        ctx.stroke();
    } 
    else if (data.tool === 'shape') {
        const { shapeType, startX, startY, endX, endY } = data;
        const w = endX - startX;
        const h = endY - startY;

        if (shapeType === 'line') {
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
        }
        else if (shapeType === 'rect') {
            ctx.strokeRect(startX, startY, w, h);
        }
        else if (shapeType === 'circle') {
            const radius = Math.sqrt(Math.pow(w, 2) + Math.pow(h, 2));
            ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
            ctx.stroke();
        }
        else if (shapeType === 'arrow') {
            const angle = Math.atan2(endY - startY, endX - startX);
            const headlen = 15 + data.size;
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(endX - headlen * Math.cos(angle - Math.PI / 6), endY - headlen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(endX - headlen * Math.cos(angle + Math.PI / 6), endY - headlen * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fill(); 
        }
    }
    else if (data.tool === 'text') {
        ctx.font = `${data.size}px Arial`; 
        ctx.fillText(data.text, data.x, data.y);
    }

    if (shouldEmit && socket) socket.emit('draw-line', data);
  };

  const getMousePos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const scrollTop = containerRef.current.scrollTop;
    
    return { 
        x: e.clientX - rect.left, 
        y: e.clientY - rect.top,
        clientX: e.clientX,
        clientY: e.clientY
    };
  };

  const startDrawing = (e) => {
    const pos = getMousePos(e);
    startPos.current = { x: pos.x, y: pos.y };

    if (tool === 'text') {
        setIsShapeMenuOpen(false);
        setTextInput({ 
            x: pos.clientX, 
            y: pos.clientY, 
            canvasX: pos.x, 
            canvasY: pos.y, 
            visible: true, 
            value: '' 
        });
        return;
    }

    setIsDrawing(true);
    ctxRef.current.beginPath();
    snapshot.current = ctxRef.current.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    setIsShapeMenuOpen(false);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const pos = getMousePos(e);

    if (tool === 'pencil' || tool === 'eraser') {
        drawShape({
            tool,
            roomId, // 🟢 THIS WAS MISSING! FIXES SYNC.
            prevX: startPos.current.x,
            prevY: startPos.current.y,
            currX: pos.x,
            currY: pos.y,
            color: tool === 'eraser' ? '#ffffff' : color,
            size: brushSize
        }, true);
        startPos.current = { x: pos.x, y: pos.y };
    } 
    else if (tool === 'shape') {
        ctxRef.current.putImageData(snapshot.current, 0, 0); 
        drawShape({
            tool: 'shape',
            shapeType: selectedShape,
            startX: startPos.current.x,
            startY: startPos.current.y,
            endX: pos.x,
            endY: pos.y,
            color,
            size: brushSize
        }, false);
    }
  };

  const stopDrawing = (e) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (tool === 'shape') {
        const pos = getMousePos(e);
        drawShape({
            tool: 'shape',
            shapeType: selectedShape,
            roomId,
            startX: startPos.current.x,
            startY: startPos.current.y,
            endX: pos.x,
            endY: pos.y,
            color,
            size: brushSize
        }, true);
    }
  };

  const handleTextSubmit = (e) => {
    if (e.key === 'Enter') {
        drawShape({
            tool: 'text',
            roomId,
            x: textInput.canvasX,
            y: textInput.canvasY,
            text: textInput.value,
            color,
            size: textSize 
        }, true);
        setTextInput({ ...textInput, visible: false });
    }
  };

  const clearBoard = () => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setTextInput({ ...textInput, visible: false });
    if (socket) socket.emit('clear-board', { roomId });
  };

  const downloadPDF = () => {
    const canvas = canvasRef.current;
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
    pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save('StudySync_Notes.pdf');
  };

  const toggleShapeMenu = () => {
      setIsShapeMenuOpen(!isShapeMenuOpen);
      setTool('shape');
  };

  const selectShape = (shape) => {
      setSelectedShape(shape);
      setTool('shape');
      setIsShapeMenuOpen(false); 
  };

  return (
    <div className={`whiteboard-wrapper ${tool === 'eraser' ? 'eraser-mode' : ''}`}>
      
      <div className="whiteboard-sidebar">
        
        <div className="sidebar-top">
            <div className="sidebar-group">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="sidebar-color" title="Color" />
            </div>

            <div className="sidebar-divider"></div>

            <div className="sidebar-group">
                <button className={`sidebar-btn ${tool==='pencil'?'active':''}`} onClick={()=>setTool('pencil')} title="Pencil">
                    <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
                {/* 🧹 NEW BLOCK ERASER ICON */}
                <button className={`sidebar-btn ${tool==='eraser'?'active':''}`} onClick={()=>setTool('eraser')} title="Eraser">
                     <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 01-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0zM4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l1.41-1.41-6.36-6.36-1.42 1.41c-.78.79-.78 2.05 0 2.83z"/></svg>
                </button>
                <button className={`sidebar-btn ${tool==='text'?'active':''}`} onClick={()=>setTool('text')} title="Text">
                    <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" /></svg>
                </button>
            </div>

            {/* SHAPES */}
            <div className="sidebar-group relative-group">
                <button className={`sidebar-btn ${tool==='shape'?'active':''}`} onClick={toggleShapeMenu} title="Shapes">
                   {selectedShape === 'rect' && <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>}
                   {selectedShape === 'circle' && <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle></svg>}
                   {selectedShape === 'arrow' && <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>}
                   {['line','square','diamond'].includes(selectedShape) && <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
                </button>
                
                {/* MENU CONTROLLED BY STATE */}
                <div className="shape-popover" style={{ display: isShapeMenuOpen ? 'flex' : 'none' }}>
                    <div className="shape-popover-inner">
                        <div onClick={()=>selectShape('rect')} title="Rectangle">⬜</div>
                        <div onClick={()=>selectShape('circle')} title="Circle">⚪</div>
                        <div onClick={()=>selectShape('line')} title="Line">📏</div>
                        <div onClick={()=>selectShape('arrow')} title="Arrow">➡️</div>
                    </div>
                </div>
            </div>

            <div className="sidebar-divider"></div>

            <div className="sidebar-group slider-group">
                {tool === 'text' ? (
                    <div className="slider-container" title="Font Size">
                        <span className="slider-label" style={{color:'#aaa', fontSize:'10px'}}>Text</span>
                        <input type="range" min="10" max="100" value={textSize} onChange={(e)=>setTextSize(parseInt(e.target.value))} className="vertical-range" />
                    </div>
                ) : (
                    <div className="slider-container" title="Brush Size">
                        <span className="slider-label" style={{color:'#aaa', fontSize:'10px'}}>Size</span>
                        <input type="range" min="1" max="50" value={brushSize} onChange={(e)=>setBrushSize(parseInt(e.target.value))} className="vertical-range" />
                    </div>
                )}
            </div>
        </div>

        {/* BOTTOM: Actions */}
        <div className="sidebar-bottom">
            <div className="sidebar-group action-group">
                <button onClick={clearBoard} className="sidebar-btn danger" title="Clear Board">
                    <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
                <button onClick={downloadPDF} className="sidebar-btn success" title="Save PDF">
                    <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                </button>
            </div>

            <button onClick={onClose} className="sidebar-btn close-btn" title="Close Board">
                <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>

      </div>

      <div className="canvas-scroll-container" ref={containerRef}>
        <canvas
            ref={canvasRef}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
        />
        {textInput.visible && (
            <input
                type="text"
                autoFocus
                value={textInput.value}
                onChange={(e) => setTextInput({...textInput, value: e.target.value})}
                onKeyDown={handleTextSubmit}
                style={{
                    position: 'fixed',
                    left: textInput.x,
                    top: textInput.y - 15,
                    fontSize: `${textSize}px`,
                    color: color,
                    border: '1px dashed #333',
                    background: 'rgba(255, 255, 255, 0.9)',
                    outline: 'none',
                    minWidth: '50px',
                    zIndex: 20000,
                    padding: '2px 5px',
                    borderRadius: '4px'
                }}
                placeholder="Type..."
            />
        )}
      </div>
    </div>
  );
};

export default Whiteboard;