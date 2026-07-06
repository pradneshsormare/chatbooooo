// terminalController.js — Handles /api/terminal-analyze endpoint

import pool from "../services/db.js";
import { groq, parseAnalysisRequest, generateSearchSummary } from "../services/groqService.js";
import { executeAnalysisTools, filterCandlesByTime } from "../services/analysisService.js";
import { fetchCandles } from "../stockTools.js";

function refersToSelection(command) {
  return /selected|marked|this area|this region|inside this|selection|highlighted|selection range/i.test(command);
}

function determineAnalysisScope(command, selection) {
  if (refersToSelection(command) && selection) {
    return "selected_region";
  }
  if (/this candle|selected candle/i.test(command)) {
    return "single_candle";
  }
  if (/last|day|week|month|hour/i.test(command)) {
    return "full_period";
  }
  return selection ? "selected_region" : "visible_chart";
}

function getSelectedCandles(candles, selection) {
  if (!selection?.startTime || !selection?.endTime) {
    return [];
  }

  let startVal = selection.startTime;
  let endVal = selection.endTime;

  // Convert to numeric timestamps if they are strings
  let startNum = typeof startVal === 'string' && startVal.includes('-')
    ? new Date(startVal + 'T00:00:00').getTime() / 1000
    : Number(startVal);

  let endNum = typeof endVal === 'string' && endVal.includes('-')
    ? new Date(endVal + 'T00:00:00').getTime() / 1000
    : Number(endVal);

  const start = Math.min(startNum, endNum);
  const end = Math.max(startNum, endNum);

  return candles.filter(candle => {
    let candleTime = typeof candle.date === 'string' && candle.date.includes('-')
      ? Math.floor(new Date(candle.date + 'T00:00:00').getTime() / 1000)
      : (typeof candle.date === 'number' ? candle.date : Number(candle.date));

    return candleTime >= start && candleTime <= end;
  });
}

function determineFetchRange(startDateStr) {
  if (!startDateStr) return "3mo";
  try {
    const start = new Date(startDateStr);
    const diffDays = Math.ceil((new Date() - start) / (1000 * 60 * 60 * 24));
    if (diffDays <= 30) return "1mo";
    if (diffDays <= 90) return "3mo";
    if (diffDays <= 180) return "6mo";
    if (diffDays <= 365) return "1y";
    if (diffDays <= 365 * 2) return "2y";
    return "max";
  } catch (e) {
    return "3mo";
  }
}

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
    const scope = determineAnalysisScope(message, selectedRange);
    console.log(`[server] Determined analysis scope: ${scope}`);

    let candles;
    let allCandles = [];
    let range = "3mo";
    let fetchInterval = effectiveInterval;

    if (parsed.startDate) {
      range = determineFetchRange(parsed.startDate);
    } else if (parsed.startTime || parsed.endTime) {
      range = "1d";
      fetchInterval = parsed.interval || "5m";
    }

    try {
      allCandles = await fetchCandles(targetSymbol, range, fetchInterval);
    } catch (e) {
      console.warn("[server] Pre-fetching all candles failed:", e.message);
    }

    if (scope === "selected_region" && selectedRange) {
      if (allCandles.length > 0) {
        candles = getSelectedCandles(allCandles, selectedRange);
      }
      if (!candles || candles.length < 3) {
        candles = (selectedRange.candles || []).map(c => ({
          date: c.date || c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        }));
      }
      console.log(`[server] Using ${candles?.length || 0} selected candles`);
    } else {
      candles = allCandles;
      if (parsed.startDate || parsed.endDate) {
        const startLimit = parsed.startDate ? parsed.startDate : null;
        const endLimit = parsed.endDate ? parsed.endDate : null;
        candles = candles.filter(c => {
          let keep = true;
          if (startLimit) keep = keep && c.date >= startLimit;
          if (endLimit) keep = keep && c.date <= endLimit;
          return keep;
        });
      }
      if (parsed.startTime || parsed.endTime) {
        candles = filterCandlesByTime(candles, parsed.startTime, parsed.endTime, parsed.date);
      }
      console.log(`[server] Using ${candles?.length || 0} candles for scope: ${scope}`);
    }

    // Step 4: Execute analysis tools
    const analysis = await executeAnalysisTools(parsed, candles, targetSymbol);

    if (parsed.startDate && parsed.endDate && candles.length > 0) {
      analysis.chartActions.push({
        type: "SET_VISIBLE_RANGE",
        startDate: parsed.startDate,
        endDate: parsed.endDate
      });
    }

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

    // Automatically log this search to history database in the background
    (async () => {
      try {
        const userId = req.user.id;
        const summary = await generateSearchSummary(message, aiSummary);

        await pool.query(
          "INSERT INTO search_history (user_id, query, symbol, summary) VALUES ($1, $2, $3, $4)",
          [userId, message, targetSymbol, summary]
        );
      } catch (historyErr) {
        console.error("[server] Failed to record search history in terminal:", historyErr.message);
      }
    })();

    res.json(response);

  } catch (error) {
    console.error("Terminal analyze error:", error);
    res.status(500).json({ error: error.message || "Analysis failed." });
  }
}
