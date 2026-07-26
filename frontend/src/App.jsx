import { useState, useRef, useEffect } from 'react';
import { Send, Bot, Trash2, Volume2, Loader2, Video, Square } from 'lucide-react';
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
  
  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0); // in seconds
  const recordingFramesRef = useRef([]);
  const recordingIntervalRef = useRef(null);
  const streamRef = useRef(null);
  const videoRef = useRef(null);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const currentAudioRef = useRef(null);

  const playVoice = async (text, index) => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
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
    setPlayingIndex(null);
    const initial = [{ role: 'assistant', content: 'Hello! I am DeeStudio Ai, built by DeeStudio. How can I help you today?' }];
    setMessages(initial);
    localStorage.removeItem('chatMessages');
  };

  // --- RECORD & PLAY WORKFLOW LOGIC ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      streamRef.current = stream;
      
      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();
      videoRef.current = video;

      setIsRecording(true);
      setRecordingTime(0);
      recordingFramesRef.current = [];

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Capture frame every 2 seconds
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 120) { // Auto-stop at 2 minutes
            stopRecording();
            return prev;
          }
          return prev + 1;
        });

        // 1 frame every 2 seconds means we grab a frame on even seconds
        if (recordingTime % 2 === 0 && video.videoWidth > 0 && video.videoHeight > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // Use low quality JPEG to save payload size
          const base64 = canvas.toDataURL('image/jpeg', 0.5); 
          recordingFramesRef.current.push(base64);
        }
      }, 1000); // 1-second interval for timer updates

      // Handle user clicking "Stop Sharing" on browser banner natively
      stream.getVideoTracks()[0].onended = () => {
        stopRecording();
      };

    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  };

  const stopRecording = async () => {
    // Need a functional setState approach to avoid stale closures, 
    // but simple ref/state check is fine if we use a helper inside useEffect.
    // For direct calls, we check isRecording (though it might be slightly stale if triggered by onended).
    setIsRecording(false);
    
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (recordingFramesRef.current.length > 0) {
      await processRecording(recordingFramesRef.current);
      recordingFramesRef.current = [];
    }
  };

  const stitchFrames = (frames) => {
    return new Promise((resolve) => {
      const MAX_FRAMES = 9;
      const sampledFrames = [];
      if (frames.length <= MAX_FRAMES) {
        sampledFrames.push(...frames);
      } else {
        const step = (frames.length - 1) / (MAX_FRAMES - 1);
        for (let i = 0; i < MAX_FRAMES; i++) {
          sampledFrames.push(frames[Math.round(i * step)]);
        }
      }

      const images = [];
      let loadedCount = 0;
      
      sampledFrames.forEach((src, i) => {
        const img = new Image();
        img.onload = () => {
          images[i] = img;
          loadedCount++;
          if (loadedCount === sampledFrames.length) {
            const cols = 1;
            const rows = sampledFrames.length;
            
            const frameW = images[0].width;
            const frameH = images[0].height;
            
            // Limit width to 1280px to keep text readable but file size manageable
            const scale = 1280 / frameW; 
            const drawW = frameW * scale;
            const drawH = frameH * scale;

            const canvas = document.createElement('canvas');
            canvas.width = drawW;
            canvas.height = rows * drawH;
            const ctx = canvas.getContext('2d');
            
            images.forEach((image, index) => {
              const x = 0;
              const y = index * drawH;
              ctx.drawImage(image, x, y, drawW, drawH);
              
              // Draw a semi-transparent background for the text so it's always visible
              ctx.fillStyle = 'rgba(0,0,0,0.7)';
              ctx.fillRect(x, y, 100, 80);
              
              ctx.fillStyle = '#ef4444'; // Red text
              ctx.font = 'bold 48px Arial';
              ctx.fillText((index + 1).toString(), x + 30, y + 55);
            });
            
            // Higher quality JPEG to ensure text is readable
            resolve(canvas.toDataURL('image/jpeg', 0.8));
          }
        };
        img.src = src;
      });
    });
  };

  const processRecording = async (frames) => {
    setIsLoading(true);
    setMessages(prev => [...prev, { role: 'user', content: `[Recorded workflow... Processing frames]` }]);
    
    try {
      const stitchedImage = await stitchFrames(frames);

      const response = await fetch('http://localhost:3001/api/skill/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames: [stitchedImage] })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `I have analyzed your workflow and built a reusable skill for you!\n\n${data.skill}`
      }]);
    } catch (error) {
      console.error("Error generating skill:", error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Sorry, I couldn't process that recording due to an error."
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInput = (e) => {
    setInput(e.target.value);
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
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const assistantMsg = { role: 'assistant', content: '', reasoning: '' };
    setMessages(prev => [...prev, assistantMsg]);

    let fullContent = '';
    let fullReasoning = '';

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
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content') {
              fullContent += parsed.content;
            } else if (parsed.type === 'reasoning') {
              fullReasoning += parsed.content;
            }

            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: 'assistant',
                content: fullContent,
                reasoning: fullReasoning || undefined
              };
              return updated;
            });
          } catch (e) {}
        }
      }

      if (fullContent.trim()) {
        setIsStreaming(false);
        setIsLoading(false);
        setTimeout(() => {
          const lastIndex = newMessages.length;
          playVoice(fullContent, lastIndex);
        }, 300);
        return;
      }

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

  // Format recording time as mm:ss
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
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
      
      {isRecording && (
        <div className="recording-banner" style={{
          background: 'rgba(239, 68, 68, 0.1)',
          borderBottom: '1px solid rgba(239, 68, 68, 0.2)',
          color: '#ef4444',
          padding: '8px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.9rem',
          fontWeight: '500'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="pulse-dot" style={{ width: '8px', height: '8px', background: '#ef4444', borderRadius: '50%', animation: 'blink 1s infinite' }}></div>
            Recording Workflow... ({formatTime(recordingTime)} / 02:00)
          </div>
        </div>
      )}

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
          <button
            className={`record-btn ${isRecording ? 'recording' : ''}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isLoading && !isRecording}
            title={isRecording ? "Stop Recording" : "Record Workflow"}
            style={{
              background: 'transparent',
              border: 'none',
              color: isRecording ? '#ef4444' : '#94a3b8',
              cursor: 'pointer',
              padding: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.2s ease'
            }}
          >
            {isRecording ? <Square size={22} fill="currentColor" /> : <Video size={22} />}
          </button>
          
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            rows={1}
            style={{ flex: 1 }}
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
