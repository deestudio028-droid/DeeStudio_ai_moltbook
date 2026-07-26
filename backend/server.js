require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

function getNvidiaVisionClient() {
  const visionKey = process.env.NVIDIA_VISION_API_KEY || nvidiaApiKeys[0];
  if (!visionKey) {
    throw new Error("No NVIDIA API Keys configured for vision.");
  }
  return new OpenAI({
    baseURL: "https://integrate.api.nvidia.com/v1",
    apiKey: visionKey,
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

app.post("/api/skill/generate", async (req, res) => {
  try {
    const { frames } = req.body;
    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: "Frames array is required" });
    }

    const client = getNvidiaVisionClient();

    // Construct the message payload for the vision model
    const contentPayload = [
      {
        type: "text",
        text: "You are DeeStudio Ai. I have provided a single image containing a storyboard grid of screenshots showing a user's screen recording (numbered 1, 2, 3, etc.). Look very closely at the screen contents (e.g. Notepad, desktop, browser). Understand their intent, and package it into a reusable skill. Output a step-by-step text guide AND a Python automation script (using PyAutoGUI). CRITICAL: Do NOT hallucinate. Do NOT make up a workflow about DeeStudio. Describe EXACTLY what is happening on the screen (like opening a text editor, typing specific words, saving a file). If you cannot read the text, state that."
      }
    ];

    // Subsample frames to maximum of 8 evenly spaced frames to prevent API payload errors
    const MAX_FRAMES = 8;
    const sampledFrames = [];
    if (frames.length <= MAX_FRAMES) {
      sampledFrames.push(...frames);
    } else {
      const step = (frames.length - 1) / (MAX_FRAMES - 1);
      for (let i = 0; i < MAX_FRAMES; i++) {
        sampledFrames.push(frames[Math.round(i * step)]);
      }
    }

    // Add each sampled frame as an image_url
    for (const frameBase64 of sampledFrames) {
      contentPayload.push({
        type: "image_url",
        image_url: { url: frameBase64 }
      });
    }

    const completion = await client.chat.completions.create({
      model: "meta/llama-3.2-90b-vision-instruct",
      messages: [
        {
          role: "user",
          content: contentPayload
        }
      ],
      temperature: 0.2,
      max_tokens: 2048,
    });

    const skillText = completion.choices?.[0]?.message?.content || "Failed to generate skill.";
    res.json({ skill: skillText });

  } catch (error) {
    console.error("Error generating skill:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to generate skill from workflow" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
