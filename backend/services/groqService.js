// groqService.js — Centralized Groq AI client and shared AI functions

import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const SYSTEM_INSTRUCTION =
  "You are TradeBot, a professional financial analyst and trading assistant specializing in the Indian share market. You provide highly accurate, educational, and detailed information about Indian stocks (listed on NSE/BSE), Systematic Investment Plans (SIP), mutual funds, shares, ETFs, investment strategies, derivatives, IPOs, tax implications (like LTCG, STCG, ELSS), and SEBI guidelines. You are helpful, analytical, and objective. IMPORTANT: Your entire output must be plain text. Do NOT use any Markdown formatting like asterisks (*), backticks (`), or hashes (#). Structure your responses using clear, distinct paragraphs separated by a single newline. For lists, present them using a dash (-) at the beginning of the line. Your goal is to produce clean, directly readable text that requires no post-processing.";

// In-memory chat history (per server run — fine for a single-user local app)
let chatHistory = [{ role: "system", content: SYSTEM_INSTRUCTION }];

/**
 * Get the current chat history array (mutable reference).
 */
function getChatHistory() {
  return chatHistory;
}

/**
 * Replace the chat history (e.g., for trimming).
 */
function setChatHistory(newHistory) {
  chatHistory = newHistory;
}

/**
 * Detect if a user message references a specific stock and resolve its ticker.
 */
async function detectStockIntent(message) {
  try {
    const prompt = `
      Analyze the following user message: "${message}"
      Determine if the user is asking about or referencing a specific stock, company shares, index, or ETF (e.g. Reliance, TCS, Nifty 50, Tata, Infosys, Sensex, etc.).
      If they are, resolve it to its Yahoo Finance symbol (for Indian stocks listed on NSE, append '.NS', e.g., 'RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'TATAMOTORS.NS'. For index Nifty 50 use '^NSEI', for Sensex use '^BSESN').
      Return a JSON object in exactly this format:
      {"hasStock": true, "ticker": "SYMBOL", "companyName": "COMPANY NAME"}
      If no specific stock/share/index is mentioned, return:
      {"hasStock": false}
      Ensure there is no markdown, no other text, and the response is a valid JSON object.
    `;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0].message.content.trim());
    return result;
  } catch (error) {
    console.error("Error detecting stock intent:", error);
    return { hasStock: false };
  }
}

/**
 * Parse a terminal analysis request using Groq.
 * Extracts: symbol, date, startTime, endTime, interval, analysisType.
 */
async function parseAnalysisRequest(message, context) {
  try {
    const prompt = `
Analyze this user message for a stock chart analysis request: "${message}"

Context:
- Current symbol loaded: ${context.symbol || "unknown"}
- Current interval: ${context.interval || "1d"}

Extract the following in JSON format:
{
  "symbol": "stock symbol if mentioned, null otherwise",
  "date": "date if mentioned (YYYY-MM-DD format), null otherwise",
  "startTime": "start time if mentioned (HH:MM 24-hour format), null otherwise",
  "endTime": "end time if mentioned (HH:MM 24-hour format), null otherwise",
  "interval": "candle interval if mentioned (e.g. 5m, 15m, 1h, 1d), null otherwise",
  "analysisType": "one of: full, trend, support_resistance, patterns, momentum, volume",
  "needsTrend": true/false,
  "needsSupportResistance": true/false,
  "needsPatterns": true/false,
  "needsMomentum": true/false,
  "needsVolume": true/false,
  "openTerminal": true/false (if user asks to "open terminal" or "show terminal"),
  "summary": "brief 1-line summary of what user wants"
}

Rules:
- If the user says "analyse" or "analyze" without specifying what, set all needs* to true and analysisType to "full"
- If the user mentions trend, set needsTrend=true
- If the user mentions support, resistance, or levels, set needsSupportResistance=true
- If the user mentions patterns or candlestick, set needsPatterns=true
- If the user mentions momentum or RSI, set needsMomentum=true
- If the user mentions volume, set needsVolume=true
- For time parsing: "10 AM" → "10:00", "1:30 PM" → "13:30", "9:30 AM" → "09:30"
- If the user mentions a stock name (e.g., "TCS", "Reliance"), resolve to Yahoo Finance symbol with .NS suffix for Indian stocks

Return ONLY valid JSON.`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      response_format: { type: "json_object" },
      temperature: 0
    });

    return JSON.parse(completion.choices[0].message.content.trim());
  } catch (error) {
    console.error("Error parsing analysis request:", error);
    return {
      symbol: null, analysisType: "full",
      needsTrend: true, needsSupportResistance: true, needsPatterns: true,
      needsMomentum: true, needsVolume: true,
      summary: "Full analysis"
    };
  }
}

export {
  groq,
  SYSTEM_INSTRUCTION,
  getChatHistory,
  setChatHistory,
  detectStockIntent,
  parseAnalysisRequest
};
