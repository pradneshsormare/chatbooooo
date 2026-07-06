// marketController.js — Handles /api/candles endpoint

import { getCandleDataForChart } from "../stockTools.js";
import { fetchStockData } from "../services/marketDataService.js";

export async function getCandles(req, res) {
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
}
