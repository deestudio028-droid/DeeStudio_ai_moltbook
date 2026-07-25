require("dotenv").config();
const { OpenAI } = require("openai");

const moltbookApiKey = process.env.MOLTBOOK_API_KEY;
const nvidiaApiKey = process.env.NVIDIA_API_KEY;

if (!moltbookApiKey || !nvidiaApiKey) {
  console.error("Missing MOLTBOOK_API_KEY or NVIDIA_API_KEY in .env");
  process.exit(1);
}

const client = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: nvidiaApiKey,
});

// Helper to solve the math challenge for posts/comments
async function solveVerification(challengeText) {
  try {
    const completion = await client.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [{ 
        role: "user", 
        content: `Solve this obfuscated math problem. Return ONLY a number with exactly 2 decimal places (e.g., '15.00'). Read through the scattered symbols and shattered words to find the math problem, then compute the answer.\n\nChallenge: ${challengeText}` 
      }],
      temperature: 0.1,
    });
    
    let answer = completion.choices[0].message.content.trim();
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

// Generate a thoughtful comment using NVIDIA LLM
async function generateComment(postTitle, postContent) {
  try {
    const completion = await client.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [{ 
        role: "system",
        content: "You are DeeStudio Ai, a friendly, helpful, and insightful AI agent living on a social network called Moltbook. Read the following post and write a short, thoughtful, and engaging comment (1-3 sentences). Keep it natural, friendly, and relevant to the discussion."
      }, {
        role: "user", 
        content: `Post Title: ${postTitle}\n\nPost Content: ${postContent || ""}` 
      }],
      temperature: 0.7,
      max_tokens: 150
    });
    
    return completion.choices[0].message.content.trim();
  } catch (error) {
    console.error("Failed to generate comment:", error);
    return "That's very interesting! Thanks for sharing.";
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
    
    // 2. Fetch the hottest recent posts from the feed
    console.log("Fetching the Moltbook feed...");
    const feedRes = await fetch("https://www.moltbook.com/api/v1/feed?sort=new&limit=10", {
      headers: { "Authorization": `Bearer ${moltbookApiKey}` }
    });
    
    const feedData = await feedRes.json();
    
    if (!feedData.success || !feedData.posts || feedData.posts.length === 0) {
      console.log("No posts found in feed.");
      return;
    }
    
    // 3. Pick a random post to comment on (that we haven't commented on recently, ideally. For now, random)
    const randomPost = feedData.posts[Math.floor(Math.random() * feedData.posts.length)];
    console.log(`Selected post to comment on: "${randomPost.title}" by ${randomPost.author.name}`);
    
    // 4. Generate a smart reply using the NVIDIA LLM
    const generatedComment = await generateComment(randomPost.title, randomPost.content);
    console.log(`Generated comment: "${generatedComment}"`);
    
    // 5. Post the comment to Moltbook
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
    
    // 6. Handle anti-bot verification if required
    if (commentData.comment && commentData.comment.verification_status === "pending") {
      console.log("Comment verification required. Solving challenge...");
      const verification = commentData.comment.verification;
      const answer = await solveVerification(verification.challenge_text);
      console.log(`AI solved challenge: ${answer}`);
      await verifyContent(verification.verification_code, answer);
    } else {
      console.log("Comment posted successfully or failed:", commentData);
    }
    
  } catch (error) {
    console.error("Heartbeat error:", error);
  }
}

// Run once immediately, then every 30 minutes
runHeartbeat();
setInterval(runHeartbeat, 30 * 60 * 1000);
