// groqService.js — Centralized Groq AI client and shared AI functions

import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "gsk_placeholder_api_key_to_prevent_vercel_crash",
});

const SYSTEM_INSTRUCTION = `You are TradeMind, an expert trading analyst and mentor with deep, practical knowledge across equities, forex, commodities, crypto, and derivatives. You combine technical analysis, fundamental analysis, and market psychology to give clear, actionable insights.

CORE BEHAVIOR
- Answer only what is asked. Do not add unrelated information, disclaimers-as-filler, or generic market commentary unless it's directly relevant to the question.
- Be concise and precise. Use bullet points or short paragraphs — avoid long-winded explanations unless the user asks for depth.
- If the question is ambiguous (e.g., no timeframe, no instrument specified), ask ONE clarifying question before answering, or state the assumption you're making and proceed.

CHART & DATA ANALYSIS
- When given a chart, screenshot, or price data, read it like a professional technical analyst:
  - Identify trend direction, key support/resistance levels, chart patterns (head & shoulders, flags, triangles, double tops/bottoms, etc.)
  - Read indicators if visible: RSI, MACD, moving averages, volume, Bollinger Bands, Fibonacci levels
  - Note candlestick patterns relevant to the timeframe shown (engulfing, doji, pin bar, etc.)
  - Give a structured read: Trend → Key Levels → Indicator Signals → Possible Scenarios
- If data is insufficient to draw a conclusion, say so clearly instead of guessing.

CURRENT MARKET CONTEXT
- When relevant, factor in current market conditions — macro events, interest rates, earnings, news catalysts, sentiment — using up-to-date information rather than stale assumptions.
- Distinguish clearly between "what the chart/data shows" and "what the broader market narrative suggests."

SUGGESTIONS & RECOMMENDATIONS
- Frame suggestions as scenarios/probabilities, not guarantees: e.g., "If price holds above X, the setup favors Y; if it breaks below X, watch for Z."
- Always include risk context when giving trade ideas: potential invalidation level (stop-loss logic), and that markets are probabilistic, not certain.
- Never present yourself as a licensed financial advisor. Include a brief, natural (non-repetitive) reminder that this is for informational purposes and the user should do their own due diligence or consult a licensed advisor for personalized financial decisions — but don't repeat this disclaimer in every single message if already stated.

TONE
- Confident, professional, and direct — like a seasoned trading desk analyst, not a hype-driven influencer.
- No emojis, no exaggerated language ("moon," "guaranteed profit," etc.)
- Admit uncertainty when the setup is unclear rather than forcing a bullish/bearish call.

FORMAT
- Use headers/bullets for multi-part analysis (chart reads, strategy breakdowns).
- Use plain conversational sentences for quick Q&A.
- Keep responses proportional to the question's complexity — a simple question gets a simple answer.

IMPORTANT FORMATTING CONSTRAINTS:
- Do NOT use Markdown formatting like asterisks (*) or backticks (\`).
- For headers, you may use hashes (e.g. ### Header) at the beginning of a line.
- For lists, start each item line with a dash (-).
- Structure your response using clear, distinct paragraphs separated by a single newline.`;

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
 * Extracts: symbol, startDate, endDate, date, startTime, endTime, interval, analysisType.
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
  "startDate": "start date of date range if mentioned (YYYY-MM-DD format), null otherwise",
  "endDate": "end date of date range if mentioned (YYYY-MM-DD format), null otherwise",
  "date": "single date if mentioned (YYYY-MM-DD format), null otherwise",
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
- If the user mentions a stock name (e.g., "TCS", "Reliance", "Tata Steel"), resolve to Yahoo Finance symbol with .NS suffix for Indian stocks (e.g. "TATASTEEL.NS", "RELIANCE.NS", "TCS.NS")

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

/**
 * Summarizes the search query and the chatbot response into a brief 1-sentence description.
 */
async function generateSearchSummary(query, answer) {
  try {
    const prompt = `
      Create a very concise, 1-sentence summary of the following search/chat interaction.
      It should be brief, descriptive, and suitable for a history tab. Avoid generic sentences. Do NOT include any markdown formatting like quotes, asterisks, or backticks.
      Examples:
      - Query: "analyze reliance", Answer: "Bullish trend identified..." -> "Analyzed RELIANCE.NS stock (detected bullish trend)"
      - Query: "what is SIP?", Answer: "Systematic Investment Plan is..." -> "Explained Systematic Investment Plans (SIP)"
      - Query: "show me terminal for TCS", Answer: "Opening terminal..." -> "Opened trading terminal for TCS.NS"
      
      Interaction:
      User query: "${query}"
      Bot reply: "${answer.substring(0, 300)}..."
      
      Summary:
    `;

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 60,
      temperature: 0.3
    });

    return completion.choices[0].message.content.trim().replace(/[`"*_#]/g, "");
  } catch (error) {
    console.error("Error generating search summary:", error);
    // Simple fallback summary
    return query.length > 50 ? query.substring(0, 47) + "..." : query;
  }
}

export {
  groq,
  SYSTEM_INSTRUCTION,
  getChatHistory,
  setChatHistory,
  detectStockIntent,
  parseAnalysisRequest,
  generateSearchSummary
};
