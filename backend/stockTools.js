// stockTools.js
// Fetches daily OHLC candles (no API key needed, via stooq.com CSV) and
// detects common candlestick patterns using standard technical-analysis rules.
import { EMA, RSI } from "trading-signals";

/**
 * Fetch recent daily candles for a symbol.
 * Uses stooq.com's free CSV endpoint (no key required).
 * @param {string} symbol e.g. "AAPL", "TSLA"
 * @param {number} days how many recent candles to return
 */
export async function fetchCandles(symbol, rangeOrDays = "3mo", interval = "1d") {
  const clean = symbol.trim().toLowerCase();
  
  let range = "3mo";
  let intervalVal = interval;
  let sliceCount = null;

  if (typeof rangeOrDays === "number" || !isNaN(Number(rangeOrDays))) {
    const days = parseInt(rangeOrDays, 10);
    sliceCount = days;
    if (days <= 5) range = "5d";
    else if (days <= 22) range = "1mo";
    else if (days <= 66) range = "3mo";
    else if (days <= 130) range = "6mo";
    else range = "1y";
    intervalVal = "1d";
  } else {
    range = rangeOrDays;
  }

  // Convert Yahoo's .ns or BSE's .bo suffix to Stooq's .in suffix
  let stooqSymbol = clean;
  if (clean.endsWith(".ns")) {
    stooqSymbol = clean.replace(".ns", ".in");
  } else if (clean.endsWith(".bo")) {
    stooqSymbol = clean.replace(".bo", ".in");
  } else if (!clean.includes(".")) {
    stooqSymbol = `${clean}.us`;
  }

  // Stooq only supports daily data. Skip Stooq for any non-daily requests.
  if (intervalVal === "1d") {
    try {
      const url = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;
      console.log(`[stockTools] Trying Stooq.com for symbol "${stooqSymbol}"...`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });

      if (response.ok) {
        const csv = await response.text();
        // Ensure we got a valid CSV back, not a JS challenge / HTML page or error message
        if (csv && !csv.startsWith("<") && !csv.toLowerCase().includes("not found") && csv.includes("Date,")) {
          console.log(`[stockTools] Successfully fetched data from Stooq for "${stooqSymbol}".`);
          const lines = csv.trim().split("\n");
          const rows = lines.slice(1); // skip header: Date,Open,High,Low,Close,Volume

          const candles = rows
            .map((line) => {
              const [date, open, high, low, close, volume] = line.split(",");
              return {
                date, // YYYY-MM-DD string
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: Number(volume),
              };
            })
            .filter((c) => !Number.isNaN(c.open));

          if (candles.length >= 3) {
            if (sliceCount !== null) {
              return candles.slice(-sliceCount);
            }
            return candles;
          }
        }
      }
      console.log(`[stockTools] Stooq returned challenge or invalid format. Falling back to Yahoo Finance.`);
    } catch (error) {
      console.warn(`[stockTools] Stooq fetch error: ${error.message}. Falling back to Yahoo Finance.`);
    }
  } else {
    console.log(`[stockTools] Suffix or interval "${intervalVal}" not daily. Skipping Stooq and querying Yahoo Finance.`);
  }

  // Fallback to Yahoo Finance
  console.log(`[stockTools] Fetching from Yahoo Finance for symbol "${symbol}" (range: ${range}, interval: ${intervalVal})...`);
  const yahooSymbol = symbol.trim().toUpperCase();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${intervalVal}&range=${range}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch stock data for "${symbol}" from both Stooq and Yahoo Finance.`);
  }
  const data = await response.json();
  if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
    throw new Error(`No data found for symbol "${symbol}" on Yahoo Finance.`);
  }

  const result = data.chart.result[0];
  const timestamps = result.timestamp || [];
  const quote = result.indicators.quote[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const candles = [];
  const isIntraday = intervalVal.endsWith("m") || intervalVal.endsWith("h") || ["1m", "2m", "5m", "15m", "30m", "60m", "90m"].includes(intervalVal);

  for (let i = 0; i < timestamps.length; i++) {
    if (
      opens[i] === null || opens[i] === undefined ||
      highs[i] === null || highs[i] === undefined ||
      lows[i] === null || lows[i] === undefined ||
      closes[i] === null || closes[i] === undefined
    ) {
      continue;
    }

    // For intraday, use UNIX timestamps in seconds.
    // For daily/weekly/monthly, use YYYY-MM-DD strings.
    const timeValue = isIntraday 
      ? timestamps[i]
      : new Date(timestamps[i] * 1000).toISOString().split('T')[0];

    candles.push({
      date: timeValue,
      open: Number(opens[i].toFixed(2)),
      high: Number(highs[i].toFixed(2)),
      low: Number(lows[i].toFixed(2)),
      close: Number(closes[i].toFixed(2)),
      volume: Number((volumes[i] || 0).toFixed(2))
    });
  }

  if (candles.length === 0) {
    throw new Error(`No valid OHLC data found for symbol "${symbol}".`);
  }

  if (sliceCount !== null) {
    return candles.slice(-sliceCount);
  }
  return candles;
}

// ------------------ PATTERN DETECTION ------------------
// Each detector looks at the last 1-3 candles and returns a match or null.

function body(c) {
  return Math.abs(c.close - c.open);
}
function range(c) {
  return c.high - c.low || 1e-9;
}
function upperShadow(c) {
  return c.high - Math.max(c.close, c.open);
}
function lowerShadow(c) {
  return Math.min(c.close, c.open) - c.low;
}
function isBullish(c) {
  return c.close > c.open;
}
function isBearish(c) {
  return c.close < c.open;
}

function detectDoji(c) {
  return body(c) / range(c) < 0.1;
}

function detectHammer(c) {
  return (
    lowerShadow(c) >= 2 * body(c) &&
    upperShadow(c) <= body(c) * 0.5 &&
    body(c) / range(c) < 0.4
  );
}

function detectInvertedHammer(c) {
  return (
    upperShadow(c) >= 2 * body(c) &&
    lowerShadow(c) <= body(c) * 0.5 &&
    body(c) / range(c) < 0.4
  );
}

function detectShootingStar(c, prev) {
  return detectInvertedHammer(c) && isBullish(prev);
}

function detectBullishEngulfing(c, prev) {
  return (
    isBearish(prev) &&
    isBullish(c) &&
    c.close >= prev.open &&
    c.open <= prev.close
  );
}

function detectBearishEngulfing(c, prev) {
  return (
    isBullish(prev) &&
    isBearish(c) &&
    c.open >= prev.close &&
    c.close <= prev.open
  );
}

function detectMorningStar(c, prev, prev2) {
  const firstBearish = isBearish(prev2) && body(prev2) / range(prev2) > 0.4;
  const middleSmall = body(prev) / range(prev) < 0.3;
  const thirdBullish =
    isBullish(c) && c.close > (prev2.open + prev2.close) / 2;
  return firstBearish && middleSmall && thirdBullish;
}

function detectEveningStar(c, prev, prev2) {
  const firstBullish = isBullish(prev2) && body(prev2) / range(prev2) > 0.4;
  const middleSmall = body(prev) / range(prev) < 0.3;
  const thirdBearish =
    isBearish(c) && c.close < (prev2.open + prev2.close) / 2;
  return firstBullish && middleSmall && thirdBearish;
}

function detectThreeWhiteSoldiers(c, prev, prev2) {
  return (
    isBullish(prev2) &&
    isBullish(prev) &&
    isBullish(c) &&
    prev.close > prev2.close &&
    c.close > prev.close
  );
}

function detectThreeBlackCrows(c, prev, prev2) {
  return (
    isBearish(prev2) &&
    isBearish(prev) &&
    isBearish(c) &&
    prev.close < prev2.close &&
    c.close < prev.close
  );
}

// ---------- NEW PATTERN DETECTORS: Marubozu & Spinning Top ----------

function detectBullishMarubozu(c) {
  // Strong bullish candle: large body, very small or no shadows
  return (
    isBullish(c) &&
    body(c) / range(c) > 0.85 &&
    upperShadow(c) / range(c) < 0.05 &&
    lowerShadow(c) / range(c) < 0.05
  );
}

function detectBearishMarubozu(c) {
  return (
    isBearish(c) &&
    body(c) / range(c) > 0.85 &&
    upperShadow(c) / range(c) < 0.05 &&
    lowerShadow(c) / range(c) < 0.05
  );
}

function detectSpinningTop(c) {
  // Small body with long shadows on both sides
  const b = body(c);
  const r = range(c);
  return (
    b / r < 0.3 &&
    b / r > 0.02 && // not a doji
    upperShadow(c) > b &&
    lowerShadow(c) > b
  );
}

// =====================================================================
// COMPREHENSIVE ANALYSIS FUNCTIONS
// =====================================================================

/**
 * Detect trend direction, strength, higher-highs/lows, and reversal signals.
 * Returns structured data with chart positions.
 */
export function findSwingPoints(candles, lookback = 3) {
  const highs = [];
  const lows = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (
        current.high <= candles[i - j].high ||
        current.high <= candles[i + j].high
      ) {
        isSwingHigh = false;
      }

      if (
        current.low >= candles[i - j].low ||
        current.low >= candles[i + j].low
      ) {
        isSwingLow = false;
      }
    }

    if (isSwingHigh) {
      highs.push({
        index: i,
        time: current.date,
        price: current.high
      });
    }

    if (isSwingLow) {
      lows.push({
        index: i,
        time: current.date,
        price: current.low
      });
    }
  }

  return { highs, lows };
}

export function analyzeMarketStructure(swings) {
  let bullishPoints = 0;
  let bearishPoints = 0;
  const labels = [];

  for (let i = 1; i < swings.highs.length; i++) {
    const previous = swings.highs[i - 1];
    const current = swings.highs[i];

    if (current.price > previous.price) {
      bullishPoints++;
      labels.push({ ...current, label: "HH" });
    } else {
      bearishPoints++;
      labels.push({ ...current, label: "LH" });
    }
  }

  for (let i = 1; i < swings.lows.length; i++) {
    const previous = swings.lows[i - 1];
    const current = swings.lows[i];

    if (current.price > previous.price) {
      bullishPoints++;
      labels.push({ ...current, label: "HL" });
    } else {
      bearishPoints++;
      labels.push({ ...current, label: "LL" });
    }
  }

  let trend = "sideways";
  if (bullishPoints > bearishPoints * 1.5) {
    trend = "bullish";
  } else if (bearishPoints > bullishPoints * 1.5) {
    trend = "bearish";
  }

  return {
    trend,
    bullishPoints,
    bearishPoints,
    labels
  };
}

export function calculateSlope(candles) {
  if (candles.length < 2) {
    return { value: 0, normalized: 0, direction: "flat" };
  }

  const n = candles.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  candles.forEach((candle, index) => {
    sumX += index;
    sumY += candle.close;
    sumXY += index * candle.close;
    sumXX += index * index;
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const averagePrice = sumY / n;
  const normalized = averagePrice > 0 ? (slope / averagePrice) * 100 : 0;

  let direction = "flat";
  if (normalized > 0.05) {
    direction = "up";
  } else if (normalized < -0.05) {
    direction = "down";
  }

  return {
    value: Number(slope.toFixed(4)),
    normalized: Number(normalized.toFixed(4)),
    direction
  };
}

export function calculateEMA(candles, period) {
  const emaValues = [];
  if (!candles || candles.length === 0) return emaValues;

  const ema = new EMA(period);
  candles.forEach(c => {
    ema.update(c.close);
    if (ema.isStable) {
      emaValues.push(Number(parseFloat(ema.getResult().toString()).toFixed(2)));
    } else {
      emaValues.push(Number(c.close.toFixed(2)));
    }
  });
  return emaValues;
}

export function analyzeEMA(candles, ema20, ema50) {
  const currentPrice = candles[candles.length - 1].close;
  const currentEMA20 = ema20[ema20.length - 1];
  const currentEMA50 = ema50[ema50.length - 1];

  let trend = "neutral";
  if (currentPrice > currentEMA20 && currentEMA20 > currentEMA50) {
    trend = "bullish";
  } else if (currentPrice < currentEMA20 && currentEMA20 < currentEMA50) {
    trend = "bearish";
  }

  return {
    trend,
    currentPrice,
    ema20: currentEMA20,
    ema50: currentEMA50,
    priceAboveEMA20: currentPrice > currentEMA20,
    priceAboveEMA50: currentPrice > currentEMA50
  };
}

export function calculateRSI(candles, period = 14) {
  const rsiValues = [];
  if (!candles || candles.length === 0) return rsiValues;

  const rsi = new RSI(period);
  candles.forEach(c => {
    rsi.update(c.close);
    if (rsi.isStable) {
      rsiValues.push(Number(parseFloat(rsi.getResult().toString()).toFixed(2)));
    } else {
      rsiValues.push(50);
    }
  });
  return rsiValues;
}

export function analyzeRSI(rsiValues) {
  const rsi = rsiValues[rsiValues.length - 1];
  let momentum = "neutral";

  if (rsi >= 70) {
    momentum = "overbought";
  } else if (rsi >= 55) {
    momentum = "bullish";
  } else if (rsi <= 30) {
    momentum = "oversold";
  } else if (rsi <= 45) {
    momentum = "bearish";
  }

  return {
    value: Number(rsi.toFixed(2)),
    momentum
  };
}


export async function analyzeMultiTimeframeTrend({ dailyCandles, hourlyCandles, selectedCandles }) {
  const globalTrend = detectTrend(dailyCandles);
  const mediumTrend = hourlyCandles ? detectTrend(hourlyCandles) : null;
  const selectedTrend = selectedCandles ? detectTrend(selectedCandles) : null;
  const recentCandles = selectedCandles ? selectedCandles.slice(-10) : dailyCandles.slice(-10);
  const recentTrend = detectTrend(recentCandles);

  return {
    global: globalTrend,
    medium: mediumTrend,
    selected: selectedTrend,
    recent: recentTrend
  };
}

export function detectTrend(candles) {
  if (!candles || candles.length < 5) {
    return {
      direction: "sideways",
      trend: "sideways",
      confidence: 0,
      strength: 0,
      details: [],
      startTime: candles && candles[0] ? candles[0].date : null,
      endTime: candles && candles[0] ? candles[candles.length - 1].date : null,
      startPrice: candles && candles[0] ? candles[0].close : 0,
      endPrice: candles && candles[0] ? candles[candles.length - 1].close : 0,
      swingHighs: [],
      swingLows: [],
      changePct: 0
    };
  }

  const swings = findSwingPoints(candles);
  const structure = analyzeMarketStructure(swings);
  const slope = calculateSlope(candles);

  const ema20 = calculateEMA(candles, 20);
  const ema50 = calculateEMA(candles, 50);
  const emaAnalysis = analyzeEMA(candles, ema20, ema50);

  const rsiValues = calculateRSI(candles, 14);
  const rsiAnalysis = analyzeRSI(rsiValues);

  const volumeAnalysis = analyzeVolume(candles);

  // Weighted scoring
  let score = 0;
  if (structure.trend === "bullish") score += 40;
  else if (structure.trend === "bearish") score -= 40;

  if (emaAnalysis.trend === "bullish") score += 25;
  else if (emaAnalysis.trend === "bearish") score -= 25;

  if (slope.direction === "up") score += 20;
  else if (slope.direction === "down") score -= 20;

  if (rsiAnalysis.momentum === "bullish" || rsiAnalysis.momentum === "overbought") score += 15;
  else if (rsiAnalysis.momentum === "bearish" || rsiAnalysis.momentum === "oversold") score -= 15;

  let trend = "sideways";
  if (score >= 35) {
    trend = score >= 70 ? "strong_bullish" : "bullish";
  } else if (score <= -35) {
    trend = score <= -70 ? "strong_bearish" : "bearish";
  }

  const confidence = Math.min(100, Math.round(Math.abs(score)));
  const strength = Math.min(100, Math.round(Math.abs(score) * 1.1));

  // Determine direction mapping for backward compatibility
  let direction = "sideways";
  if (trend.includes("bullish")) direction = "bullish";
  if (trend.includes("bearish")) direction = "bearish";

  // Determine trend weakening: last few candles opposing the main trend
  const recentSlice = candles.slice(-Math.min(5, Math.floor(candles.length / 3)));
  const recentSlope = calculateSlope(recentSlice);
  const weakening = (direction === "bullish" && recentSlope.direction === "down") ||
                    (direction === "bearish" && recentSlope.direction === "up");
  const possibleReversal = weakening && Math.abs(recentSlope.normalized) > 0.15;

  const first = candles[0];
  const last = candles[candles.length - 1];
  const changePct = ((last.close - first.close) / first.close) * 100;

  // Build details for notes
  const details = [];
  details.push({
    time: first.date,
    text: `Trend score: ${score} (${trend.replace("_", " ")}). Structure: ${structure.trend}, EMA: ${emaAnalysis.trend}, RSI: ${rsiAnalysis.momentum}.`,
    category: "trend"
  });

  if (weakening) {
    details.push({
      time: last.date,
      text: `Trend weakening: short-term slope is ${recentSlope.direction} against main trend.`,
      category: "warning"
    });
  }

  return {
    direction,
    trend,
    score,
    confidence,
    strength,
    startTime: first.date,
    endTime: last.date,
    startPrice: first.close,
    endPrice: last.close,
    changePct: Number(changePct.toFixed(2)),
    swingHighs: swings.highs,
    swingLows: swings.lows,
    structure,
    slope,
    ema: emaAnalysis,
    rsi: rsiAnalysis,
    volume: volumeAnalysis,
    weakening,
    possibleReversal,
    details
  };
}

/**
 * Detect support and resistance levels by clustering swing points.
 */
export function detectSupportResistance(candles) {
  if (!candles || candles.length < 5) {
    return { supports: [], resistances: [] };
  }

  // Find all swing highs and lows (local peaks/troughs with window of 2)
  const swingPoints = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    const isHigh = c.high >= candles[i-1].high && c.high >= candles[i-2].high &&
                   c.high >= candles[i+1].high && c.high >= candles[i+2].high;
    const isLow = c.low <= candles[i-1].low && c.low <= candles[i-2].low &&
                  c.low <= candles[i+1].low && c.low <= candles[i+2].low;
    if (isHigh) swingPoints.push({ type: "high", price: c.high, time: c.date, index: i });
    if (isLow) swingPoints.push({ type: "low", price: c.low, time: c.date, index: i });
  }

  // Cluster nearby price levels (within 0.5% of each other)
  const priceRange = Math.max(...candles.map(c => c.high)) - Math.min(...candles.map(c => c.low));
  const clusterThreshold = priceRange * 0.015; // 1.5% of price range

  const clusters = [];
  const used = new Set();
  for (let i = 0; i < swingPoints.length; i++) {
    if (used.has(i)) continue;
    const cluster = [swingPoints[i]];
    used.add(i);
    for (let j = i + 1; j < swingPoints.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(swingPoints[j].price - swingPoints[i].price) <= clusterThreshold) {
        cluster.push(swingPoints[j]);
        used.add(j);
      }
    }
    if (cluster.length >= 1) {
      const avgPrice = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
      const types = cluster.map(p => p.type);
      clusters.push({
        price: Number(avgPrice.toFixed(2)),
        touches: cluster.length,
        points: cluster,
        isResistance: types.filter(t => t === "high").length >= types.filter(t => t === "low").length,
        strength: Math.min(100, cluster.length * 25)
      });
    }
  }

  // Sort by strength (more touches = stronger)
  clusters.sort((a, b) => b.touches - a.touches);

  // Current price for classifying support vs resistance
  const currentPrice = candles[candles.length - 1].close;

  const supports = clusters
    .filter(c => c.price < currentPrice)
    .slice(0, 5)
    .map(c => ({
      price: c.price,
      strength: c.strength,
      touches: c.touches,
      times: c.points.map(p => p.time)
    }));

  const resistances = clusters
    .filter(c => c.price >= currentPrice)
    .slice(0, 5)
    .map(c => ({
      price: c.price,
      strength: c.strength,
      touches: c.touches,
      times: c.points.map(p => p.time)
    }));

  // Build notes
  const details = [];
  supports.forEach(s => {
    details.push({
      time: s.times[s.times.length - 1],
      text: `Support at ${s.price} (${s.touches} touch${s.touches > 1 ? 'es' : ''})`,
      category: "support"
    });
  });
  resistances.forEach(r => {
    details.push({
      time: r.times[r.times.length - 1],
      text: `Resistance at ${r.price} (${r.touches} touch${r.touches > 1 ? 'es' : ''})`,
      category: "resistance"
    });
  });

  return { supports, resistances, details };
}

/**
 * Calculate momentum using RSI and rate of change.
 */
export function calculateMomentum(candles) {
  if (!candles || candles.length < 15) {
    return { rsi: 50, roc: 0, direction: "neutral", strength: "moderate", details: [] };
  }

  // RSI (14-period)
  const period = 14;
  let gains = 0, losses = 0;
  const startIdx = candles.length - period - 1;
  for (let i = startIdx + 1; i <= startIdx + period; i++) {
    const change = candles[i].close - candles[i-1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Smooth RSI for remaining candles
  for (let i = startIdx + period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i-1].close;
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = Number((100 - 100 / (1 + rs)).toFixed(2));

  // Rate of Change (10-period)
  const rocPeriod = Math.min(10, candles.length - 1);
  const rocBase = candles[candles.length - 1 - rocPeriod].close;
  const roc = Number((((candles[candles.length - 1].close - rocBase) / rocBase) * 100).toFixed(2));

  // Direction and strength
  let direction = "neutral";
  let momentumStrength = "moderate";
  if (rsi > 70) { direction = "overbought"; momentumStrength = "strong bullish"; }
  else if (rsi > 55) { direction = "bullish"; momentumStrength = "moderate bullish"; }
  else if (rsi < 30) { direction = "oversold"; momentumStrength = "strong bearish"; }
  else if (rsi < 45) { direction = "bearish"; momentumStrength = "moderate bearish"; }

  const details = [];
  details.push({
    time: candles[candles.length - 1].date,
    text: `RSI: ${rsi} — ${direction}${rsi > 70 ? ' (overbought zone)' : rsi < 30 ? ' (oversold zone)' : ''}`,
    category: "momentum"
  });
  if (Math.abs(roc) > 3) {
    details.push({
      time: candles[candles.length - 1].date,
      text: `Rate of Change: ${roc > 0 ? '+' : ''}${roc}% — ${roc > 0 ? 'strong upward' : 'strong downward'} momentum`,
      category: "momentum"
    });
  }

  return { rsi, roc, direction, strength: momentumStrength, details };
}

/**
 * Analyze volume trends, average volume, and breakout detection.
 */
export function analyzeVolume(candles) {
  if (!candles || candles.length < 5) {
    return { avgVolume: 0, trend: "flat", breakouts: [], details: [] };
  }

  const volumes = candles.map(c => c.volume || 0);
  const avgVolume = Math.round(volumes.reduce((s, v) => s + v, 0) / volumes.length);

  // Volume trend: compare first half vs second half
  const mid = Math.floor(candles.length / 2);
  const firstHalfAvg = volumes.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const secondHalfAvg = volumes.slice(mid).reduce((s, v) => s + v, 0) / (candles.length - mid);
  const volumeChangePct = firstHalfAvg > 0 ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100 : 0;

  let trend = "flat";
  if (volumeChangePct > 20) trend = "increasing";
  else if (volumeChangePct < -20) trend = "decreasing";

  // Detect volume breakouts (> 2x average)
  const breakouts = [];
  candles.forEach((c, i) => {
    if (c.volume && c.volume > avgVolume * 2) {
      const priceDir = c.close >= c.open ? "bullish" : "bearish";
      breakouts.push({
        time: c.date,
        volume: c.volume,
        ratio: Number((c.volume / avgVolume).toFixed(1)),
        priceDirection: priceDir
      });
    }
  });

  // Volume-price confirmation
  const recent = candles.slice(-5);
  const recentPriceUp = recent[recent.length-1].close > recent[0].close;
  const recentVolUp = (recent.map(c => c.volume || 0).reduce((s,v) => s+v, 0) / recent.length) > avgVolume;
  const confirmation = (recentPriceUp && recentVolUp) || (!recentPriceUp && !recentVolUp);

  const details = [];
  if (trend !== "flat") {
    details.push({
      time: candles[mid].date,
      text: `Volume ${trend} (${volumeChangePct > 0 ? '+' : ''}${volumeChangePct.toFixed(0)}% change)`,
      category: "volume"
    });
  }
  breakouts.forEach(b => {
    details.push({
      time: b.time,
      text: `Volume breakout: ${b.ratio}x average (${b.priceDirection})`,
      category: "volume"
    });
  });
  if (!confirmation) {
    details.push({
      time: candles[candles.length - 1].date,
      text: `Volume-price divergence detected`,
      category: "warning"
    });
  }

  return {
    avgVolume,
    trend,
    volumeChangePct: Number(volumeChangePct.toFixed(2)),
    breakouts,
    confirmation,
    details
  };
}

/**
 * Scan ALL candles for patterns (enhanced with Marubozu and Spinning Top).
 */
export function detectAllPatternsEnhanced(candles) {
  if (candles.length < 3) return candles;

  const annotated = candles.map((c, i) => {
    const result = { ...c };

    // Need at least 1 previous candle
    if (i >= 1) {
      const prev = candles[i - 1];

      // Single-candle patterns (in priority order)
      if (detectBullishMarubozu(c)) {
        result.pattern = "Bullish Marubozu";
        result.signal = "bullish";
        result.confidence = 85;
        result.explanation = "Strong bullish candle with no shadows — buyers dominated the entire session.";
      } else if (detectBearishMarubozu(c)) {
        result.pattern = "Bearish Marubozu";
        result.signal = "bearish";
        result.confidence = 85;
        result.explanation = "Strong bearish candle with no shadows — sellers dominated the entire session.";
      } else if (detectDoji(c)) {
        result.pattern = "Doji";
        result.signal = "neutral";
        result.confidence = 60;
        result.explanation = "Open and close nearly equal — indecision between buyers and sellers.";
      } else if (detectHammer(c)) {
        result.pattern = "Hammer";
        result.signal = "bullish";
        result.confidence = 72;
        result.explanation = "Long lower wick with small body at the top — possible bullish reversal signal.";
      } else if (detectShootingStar(c, prev)) {
        result.pattern = "Shooting Star";
        result.signal = "bearish";
        result.confidence = 70;
        result.explanation = "Long upper wick after uptrend — sellers pushed price back down, possible reversal.";
      } else if (detectInvertedHammer(c)) {
        result.pattern = "Inverted Hammer";
        result.signal = "bullish";
        result.confidence = 65;
        result.explanation = "Long upper wick with small body at bottom — potential bullish reversal signal.";
      } else if (detectSpinningTop(c)) {
        result.pattern = "Spinning Top";
        result.signal = "neutral";
        result.confidence = 55;
        result.explanation = "Small body with long shadows — indecision, potential trend pause.";
      }

      // 2-candle patterns (only if no single-candle pattern found)
      if (!result.pattern) {
        if (detectBullishEngulfing(c, prev)) {
          result.pattern = "Bullish Engulfing";
          result.signal = "bullish";
          result.confidence = 78;
          result.explanation = "Bullish candle fully engulfs prior bearish candle — strong reversal signal.";
        } else if (detectBearishEngulfing(c, prev)) {
          result.pattern = "Bearish Engulfing";
          result.signal = "bearish";
          result.confidence = 78;
          result.explanation = "Bearish candle fully engulfs prior bullish candle — strong reversal signal.";
        }
      }
    }

    // 3-candle patterns
    if (i >= 2 && !result.pattern) {
      const prev = candles[i - 1];
      const prev2 = candles[i - 2];

      if (detectMorningStar(c, prev, prev2)) {
        result.pattern = "Morning Star";
        result.signal = "bullish";
        result.confidence = 82;
        result.explanation = "Three-candle bullish reversal: bearish → small body → bullish close above midpoint.";
      } else if (detectEveningStar(c, prev, prev2)) {
        result.pattern = "Evening Star";
        result.signal = "bearish";
        result.confidence = 82;
        result.explanation = "Three-candle bearish reversal: bullish → small body → bearish close below midpoint.";
      } else if (detectThreeWhiteSoldiers(c, prev, prev2)) {
        result.pattern = "Three White Soldiers";
        result.signal = "bullish";
        result.confidence = 88;
        result.explanation = "Three consecutive bullish candles with progressively higher closes — strong uptrend continuation.";
      } else if (detectThreeBlackCrows(c, prev, prev2)) {
        result.pattern = "Three Black Crows";
        result.signal = "bearish";
        result.confidence = 88;
        result.explanation = "Three consecutive bearish candles with progressively lower closes — strong downtrend continuation.";
      }
    }

    return result;
  });

  return annotated;
}

/**
 * Central analysis function: runs ALL analysis on a set of candles.
 * Returns unified result with chart action data.
 */
export function analyzeSelectedRange(candles) {
  if (!candles || candles.length < 3) {
    return {
      trend: { direction: "neutral", strength: 0, confidence: 0 },
      supportResistance: { supports: [], resistances: [] },
      patterns: [],
      momentum: { rsi: 50, direction: "neutral" },
      volume: { trend: "flat" },
      notes: [],
      chartActions: []
    };
  }

  const trend = detectTrend(candles);
  const sr = detectSupportResistance(candles);
  const annotated = detectAllPatternsEnhanced(candles);
  const patterns = annotated.filter(c => c.pattern && c.pattern !== "No standard pattern detected");
  const momentum = calculateMomentum(candles);
  const vol = analyzeVolume(candles);

  // Build chart actions
  const chartActions = [];
  const first = candles[0];
  const last = candles[candles.length - 1];

  // Highlight the analyzed range
  chartActions.push({
    type: "HIGHLIGHT_RANGE",
    startTime: first.date,
    endTime: last.date
  });

  // Trend line
  if (trend.direction !== "sideways") {
    chartActions.push({
      type: "DRAW_TREND_LINE",
      startTime: trend.startTime,
      endTime: trend.endTime,
      startPrice: trend.startPrice,
      endPrice: trend.endPrice,
      direction: trend.direction,
      confidence: trend.confidence,
      strength: trend.strength
    });
  }

  // Support lines
  sr.supports.forEach(s => {
    chartActions.push({
      type: "DRAW_SUPPORT",
      price: s.price,
      strength: s.strength,
      touches: s.touches
    });
  });

  // Resistance lines
  sr.resistances.forEach(r => {
    chartActions.push({
      type: "DRAW_RESISTANCE",
      price: r.price,
      strength: r.strength,
      touches: r.touches
    });
  });

  // Pattern markers
  patterns.forEach(p => {
    chartActions.push({
      type: "ADD_PATTERN_MARKER",
      pattern: p.pattern,
      time: p.date,
      price: p.signal === "bullish" ? p.low : p.high,
      direction: p.signal,
      confidence: p.confidence || 70,
      explanation: p.explanation || ""
    });
  });

  // Collect all notes
  const notes = [
    ...trend.details,
    ...sr.details,
    ...momentum.details,
    ...vol.details
  ];

  // Add pattern notes
  patterns.forEach(p => {
    notes.push({
      time: p.date,
      text: `${p.pattern} detected (${p.signal}, ${p.confidence || 70}% confidence)`,
      category: "pattern"
    });
  });

  // Sort notes by time
  notes.sort((a, b) => {
    if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
    return String(a.time).localeCompare(String(b.time));
  });

  return {
    trend,
    supportResistance: sr,
    patterns: patterns.map(p => ({
      pattern: p.pattern,
      signal: p.signal,
      confidence: p.confidence,
      explanation: p.explanation,
      time: p.date,
      price: p.close
    })),
    momentum,
    volume: vol,
    notes,
    chartActions
  };
}

/**
 * Runs all pattern detectors against the most recent candles.
 * Returns an array of matches with a bullish/bearish/neutral signal label.
 */
export function detectPatterns(candles) {
  if (candles.length < 3) {
    throw new Error("Need at least 3 candles to detect patterns.");
  }

  const matches = [];
  const scanLimit = Math.max(2, candles.length - 20);

  for (let i = candles.length - 1; i >= scanLimit; i--) {
    const c = candles[i];
    const prev = candles[i - 1];
    const prev2 = candles[i - 2];
    const dateStr = c.date || c.time;

    if (detectDoji(c)) matches.push({ date: dateStr, close: c.close, pattern: "Doji", signal: "neutral" });
    if (detectHammer(c)) matches.push({ date: dateStr, close: c.close, pattern: "Hammer", signal: "bullish" });
    if (detectInvertedHammer(c) && !detectShootingStar(c, prev))
      matches.push({ date: dateStr, close: c.close, pattern: "Inverted Hammer", signal: "bullish" });
    if (detectShootingStar(c, prev))
      matches.push({ date: dateStr, close: c.close, pattern: "Shooting Star", signal: "bearish" });
    if (detectBullishEngulfing(c, prev))
      matches.push({ date: dateStr, close: c.close, pattern: "Bullish Engulfing", signal: "bullish" });
    if (detectBearishEngulfing(c, prev))
      matches.push({ date: dateStr, close: c.close, pattern: "Bearish Engulfing", signal: "bearish" });
    if (detectMorningStar(c, prev, prev2))
      matches.push({ date: dateStr, close: c.close, pattern: "Morning Star", signal: "bullish" });
    if (detectEveningStar(c, prev, prev2))
      matches.push({ date: dateStr, close: c.close, pattern: "Evening Star", signal: "bearish" });
    if (detectThreeWhiteSoldiers(c, prev, prev2))
      matches.push({ date: dateStr, close: c.close, pattern: "Three White Soldiers", signal: "bullish" });
    if (detectThreeBlackCrows(c, prev, prev2))
      matches.push({ date: dateStr, close: c.close, pattern: "Three Black Crows", signal: "bearish" });
    if (detectBullishMarubozu(c))
      matches.push({ date: dateStr, close: c.close, pattern: "Bullish Marubozu", signal: "bullish" });
    if (detectBearishMarubozu(c))
      matches.push({ date: dateStr, close: c.close, pattern: "Bearish Marubozu", signal: "bearish" });
    if (detectSpinningTop(c))
      matches.push({ date: dateStr, close: c.close, pattern: "Spinning Top", signal: "neutral" });
  }

  if (matches.length === 0) {
    matches.push({ pattern: "No standard patterns detected in the last 20 candles", signal: "neutral" });
  }

  // simple trend context over the visible window
  const first = candles[0];
  const last = candles[candles.length - 1];
  const trendPct = (((last.close - first.close) / first.close) * 100).toFixed(2);

  return {
    latestCandle: candles[candles.length - 1],
    matches,
    trend: {
      periodDays: candles.length,
      changePercent: Number(trendPct),
      direction: trendPct > 0 ? "up" : trendPct < 0 ? "down" : "flat",
    },
  };
}

/**
 * Convenience function combining fetch + detect, used by the chatbot tool.
 */
export async function getCandlestickAnalysis(symbol, days = 30) {
  const candles = await fetchCandles(symbol, days);
  const analysis = detectPatterns(candles);
  return {
    symbol: symbol.toUpperCase(),
    ...analysis,
  };
}

/**
 * Scans ALL candles and annotates each one with detected patterns.
 * Returns the full candle array with `pattern` and `signal` fields added
 * on candles where a pattern is found.
 */
export function detectAllPatterns(candles) {
  if (candles.length < 3) return candles;

  const annotated = candles.map((c, i) => {
    const result = { ...c };

    // Need at least 1 previous candle for 2-candle patterns
    if (i >= 1) {
      const prev = candles[i - 1];

      // Single-candle patterns
      if (detectDoji(c)) {
        result.pattern = "Doji";
        result.signal = "neutral";
      } else if (detectHammer(c)) {
        result.pattern = "Hammer";
        result.signal = "bullish";
      } else if (detectShootingStar(c, prev)) {
        result.pattern = "Shooting Star";
        result.signal = "bearish";
      } else if (detectInvertedHammer(c)) {
        result.pattern = "Inverted Hammer";
        result.signal = "bullish";
      }

      // 2-candle patterns
      if (!result.pattern) {
        if (detectBullishEngulfing(c, prev)) {
          result.pattern = "Bullish Engulfing";
          result.signal = "bullish";
        } else if (detectBearishEngulfing(c, prev)) {
          result.pattern = "Bearish Engulfing";
          result.signal = "bearish";
        }
      }
    }

    // Need at least 2 previous candles for 3-candle patterns
    if (i >= 2 && !result.pattern) {
      const prev = candles[i - 1];
      const prev2 = candles[i - 2];

      if (detectMorningStar(c, prev, prev2)) {
        result.pattern = "Morning Star";
        result.signal = "bullish";
      } else if (detectEveningStar(c, prev, prev2)) {
        result.pattern = "Evening Star";
        result.signal = "bearish";
      } else if (detectThreeWhiteSoldiers(c, prev, prev2)) {
        result.pattern = "Three White Soldiers";
        result.signal = "bullish";
      } else if (detectThreeBlackCrows(c, prev, prev2)) {
        result.pattern = "Three Black Crows";
        result.signal = "bearish";
      }
    }

    return result;
  });

  return annotated;
}

export async function getCandleDataForChart(symbol, range = "3mo", interval = "1d") {
  const candles = await fetchCandles(symbol, range, interval);
  const annotated = detectAllPatternsEnhanced(candles);

  // Also compute overall trend
  const first = candles[0];
  const last = candles[candles.length - 1];
  const trendPct = (((last.close - first.close) / first.close) * 100).toFixed(2);

  return {
    symbol: symbol.toUpperCase(),
    candles: annotated.map(c => ({
      time: c.date,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      ...(c.pattern ? {
        pattern: c.pattern,
        signal: c.signal,
        confidence: c.confidence || null,
        explanation: c.explanation || null
      } : {})
    })),
    trend: {
      direction: trendPct > 0 ? "up" : trendPct < 0 ? "down" : "flat",
      changePercent: Number(trendPct)
    }
  };
}

