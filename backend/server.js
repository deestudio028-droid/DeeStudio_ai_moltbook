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

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid messages format" });
    }

    const client = getNvidiaClient();
    const completion = await client.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: messages,
      temperature: 1,
      top_p: 1,
      max_tokens: 4096,
      stream: false,
    });

    const responseMessage = completion.choices[0].message;
    const reasoning = responseMessage.reasoning_content || null;

    res.json({
      content: responseMessage.content,
      reasoning: reasoning,
    });
  } catch (error) {
    console.error("Error calling NVIDIA API:", error.message);
    res.status(500).json({ error: "Failed to generate response" });
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

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
