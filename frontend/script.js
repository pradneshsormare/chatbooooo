// ------------------ DOM ELEMENTS ------------------
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const chatMessages = document.getElementById("chat-messages");

// ------------------ EVENT LISTENERS ------------------
chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userProblem = userInput.value.trim();
    if (!userProblem) return;

    addMessage(userProblem, "user");
    userInput.value = "";

    const loadingIndicator = addMessage("Thinking...", "bot", true);

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: userProblem }),
        });

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }

        const data = await response.json();

        loadingIndicator.remove();
        const botMsgEl = addMessage(data.text, "bot");

        // If stockData is returned, draw the stock chart card
        if (data.stockData) {
            appendStockCard(data.stockData, botMsgEl, data.terminalTicker);
        }

        // If terminal data with chart actions is available, show analysis preview
        if (data.terminalData) {
            appendAnalysisPreview(data.terminalData, botMsgEl);

            // If openTerminal is true, auto-open the terminal
            if (data.terminalData.openTerminal) {
                // Store analysis data for the terminal to pick up
                sessionStorage.setItem("terminalAnalysis", JSON.stringify({
                    chartActions: data.terminalData.chartActions,
                    notes: data.terminalData.notes,
                    message: data.terminalData.analysisMessage
                }));

                // Open terminal after a short delay so user sees the chat response first
                setTimeout(() => {
                    const symbol = data.terminalData.symbol || data.terminalTicker || "AAPL";
                    window.open(`terminal.html?symbol=${encodeURIComponent(symbol)}`, "_blank");
                }, 1500);
            }
        }
    } catch (error) {
        loadingIndicator.remove();
        addMessage("Sorry, something went wrong. Please try again.", "bot");
        console.error("AI Error:", error);
    }
});

// ------------------ HELPER FUNCTIONS ------------------
/**
 * Cleans and formats text, then adds it to the chat interface.
 */
function addMessage(text, sender, isLoading = false) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", `${sender}-message`);

    if (isLoading) {
        messageElement.classList.add("loading");
        const p = document.createElement("p");
        p.textContent = text;
        messageElement.appendChild(p);
    } else if (sender === 'bot') {
        let cleanText = text
            .replace(/```(?:json|javascript|html|css|python)?/g, '')
            .replace(/```/g, '')
            .replace(/\*/g, '')
            .trim();

        const paragraphs = cleanText.split('\n').filter(p => p.trim() !== '');

        if (paragraphs.length === 0) {
            const p = document.createElement('p');
            p.textContent = cleanText;
            messageElement.appendChild(p);
        } else {
            paragraphs.forEach(paraText => {
                const p = document.createElement('p');
                p.textContent = paraText;
                messageElement.appendChild(p);
            });
        }
    } else {
        const p = document.createElement("p");
        p.textContent = text;
        messageElement.appendChild(p);
    }

    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return messageElement;
}

/**
 * Appends a Chart.js stock chart card below the bot's text message.
 */
function appendStockCard(stockData, targetMessageEl, terminalTicker) {
    const card = document.createElement("div");
    card.classList.add("stock-card");

    const isUp = stockData.change >= 0;
    const arrowIcon = isUp ? "fa-arrow-trend-up" : "fa-arrow-trend-down";
    const changeClass = isUp ? "up" : "down";
    const sign = isUp ? "+" : "";

    const chartId = `chart-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const termTicker = terminalTicker || stockData.ticker;

    card.innerHTML = `
        <div class="stock-card-header">
            <div class="stock-company">
                <span class="stock-name">${stockData.companyName}</span>
                <span class="stock-symbol">${stockData.ticker} · NSE</span>
            </div>
            <div class="stock-price-info">
                <span class="stock-current-price">₹${stockData.currentPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                <span class="stock-change ${changeClass}">
                    <i class="fa-solid ${arrowIcon}"></i>
                    ${sign}${stockData.change.toFixed(2)} (${sign}${stockData.changePercent.toFixed(2)}%)
                </span>
            </div>
        </div>
        <div class="stock-chart-container">
            <canvas id="${chartId}"></canvas>
        </div>
        <a href="terminal.html?symbol=${encodeURIComponent(termTicker)}" target="_blank" class="open-terminal-btn">
            <i class="fas fa-chart-bar"></i>
            Open Terminal
        </a>
    `;

    targetMessageEl.appendChild(card);

    const ctx = document.getElementById(chartId).getContext("2d");

    const lineColor = isUp ? "#10B981" : "#F43F5E";
    const gradient = ctx.createLinearGradient(0, 0, 0, 180);
    if (isUp) {
        gradient.addColorStop(0, "rgba(16, 185, 129, 0.4)");
        gradient.addColorStop(1, "rgba(16, 185, 129, 0.0)");
    } else {
        gradient.addColorStop(0, "rgba(244, 63, 94, 0.4)");
        gradient.addColorStop(1, "rgba(244, 63, 94, 0.0)");
    }

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: stockData.history.labels,
            datasets: [{
                data: stockData.history.prices,
                borderColor: lineColor,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: lineColor,
                backgroundColor: gradient,
                fill: true,
                tension: 0.15
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: '#1E293B',
                    titleColor: '#94A3B8',
                    bodyColor: '#FFFFFF',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return `₹${context.parsed.y.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#94A3B8',
                        font: { size: 10 },
                        maxTicksLimit: 6
                    }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: '#94A3B8',
                        font: { size: 10 }
                    }
                }
            }
        }
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Appends an analysis preview card showing AI analysis results
 * with a button to open the full terminal with pre-loaded analysis.
 */
function appendAnalysisPreview(terminalData, targetMessageEl) {
    const preview = document.createElement("div");
    preview.classList.add("analysis-preview-card");

    const actionCount = terminalData.chartActions ? terminalData.chartActions.length : 0;
    const noteCount = terminalData.notes ? terminalData.notes.length : 0;

    // Extract key findings
    const trendAction = terminalData.chartActions?.find(a => a.type === "DRAW_TREND_LINE");
    const supports = terminalData.chartActions?.filter(a => a.type === "DRAW_SUPPORT") || [];
    const resistances = terminalData.chartActions?.filter(a => a.type === "DRAW_RESISTANCE") || [];
    const patterns = terminalData.chartActions?.filter(a => a.type === "ADD_PATTERN_MARKER") || [];

    let findingsHtml = '<div class="preview-findings">';

    if (trendAction) {
        const trendColor = trendAction.direction === "bullish" ? "#10B981" : trendAction.direction === "bearish" ? "#F43F5E" : "#FBBF24";
        const trendIcon = trendAction.direction === "bullish" ? "fa-arrow-trend-up" : "fa-arrow-trend-down";
        findingsHtml += `<span class="preview-tag" style="background:${trendColor}20;color:${trendColor};border:1px solid ${trendColor}40">
            <i class="fas ${trendIcon}"></i> ${trendAction.direction} (${trendAction.confidence}%)
        </span>`;
    }

    if (supports.length > 0) {
        findingsHtml += `<span class="preview-tag" style="background:rgba(59,130,246,0.15);color:#3B82F6;border:1px solid rgba(59,130,246,0.3)">
            <i class="fas fa-arrow-down"></i> ${supports.length} support
        </span>`;
    }

    if (resistances.length > 0) {
        findingsHtml += `<span class="preview-tag" style="background:rgba(244,63,94,0.15);color:#F43F5E;border:1px solid rgba(244,63,94,0.3)">
            <i class="fas fa-arrow-up"></i> ${resistances.length} resistance
        </span>`;
    }

    if (patterns.length > 0) {
        findingsHtml += `<span class="preview-tag" style="background:rgba(251,191,36,0.15);color:#FBBF24;border:1px solid rgba(251,191,36,0.3)">
            <i class="fas fa-shapes"></i> ${patterns.length} patterns
        </span>`;
    }

    findingsHtml += '</div>';

    preview.innerHTML = `
        <div class="preview-header">
            <i class="fas fa-wand-magic-sparkles" style="color:#A855F7"></i>
            <span>AI Analysis Ready</span>
            <span class="preview-badge">${actionCount} actions · ${noteCount} notes</span>
        </div>
        ${findingsHtml}
        <button class="preview-open-btn" onclick="openTerminalWithAnalysis('${encodeURIComponent(JSON.stringify({
            chartActions: terminalData.chartActions,
            notes: terminalData.notes,
            message: terminalData.analysisMessage || ''
        }))}', '${terminalData.symbol}')">
            <i class="fas fa-chart-bar"></i> Open Terminal with Analysis
        </button>
    `;

    targetMessageEl.appendChild(preview);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Opens the terminal with pre-loaded analysis data.
 */
window.openTerminalWithAnalysis = function(encodedData, symbol) {
    try {
        const data = JSON.parse(decodeURIComponent(encodedData));
        sessionStorage.setItem("terminalAnalysis", JSON.stringify(data));
        window.open(`terminal.html?symbol=${encodeURIComponent(symbol)}`, "_blank");
    } catch (e) {
        console.error("Failed to open terminal:", e);
        window.open(`terminal.html?symbol=${encodeURIComponent(symbol)}`, "_blank");
    }
};
