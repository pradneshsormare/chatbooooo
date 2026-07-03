import "dotenv/config";
import express from "express";
import Groq from "groq-sdk";
import { getCandlestickAnalysis, getCandleDataForChart } from "./stockTools.js";

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

// Tool definition for Groq tool-calling
const tools = [
  {
    type: "function",
    function: {
      name: "getCandlestickAnalysis",
      description: "Fetches daily OHLC candlestick data for a stock and algorithmically detects candlestick patterns like Doji, Hammer, Bullish/Bearish Engulfing, Morning/Evening Star, Three White Soldiers, Three Black Crows, etc. Call this tool whenever the user asks about candlestick patterns, technical chart analysis, or OHLC pattern detection for any stock.",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "The stock ticker symbol. For US stocks use plain ticker (e.g. AAPL, TSLA). For Indian NSE stocks append .NS (e.g. RELIANCE.NS, TCS.NS, INFY.NS)."
          },
          days: {
            type: "string",
            description: "Number of recent trading days to analyze, as a string. Defaults to '30'."
          }
        },
        required: ["symbol"]
      }
    }
  }
];

app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    if (!userMessage) {
      return res.status(400).json({ error: "Missing 'message' in request body" });
    }

    // Step 1: Detect stock reference using Groq
    const intent = await detectStockIntent(userMessage);
    let stockData = null;
    let systemInstruction = SYSTEM_INSTRUCTION;

    if (intent.hasStock && intent.ticker) {
      // Step 2: Query Yahoo Finance API for live price data (for the chart card)
      const fetched = await fetchStockData(intent.ticker);
      if (fetched) {
        stockData = fetched;
        if (intent.companyName) {
          stockData.companyName = intent.companyName;
        }

        // Step 3: Inject real-time price context into the system instruction
        const dataSnippet = `
[REAL-TIME STOCK DATA FOR ${stockData.companyName} (${stockData.ticker})]
Current Price: ${stockData.currentPrice} INR
Price Change: ${stockData.change >= 0 ? "+" : ""}${stockData.change} INR (${stockData.changePercent >= 0 ? "+" : ""}${stockData.changePercent}%)
Previous Close: ${stockData.prevClose} INR
30-Day Price Trend (Recent Close Prices): ${stockData.history.prices.slice(-5).join(", ")}

Use the real-time figures above in your analysis. Be specific, realistic, and objective. Refer to these current numbers. Do not use asterisks or backticks.
`;
        systemInstruction = SYSTEM_INSTRUCTION + "\n\n" + dataSnippet;
      }
    }

    // Build a FRESH message list for this request.
    // Only include: system instruction + recent conversation history (capped) + current user message.
    // This prevents old tool-call artifacts from polluting future requests.
    const MAX_HISTORY_PAIRS = 10; // keep last 10 user/assistant pairs
    const recentHistory = chatHistory.slice(1); // skip system message
    const trimmedHistory = recentHistory.slice(-MAX_HISTORY_PAIRS * 2);

    const messagesToSend = [
      { role: "system", content: systemInstruction },
      ...trimmedHistory,
      { role: "user", content: userMessage }
    ];

    // Step 4: First Groq call — model decides whether to answer directly or call a tool
    console.log(`[server] Sending chat to Groq (${messagesToSend.length} messages, tools enabled)...`);

    let completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: messagesToSend,
      tools: tools,
      tool_choice: "auto",
      max_tokens: 1024,
      temperature: 0.1
    });

    let responseMessage = completion.choices[0].message;

    // Step 5: If Groq decided to call the getCandlestickAnalysis tool
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      console.log(`[server] Groq requested ${responseMessage.tool_calls.length} tool call(s).`);

      // Add the assistant's tool-call request to the conversation
      messagesToSend.push(responseMessage);

      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.function.name === "getCandlestickAnalysis") {
          const args = JSON.parse(toolCall.function.arguments);
          const symbol = args.symbol;
          const daysVal = args.days;
          const days = (typeof daysVal === "string" ? parseInt(daysVal, 10) : daysVal) || 30;

          try {
            console.log(`[server] Executing getCandlestickAnalysis("${symbol}", ${days})...`);

            // This calls stockTools.js which fetches OHLC from Yahoo Finance
            // and runs pattern detection math
            const toolResult = await getCandlestickAnalysis(symbol, days);

            console.log(`[server] Tool returned: ${toolResult.matches.length} pattern(s) detected, trend: ${toolResult.trend.direction} (${toolResult.trend.changePercent}%)`);

            // If the stock chart card wasn't already populated, fetch it now
            // so the frontend can render the interactive price chart
            if (!stockData) {
              let yahooSymbol = symbol.toUpperCase();
              // Convert stooq-style .IN back to Yahoo's .NS for Indian stocks
              if (yahooSymbol.endsWith(".IN")) {
                yahooSymbol = yahooSymbol.replace(".IN", ".NS");
              }
              // If no suffix at all, try as-is (works for US stocks like AAPL)
              const fetched = await fetchStockData(yahooSymbol);
              if (fetched) {
                stockData = fetched;
                if (intent.companyName) {
                  stockData.companyName = intent.companyName;
                }
              }
            }

            // Push the tool result back into the conversation for Groq to interpret
            messagesToSend.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: "getCandlestickAnalysis",
              content: JSON.stringify(toolResult)
            });
          } catch (err) {
            console.error(`[server] Tool execution failed for "${symbol}":`, err.message);
            messagesToSend.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: "getCandlestickAnalysis",
              content: JSON.stringify({ error: err.message })
            });
          }
        }
      }

      // Step 6: Second Groq call — model now has the fresh tool results
      // and must interpret them in the dragon persona
      messagesToSend[0].content = `You are a wise, ancient, and fiery trading dragon who is also a professional financial analyst. You have just received FRESH candlestick pattern analysis data from your magical tools. Analyze and explain these results in your dragon persona, using vivid metaphors of fire, scales, claws, and ancient scrolls.

CRITICAL RULES:
- Use ONLY the tool result data you just received. Do NOT repeat or reference any previous analysis.
- Include the specific pattern name(s) detected, the trend direction, and the exact change percentage from the tool data.
- Mention specific OHLC price numbers from the latest candle to make the analysis concrete.
- Give a clear bullish/bearish/neutral verdict based on the pattern signals.
- Do NOT use any Markdown formatting (no asterisks, backticks, or hashes).
- Structure your response with clear paragraphs separated by newlines.
- For lists, use a dash (-) at the start of each line.
- Every response must be unique and directly tied to the fresh data. Never give a generic or templated answer.
- Current timestamp: ${new Date().toISOString()} — use this to vary your phrasing and opening lines.`;

      console.log(`[server] Sending tool results back to Groq for final interpretation...`);

      completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: messagesToSend,
        max_tokens: 1024,
        temperature: 0.9
      });

      responseMessage = completion.choices[0].message;
    }

    const reply = responseMessage.content;

    // Only store plain user/assistant messages in chat history (no tool artifacts)
    // This keeps history clean and prevents repeated answers
    chatHistory.push({ role: "user", content: userMessage });
    chatHistory.push({ role: "assistant", content: reply });

    // Cap total chat history to prevent unbounded growth
    // Keep system message + last 20 messages (10 pairs)
    if (chatHistory.length > 21) {
      chatHistory = [chatHistory[0], ...chatHistory.slice(-20)];
    }

    console.log(`[server] Response sent. Chat history length: ${chatHistory.length}`);

    res.json({ 
      text: reply,
      stockData: stockData,
      // Include the ticker so the frontend can offer an "Open Terminal" button
      terminalTicker: (stockData && stockData.ticker) ? stockData.ticker : (intent.hasStock ? intent.ticker : null)
    });
  } catch (error) {
    console.error("Groq API error:", error);
    res.status(500).json({ error: "Something went wrong talking to the AI." });
  }
});

// --- Candle Data API for the Terminal Chart ---
app.get("/api/candles", async (req, res) => {
  try {
    const symbol = req.query.symbol;
    const range = req.query.range || "3mo";
    const interval = req.query.interval || "1d";

    if (!symbol) {
      return res.status(400).json({ error: "Missing 'symbol' query parameter. Example: /api/candles?symbol=AAPL" });
    }

    console.log(`[server] /api/candles request: symbol=${symbol}, range=${range}, interval=${interval}`);
    const data = await getCandleDataForChart(symbol, range, interval);

    // Also fetch live price for the terminal header
    const fetched = await fetchStockData(symbol);
    if (fetched) {
      data.livePrice = {
        currentPrice: fetched.currentPrice,
        change: fetched.change,
        changePercent: fetched.changePercent,
        prevClose: fetched.prevClose
      };
    }

    console.log(`[server] Returning ${data.candles.length} candles for ${data.symbol}`);
    res.json(data);
  } catch (error) {
    console.error("Candle API error:", error.message);
    res.status(500).json({ error: error.message || "Failed to fetch candle data." });
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
