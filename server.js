import "dotenv/config";
import express from "express";
import Groq from "groq-sdk";
import {
  getCandlestickAnalysis,
  getCandleDataForChart,
  fetchCandles,
  detectTrend,
  detectSupportResistance,
  calculateMomentum,
  analyzeVolume,
  analyzeSelectedRange,
  detectAllPatternsEnhanced
} from "./stockTools.js";

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

// =====================================================================
// TOOL ORCHESTRATOR — Parses user requests and runs the right tools
// =====================================================================

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

/**
 * Execute analysis tools based on parsed request and return chart actions.
 */
async function executeAnalysisTools(parsed, candles, symbol) {
  const results = {};
  const chartActions = [];
  const notes = [];

  if (!candles || candles.length < 3) {
    return {
      message: "Not enough candle data to perform analysis.",
      chartActions: [],
      notes: [],
      results: {}
    };
  }

  const first = candles[0];
  const last = candles[candles.length - 1];

  // Highlight the range being analyzed
  chartActions.push({
    type: "HIGHLIGHT_RANGE",
    startTime: first.date,
    endTime: last.date
  });

  // Run requested tools
  if (parsed.needsTrend) {
    results.trend = detectTrend(candles);
    if (results.trend.direction !== "sideways") {
      chartActions.push({
        type: "DRAW_TREND_LINE",
        startTime: results.trend.startTime,
        endTime: results.trend.endTime,
        startPrice: results.trend.startPrice,
        endPrice: results.trend.endPrice,
        direction: results.trend.direction,
        confidence: results.trend.confidence,
        strength: results.trend.strength
      });
    }
    notes.push(...results.trend.details);
  }

  if (parsed.needsSupportResistance) {
    results.supportResistance = detectSupportResistance(candles);
    results.supportResistance.supports.forEach(s => {
      chartActions.push({
        type: "DRAW_SUPPORT",
        price: s.price,
        strength: s.strength,
        touches: s.touches
      });
    });
    results.supportResistance.resistances.forEach(r => {
      chartActions.push({
        type: "DRAW_RESISTANCE",
        price: r.price,
        strength: r.strength,
        touches: r.touches
      });
    });
    notes.push(...results.supportResistance.details);
  }

  if (parsed.needsPatterns) {
    const annotated = detectAllPatternsEnhanced(candles);
    results.patterns = annotated
      .filter(c => c.pattern)
      .map(c => ({
        pattern: c.pattern,
        signal: c.signal,
        confidence: c.confidence,
        explanation: c.explanation,
        time: c.date,
        price: c.close
      }));

    results.patterns.forEach(p => {
      chartActions.push({
        type: "ADD_PATTERN_MARKER",
        pattern: p.pattern,
        time: p.time,
        price: p.price,
        direction: p.signal,
        confidence: p.confidence || 70,
        explanation: p.explanation || ""
      });
      notes.push({
        time: p.time,
        text: `${p.pattern} detected (${p.signal}, ${p.confidence || 70}% confidence)`,
        category: "pattern"
      });
    });
  }

  if (parsed.needsMomentum) {
    results.momentum = calculateMomentum(candles);
    notes.push(...results.momentum.details);
  }

  if (parsed.needsVolume) {
    results.volume = analyzeVolume(candles);
    notes.push(...results.volume.details);
  }

  // Sort notes by time
  notes.sort((a, b) => {
    if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
    return String(a.time).localeCompare(String(b.time));
  });

  // Generate summary message
  let message = `Analysis complete for ${symbol}.\n`;
  if (results.trend) {
    message += `Trend: ${results.trend.direction} (${results.trend.confidence}% confidence, strength ${results.trend.strength}/100).\n`;
    if (results.trend.weakening) message += `Warning: Trend weakening detected.\n`;
    if (results.trend.possibleReversal) message += `Alert: Possible trend reversal.\n`;
  }
  if (results.supportResistance) {
    const sCount = results.supportResistance.supports.length;
    const rCount = results.supportResistance.resistances.length;
    message += `Found ${sCount} support level(s) and ${rCount} resistance level(s).\n`;
  }
  if (results.patterns) {
    const importantPatterns = results.patterns.filter(p => (p.confidence || 70) >= 65);
    if (importantPatterns.length > 0) {
      message += `Patterns: ${importantPatterns.map(p => p.pattern).join(", ")}.\n`;
    }
  }
  if (results.momentum) {
    message += `Momentum: RSI ${results.momentum.rsi} (${results.momentum.direction}).\n`;
  }
  if (results.volume) {
    message += `Volume: ${results.volume.trend}`;
    if (results.volume.breakouts.length > 0) message += ` with ${results.volume.breakouts.length} breakout(s)`;
    message += `.\n`;
  }

  return { message, chartActions, notes, results };
}

// Tool definition for Groq tool-calling
const tools = [
  {
    type: "function",
    function: {
      name: "getCandlestickAnalysis",
      description: "Fetches daily OHLC candlestick data for a stock and algorithmically detects candlestick patterns like Doji, Hammer, Bullish/Bearish Engulfing, Morning/Evening Star, Three White Soldiers, Three Black Crows, Marubozu, Spinning Top, etc. Also includes trend analysis, support/resistance, and momentum. Call this tool whenever the user asks about candlestick patterns, technical chart analysis, or OHLC pattern detection for any stock.",
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

    // Check for terminal-intent commands
    const terminalIntentRegex = /\b(open\s+(the\s+)?terminal|show\s+(me\s+)?(the\s+)?terminal|analyse?\s+.*\s+in\s+terminal)\b/i;
    const isTerminalIntent = terminalIntentRegex.test(userMessage);

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

    // If terminal intent detected, pre-compute chart actions
    let terminalData = null;
    if (isTerminalIntent && intent.hasStock && intent.ticker) {
      try {
        const parsed = await parseAnalysisRequest(userMessage, { symbol: intent.ticker, interval: "1d" });
        const candles = await fetchCandles(intent.ticker, "1mo", "1d");
        const analysisResult = await executeAnalysisTools(
          { ...parsed, needsTrend: true, needsSupportResistance: true, needsPatterns: true, needsMomentum: true, needsVolume: true },
          candles,
          intent.ticker
        );
        terminalData = {
          openTerminal: true,
          symbol: intent.ticker,
          range: "1mo",
          interval: "1d",
          chartActions: analysisResult.chartActions,
          notes: analysisResult.notes,
          analysisMessage: analysisResult.message
        };
      } catch (err) {
        console.error("[server] Terminal analysis failed:", err.message);
      }
    }

    // Build a FRESH message list for this request.
    const MAX_HISTORY_PAIRS = 10;
    const recentHistory = chatHistory.slice(1);
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

            const toolResult = await getCandlestickAnalysis(symbol, days);

            console.log(`[server] Tool returned: ${toolResult.matches.length} pattern(s) detected, trend: ${toolResult.trend.direction} (${toolResult.trend.changePercent}%)`);

            // If the stock chart card wasn't already populated, fetch it now
            if (!stockData) {
              let yahooSymbol = symbol.toUpperCase();
              if (yahooSymbol.endsWith(".IN")) {
                yahooSymbol = yahooSymbol.replace(".IN", ".NS");
              }
              const fetched = await fetchStockData(yahooSymbol);
              if (fetched) {
                stockData = fetched;
                if (intent.companyName) {
                  stockData.companyName = intent.companyName;
                }
              }
            }

            // Also generate chart actions for terminal preview
            if (!terminalData) {
              try {
                const candles = await fetchCandles(symbol, days);
                const fullAnalysis = analyzeSelectedRange(candles);
                terminalData = {
                  openTerminal: false,
                  symbol: symbol.toUpperCase(),
                  range: "1mo",
                  interval: "1d",
                  chartActions: fullAnalysis.chartActions,
                  notes: fullAnalysis.notes
                };
              } catch (err) {
                console.warn("[server] Chart action generation failed:", err.message);
              }
            }

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

      // Step 6: Second Groq call with tool results
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
    chatHistory.push({ role: "user", content: userMessage });
    chatHistory.push({ role: "assistant", content: reply });

    // Cap total chat history to prevent unbounded growth
    if (chatHistory.length > 21) {
      chatHistory = [chatHistory[0], ...chatHistory.slice(-20)];
    }

    console.log(`[server] Response sent. Chat history length: ${chatHistory.length}`);

    const responsePayload = { 
      text: reply,
      stockData: stockData,
      terminalTicker: (stockData && stockData.ticker) ? stockData.ticker : (intent.hasStock ? intent.ticker : null)
    };

    // Include terminal data if available
    if (terminalData) {
      responsePayload.terminalData = terminalData;
    }

    res.json(responsePayload);
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

// =====================================================================
// TERMINAL ANALYSIS ENDPOINT — AI-controlled chart analysis
// =====================================================================
app.post("/api/terminal-analyze", async (req, res) => {
  try {
    const { message, symbol, interval, selectedRange, candles: clientCandles } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Missing 'message' in request body" });
    }

    const effectiveSymbol = symbol || "AAPL";
    const effectiveInterval = interval || "1d";

    console.log(`[server] /api/terminal-analyze: "${message}" for ${effectiveSymbol}`);

    // Step 1: Parse the analysis request
    const parsed = await parseAnalysisRequest(message, {
      symbol: effectiveSymbol,
      interval: effectiveInterval
    });

    console.log(`[server] Parsed request:`, JSON.stringify(parsed, null, 2));

    // Step 2: Determine which symbol to use
    const targetSymbol = parsed.symbol || effectiveSymbol;

    // Step 3: Get candle data
    let candles;
    if (selectedRange && selectedRange.candles && selectedRange.candles.length >= 3) {
      // Use the user's selected range candles
      candles = selectedRange.candles;
      console.log(`[server] Using ${candles.length} selected candles`);
    } else {
      // Fetch candle data for the requested period
      let range = "1mo";
      let fetchInterval = effectiveInterval;

      // If time period was specified, use intraday data
      if (parsed.startTime || parsed.endTime) {
        range = "1d";
        fetchInterval = parsed.interval || "5m";
      }

      candles = await fetchCandles(targetSymbol, range, fetchInterval);

      // Filter by time if specified
      if (parsed.startTime || parsed.endTime) {
        candles = filterCandlesByTime(candles, parsed.startTime, parsed.endTime, parsed.date);
      }

      console.log(`[server] Fetched ${candles.length} candles for ${targetSymbol}`);
    }

    // Step 4: Execute analysis tools
    const analysis = await executeAnalysisTools(parsed, candles, targetSymbol);

    // Step 5: Generate AI text summary using Groq
    let aiSummary = analysis.message;
    try {
      const summaryPrompt = `You are TradeBot, a professional trading analyst. Based on this analysis data, provide a concise, insightful summary. Do NOT use markdown formatting (no asterisks, backticks, hashes). Use plain text with clear paragraphs.

Analysis Data:
${JSON.stringify(analysis.results, null, 2)}

Symbol: ${targetSymbol}
User Request: "${message}"

Give a 3-5 sentence professional analysis summary that highlights the most important findings. Be specific with numbers and prices.`;

      const summaryCompletion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: summaryPrompt }],
        max_tokens: 500,
        temperature: 0.3
      });
      aiSummary = summaryCompletion.choices[0].message.content.trim();
    } catch (err) {
      console.warn("[server] AI summary generation failed, using default:", err.message);
    }

    // Step 6: Return structured response
    const response = {
      message: aiSummary,
      chartActions: analysis.chartActions,
      notes: analysis.notes,
      symbol: targetSymbol,
      parsed: {
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        analysisType: parsed.analysisType,
        summary: parsed.summary
      }
    };

    console.log(`[server] Terminal analysis complete: ${analysis.chartActions.length} chart actions, ${analysis.notes.length} notes`);
    res.json(response);

  } catch (error) {
    console.error("Terminal analyze error:", error);
    res.status(500).json({ error: error.message || "Analysis failed." });
  }
});

/**
 * Filter candles by time range for intraday data.
 */
function filterCandlesByTime(candles, startTime, endTime, date) {
  if (!candles || candles.length === 0) return candles;

  return candles.filter(c => {
    let candleTime;
    if (typeof c.date === 'number') {
      // Unix timestamp
      const d = new Date(c.date * 1000);
      candleTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } else if (typeof c.date === 'string' && c.date.includes('T')) {
      const d = new Date(c.date);
      candleTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } else {
      return true; // Daily candle, no time filter
    }

    let pass = true;
    if (startTime) pass = pass && candleTime >= startTime;
    if (endTime) pass = pass && candleTime <= endTime;
    return pass;
  });
}

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
