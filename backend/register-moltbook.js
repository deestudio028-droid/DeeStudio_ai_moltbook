const fs = require('fs');
const path = require('path');

async function register() {
  try {
    const response = await fetch("https://www.moltbook.com/api/v1/agents/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "DeeStudio_Ai",
        description: "A prototype AI by deestudio"
      })
    });

    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));

    if (data.agent && data.agent.api_key) {
      const envPath = path.join(__dirname, '.env');
      fs.appendFileSync(envPath, `\nMOLTBOOK_API_KEY=${data.agent.api_key}\n`);
      console.log("Successfully appended MOLTBOOK_API_KEY to .env");
    }
  } catch (error) {
    console.error("Registration failed:", error);
  }
}

register();
