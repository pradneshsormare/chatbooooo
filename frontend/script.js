// Check authentication before loading anything
const token = localStorage.getItem("tradebot_token");
if (!token) {
    window.location.href = "index.html";
}

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
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ message: userProblem }),
        });

        if (response.status === 401) {
            localStorage.removeItem("tradebot_token");
            localStorage.removeItem("tradebot_user");
            window.location.href = "index.html";
            return;
        }

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

        // Refresh search history list to show the new item
        if (typeof window.refreshSearchHistory === "function") {
            window.refreshSearchHistory();
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
 * Dynamic financial text highlights and formatting.
 * Shows profit/green, losses/red, and digits/sky-blue mono.
 */
function highlightFinancialData(text) {
    // Escape HTML to prevent injection
    let escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Define pattern components:
    const profitKeywords = '\\b(?:profit|profits|gain|gains|bullish|upward|upwards|surged|surges|positive|growth|green|long)\\b';
    const lossKeywords = '\\b(?:loss|losses|lose|drop|drops|bearish|downward|downwards|slump|slumps|negative|decline|red|short)\\b';
    const signedNumbers = '[+-]\\s*(?:₹|Rs\\.?|\\$)?\\s*\\d+(?:,\\d+)*(?:\\.\\d+)?\\s*%?';
    const currencyFigures = '(?:₹|Rs\\.?|\\$)\\s*\\d+(?:,\\d+)*(?:\\.\\d+)?';
    const standaloneDigits = '\\b(?!(?:19[789]\\d|20[0123456789]\\d)\\b)\\d+(?:,\\d+)*(?:\\.\\d+)?%?\\b';

    const masterRegex = new RegExp(
        `(${profitKeywords})|(${lossKeywords})|(${signedNumbers})|(${currencyFigures})|(${standaloneDigits})`,
        'gi'
    );

    return escaped.replace(masterRegex, (match, p1, p2, p3, p4, p5) => {
        if (p1) {
            return `<span class="profit-highlight">${match}</span>`;
        } else if (p2) {
            return `<span class="loss-highlight">${match}</span>`;
        } else if (p3) {
            const clean = match.trim();
            if (clean.startsWith('+')) {
                return `<span class="profit-highlight">${match}</span>`;
            } else if (clean.startsWith('-')) {
                return `<span class="loss-highlight">${match}</span>`;
            }
            return `<span class="digit-highlight">${match}</span>`;
        } else if (p4 || p5) {
            return `<span class="digit-highlight">${match}</span>`;
        }
        return match;
    });
}

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

        const rawLines = cleanText.split('\n');
        let currentListItems = [];

        const appendCurrentList = () => {
            if (currentListItems.length > 0) {
                const details = document.createElement('details');
                details.className = 'analysis-details-collapse';

                const summary = document.createElement('summary');
                summary.className = 'analysis-details-summary';

                const count = currentListItems.length;
                summary.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> View Detected Patterns (${count} found)`;
                details.appendChild(summary);

                const listContainer = document.createElement('div');
                listContainer.className = 'analysis-details-content';

                currentListItems.forEach(itemText => {
                    const itemEl = document.createElement('div');
                    itemEl.className = 'analysis-list-item';

                    let iconHtml = '<i class="fa-solid fa-circle-dot text-neutral"></i>';
                    const lowerText = itemText.toLowerCase();
                    if (lowerText.includes('bullish') || lowerText.includes('hammer') || lowerText.includes('morning star') || lowerText.includes('soldiers') || lowerText.includes('marubozu bullish')) {
                        iconHtml = '<i class="fa-solid fa-circle-chevron-up text-success"></i>';
                    } else if (lowerText.includes('bearish') || lowerText.includes('shooting star') || lowerText.includes('evening star') || lowerText.includes('crows') || lowerText.includes('marubozu bearish')) {
                        iconHtml = '<i class="fa-solid fa-circle-chevron-down text-danger"></i>';
                    }

                    const cleanedItem = itemText.replace(/^-\s*/, '');
                    itemEl.innerHTML = `${iconHtml} <span>${highlightFinancialData(cleanedItem)}</span>`;
                    listContainer.appendChild(itemEl);
                });

                details.appendChild(listContainer);
                messageElement.appendChild(details);
                currentListItems = [];
            }
        };

        rawLines.forEach(line => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return;

            if (trimmedLine.startsWith('-')) {
                currentListItems.push(trimmedLine);
            } else {
                appendCurrentList();

                const p = document.createElement('p');
                if (trimmedLine.startsWith('###') || trimmedLine.startsWith('##') || trimmedLine.startsWith('#')) {
                    const headingText = trimmedLine.replace(/^#+\s*/, '');
                    p.className = 'analysis-section-heading';
                    p.innerHTML = `<i class="fa-solid fa-circle-nodes"></i> ${highlightFinancialData(headingText)}`;
                } else {
                    p.innerHTML = highlightFinancialData(trimmedLine);
                }
                messageElement.appendChild(p);
            }
        });

        appendCurrentList();
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

// ------------------ AUTHENTICATION & PROFILE & HISTORY SETUP ------------------
document.addEventListener("DOMContentLoaded", () => {
    const userStr = localStorage.getItem("tradebot_user");
    const userToken = localStorage.getItem("tradebot_token");
    
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

    // --- Search History Logic ---
    const historyToggleBtn = document.getElementById("history-toggle-btn");
    const historySidebar = document.getElementById("history-sidebar");
    const historyList = document.getElementById("history-list");
    const clearHistoryBtn = document.getElementById("clear-history-btn");

    if (historyToggleBtn && historySidebar) {
        // Toggle Sidebar open/collapsed
        historyToggleBtn.addEventListener("click", () => {
            const isCollapsed = historySidebar.classList.toggle("collapsed");
            historyToggleBtn.classList.toggle("active", !isCollapsed);
            if (!isCollapsed) {
                fetchHistory();
            }
        });

        // Clear All History
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener("click", async () => {
                if (!confirm("Are you sure you want to clear your entire search history?")) return;
                try {
                    const response = await fetch("/api/history", {
                        method: "DELETE",
                        headers: { "Authorization": `Bearer ${userToken}` }
                    });
                    if (response.ok) {
                        fetchHistory();
                    } else {
                        console.error("Failed to clear history");
                    }
                } catch (err) {
                    console.error("Error clearing history:", err);
                }
            });
        }

        // Fetch History on Page Load
        fetchHistory();
    }

    async function fetchHistory() {
        if (!userToken) return;
        try {
            const response = await fetch("/api/history", {
                headers: { "Authorization": `Bearer ${userToken}` }
            });
            if (response.status === 401) {
                localStorage.removeItem("tradebot_token");
                localStorage.removeItem("tradebot_user");
                window.location.href = "index.html";
                return;
            }
            const data = await response.json();
            if (response.ok) {
                renderHistory(data.history || []);
            }
        } catch (err) {
            console.error("Error fetching history:", err);
        }
    }

    function renderHistory(items) {
        if (!historyList) return;
        historyList.innerHTML = "";

        if (items.length === 0) {
            historyList.innerHTML = '<p class="history-empty">No search history yet.</p>';
            return;
        }

        items.forEach(item => {
            const card = document.createElement("div");
            card.className = "history-card";
            
            // Format time relative or simple locale
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

            // Click card to fill query
            card.addEventListener("click", (e) => {
                // If clicked delete button, don't execute load
                if (e.target.closest(".history-card-delete")) return;
                
                const userInputField = document.getElementById("user-input");
                if (userInputField) {
                    userInputField.value = item.query;
                    userInputField.focus();
                }
            });

            // Delete item button handler
            const deleteBtn = card.querySelector(".history-card-delete");
            deleteBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                try {
                    const response = await fetch(`/api/history/${item.id}`, {
                        method: "DELETE",
                        headers: { "Authorization": `Bearer ${userToken}` }
                    });
                    if (response.ok) {
                        fetchHistory();
                    }
                } catch (err) {
                    console.error("Error deleting history item:", err);
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

    // Expose fetchHistory globally so script.js can refresh it after submitting chat message
    window.refreshSearchHistory = fetchHistory;
});
