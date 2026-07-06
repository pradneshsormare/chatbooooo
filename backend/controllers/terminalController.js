// terminalController.js — Handles /api/terminal-analyze endpoint

import { groq, parseAnalysisRequest } from "../services/groqService.js";
import { executeAnalysisTools, filterCandlesByTime } from "../services/analysisService.js";
import { fetchCandles } from "../stockTools.js";

export async function analyzeTerminal(req, res) {
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
}
