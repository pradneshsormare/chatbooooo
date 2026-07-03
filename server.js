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
  "You are TradeBot, a professional financial analyst and trading assistant specializing in the Indian share market. You provide highly accurate, educational, and detailed information about Indian stocks (listed on NSE/BSE), Systematic Investment Plans (SIP), mutual funds, shares, ETFs, investment strategies, derivatives, IPOs, tax implications (like LTCG, STCG, ELSS), and SEBI guidelines. You are helpful, analytical, and objective. IMPORTANT: Your entire output must be plain text. Do NOT use any Markdown formatting like asterisks (*), backticks (`), or hashes (#). Structure your responses using clear, distinct paragraphs separated by a single newline. For lists, present them using a dash (-) at the beginning of the line. Your goal is to produce clean, directly readable text that requires no post-processing.";

// In-memory chat history (per server run — fine for a single-user local app)
let chatHistory = [{ role: "system", content: SYSTEM_INSTRUCTION }];

// Helper to detect stock intents and resolve tickers
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

// Helper to fetch live quote and historical chart data from Yahoo Finance
async function fetchStockData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1mo`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Yahoo API returned status ${response.status} for ${ticker}`);
      return null;
    }
    const data = await response.json();
    if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
      console.error(`No chart results found for ${ticker}`);
      return null;
    }

    const result = data.chart.result[0];
    const meta = result.meta;
    const timestamps = result.timestamp || [];
    const closePrices = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];

    // Format timestamps to readable dates like "DD MMM"
    const labels = timestamps.map(ts => {
      const date = new Date(ts * 1000);
      return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    });

    // Clean up null values if any in close prices, replacing with the previous non-null price
    let lastValidPrice = meta.regularMarketPrice;
    const cleanPrices = closePrices.map(price => {
      if (price === null || price === undefined) {
        return lastValidPrice;
      }
      lastValidPrice = Number(price.toFixed(2));
      return lastValidPrice;
    });

    const currentPrice = Number(meta.regularMarketPrice.toFixed(2));
    const prevClose = Number(meta.chartPreviousClose.toFixed(2));
    const change = Number((currentPrice - prevClose).toFixed(2));
    const changePercent = Number(((change / prevClose) * 100).toFixed(2));

    return {
      ticker: meta.symbol,
      companyName: meta.symbol, // Overridden in chat endpoint
      currentPrice,
      change,
      changePercent,
      prevClose,
      history: {
        labels,
        prices: cleanPrices
      }
    };
  } catch (error) {
    console.error("Error fetching Yahoo Finance data:", error);
    return null;
  }
}

app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    if (!userMessage) {
      return res.status(400).json({ error: "Missing 'message' in request body" });
    }

    // Step 1: Detect stock reference
    const intent = await detectStockIntent(userMessage);
    let stockData = null;
    let systemInstruction = SYSTEM_INSTRUCTION;

    if (intent.hasStock && intent.ticker) {
      // Step 2: Query Yahoo Finance API
      const fetched = await fetchStockData(intent.ticker);
      if (fetched) {
        stockData = fetched;
        if (intent.companyName) {
          stockData.companyName = intent.companyName;
        }

        // Step 3: Inject context snippet
        const dataSnippet = `
[REAL-TIME STOCK DATA FOR ${stockData.companyName} (${stockData.ticker})]
Current Price: ${stockData.currentPrice} INR
Price Change: ${stockData.change >= 0 ? "+" : ""}${stockData.change} INR (${stockData.changePercent >= 0 ? "+" : ""}${stockData.changePercent}%)
Previous Close: ${stockData.prevClose} INR
30-Day Price Trend (Recent Close Prices): ${stockData.history.prices.slice(-5).join(", ")}

Analyze this stock using the real-time figures above. Be specific, realistic, objective, and refer to these current numbers in your answer. Do not use asterisks or backticks.
`;
        systemInstruction = SYSTEM_INSTRUCTION + "\n\n" + dataSnippet;
      }
    }

    // Prepare contextual message list without polluting permanent chatHistory system instruction
    const messagesToSend = chatHistory.map((msg, idx) => {
      if (idx === 0 && msg.role === "system") {
        return { role: "system", content: systemInstruction };
      }
      return msg;
    });

    messagesToSend.push({ role: "user", content: userMessage });

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: messagesToSend,
      max_tokens: 1000,
    });

    const reply = completion.choices[0].message.content;
    chatHistory.push({ role: "user", content: userMessage });
    chatHistory.push({ role: "assistant", content: reply });

    res.json({ 
      text: reply,
      stockData: stockData 
    });
  } catch (error) {
    console.error("Groq API error:", error);
    res.status(500).json({ error: "Something went wrong talking to the AI." });
  }
});

app.post("/api/quiz", async (req, res) => {
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
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TradeBot server running at http://localhost:${PORT}`));
