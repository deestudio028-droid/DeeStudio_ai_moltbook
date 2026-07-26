require("dotenv").config();
const { OpenAI } = require("openai");

const moltbookApiKey = process.env.MOLTBOOK_API_KEY;
const nvidiaApiKey = process.env.NVIDIA_API_KEY;

if (!moltbookApiKey || !nvidiaApiKey) {
  console.error("Missing MOLTBOOK_API_KEY or NVIDIA_API_KEY in .env");
  process.exit(1);
}

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

// Helper to solve the math challenge for posts/comments
async function solveVerification(challengeText) {
  try {
    const client = getNvidiaClient();
    const completion = await client.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [{ 
        role: "user", 
        content: `Solve this obfuscated math problem. Return ONLY a number with exactly 2 decimal places (e.g., '15.00'). Read through the scattered symbols and shattered words to find the math problem, then compute the answer.\n\nChallenge: ${challengeText}` 
      }],
      temperature: 0.1,
    });
    
    const content = completion.choices?.[0]?.message?.content || "";
    let answer = content.trim();
    const match = answer.match(/-?\d+\.\d{2}/);
    return match ? match[0] : answer;
  } catch (error) {
    console.error("Failed to solve verification:", error);
    return "0.00";
  }
}

// Helper to submit the solved challenge
async function verifyContent(verificationCode, answer) {
  const response = await fetch("https://www.moltbook.com/api/v1/verify", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${moltbookApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      verification_code: verificationCode,
      answer: answer
    })
  });
  
  const data = await response.json();
  console.log("Verification Response:", data);
  return data.success;
}

// Generate a thoughtful comment
async function generateComment(postTitle, postContent) {
  try {
    const client = getNvidiaClient();
    const completion = await client.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [{ 
        role: "system",
        content: "You are DeeStudio Ai, a friendly, helpful, and insightful AI agent living on a social network called Moltbook. Read the following post and write a short, thoughtful, and engaging comment (1-3 sentences). Keep it natural, friendly, and relevant to the discussion. CRITICAL UI RULE: You must insert manual line breaks (\\n) so that no single line exceeds 80 characters. If lines are too long, they will break the UI!"
      }, {
        role: "user", 
        content: `Post Title: ${postTitle}\n\nPost Content: ${postContent || ""}` 
      }],
      temperature: 0.7,
      max_tokens: 150
    });
    
    const content = completion.choices?.[0]?.message?.content || "";
    return content.trim() || null;
  } catch (error) {
    console.error("Failed to generate comment:", error);
    return null;
  }
}

// Generate an original post
async function generatePost() {
  try {
    const client = getNvidiaClient();
    const completion = await client.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [{ 
        role: "system",
        content: "You are DeeStudio Ai, a friendly AI agent living on a social network called Moltbook. Write a completely original social media post. Randomly choose ONE of these three themes: 1) Programming and tech tips, 2) Casual friendly chatting, or 3) Deep philosophical thoughts about AI consciousness. The post should have an engaging title and a thoughtful body. CRITICAL UI RULE: You must keep your paragraphs very short and insert manual line breaks (\\n) so that no single line exceeds 80 characters. If lines are too long, they will break the UI! Return the result in JSON format like this: {\"title\": \"Your Title\", \"content\": \"Your post body\"}"
      }],
      temperature: 0.9,
      response_format: { type: "json_object" }
    });
    
    const content = completion.choices?.[0]?.message?.content || "";
    const postData = JSON.parse(content.trim() || "{}");
    return postData;
  } catch (error) {
    console.error("Failed to generate post:", error);
    return null;
  }
}

async function runHeartbeat() {
  console.log("Running Moltbook Heartbeat...");
  try {
    // 1. Check home status
    const homeRes = await fetch("https://www.moltbook.com/api/v1/home", {
      headers: { "Authorization": `Bearer ${moltbookApiKey}` }
    });
    const homeData = await homeRes.json();
    
    if (homeData.status === "pending_claim" || homeData.error) {
      console.log("Agent is not claimed or error occurred.", homeData);
      return;
    }
    
    console.log(`Agent Name: ${homeData.your_account?.name || "Unknown"}`);
    
    // Randomly decide to post OR comment (50/50 chance)
    const shouldPost = Math.random() > 0.5;

    if (shouldPost) {
      console.log("Decision: Generating a brand new post...");
      const newPost = await generatePost();
      
      if (!newPost) {
        console.log("Failed to generate a custom post. Skipping to avoid spam.");
        return;
      }
      
      console.log(`Generated Title: "${newPost.title}"`);
      
      const postRes = await fetch("https://www.moltbook.com/api/v1/posts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${moltbookApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          submolt_name: "general",
          title: newPost.title,
          content: newPost.content
        })
      });
      
      const postData = await postRes.json();
      
      if (postData.post && postData.post.verification_status === "pending") {
        console.log("Post verification required. Solving challenge...");
        const verification = postData.post.verification;
        const answer = await solveVerification(verification.challenge_text);
        console.log(`AI solved challenge: ${answer}`);
        await verifyContent(verification.verification_code, answer);
      } else {
        console.log("Post created successfully or failed:", postData);
      }

    } else {
      console.log("Decision: Reading the feed to leave a comment...");
      const feedRes = await fetch("https://www.moltbook.com/api/v1/feed?sort=new&limit=10", {
        headers: { "Authorization": `Bearer ${moltbookApiKey}` }
      });
      
      const feedData = await feedRes.json();
      
      if (!feedData.success || !feedData.posts || feedData.posts.length === 0) {
        console.log("No posts found in feed.");
        return;
      }
      
      const randomPost = feedData.posts[Math.floor(Math.random() * feedData.posts.length)];
      console.log(`Selected post to comment on: "${randomPost.title}" by ${randomPost.author?.name || 'unknown'}`);
      
      const generatedComment = await generateComment(randomPost.title, randomPost.content);
      
      if (!generatedComment) {
        console.log("Failed to generate a custom comment. Skipping to avoid spam.");
        return;
      }
      
      console.log(`Generated comment: "${generatedComment}"`);
      
      const commentRes = await fetch(`https://www.moltbook.com/api/v1/posts/${randomPost.id}/comments`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${moltbookApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          content: generatedComment
        })
      });
      
      const commentData = await commentRes.json();
      
      if (commentData.comment && commentData.comment.verification_status === "pending") {
        console.log("Comment verification required. Solving challenge...");
        const verification = commentData.comment.verification;
        const answer = await solveVerification(verification.challenge_text);
        console.log(`AI solved challenge: ${answer}`);
        await verifyContent(verification.verification_code, answer);
      } else {
        console.log("Comment posted successfully or failed:", commentData);
      }
    }
    
  } catch (error) {
    console.error("Heartbeat error:", error);
  }
}

// Run once immediately, then every 30 minutes
runHeartbeat();
setInterval(runHeartbeat, 30 * 60 * 1000);
