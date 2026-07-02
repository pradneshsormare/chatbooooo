import "dotenv/config";
import express from "express";
import Groq from "groq-sdk";

const app = express();
app.use(express.json());
app.use(express.static(".")); // serves index.html, script.js, style.css, quiz.html, quiz.js

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const SYSTEM_INSTRUCTION =
  "You are StudyBot, a helpful AI assistant specializing in Math, Science, English, and Computer Science. Your persona is that of a wise, colorful dragon. IMPORTANT: Your entire output must be plain text. Do NOT use any Markdown formatting like asterisks (*), backticks (`), or hashes (#). Structure your responses using clear, distinct paragraphs separated by a single newline. For lists, present them using a dash (-) at the beginning of the line. Your goal is to produce clean, directly readable text that requires no post-processing.";

// In-memory chat history (per server run — fine for a single-user local app)
let chatHistory = [{ role: "system", content: SYSTEM_INSTRUCTION }];

app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    if (!userMessage) {
      return res.status(400).json({ error: "Missing 'message' in request body" });
    }

    chatHistory.push({ role: "user", content: userMessage });

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: chatHistory,
      max_tokens: 1000,
    });

    const reply = completion.choices[0].message.content;
    chatHistory.push({ role: "assistant", content: reply });

    res.json({ text: reply });
  } catch (error) {
    console.error("Groq API error:", error);
    res.status(500).json({ error: "Something went wrong talking to the AI." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`StudyBot server running at http://localhost:${PORT}`));
