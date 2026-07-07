// Check authentication before loading anything
const token = localStorage.getItem("tradebot_token");
if (!token) {
    window.location.href = "index.html";
}

// ============================================================
// terminal.js — AI-Controlled Interactive Trading Terminal
// TradingView Lightweight Charts + Drawing Tools + AI Analysis
// ============================================================

// -------------------- STATE --------------------
let chart = null;
let candlestickSeries = null;
let volumeSeries = null;
let currentSymbol = "";
let currentRange = "1mo";
let currentInterval = "1d";
let currentCandleData = []; // All loaded candles (raw)
let currentTool = "pointer";
let showPatterns = false; // Controls pattern marker visibility

// Drawing state
let drawings = {
    trendLines: [],   // { series, startTime, endTime, startPrice, endPrice }
    hLines: [],       // { priceLine, price }
    fibLevels: [],    // { priceLines[] }
    highlights: []    // { series }
};
let drawingHistory = [];

// Rectangle selection state
let selectionState = {
    isSelecting: false,
    startX: null, startY: null,
    startTime: null, startPrice: null,
    endTime: null, endPrice: null,
    candles: [],
    highlightSeries: null
};

// Drawing tool state (for trendline/hline/fibonacci)
let drawingState = {
    step: 0,  // 0=not started, 1=first click done
    startTime: null, startPrice: null
};

// AI Notes
let aiNotes = [];

// -------------------- DOM --------------------
const chartContainer = document.getElementById("candlestick-chart");
const loadingEl = document.getElementById("chart-loading");
const errorEl = document.getElementById("chart-error");
const errorMsg = document.getElementById("error-message");
const headerTicker = document.getElementById("header-ticker");
const headerExchange = document.getElementById("header-exchange");
const headerPrice = document.getElementById("header-price");
const headerChange = document.getElementById("header-change");
const tfButtons = document.querySelectorAll(".tf-btn[data-range]");
const changeSymbolBtn = document.getElementById("change-symbol-btn");
const searchOverlay = document.getElementById("symbol-search-overlay");
const searchForm = document.getElementById("symbol-search-form");
const searchInput = document.getElementById("symbol-search-input");
const toolButtons = document.querySelectorAll(".tool-btn[data-tool]");
const selectionInfoBar = document.getElementById("selection-info-bar");
const selectionRangeText = document.getElementById("selection-range-text");
const analyzeSelectionBtn = document.getElementById("analyze-selection-btn");
const clearSelectionBtn = document.getElementById("clear-selection-btn");
const terminalChatForm = document.getElementById("terminal-chat-form");
const terminalChatInput = document.getElementById("terminal-chat-input");
const notesList = document.getElementById("notes-list");
const aiSummarySection = document.getElementById("ai-summary-section");
const analysisTags = document.getElementById("analysis-tags");
const notesToggleBtn = document.getElementById("notes-toggle-btn");
const notesPanel = document.getElementById("ai-notes-panel");
const patternPopup = document.getElementById("pattern-popup");
const aiPanelToggleFab = document.getElementById("ai-panel-toggle-fab");
const panelResizeHandle = document.getElementById("panel-resize-handle");

// -------------------- INIT --------------------
function init() {
    const params = new URLSearchParams(window.location.search);
    currentSymbol = params.get("symbol") || "AAPL";
    currentRange = params.get("range") || "1mo";
    currentInterval = params.get("interval") || "1d";

    tfButtons.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.range === currentRange && btn.dataset.interval === currentInterval);
    });

    createChart();
    loadData(currentSymbol, currentRange, currentInterval);
    setupEventListeners();

    // Check if analysis data was passed via sessionStorage
    const storedAnalysis = sessionStorage.getItem("terminalAnalysis");
    if (storedAnalysis) {
        showPatterns = true;
        sessionStorage.removeItem("terminalAnalysis");
        try {
            const data = JSON.parse(storedAnalysis);
            // Delay execution to let chart load first
            setTimeout(() => {
                if (data.chartActions) executeChartActions(data.chartActions);
                if (data.notes) renderNotes(data.notes);
                if (data.message) showAISummary(data.message);
            }, 2000);
        } catch (e) {
            console.warn("[terminal] Failed to parse stored analysis:", e);
        }
    }

    // Auth profile display and logout handler
    const userStr = localStorage.getItem("tradebot_user");
    if (userStr) {
        try {
            const user = JSON.parse(userStr);
            const userDisplayName = document.getElementById("user-display-name");
            if (userDisplayName) {
                userDisplayName.innerHTML = `<i class="fas fa-user-circle"></i> ${user.username}`;
            }
        } catch (e) {
            console.error("Error parsing user info:", e);
        }
    }

    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            localStorage.removeItem("tradebot_token");
            localStorage.removeItem("tradebot_user");
            window.location.href = "index.html";
        });
    }

    // --- Terminal Tab Navigation & Search History ---
    const tabNotesBtn = document.getElementById("tab-notes-btn");
    const tabHistoryBtn = document.getElementById("tab-history-btn");
    const notesTabContent = document.getElementById("notes-tab-content");
    const historyTabContent = document.getElementById("history-tab-content");
    const historyList = document.getElementById("history-list");
    const clearHistoryBtn = document.getElementById("clear-history-btn");

    if (tabNotesBtn && tabHistoryBtn && notesTabContent && historyTabContent) {
        tabNotesBtn.addEventListener("click", () => {
            tabHistoryBtn.classList.remove("active");
            tabNotesBtn.classList.add("active");
            historyTabContent.classList.add("hidden");
            notesTabContent.classList.remove("hidden");
        });

        tabHistoryBtn.addEventListener("click", () => {
            tabNotesBtn.classList.remove("active");
            tabHistoryBtn.classList.add("active");
            notesTabContent.classList.add("hidden");
            historyTabContent.classList.remove("hidden");
            fetchTerminalHistory();
        });
    }

    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener("click", async () => {
            if (!confirm("Are you sure you want to clear your entire search history?")) return;
            const token = localStorage.getItem("tradebot_token");
            try {
                const response = await fetch("/api/history", {
                    method: "DELETE",
                    headers: { "Authorization": `Bearer ${token}` }
                });
                if (response.ok) {
                    fetchTerminalHistory();
                }
            } catch (err) {
                console.error("Error clearing history in terminal:", err);
            }
        });
    }

    async function fetchTerminalHistory() {
        const token = localStorage.getItem("tradebot_token");
        if (!token) return;
        try {
            const response = await fetch("/api/history", {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (response.status === 401) {
                localStorage.removeItem("tradebot_token");
                localStorage.removeItem("tradebot_user");
                window.location.href = "index.html";
                return;
            }
            const data = await response.json();
            if (response.ok) {
                renderTerminalHistory(data.history || []);
            }
        } catch (err) {
            console.error("Error fetching terminal history:", err);
        }
    }

    function renderTerminalHistory(items) {
        if (!historyList) return;
        historyList.innerHTML = "";

        if (items.length === 0) {
            historyList.innerHTML = '<p class="history-empty">No search history yet.</p>';
            return;
        }

        items.forEach(item => {
            const card = document.createElement("div");
            card.className = "history-card";
            
            const timeStr = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + 
                            " " + new Date(item.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });

            const symbolTag = item.symbol ? `<span class="history-symbol">${item.symbol}</span>` : '';
            
            card.innerHTML = `
                <div class="history-card-header">
                    <span class="history-query">${escapeHtml(item.query)}</span>
                    <button class="history-card-delete" data-id="${item.id}" title="Delete item">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <p class="history-summary">${escapeHtml(item.summary || item.query)}</p>
                <div class="history-footer">
                    ${symbolTag}
                    <span class="history-time">${timeStr}</span>
                </div>
            `;

            // Click card to load symbol in terminal
            card.addEventListener("click", (e) => {
                if (e.target.closest(".history-card-delete")) return;
                
                const targetSymbol = item.symbol || item.query.trim().toUpperCase();
                if (targetSymbol) {
                    const url = new URL(window.location);
                    url.searchParams.set("symbol", targetSymbol);
                    window.location.href = url.toString();
                }
            });

            // Delete item button handler
            const deleteBtn = card.querySelector(".history-card-delete");
            deleteBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const token = localStorage.getItem("tradebot_token");
                try {
                    const response = await fetch(`/api/history/${item.id}`, {
                        method: "DELETE",
                        headers: { "Authorization": `Bearer ${token}` }
                    });
                    if (response.ok) {
                        fetchTerminalHistory();
                    }
                } catch (err) {
                    console.error("Error deleting terminal history item:", err);
                }
            });

            historyList.appendChild(card);
        });
    }

    function escapeHtml(text) {
        if (!text) return "";
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Expose fetchTerminalHistory globally to refresh it when new analysis runs
    window.refreshTerminalHistory = fetchTerminalHistory;
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

    candlestickSeries = chart.addCandlestickSeries({
        upColor: "#10B981",
        downColor: "#F43F5E",
        borderDownColor: "#F43F5E",
        borderUpColor: "#10B981",
        wickDownColor: "#F43F5E",
        wickUpColor: "#10B981",
    });

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

    // Subscribe to crosshair move and clicks for coordinate tracking
    chart.subscribeCrosshairMove(handleCrosshairMove);
    chart.subscribeClick(handleChartClick);
}

// -------------------- DATA FETCHING --------------------
async function loadData(symbol, range, interval) {
    showLoading();
    hideError();

    try {
        const url = `/api/candles?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`;
        console.log(`[terminal] Fetching: ${url}`);

        const response = await fetch(url, {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        if (response.status === 401) {
            localStorage.removeItem("tradebot_token");
            localStorage.removeItem("tradebot_user");
            window.location.href = "index.html";
            return;
        }

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Server returned ${response.status}`);
        }

        const data = await response.json();
        console.log(`[terminal] Received ${data.candles.length} candles for ${data.symbol}`);

        currentCandleData = data.candles;
        renderChart(data);
        updateHeader(data);
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

    candlestickSeries.setData(
        candles.map(c => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        }))
    );

    volumeSeries.setData(
        candles.map(c => ({
            time: c.time,
            value: c.volume,
            color: c.close >= c.open
                ? "rgba(16, 185, 129, 0.25)"
                : "rgba(244, 63, 94, 0.25)",
        }))
    );

    // Place markers for detected patterns across the entire graph (shown only in analysis mode)
    const markers = [];
    if (showPatterns) {
        candles.forEach(c => {
            if (c.pattern) {
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
    }

    candlestickSeries.setMarkers(markers);

    // Set visible range
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

    const sym = data.symbol.toUpperCase();
    if (sym.endsWith(".NS")) {
        headerExchange.textContent = "NSE · India";
    } else if (sym.endsWith(".BO")) {
        headerExchange.textContent = "BSE · India";
    } else {
        headerExchange.textContent = "NASDAQ / NYSE · US";
    }

    if (data.livePrice) {
        const lp = data.livePrice;
        headerPrice.textContent = formatPrice(lp.currentPrice, sym);
        const sign = lp.change >= 0 ? "+" : "";
        const changeText = `${sign}${lp.change.toFixed(2)} (${sign}${lp.changePercent.toFixed(2)}%)`;
        headerChange.textContent = changeText;
        headerChange.className = "change " + (lp.change >= 0 ? "up" : "down");
    } else if (data.candles.length > 0) {
        const last = data.candles[data.candles.length - 1];
        headerPrice.textContent = formatPrice(last.close, sym);
        headerChange.textContent = "";
    }

    document.title = `${data.symbol} — TradeMind Terminal`;
}

function formatPrice(price, symbol) {
    if (symbol && (symbol.endsWith(".NS") || symbol.endsWith(".BO"))) {
        return "₹" + price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// -------------------- CHART ACTION EXECUTOR --------------------
function executeChartActions(actions) {
    if (!actions || !Array.isArray(actions)) return;

    console.log(`[terminal] Executing ${actions.length} chart actions`);

    actions.forEach(action => {
        switch (action.type) {
            case "HIGHLIGHT_RANGE":
                highlightRange(action.startTime, action.endTime);
                break;
            case "DRAW_TREND_LINE":
                drawTrendLine(action);
                break;
            case "DRAW_SUPPORT":
                drawSupportLine(action.price, action.strength);
                break;
            case "DRAW_RESISTANCE":
                drawResistanceLine(action.price, action.strength);
                break;
            case "DRAW_STRUCTURE_LABELS":
                drawStructureLabels(action.labels);
                break;
            case "SET_VISIBLE_RANGE":
                setVisibleRange(action.startDate, action.endDate);
                break;
            case "ADD_PATTERN_MARKER":
                // Pattern markers are handled through chart markers in renderChart
                break;
            case "ADD_NOTE":
                aiNotes.push(action);
                break;
        }
    });
}

function setVisibleRange(start, end) {
    if (!chart || !start || !end) return;
    try {
        chart.timeScale().setVisibleRange({
            from: start,
            to: end
        });
    } catch (e) {
        console.warn("[terminal] setVisibleRange failed:", e);
    }
}

function highlightRange(startTime, endTime) {
    try {
        const highlightData = currentCandleData
            .filter(c => c.time >= startTime && c.time <= endTime)
            .map(c => ({
                time: c.time,
                value: c.high,
                color: "rgba(168, 85, 247, 0.08)"
            }));

        if (highlightData.length > 0) {
            const hl = chart.addHistogramSeries({
                priceScaleId: 'highlight',
                priceFormat: { type: 'price' },
            });
            chart.priceScale('highlight').applyOptions({
                scaleMargins: { top: 0, bottom: 0 },
            });
            hl.setData(highlightData);
            const item = { series: hl };
            drawings.highlights.push(item);
            drawingHistory.push({ type: 'highlight', target: hl, dataRef: item });
        }
    } catch (e) {
        console.warn("[terminal] Highlight range failed:", e);
    }
}

function drawTrendLine(action) {
    try {
        const trendData = [
            { time: action.startTime, value: action.startPrice },
            { time: action.endTime, value: action.endPrice }
        ];

        const color = action.direction === "bullish" ? "#10B981" : action.direction === "bearish" ? "#F43F5E" : "#FBBF24";

        const lineSeries = chart.addLineSeries({
            color: color,
            lineWidth: 2,
            lineStyle: LightweightCharts.LineStyle.Solid,
            priceScaleId: '',
            lastValueVisible: false,
            priceLineVisible: false,
        });
        lineSeries.setData(trendData);

        // Add trend label as marker
        const midIdx = Math.floor(currentCandleData.length / 2);
        const labelTime = action.endTime;
        const dirLabel = action.direction === "bullish" ? "▲ BULLISH" : action.direction === "bearish" ? "▼ BEARISH" : "— SIDEWAYS";

        candlestickSeries.setMarkers([
            ...candlestickSeries.markers || [],
        ]);

        const item = {
            series: lineSeries,
            ...action
        };
        drawings.trendLines.push(item);
        drawingHistory.push({ type: 'trendline', target: lineSeries, dataRef: item });
    } catch (e) {
        console.warn("[terminal] Draw trend line failed:", e);
    }
}

function drawSupportLine(price, strength) {
    try {
        const opacity = Math.min(1, (strength || 50) / 100);
        const priceLine = candlestickSeries.createPriceLine({
            price: price,
            color: `rgba(59, 130, 246, ${opacity})`,
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
            title: `S ${price}`,
        });
        const item = { priceLine, price, type: "support" };
        drawings.hLines.push(item);
        drawingHistory.push({ type: 'hline', target: priceLine, dataRef: item });
    } catch (e) {
        console.warn("[terminal] Draw support failed:", e);
    }
}

function drawResistanceLine(price, strength) {
    try {
        const opacity = Math.min(1, (strength || 50) / 100);
        const priceLine = candlestickSeries.createPriceLine({
            price: price,
            color: `rgba(244, 63, 94, ${opacity})`,
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
            title: `R ${price}`,
        });
        const item = { priceLine, price, type: "resistance" };
        drawings.hLines.push(item);
        drawingHistory.push({ type: 'hline', target: priceLine, dataRef: item });
    } catch (e) {
        console.warn("[terminal] Draw resistance failed:", e);
    }
}

function drawStructureLabels(labels) {
    if (!labels || !Array.isArray(labels)) return;
    
    const currentMarkers = candlestickSeries.markers || [];
    const newMarkers = [...currentMarkers];
    
    labels.forEach(lbl => {
        const isBullish = lbl.label === "HH" || lbl.label === "HL";
        newMarkers.push({
            time: lbl.time,
            position: isBullish ? "aboveBar" : "belowBar",
            color: isBullish ? "#34D399" : "#F43F5E",
            shape: "circle",
            text: lbl.label,
            id: `structure-${lbl.time}-${lbl.label}`
        });
    });
    
    candlestickSeries.setMarkers(newMarkers);
    
    drawingHistory.push({
        type: 'markers',
        target: labels.map(lbl => `structure-${lbl.time}-${lbl.label}`),
        dataRef: labels
    });
}

// -------------------- DRAWING TOOLS --------------------
function clearAllDrawings() {
    drawings.trendLines.forEach(d => {
        try { chart.removeSeries(d.series); } catch (e) {}
    });
    drawings.highlights.forEach(d => {
        try { chart.removeSeries(d.series); } catch (e) {}
    });
    drawings.hLines.forEach(d => {
        try { candlestickSeries.removePriceLine(d.priceLine); } catch (e) {}
    });
    drawings.fibLevels.forEach(d => {
        d.priceLines.forEach(pl => {
            try { candlestickSeries.removePriceLine(pl); } catch (e) {}
        });
    });

    drawings = { trendLines: [], hLines: [], fibLevels: [], highlights: [] };
    drawingHistory = [];
    clearSelection();
}

function clearSelection() {
    selectionState = {
        isSelecting: false,
        startX: null, startY: null,
        startTime: null, startPrice: null,
        endTime: null, endPrice: null,
        candles: [],
        highlightSeries: null
    };
    selectionInfoBar.classList.add("hidden");
}

// -------------------- RECTANGLE SELECTION --------------------
function handleChartMouseDown(e) {
    if (currentTool !== "rectangle" && currentTool !== "ai-analyze") return;
    if (!chart) return;

    const rect = chartContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const coord = chart.timeScale().coordinateToTime(x);
    const priceCoord = candlestickSeries.coordinateToPrice(y);

    if (coord && priceCoord) {
        selectionState.isSelecting = true;
        selectionState.startTime = coord;
        selectionState.startPrice = priceCoord;
        selectionState.startX = x;
        selectionState.startY = y;
    }
}

function handleChartMouseUp(e) {
    if (!selectionState.isSelecting) return;
    selectionState.isSelecting = false;

    const rect = chartContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const coord = chart.timeScale().coordinateToTime(x);
    const priceCoord = candlestickSeries.coordinateToPrice(y);

    if (coord && priceCoord) {
        selectionState.endTime = coord;
        selectionState.endPrice = priceCoord;

        // Normalize order
        if (selectionState.startTime > selectionState.endTime) {
            [selectionState.startTime, selectionState.endTime] = [selectionState.endTime, selectionState.startTime];
        }
        if (selectionState.startPrice > selectionState.endPrice) {
            [selectionState.startPrice, selectionState.endPrice] = [selectionState.endPrice, selectionState.startPrice];
        }

        // Filter candles in the selected range
        selectionState.candles = currentCandleData.filter(c =>
            c.time >= selectionState.startTime && c.time <= selectionState.endTime
        );

        if (selectionState.candles.length > 0) {
            // Show selection info
            const startStr = formatTime(selectionState.startTime);
            const endStr = formatTime(selectionState.endTime);
            selectionRangeText.textContent = `Selected: ${startStr} → ${endStr} (${selectionState.candles.length} candles)`;
            selectionInfoBar.classList.remove("hidden");

            // Highlight the selected area
            highlightRange(selectionState.startTime, selectionState.endTime);

            // If AI analyze tool, auto-trigger analysis
            if (currentTool === "ai-analyze") {
                analyzeSelection();
            }
        }
    }
}

function handleCrosshairMove(param) {
    // Track mouse position for drawing tools
}

function handleChartClick(param) {
    if (!param || !param.point) return;
    const time = param.time;
    const price = candlestickSeries.coordinateToPrice(param.point.y);

    if (currentTool === "hline") {
        if (price) {
            const priceLine = candlestickSeries.createPriceLine({
                price: price,
                color: "rgba(251, 191, 36, 0.7)",
                lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Solid,
                axisLabelVisible: true,
                title: `H ${price.toFixed(2)}`,
            });
            const item = { priceLine, price, type: "horizontal" };
            drawings.hLines.push(item);
            drawingHistory.push({ type: 'hline', target: priceLine, dataRef: item });
            setActiveTool("pointer");
        }
    } else if (currentTool === "trendline") {
        if (time && price) {
            if (drawingState.step === 0) {
                drawingState.step = 1;
                drawingState.startTime = time;
                drawingState.startPrice = price;
            } else {
                // Second click — draw the line
                const lineSeries = chart.addLineSeries({
                    color: "#FBBF24",
                    lineWidth: 2,
                    lineStyle: LightweightCharts.LineStyle.Solid,
                    lastValueVisible: false,
                    priceLineVisible: false,
                });
                lineSeries.setData([
                    { time: drawingState.startTime, value: drawingState.startPrice },
                    { time: time, value: price }
                ]);
                const item = {
                    series: lineSeries,
                    startTime: drawingState.startTime,
                    endTime: time,
                    startPrice: drawingState.startPrice,
                    endPrice: price
                };
                drawings.trendLines.push(item);
                drawingHistory.push({ type: 'trendline', target: lineSeries, dataRef: item });
                drawingState.step = 0;
                setActiveTool("pointer");
            }
        }
    } else if (currentTool === "fibonacci") {
        if (time && price) {
            if (drawingState.step === 0) {
                drawingState.step = 1;
                drawingState.startTime = time;
                drawingState.startPrice = price;
            } else {
                // Draw Fibonacci levels
                const high = Math.max(drawingState.startPrice, price);
                const low = Math.min(drawingState.startPrice, price);
                const diff = high - low;
                const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
                const colors = ["#F43F5E", "#FF6B6B", "#FBBF24", "#94A3B8", "#34D399", "#10B981", "#3B82F6"];

                const priceLines = levels.map((level, idx) => {
                    const levelPrice = high - diff * level;
                    return candlestickSeries.createPriceLine({
                        price: levelPrice,
                        color: colors[idx],
                        lineWidth: 1,
                        lineStyle: LightweightCharts.LineStyle.Dotted,
                        axisLabelVisible: true,
                        title: `${(level * 100).toFixed(1)}% — ${levelPrice.toFixed(2)}`,
                    });
                });

                const item = { priceLines };
                drawings.fibLevels.push(item);
                drawingHistory.push({ type: 'fibonacci', target: priceLines, dataRef: item });
                drawingState.step = 0;
                setActiveTool("pointer");
            }
        }
    }

    // Check if a pattern candle was clicked
    if (currentTool === "pointer" || currentTool === "crosshair") {
        if (time) {
            const candle = currentCandleData.find(c => c.time === time);
            if (candle && candle.pattern) {
                const rect = chartContainer.getBoundingClientRect();
                const x = rect.left + param.point.x;
                const y = rect.top + param.point.y;
                showPatternPopup(candle, x, y);
            }
        }
    }
}

// -------------------- PATTERN POPUP --------------------
function showPatternPopup(candle, x, y) {
    const popup = patternPopup;
    popup.classList.remove("hidden");

    document.getElementById("popup-pattern-name").textContent = candle.pattern;
    document.getElementById("popup-time").textContent = formatTime(candle.time);
    document.getElementById("popup-price").textContent = formatPrice(candle.close, currentSymbol);
    document.getElementById("popup-signal").textContent = (candle.signal || "neutral").toUpperCase();
    document.getElementById("popup-signal").style.color =
        candle.signal === "bullish" ? "#10B981" : candle.signal === "bearish" ? "#F43F5E" : "#FBBF24";
    document.getElementById("popup-confidence").textContent = (candle.confidence || 70) + "%";
    document.getElementById("popup-explanation").textContent = candle.explanation || "Standard candlestick pattern.";

    // Position popup near click
    const maxX = window.innerWidth - 300;
    const maxY = window.innerHeight - 250;
    popup.style.left = Math.min(x + 10, maxX) + "px";
    popup.style.top = Math.min(y + 10, maxY) + "px";
}

function hidePatternPopup() {
    patternPopup.classList.add("hidden");
}

// -------------------- AI ANALYSIS --------------------
async function analyzeSelection() {
    if (selectionState.candles.length < 3) {
        showAISummary("Please select at least 3 candles to analyze.");
        return;
    }

    showAnalysisLoading();

    try {
        const response = await fetch("/api/terminal-analyze", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                message: "Analyze this selected area completely",
                symbol: currentSymbol,
                interval: currentInterval,
                selectedRange: {
                    startTime: selectionState.startTime,
                    endTime: selectionState.endTime,
                    startPrice: selectionState.startPrice,
                    endPrice: selectionState.endPrice,
                    candles: selectionState.candles
                }
            })
        });

        if (response.status === 401) {
            localStorage.removeItem("tradebot_token");
            localStorage.removeItem("tradebot_user");
            window.location.href = "index.html";
            return;
        }

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const data = await response.json();
        await handleAnalysisResponse(data);

    } catch (error) {
        console.error("[terminal] Analysis error:", error);
        showAISummary("Analysis failed. Please try again.");
    }
}

async function handleAnalysisResponse(data) {
    showPatterns = true;
    if (data.symbol && data.symbol.toUpperCase() !== currentSymbol.toUpperCase()) {
        currentSymbol = data.symbol.toUpperCase();
        
        const url = new URL(window.location);
        url.searchParams.set("symbol", currentSymbol);
        window.history.replaceState({}, "", url);
        
        await loadData(currentSymbol, currentRange, currentInterval);
    } else {
        clearAllDrawings();
        // Force refresh markers on the chart now that showPatterns is true
        if (currentCandleData && currentCandleData.length > 0) {
            renderChart({ candles: currentCandleData });
        }
    }

    if (data.chartActions) executeChartActions(data.chartActions);
    if (data.notes) renderNotes(data.notes);
    if (data.message) showAISummary(data.message);

    renderAnalysisTags(data);
    
    // Refresh search history list inside terminal
    if (typeof window.refreshTerminalHistory === "function") {
        window.refreshTerminalHistory();
    }
}

async function sendTerminalChat(message) {
    showAnalysisLoading();

    try {
        const payload = {
            message: message,
            symbol: currentSymbol,
            interval: currentInterval
        };

        // Include selection if available
        if (selectionState.candles.length > 0) {
            payload.selectedRange = {
                startTime: selectionState.startTime,
                endTime: selectionState.endTime,
                startPrice: selectionState.startPrice,
                endPrice: selectionState.endPrice,
                candles: selectionState.candles
            };
        }

        const response = await fetch("/api/terminal-analyze", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        if (response.status === 401) {
            localStorage.removeItem("tradebot_token");
            localStorage.removeItem("tradebot_user");
            window.location.href = "index.html";
            return;
        }

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const data = await response.json();
        await handleAnalysisResponse(data);

    } catch (error) {
        console.error("[terminal] Chat error:", error);
        showAISummary("Analysis failed. Please try again.");
    }
}

// -------------------- NOTES PANEL --------------------
function renderNotes(notes) {
    aiNotes = notes;
    notesList.innerHTML = "";

    if (!notes || notes.length === 0) {
        notesList.innerHTML = '<div class="note-card"><p class="note-card-text" style="color:var(--t-text-dim);font-style:italic;">No analysis notes yet.</p></div>';
        return;
    }

    notes.forEach((note, idx) => {
        const card = document.createElement("div");
        card.className = "note-card";
        card.innerHTML = `
            <div class="note-card-time">${formatTime(note.time)}</div>
            <div class="note-card-text">${note.text}</div>
            <span class="note-card-category ${note.category || 'trend'}">${note.category || 'info'}</span>
        `;
        card.addEventListener("click", () => navigateToCandle(note.time));
        notesList.appendChild(card);
    });
}

function navigateToCandle(time) {
    if (!time || !chart) return;

    try {
        // Find the candle index
        const idx = currentCandleData.findIndex(c => c.time === time);
        if (idx >= 0) {
            chart.timeScale().setVisibleLogicalRange({
                from: Math.max(0, idx - 15),
                to: Math.min(currentCandleData.length, idx + 15)
            });
        }
    } catch (e) {
        console.warn("[terminal] Navigate to candle failed:", e);
    }
}

function showAISummary(text) {
    aiSummarySection.innerHTML = "";
    const p = document.createElement("p");
    p.className = "ai-summary-text";
    p.textContent = text;
    aiSummarySection.appendChild(p);
}

function showAnalysisLoading() {
    const loadingHtml = `
        <div class="analysis-loading">
            <div class="mini-spinner"></div>
            <span>Analyzing...</span>
        </div>
    `;
    aiSummarySection.innerHTML = loadingHtml;
    notesList.innerHTML = "";
    analysisTags.innerHTML = "";
}

function renderAnalysisTags(data) {
    analysisTags.innerHTML = "";

    if (data.chartActions) {
        const actionTypes = new Set(data.chartActions.map(a => a.type));

        if (actionTypes.has("DRAW_TREND_LINE")) {
            const trendAction = data.chartActions.find(a => a.type === "DRAW_TREND_LINE");
            const tag = createTag("trend", `${trendAction?.direction || "trend"} ${trendAction?.confidence || ""}%`);
            analysisTags.appendChild(tag);
        }
        if (actionTypes.has("DRAW_SUPPORT")) {
            const count = data.chartActions.filter(a => a.type === "DRAW_SUPPORT").length;
            analysisTags.appendChild(createTag("support", `${count} support`));
        }
        if (actionTypes.has("DRAW_RESISTANCE")) {
            const count = data.chartActions.filter(a => a.type === "DRAW_RESISTANCE").length;
            analysisTags.appendChild(createTag("resistance", `${count} resistance`));
        }
        if (actionTypes.has("ADD_PATTERN_MARKER")) {
            const patterns = data.chartActions.filter(a => a.type === "ADD_PATTERN_MARKER");
            analysisTags.appendChild(createTag("pattern", `${patterns.length} patterns`));
        }
    }
}

function createTag(category, text) {
    const tag = document.createElement("span");
    tag.className = `analysis-tag ${category}`;
    tag.textContent = text;
    return tag;
}

// -------------------- TOOL MANAGEMENT --------------------
function setActiveTool(tool) {
    currentTool = tool;
    toolButtons.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tool === tool);
    });

    // Update chart interaction mode
    if (tool === "pointer") {
        chart.applyOptions({
            handleScroll: { mouseWheel: true, pressedMouseMove: true },
            handleScale: { mouseWheel: true },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
        });
    } else if (tool === "crosshair") {
        chart.applyOptions({
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
        });
    } else {
        // For drawing tools, keep chart interaction but also handle clicks
        chart.applyOptions({
            handleScroll: { mouseWheel: true, pressedMouseMove: false },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
        });
    }

    // Reset drawing state
    drawingState.step = 0;

    // Update cursor
    const cursor = (tool === "rectangle" || tool === "ai-analyze") ? "crosshair" :
                   (tool === "trendline" || tool === "hline" || tool === "fibonacci") ? "crosshair" : "default";
    chartContainer.style.cursor = cursor;
}

// -------------------- ZOOM CONTROLS --------------------
function zoomIn() {
    const range = chart.timeScale().getVisibleLogicalRange();
    if (range) {
        const center = (range.from + range.to) / 2;
        const halfSpan = (range.to - range.from) / 4;
        chart.timeScale().setVisibleLogicalRange({
            from: center - halfSpan,
            to: center + halfSpan
        });
    }
}

function zoomOut() {
    const range = chart.timeScale().getVisibleLogicalRange();
    if (range) {
        const center = (range.from + range.to) / 2;
        const halfSpan = (range.to - range.from);
        chart.timeScale().setVisibleLogicalRange({
            from: center - halfSpan,
            to: center + halfSpan
        });
    }
}

function fitChart() {
    chart.timeScale().fitContent();
}

function resetChart() {
    clearAllDrawings();
    aiNotes = [];
    notesList.innerHTML = "";
    aiSummarySection.innerHTML = '<p class="ai-summary-placeholder">Select an area or type a command to start analysis.</p>';
    analysisTags.innerHTML = "";
    fitChart();
}

// -------------------- HELPERS --------------------
function formatTime(time) {
    if (typeof time === "number") {
        const d = new Date(time * 1000);
        return d.toLocaleString("en-IN", {
            hour: "2-digit", minute: "2-digit",
            day: "2-digit", month: "short",
            hour12: true
        });
    }
    if (typeof time === "string") {
        if (time.includes("T")) {
            return new Date(time).toLocaleString("en-IN", {
                hour: "2-digit", minute: "2-digit",
                day: "2-digit", month: "short",
                hour12: true
            });
        }
        // YYYY-MM-DD
        const d = new Date(time + "T00:00:00");
        return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    }
    return String(time);
}

function showLoading() { loadingEl.classList.remove("hidden"); }
function hideLoading() { loadingEl.classList.add("hidden"); }
function showError(msg) { errorMsg.textContent = msg; errorEl.classList.remove("hidden"); }
function hideError() { errorEl.classList.add("hidden"); }

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

            const url = new URL(window.location);
            url.searchParams.set("range", range);
            url.searchParams.set("interval", interval);
            window.history.replaceState({}, "", url);

            clearAllDrawings();
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

    // Search overlay
    searchOverlay.addEventListener("click", (e) => {
        if (e.target === searchOverlay) searchOverlay.classList.add("hidden");
    });

    searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const newSymbol = searchInput.value.trim().toUpperCase();
        if (!newSymbol) return;

        currentSymbol = newSymbol;
        searchOverlay.classList.add("hidden");

        const url = new URL(window.location);
        url.searchParams.set("symbol", newSymbol);
        window.history.replaceState({}, "", url);

        clearAllDrawings();
        showPatterns = false; // Reset pattern visibility for new symbol searches
        loadData(currentSymbol, currentRange, currentInterval);
    });

    // Drawing tool buttons
    toolButtons.forEach(btn => {
        btn.addEventListener("click", () => setActiveTool(btn.dataset.tool));
    });

    // Zoom controls
    document.getElementById("zoom-in-btn").addEventListener("click", zoomIn);
    document.getElementById("zoom-out-btn").addEventListener("click", zoomOut);
    document.getElementById("fit-chart-btn").addEventListener("click", fitChart);
    document.getElementById("reset-chart-btn").addEventListener("click", resetChart);

    // Delete / Clear
    document.getElementById("delete-drawing-btn").addEventListener("click", () => {
        if (drawingHistory.length === 0) return;
        
        const lastDrawing = drawingHistory.pop();
        
        if (lastDrawing.type === 'trendline') {
            try { chart.removeSeries(lastDrawing.target); } catch (e) {}
            drawings.trendLines = drawings.trendLines.filter(d => d !== lastDrawing.dataRef);
        } else if (lastDrawing.type === 'hline') {
            try { candlestickSeries.removePriceLine(lastDrawing.target); } catch (e) {}
            drawings.hLines = drawings.hLines.filter(d => d !== lastDrawing.dataRef);
        } else if (lastDrawing.type === 'fibonacci') {
            lastDrawing.target.forEach(pl => {
                try { candlestickSeries.removePriceLine(pl); } catch (e) {}
            });
            drawings.fibLevels = drawings.fibLevels.filter(d => d !== lastDrawing.dataRef);
        } else if (lastDrawing.type === 'highlight') {
            try { chart.removeSeries(lastDrawing.target); } catch (e) {}
            drawings.highlights = drawings.highlights.filter(d => d !== lastDrawing.dataRef);
        } else if (lastDrawing.type === 'markers') {
            const current = candlestickSeries.markers || [];
            const filtered = current.filter(m => !lastDrawing.target.includes(m.id || `structure-${m.time}-${m.text}`));
            candlestickSeries.setMarkers(filtered);
        }
    });
    document.getElementById("clear-all-btn").addEventListener("click", clearAllDrawings);

    // Selection buttons
    analyzeSelectionBtn.addEventListener("click", analyzeSelection);
    clearSelectionBtn.addEventListener("click", clearSelection);

    // Chart mouse events for rectangle selection
    chartContainer.addEventListener("mousedown", handleChartMouseDown);
    chartContainer.addEventListener("mouseup", handleChartMouseUp);

    // Terminal chat
    terminalChatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const msg = terminalChatInput.value.trim();
        if (!msg) return;
        terminalChatInput.value = "";
        sendTerminalChat(msg);
    });

    // Notes panel toggle
    notesToggleBtn.addEventListener("click", () => {
        notesPanel.classList.add("collapsed");
        aiPanelToggleFab.classList.add("visible");
    });

    aiPanelToggleFab.addEventListener("click", () => {
        notesPanel.classList.remove("collapsed");
        aiPanelToggleFab.classList.remove("visible");
    });

    // Right-panel drag-to-resize logic
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    panelResizeHandle.addEventListener("mousedown", (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = notesPanel.getBoundingClientRect().width;
        panelResizeHandle.classList.add("active");
        document.body.style.cursor = "ew-resize";
        document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (e) => {
        if (!isResizing) return;
        
        const deltaX = e.clientX - startX;
        const newWidth = Math.max(300, Math.min(700, startWidth - deltaX));
        notesPanel.style.width = `${newWidth}px`;
    });

    document.addEventListener("mouseup", () => {
        if (!isResizing) return;
        isResizing = false;
        panelResizeHandle.classList.remove("active");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
    });

    // Pattern popup close
    document.getElementById("popup-close-btn").addEventListener("click", hidePatternPopup);

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT") return;

        switch (e.key.toLowerCase()) {
            case "escape":
                if (!searchOverlay.classList.contains("hidden")) {
                    searchOverlay.classList.add("hidden");
                } else {
                    hidePatternPopup();
                    setActiveTool("pointer");
                }
                break;
            case "v": setActiveTool("pointer"); break;
            case "r": setActiveTool("rectangle"); break;
            case "a": setActiveTool("ai-analyze"); break;
            case "t": setActiveTool("trendline"); break;
            case "h": setActiveTool("hline"); break;
            case "f": setActiveTool("fibonacci"); break;
            case "delete":
            case "backspace":
                document.getElementById("delete-drawing-btn").click();
                break;
        }
    });

    // Close popup on click outside
    document.addEventListener("click", (e) => {
        if (!patternPopup.contains(e.target) && !patternPopup.classList.contains("hidden")) {
            // Small delay to avoid closing immediately
            setTimeout(() => {
                if (!patternPopup.matches(":hover")) hidePatternPopup();
            }, 100);
        }
    });
}

// -------------------- BOOT --------------------
document.addEventListener("DOMContentLoaded", init);
