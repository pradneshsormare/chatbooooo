// ------------------ DOM ELEMENTS ------------------
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const chatMessages = document.getElementById("chat-messages");

// ------------------ EVENT LISTENERS ------------------
chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userProblem = userInput.value.trim();
    if (!userProblem) return;

    // Use the updated addMessage function for the user's message
    addMessage(userProblem, "user");
    userInput.value = "";

    // Add a loading indicator
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

        // Remove the loading indicator before adding the final message
        loadingIndicator.remove();
        // Use the updated addMessage function for the bot's response
        const botMsgEl = addMessage(data.text, "bot");

        // If stockData is returned, draw the stock chart card
        if (data.stockData) {
            appendStockCard(data.stockData, botMsgEl, data.terminalTicker);
        }
    } catch (error) {
        loadingIndicator.remove();
        addMessage("Sorry, something went wrong. Please try again.", "bot");
        console.error("AI Error:", error);
    }
});

// ------------------ HELPER FUNCTIONS ------------------
/**
 * UPDATED: Cleans and formats text, then adds it to the chat interface.
 * @param {string} text The message content.
 * @param {string} sender The sender ('user' or 'bot').
 * @param {boolean} isLoading If true, shows a loading state.
 * @returns {HTMLElement} The created message element.
 */
function addMessage(text, sender, isLoading = false) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", `${sender}-message`);

    if (isLoading) {
        messageElement.classList.add("loading");
        const p = document.createElement("p");
        p.textContent = text; // Use textContent for security
        messageElement.appendChild(p);
    } else if (sender === 'bot') {
        // Step 1: Clean the raw text from the AI to remove unwanted signs
        let cleanText = text
            .replace(/```(?:json|javascript|html|css|python)?/g, '') // Remove code fences and language hints
            .replace(/```/g, '')
            .replace(/\*/g, '')   // Remove asterisks
            .trim();

        // Step 2: Format the cleaned text into proper paragraphs
        const paragraphs = cleanText.split('\n').filter(p => p.trim() !== ''); // Split by newline and remove empty lines

        // If there are no paragraphs, handle it as a single block of text
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
    } else { // For user messages, just display the text
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
 * @param {Object} stockData The stock metadata and history.
 * @param {HTMLElement} targetMessageEl The parent bot message element.
 * @param {string|null} terminalTicker Optional ticker for the Open Terminal button.
 */
function appendStockCard(stockData, targetMessageEl, terminalTicker) {
    const card = document.createElement("div");
    card.classList.add("stock-card");

    const isUp = stockData.change >= 0;
    const arrowIcon = isUp ? "fa-arrow-trend-up" : "fa-arrow-trend-down";
    const changeClass = isUp ? "up" : "down";
    const sign = isUp ? "+" : "";

    // Generate unique ID for chart canvas
    const chartId = `chart-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Determine the ticker for the terminal link
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
            <i class="fas fa-chart-candlestick"></i>
            <i class="fas fa-chart-bar"></i>
            Open Terminal
        </a>
    `;

    // Append to message element
    targetMessageEl.appendChild(card);

    // Render Chart using Chart.js
    const ctx = document.getElementById(chartId).getContext("2d");

    // Colors
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

    // Auto-scroll chat messages
    const chatMessages = document.getElementById("chat-messages");
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
