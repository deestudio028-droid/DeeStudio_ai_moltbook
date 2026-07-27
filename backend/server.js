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
      model: "openai/gpt-oss-120b",
      messages: messages,
      temperature: 1,
      top_p: 1,
      max_tokens: 4096,
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
      const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
      const voiceId = process.env.ELEVENLABS_VOICE_ID;
      
      if (!elevenLabsKey || !voiceId) {
        return res.status(500).json({ error: "ElevenLabs API Key or Voice ID is not configured." });
      }

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": elevenLabsKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("ElevenLabs TTS Error:", response.status, errText);
        return res.status(response.status).json({ error: "ElevenLabs TTS generation failed" });
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      res.set("Content-Type", "audio/mpeg");
      return res.send(buffer);
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
