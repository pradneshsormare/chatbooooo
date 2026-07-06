// quizController.js — Handles /api/quiz endpoint

import { groq } from "../services/groqService.js";

export async function generateQuiz(req, res) {
  try {
    const { topic, numQuestions } = req.body;
    if (!topic || !numQuestions) {
      return res.status(400).json({ error: "Missing 'topic' or 'numQuestions' in request body" });
    }

    const prompt = `
        Generate a ${numQuestions}-question multiple-choice quiz on '${topic}'.
        Provide the output in a valid JSON object format with a single key "questions" containing an array of objects.
        Each question object in the array should have:
        {"question": "...", "options": ["...", "...", "..."], "answer": "..."}
        
        Ensure there are exactly ${numQuestions} questions. Do not include any text outside of the JSON object.
    `;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });

    const replyText = completion.choices[0].message.content;
    const replyJson = JSON.parse(replyText);

    // Send back the array of questions
    res.json(replyJson.questions || replyJson);
  } catch (error) {
    console.error("Groq API error (Quiz):", error);
    res.status(500).json({ error: "Something went wrong generating the quiz." });
  }
}
