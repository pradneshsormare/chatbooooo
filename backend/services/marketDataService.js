// marketDataService.js — Yahoo Finance data fetching

/**
 * Fetch live quote and historical chart data from Yahoo Finance.
 * @param {string} ticker — Yahoo Finance ticker (e.g. "RELIANCE.NS", "AAPL")
 * @returns {object|null} — Stock data with price, change, and 30-day history
 */
export async function fetchStockData(ticker) {
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
