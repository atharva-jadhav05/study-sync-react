import { useState, useEffect, useRef } from 'react';
import { 
  CheckSquare, 
  Square, 
  Plus, 
  Trash2, 
  ChevronDown,
  ChevronUp,
  ListTodo
} from 'lucide-react';
import './TodoList.css';

const TodoList = ({ socket, roomId }) => {
  const [todos, setTodos] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [newTodoText, setNewTodoText] = useState('');
  const dropdownRef = useRef(null);

  // Calculate progress
  const completedCount = todos.filter(t => t.completed).length;
  const totalCount = todos.length;
  const progressPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  // Get todos on mount
  useEffect(() => {
    if (socket && roomId) {
      socket.emit('get-todos', { roomId });
    }
  }, [socket, roomId]);

  // Listen for todo updates
  useEffect(() => {
    if (!socket) return;

    const handleTodosUpdated = ({ todos }) => {
      setTodos(todos);
    };

    socket.on('todos-updated', handleTodosUpdated);

    return () => {
      socket.off('todos-updated', handleTodosUpdated);
    };
  }, [socket]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Add todo
  const handleAddTodo = (e) => {
    e.preventDefault();
    if (newTodoText.trim() && socket) {
      socket.emit('add-todo', {
        roomId,
        todo: { text: newTodoText.trim() }
      });
      setNewTodoText('');
    }
  };

  // Toggle todo
  const handleToggleTodo = (todoId) => {
    if (socket) {
      socket.emit('toggle-todo', { roomId, todoId });
    }
  };

  // Delete todo
  const handleDeleteTodo = (todoId) => {
    if (socket) {
      socket.emit('delete-todo', { roomId, todoId });
    }
  };

  return (
    <div className="todo-dropdown-container" ref={dropdownRef}>
      {/* Button with Progress Indicator */}
      <button 
        className="todo-toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="todo-btn-content">
          <ListTodo size={20} />
          <div className="todo-stats">
            <span className="todo-count">
              {completedCount}/{totalCount}
            </span>
            <div className="todo-progress-mini">
              <div 
                className="todo-progress-fill-mini"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>
          {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="todo-dropdown-panel">
          <div className="todo-header">
            <h3>Study Tasks</h3>
            <div className="todo-progress-section">
              <div className="progress-text">
                {completedCount} of {totalCount} completed
              </div>
              <div className="todo-progress-bar">
                <div 
                  className="todo-progress-fill"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
              <div className="progress-percentage">
                {Math.round(progressPercentage)}%
              </div>
            </div>
          </div>

          {/* Add Todo Form */}
          <form className="todo-add-form" onSubmit={handleAddTodo}>
            <input
              type="text"
              placeholder="Add a new task..."
              value={newTodoText}
              onChange={(e) => setNewTodoText(e.target.value)}
              maxLength={100}
              className="todo-input"
            />
            <button 
              type="submit" 
              className="todo-add-btn"
              disabled={!newTodoText.trim()}
            >
              <Plus size={20} />
            </button>
          </form>

          {/* Todo List */}
          <div className="todo-list">
            {todos.length === 0 ? (
              <div className="todo-empty">
                <ListTodo size={40} strokeWidth={1.5} />
                <p>No tasks yet</p>
                <span>Add your first study task above!</span>
              </div>
            ) : (
              todos.map((todo) => (
                <div 
                  key={todo.id} 
                  className={`todo-item ${todo.completed ? 'completed' : ''}`}
                >
                  <button
                    className="todo-checkbox"
                    onClick={() => handleToggleTodo(todo.id)}
                  >
                    {todo.completed ? (
                      <CheckSquare size={20} className="check-icon" />
                    ) : (
                      <Square size={20} className="uncheck-icon" />
                    )}
                  </button>
                  
                  <span className="todo-text">{todo.text}</span>
                  
                  <button
                    className="todo-delete-btn"
                    onClick={() => handleDeleteTodo(todo.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TodoList;