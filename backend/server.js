require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Parse comma-separated keys for rotation
const nvidiaApiKeysRaw = process.env.NVIDIA_API_KEYS || process.env.NVIDIA_API_KEY || "";
const nvidiaApiKeys = nvidiaApiKeysRaw.split(',').map(k => k.trim()).filter(k => k);
let currentKeyIndex = 0;

function getNvidiaClient() {
  if (nvidiaApiKeys.length === 0) {
    throw new Error("No NVIDIA API Keys configured.");
  }
  const key = nvidiaApiKeys[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % nvidiaApiKeys.length;
  return new OpenAI({
    baseURL: "https://integrate.api.nvidia.com/v1",
    apiKey: key,
  });
}

// Streaming chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid messages format" });
    }

    const client = getNvidiaClient();

    // Set headers for Server-Sent Events (SSE)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await client.chat.completions.create({
      model: "meta/llama-3.1-8b-instruct",
      messages: messages,
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 1024,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      // Send reasoning tokens
      if (delta.reasoning_content) {
        res.write(`data: ${JSON.stringify({ type: "reasoning", content: delta.reasoning_content })}\n\n`);
      }

      // Send content tokens
      if (delta.content) {
        res.write(`data: ${JSON.stringify({ type: "content", content: delta.content })}\n\n`);
      }
    }

    // Signal end of stream
    res.write(`data: [DONE]\n\n`);
    res.end();

  } catch (error) {
    console.error("Error calling NVIDIA API:", error.message);
    // If headers haven't been sent yet, send JSON error
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate response" });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", content: "Stream interrupted." })}\n\n`);
      res.end();
    }
  }
});

app.post("/api/synthesize", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    // Check for Tamil characters (Unicode block 0B80-0BFF)
    const hasTamil = /[\u0B80-\u0BFF]/.test(text);

    if (hasTamil) {
      try {
        // Split into sentences for faster response. 
        // Only synthesize the first meaningful sentence to get audio playing ASAP.
        // Tamil sentence endings: । . ! ?
        const sentenceEnders = /([.!?।]\s+|\n)/;
        const sentences = text.split(sentenceEnders).filter(s => s && s.trim().length > 2 && !/^[.!?।\s]+$/.test(s));
        const firstChunk = sentences.length > 0 ? sentences[0].trim() : text.trim();
        // Ensure it's not too long for the model
        const ttsText = firstChunk.length > 200 ? firstChunk.substring(0, 200) : firstChunk;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000); // 25s hard timeout

        const response = await fetch('http://localhost:5000/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: ttsText }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const errText = await response.text();
          console.error("Local Indic-TTS Error:", response.status, errText);
          return res.status(response.status).json({ error: "Local Indic-TTS generation failed" });
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.set("Content-Type", "audio/wav");
        return res.send(buffer);
      } catch (error) {
        if (error.name === 'AbortError') {
          console.error("TTS microservice timed out after 25s");
          return res.status(504).json({ error: "TTS timed out" });
        }
        console.error("Failed to connect to local TTS microservice:", error.message);
        return res.status(500).json({ error: "TTS microservice is unreachable" });
      }
    }

    // Fallback to NVIDIA TTS for Non-Tamil
    const voiceApiKey = process.env.NVIDIA_VOICE_API_KEY || process.env.NVIDIA_API_KEY;
    if (!voiceApiKey) {
      return res.status(500).json({ error: "Voice API Key is not configured." });
    }

    // Node 18+ has native fetch and FormData
    const formData = new FormData();
    formData.append("text", text);
    formData.append("language", "en-US");
    formData.append("voice", "Magpie-Multilingual.EN-US.Ray");
    formData.append("encoding", "LINEAR_PCM");
    formData.append("sample_rate_hz", "44100");

    const response = await fetch("https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/v1/audio/synthesize", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${voiceApiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("TTS API Error:", response.status, errText);
      return res.status(response.status).json({ error: "TTS generation failed" });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    res.set("Content-Type", "audio/wav");
    res.send(buffer);
  } catch (error) {
    console.error("Error in synthesize:", error);
    res.status(500).json({ error: "Server error during synthesis" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
