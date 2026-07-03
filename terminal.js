// ============================================================
// terminal.js — Groww-Style Candlestick Chart Terminal
// Uses TradingView Lightweight Charts + /api/candles endpoint
// ============================================================

// -------------------- STATE --------------------
let chart = null;
let candlestickSeries = null;
let volumeSeries = null;
let currentSymbol = "";
let currentRange = "1mo";
let currentInterval = "1d";

// -------------------- DOM --------------------
const chartContainer = document.getElementById("candlestick-chart");
const loadingEl = document.getElementById("chart-loading");
const errorEl = document.getElementById("chart-error");
const errorMsg = document.getElementById("error-message");
const headerTicker = document.getElementById("header-ticker");
const headerExchange = document.getElementById("header-exchange");
const headerPrice = document.getElementById("header-price");
const headerChange = document.getElementById("header-change");
const patternTags = document.getElementById("pattern-tags");
const trendInfo = document.getElementById("trend-info");
const tfButtons = document.querySelectorAll(".tf-btn[data-range]");
const changeSymbolBtn = document.getElementById("change-symbol-btn");
const searchOverlay = document.getElementById("symbol-search-overlay");
const searchForm = document.getElementById("symbol-search-form");
const searchInput = document.getElementById("symbol-search-input");

// -------------------- INIT --------------------
function init() {
    // Read symbol from URL params
    const params = new URLSearchParams(window.location.search);
    currentSymbol = params.get("symbol") || "AAPL";
    currentRange = params.get("range") || "1mo";
    currentInterval = params.get("interval") || "1d";

    // Highlight the active timeframe button
    tfButtons.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.range === currentRange && btn.dataset.interval === currentInterval);
    });

    // Create the chart
    createChart();

    // Fetch and render data
    loadData(currentSymbol, currentRange, currentInterval);

    // Event listeners
    setupEventListeners();
}

// -------------------- CHART CREATION --------------------
function createChart() {
    chart = LightweightCharts.createChart(chartContainer, {
        layout: {
            background: { type: "solid", color: "#0B0F19" },
            textColor: "#94A3B8",
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Consolas', monospace",
        },
        grid: {
            vertLines: { color: "rgba(255, 255, 255, 0.03)" },
            horzLines: { color: "rgba(255, 255, 255, 0.03)" },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: {
                color: "rgba(16, 185, 129, 0.3)",
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
                labelBackgroundColor: "#10B981",
            },
            horzLine: {
                color: "rgba(16, 185, 129, 0.3)",
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
                labelBackgroundColor: "#10B981",
            },
        },
        rightPriceScale: {
            borderColor: "rgba(255, 255, 255, 0.08)",
            scaleMargins: { top: 0.1, bottom: 0.25 },
        },
        timeScale: {
            borderColor: "rgba(255, 255, 255, 0.08)",
            timeVisible: true,
            secondsVisible: false,
            fixLeftEdge: false,
            fixRightEdge: false,
            rightOffset: 5,
            barSpacing: 7,
            minBarSpacing: 0.5,
            rightBarStaysOnScroll: true,
        },
        handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: true,
        },
        handleScale: {
            axisPressedMouseMove: true,
            mouseWheel: true,
            pinch: true,
        },
    });

    // Candlestick series
    candlestickSeries = chart.addCandlestickSeries({
        upColor: "#10B981",
        downColor: "#F43F5E",
        borderDownColor: "#F43F5E",
        borderUpColor: "#10B981",
        wickDownColor: "#F43F5E",
        wickUpColor: "#10B981",
    });

    // Volume histogram series
    volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Auto-resize
    const resizeObserver = new ResizeObserver(() => {
        if (chart && chartContainer.clientWidth > 0 && chartContainer.clientHeight > 0) {
            chart.applyOptions({
                width: chartContainer.clientWidth,
                height: chartContainer.clientHeight,
            });
        }
    });
    resizeObserver.observe(chartContainer);
}

// -------------------- DATA FETCHING --------------------
async function loadData(symbol, range, interval) {
    showLoading();
    hideError();

    try {
        const url = `/api/candles?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`;
        console.log(`[terminal] Fetching: ${url}`);

        const response = await fetch(url);
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Server returned ${response.status}`);
        }

        const data = await response.json();
        console.log(`[terminal] Received ${data.candles.length} candles for ${data.symbol}`);

        renderChart(data);
        updateHeader(data);
        updateAnalysisPanel(data);
        hideLoading();

    } catch (error) {
        console.error("[terminal] Load error:", error);
        hideLoading();
        showError(error.message);
    }
}

// -------------------- CHART RENDERING --------------------
function renderChart(data) {
    const candles = data.candles;

    // Set candlestick data
    candlestickSeries.setData(
        candles.map(c => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        }))
    );

    // Set volume data with colors
    volumeSeries.setData(
        candles.map(c => ({
            time: c.time,
            value: c.volume,
            color: c.close >= c.open
                ? "rgba(16, 185, 129, 0.25)"
                : "rgba(244, 63, 94, 0.25)",
        }))
    );

    // Place markers on candles where patterns are detected (limit to last 15 patterns to prevent overcrowding)
    const markers = [];
    const patternCandles = candles.filter(c => c.pattern);
    const recentPatternCandles = patternCandles.slice(-15);

    candles.forEach(c => {
        if (c.pattern && recentPatternCandles.includes(c)) {
            const isBullish = c.signal === "bullish";
            const isBearish = c.signal === "bearish";

            markers.push({
                time: c.time,
                position: isBullish ? "belowBar" : "aboveBar",
                color: isBullish ? "#10B981" : isBearish ? "#F43F5E" : "#FBBF24",
                shape: isBullish ? "arrowUp" : isBearish ? "arrowDown" : "circle",
                text: c.pattern,
            });
        }
    });

    candlestickSeries.setMarkers(markers);

    // Set visible range to show only the last 120 candles initially (for large datasets),
    // allowing the user to scroll/zoom back to see older data.
    const totalBars = candles.length;
    if (totalBars > 0) {
        chart.timeScale().setVisibleLogicalRange({
            from: Math.max(0, totalBars - 120),
            to: totalBars + 5
        });
    }
}

// -------------------- HEADER UPDATE --------------------
function updateHeader(data) {
    headerTicker.textContent = data.symbol;

    // Determine exchange from symbol
    const sym = data.symbol.toUpperCase();
    if (sym.endsWith(".NS")) {
        headerExchange.textContent = "NSE · India";
    } else if (sym.endsWith(".BO")) {
        headerExchange.textContent = "BSE · India";
    } else {
        headerExchange.textContent = "NASDAQ / NYSE · US";
    }

    // Live price from API
    if (data.livePrice) {
        const lp = data.livePrice;
        headerPrice.textContent = formatPrice(lp.currentPrice, sym);

        const sign = lp.change >= 0 ? "+" : "";
        const changeText = `${sign}${lp.change.toFixed(2)} (${sign}${lp.changePercent.toFixed(2)}%)`;
        headerChange.textContent = changeText;
        headerChange.className = "change " + (lp.change >= 0 ? "up" : "down");
    } else if (data.candles.length > 0) {
        // Fallback to last candle price
        const last = data.candles[data.candles.length - 1];
        headerPrice.textContent = formatPrice(last.close, sym);
        headerChange.textContent = "";
    }

    document.title = `${data.symbol} — TradeBot Terminal`;
}

function formatPrice(price, symbol) {
    if (symbol && (symbol.endsWith(".NS") || symbol.endsWith(".BO"))) {
        return "₹" + price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// -------------------- ANALYSIS PANEL --------------------
function updateAnalysisPanel(data) {
    // Gather all detected patterns from the candles
    const patternMap = new Map();
    data.candles.forEach(c => {
        if (c.pattern && !patternMap.has(c.pattern)) {
            patternMap.set(c.pattern, c.signal);
        }
    });

    // Render tags
    patternTags.innerHTML = "";
    if (patternMap.size === 0) {
        const tag = document.createElement("span");
        tag.className = "pattern-tag neutral";
        tag.innerHTML = '<i class="fas fa-minus-circle"></i> No patterns detected';
        patternTags.appendChild(tag);
    } else {
        patternMap.forEach((signal, pattern) => {
            const tag = document.createElement("span");
            tag.className = `pattern-tag ${signal}`;
            const icon = signal === "bullish" ? "fa-arrow-trend-up"
                : signal === "bearish" ? "fa-arrow-trend-down"
                : "fa-circle-dot";
            tag.innerHTML = `<i class="fas ${icon}"></i> ${pattern}`;
            patternTags.appendChild(tag);
        });
    }

    // Trend info
    if (data.trend) {
        const dir = data.trend.direction;
        const pct = data.trend.changePercent;
        const sign = pct >= 0 ? "+" : "";
        const icon = dir === "up" ? "fa-arrow-trend-up" : dir === "down" ? "fa-arrow-trend-down" : "fa-minus";

        trendInfo.className = `trend-info ${dir}`;
        trendInfo.innerHTML = `<i class="fas ${icon}"></i> Trend (${currentRange.toUpperCase()}): ${sign}${pct}%`;
    }
}

// -------------------- UI HELPERS --------------------
function showLoading() {
    loadingEl.classList.remove("hidden");
}
function hideLoading() {
    loadingEl.classList.add("hidden");
}
function showError(msg) {
    errorMsg.textContent = msg;
    errorEl.classList.remove("hidden");
}
function hideError() {
    errorEl.classList.add("hidden");
}

// -------------------- EVENT LISTENERS --------------------
function setupEventListeners() {
    // Timeframe buttons
    tfButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const range = btn.dataset.range;
            const interval = btn.dataset.interval;
            if (range === currentRange && interval === currentInterval) return;

            currentRange = range;
            currentInterval = interval;
            tfButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            // Update URL parameters without reload
            const url = new URL(window.location);
            url.searchParams.set("range", range);
            url.searchParams.set("interval", interval);
            url.searchParams.delete("days"); // clean up old param if present
            window.history.replaceState({}, "", url);

            loadData(currentSymbol, currentRange, currentInterval);
        });
    });

    // Change symbol button
    changeSymbolBtn.addEventListener("click", () => {
        searchOverlay.classList.remove("hidden");
        searchInput.value = currentSymbol;
        searchInput.focus();
        searchInput.select();
    });

    // Search overlay close on click outside
    searchOverlay.addEventListener("click", (e) => {
        if (e.target === searchOverlay) {
            searchOverlay.classList.add("hidden");
        }
    });

    // Search form submit
    searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const newSymbol = searchInput.value.trim().toUpperCase();
        if (!newSymbol) return;

        currentSymbol = newSymbol;
        searchOverlay.classList.add("hidden");

        // Update URL
        const url = new URL(window.location);
        url.searchParams.set("symbol", newSymbol);
        window.history.replaceState({}, "", url);

        loadData(currentSymbol, currentRange, currentInterval);
    });

    // Keyboard shortcut: Escape to close search
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !searchOverlay.classList.contains("hidden")) {
            searchOverlay.classList.add("hidden");
        }
    });
}

// -------------------- BOOT --------------------
document.addEventListener("DOMContentLoaded", init);
