// chatController.js — Handles /api/chat endpoint

import {
  groq,
  SYSTEM_INSTRUCTION,
  getChatHistory,
  setChatHistory,
  detectStockIntent,
  parseAnalysisRequest
} from "../services/groqService.js";
import { fetchStockData } from "../services/marketDataService.js";
import { executeAnalysisTools } from "../services/analysisService.js";
import {
  getCandlestickAnalysis,
  fetchCandles,
  analyzeSelectedRange
} from "../stockTools.js";

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

export async function handleChat(req, res) {
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
    const chatHistory = getChatHistory();
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
      setChatHistory([chatHistory[0], ...chatHistory.slice(-20)]);
    }

    console.log(`[server] Response sent. Chat history length: ${getChatHistory().length}`);

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
}
