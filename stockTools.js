// stockTools.js
// Fetches daily OHLC candles (no API key needed, via stooq.com CSV) and
// detects common candlestick patterns using standard technical-analysis rules.

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

/**
 * Runs all pattern detectors against the most recent candles.
 * Returns an array of matches with a bullish/bearish/neutral signal label.
 */
export function detectPatterns(candles) {
  if (candles.length < 3) {
    throw new Error("Need at least 3 candles to detect patterns.");
  }

  const c = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  const matches = [];

  if (detectDoji(c)) matches.push({ pattern: "Doji", signal: "neutral" });
  if (detectHammer(c)) matches.push({ pattern: "Hammer", signal: "bullish" });
  if (detectInvertedHammer(c) && !detectShootingStar(c, prev))
    matches.push({ pattern: "Inverted Hammer", signal: "bullish" });
  if (detectShootingStar(c, prev))
    matches.push({ pattern: "Shooting Star", signal: "bearish" });
  if (detectBullishEngulfing(c, prev))
    matches.push({ pattern: "Bullish Engulfing", signal: "bullish" });
  if (detectBearishEngulfing(c, prev))
    matches.push({ pattern: "Bearish Engulfing", signal: "bearish" });
  if (detectMorningStar(c, prev, prev2))
    matches.push({ pattern: "Morning Star", signal: "bullish" });
  if (detectEveningStar(c, prev, prev2))
    matches.push({ pattern: "Evening Star", signal: "bearish" });
  if (detectThreeWhiteSoldiers(c, prev, prev2))
    matches.push({ pattern: "Three White Soldiers", signal: "bullish" });
  if (detectThreeBlackCrows(c, prev, prev2))
    matches.push({ pattern: "Three Black Crows", signal: "bearish" });

  if (matches.length === 0) {
    matches.push({ pattern: "No standard pattern detected", signal: "neutral" });
  }

  // simple trend context over the visible window, for extra judgment material
  const first = candles[0];
  const last = candles[candles.length - 1];
  const trendPct = (((last.close - first.close) / first.close) * 100).toFixed(2);

  return {
    latestCandle: c,
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
  const annotated = detectAllPatterns(candles);

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
      ...(c.pattern ? { pattern: c.pattern, signal: c.signal } : {})
    })),
    trend: {
      direction: trendPct > 0 ? "up" : trendPct < 0 ? "down" : "flat",
      changePercent: Number(trendPct)
    }
  };
}
