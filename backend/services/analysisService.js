// analysisService.js — Tool orchestrator for technical analysis

import {
  detectTrend,
  detectSupportResistance,
  calculateMomentum,
  analyzeVolume,
  detectAllPatternsEnhanced
} from "../stockTools.js";

/**
 * Execute analysis tools based on parsed request and return chart actions.
 */
export async function executeAnalysisTools(parsed, candles, symbol) {
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
    if (results.trend.structure && results.trend.structure.labels && results.trend.structure.labels.length > 0) {
      chartActions.push({
        type: "DRAW_STRUCTURE_LABELS",
        labels: results.trend.structure.labels
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

/**
 * Filter candles by time range for intraday data.
 */
export function filterCandlesByTime(candles, startTime, endTime, date) {
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
