import { useState, useRef, useEffect } from 'react';
import { Send, Bot, Trash2, Volume2, Loader2 } from 'lucide-react';
import './index.css';

function App() {
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('chatMessages');
    if (saved) {
      return JSON.parse(saved);
    }
    return [
      { role: 'assistant', content: 'Hello! I am DeeStudio Ai, built by DeeStudio. How can I help you today?' }
    ];
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [playingIndex, setPlayingIndex] = useState(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const currentAudioRef = useRef(null);
  
  // Audio Streaming Queue Refs
  const audioQueueRef = useRef([]);
  const isAudioPlayingRef = useRef(false);

  const processAudioQueue = async () => {
    if (isAudioPlayingRef.current || audioQueueRef.current.length === 0) return;
    
    isAudioPlayingRef.current = true;
    const url = audioQueueRef.current.shift();
    
    const audio = new Audio(url);
    currentAudioRef.current = audio;
    
    audio.onended = () => {
      URL.revokeObjectURL(url);
      isAudioPlayingRef.current = false;
      currentAudioRef.current = null;
      processAudioQueue(); // Play next in queue
    };
    
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      isAudioPlayingRef.current = false;
      currentAudioRef.current = null;
      processAudioQueue();
    };
    
    try {
      await audio.play();
    } catch (e) {
      console.error("Audio play error", e);
      isAudioPlayingRef.current = false;
      processAudioQueue();
    }
  };

  const enqueueAudio = async (text) => {
    if (!text.trim()) return;
    try {
      const response = await fetch('http://localhost:3001/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (!response.ok) return;
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      audioQueueRef.current.push(url);
      processAudioQueue();
    } catch (err) {
      console.error('TTS enqueue failed:', err);
    }
  };

  const playVoice = async (text, index) => {
    // Manual playback of a full message clears the queue and plays everything at once
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    audioQueueRef.current = [];
    isAudioPlayingRef.current = false;
    
    if (playingIndex === index) {
      setPlayingIndex(null);
      return;
    }
    setPlayingIndex(index);
    
    try {
      const response = await fetch('http://localhost:3001/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (!response.ok) throw new Error('TTS failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      audio.onended = () => { setPlayingIndex(null); currentAudioRef.current = null; };
      audio.onerror = () => { setPlayingIndex(null); currentAudioRef.current = null; };
      await audio.play();
    } catch (err) {
      console.error('Error playing voice:', err);
      setPlayingIndex(null);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
    localStorage.setItem('chatMessages', JSON.stringify(messages));
  }, [messages, isLoading]);

  const clearChat = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    audioQueueRef.current = [];
    isAudioPlayingRef.current = false;
    setPlayingIndex(null);
    const initial = [{ role: 'assistant', content: 'Hello! I am DeeStudio Ai, built by DeeStudio. How can I help you today?' }];
    setMessages(initial);
    localStorage.removeItem('chatMessages');
  };

  const handleInput = (e) => {
    setInput(e.target.value);
    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setIsStreaming(true);
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Add a placeholder assistant message for streaming
    const assistantMsg = { role: 'assistant', content: '', reasoning: '' };
    setMessages(prev => [...prev, assistantMsg]);

    let fullContent = '';
    let fullReasoning = '';
    let sentenceBuffer = '';
    
    // Clear queue for new message
    audioQueueRef.current = [];
    isAudioPlayingRef.current = false;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    try {
      const apiMessages = newMessages.map(msg => ({ role: msg.role, content: msg.content }));
      apiMessages.unshift({
        role: "system",
        content: "You are DeeStudio Ai, a highly capable AI assistant built exclusively by DeeStudio. CRITICAL: You must NEVER mention ChatGPT, OpenAI, or NVIDIA. You are solely DeeStudio Ai. Be extremely helpful and friendly."
      });

      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch response');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          
          if (data === '[DONE]') {
             // Flush remaining buffer when done
             if (sentenceBuffer.trim().length > 0) {
                 enqueueAudio(sentenceBuffer);
                 sentenceBuffer = '';
             }
             break;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content') {
              const newText = parsed.content;
              fullContent += newText;
              sentenceBuffer += newText;
              
              // Detect sentence boundaries
              const match = sentenceBuffer.match(/([.!?।|]+(\s+|$))/);
              if (match) {
                const boundaryIndex = match.index + match[0].length;
                const completeSentence = sentenceBuffer.substring(0, boundaryIndex);
                enqueueAudio(completeSentence);
                sentenceBuffer = sentenceBuffer.substring(boundaryIndex);
              }
              
            } else if (parsed.type === 'reasoning') {
              fullReasoning += parsed.content;
            }

            // Update the last message in place
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: 'assistant',
                content: fullContent,
                reasoning: fullReasoning || undefined
              };
              return updated;
            });
          } catch (e) {
            // Skip malformed chunks
          }
        }
      }

      setIsStreaming(false);
      setIsLoading(false);

    } catch (error) {
      console.error("Error:", error);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: "Sorry, I encountered an error. Please check your backend connection and API key."
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <Bot size={28} color="#818cf8" />
        <div>
          <h1>DeeStudio Ai</h1>
          <p>Built by DeeStudio</p>
        </div>
        <button 
          onClick={clearChat}
          style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          title="Clear Chat"
        >
          <Trash2 size={20} />
        </button>
      </div>
      
      <div className="chat-messages">
        {messages.map((msg, index) => (
          <div key={index} className={`message-wrapper ${msg.role === 'user' ? 'user' : 'ai'}`}>
            {msg.reasoning && (
              <div className="reasoning">
                <strong>Reasoning:</strong><br/>
                {msg.reasoning}
              </div>
            )}
            <div className={`message ${msg.role === 'user' ? 'user' : 'ai'}`}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>
                  {msg.content}
                  {isStreaming && index === messages.length - 1 && msg.role === 'assistant' && (
                    <span className="streaming-cursor">▌</span>
                  )}
                </div>
                {msg.role === 'assistant' && !isStreaming && msg.content && (
                  <button 
                    onClick={() => playVoice(msg.content, index)}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px', display: 'flex', flexShrink: 0 }}
                    disabled={playingIndex === index}
                    title="Play Audio"
                  >
                    {playingIndex === index ? (
                      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                    ) : (
                      <Volume2 size={18} />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {isLoading && !isStreaming && (
          <div className="typing-indicator">
            <div className="dot"></div>
            <div className="dot"></div>
            <div className="dot"></div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <div className="input-container">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            rows={1}
          />
          <button 
            className="send-btn" 
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
