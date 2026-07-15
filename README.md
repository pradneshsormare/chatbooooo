
<p align="center">
  <img src="https://img.shields.io/badge/TradeMind-AI-00C9A7?style=for-the-badge&logo=chartdotjs&logoColor=white" alt="TradeMind AI" />
  <img src="https://img.shields.io/badge/Node.js-v18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Groq-LLM-FF6B6B?style=for-the-badge&logo=openai&logoColor=white" alt="Groq LLM" />
  <img src="https://img.shields.io/badge/Vercel-Deployed-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />
</p>

# 📈 TradeMind AI — Stock Analysis Terminal

**TradeMind AI** is a full-stack, AI-powered stock analysis platform that combines real-time market data, interactive candlestick charting, algorithmic pattern detection, and a conversational AI analyst — all in one seamless interface.

> Ask questions about any stock in natural language, get instant technical analysis with interactive charts, and explore the market like a professional trader.

---

## ✨ Features

### 🤖 AI-Powered Chat Analyst
- Conversational stock analysis powered by **Groq LLM** (LLaMA-based)
- Understands natural language queries — *"How is Reliance doing?"*, *"Analyze AAPL candlestick patterns"*
- Automatic stock ticker detection and intent parsing
- Tool-calling support for real-time candlestick pattern analysis
- Maintains in-session chat history for contextual follow-ups

### 📊 Interactive Trading Terminal
- Professional-grade candlestick charts built with **TradingView Lightweight Charts**
- Multiple timeframes: 1D, 5D, 1M, 3M, 6M, 1Y, 2Y, Max
- Intraday intervals: 5m, 15m, 30m, 1h, and daily
- Live price display with real-time change indicators
- Region selection for scoped analysis of specific chart areas
- AI-powered terminal commands — ask questions directly about what you see on the chart

### 🔍 Algorithmic Technical Analysis
- **20+ Candlestick Patterns** detected automatically:
  - Doji, Hammer, Inverted Hammer, Hanging Man
  - Bullish/Bearish Engulfing, Morning/Evening Star
  - Three White Soldiers, Three Black Crows
  - Marubozu, Spinning Top, Harami, and more
- **Trend Detection** — identifies uptrends, downtrends, and sideways movement
- **Support & Resistance Levels** — algorithmically computed from price action
- **Momentum Analysis** — RSI and EMA-based momentum scoring
- **Volume Analysis** — average volume, volume trends, and spike detection

### 🔐 Authentication System
- User registration and login with **PBKDF2** password hashing
- Cryptographically signed session tokens (HMAC-SHA256)
- Token-based API authentication middleware
- 24-hour token expiry with automatic session management

### 📜 Search History
- Persistent search history per user
- AI-generated summaries for each search
- View, delete individual entries, or clear all history
- History sidebar with quick-access to past analyses

### 🗄️ Dual Database Support
- **PostgreSQL** for production (Vercel / hosted environments)
- **JSON file fallback** for local development (zero-config)
- Automatic detection and seamless switching between modes
- Read-only filesystem detection for serverless environments

---

## 🏗️ Architecture

```
chatbooooo/
├── backend/
│   ├── server.js                  # Express app entry point
│   ├── stockTools.js              # OHLC fetching + 20+ pattern detectors
│   ├── controllers/
│   │   ├── chatController.js      # AI chat with tool-calling
│   │   ├── terminalController.js  # Terminal analysis endpoint
│   │   └── marketController.js    # Candle data API
│   ├── services/
│   │   ├── groqService.js         # Groq LLM client + prompt engineering
│   │   ├── analysisService.js     # Technical analysis orchestrator
│   │   ├── marketDataService.js   # Yahoo Finance data fetching
│   │   ├── db.js                  # PostgreSQL + JSON fallback database
│   │   └── userService.js         # User data operations
│   ├── routes/
│   │   ├── authRoutes.js          # POST /api/auth/register, /api/auth/login
│   │   ├── chatRoutes.js          # POST /api/chat
│   │   ├── terminalRoutes.js      # POST /api/terminal-analyze
│   │   ├── marketRoutes.js        # GET  /api/candles
│   │   └── historyRoutes.js       # GET/POST/DELETE /api/history
│   ├── middleware/
│   │   └── auth.js                # Bearer token authentication
│   └── utils/
│       └── auth.js                # Password hashing + token generation
├── frontend/
│   ├── index.html                 # Login / Register page
│   ├── chat.html                  # AI Chat interface
│   ├── terminal.html              # Trading terminal with charts
│   ├── style.css                  # Chat + auth styles
│   ├── terminal.css               # Terminal-specific styles
│   ├── script.js                  # Chat page logic
│   ├── terminal.js                # Terminal page logic + chart rendering
│   └── auth.js                    # Auth flow (login/register/token)
├── vercel.json                    # Vercel deployment config
├── package.json
└── .gitignore
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18 or higher
- **npm** v9+
- A **Groq API key** — [Get one free at console.groq.com](https://console.groq.com)
- *(Optional)* **PostgreSQL** — falls back to local JSON files if unavailable

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/chatbooooo.git
cd chatbooooo

# Install dependencies
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
# Required
GROQ_API_KEY=gsk_your_groq_api_key_here

# Optional — falls back to local JSON database if not set
DATABASE_URL=postgresql://user:password@host:5432/tradebot

# Optional — defaults to a built-in secret for local dev
JWT_SECRET=your_super_secret_key
```

### Run Locally

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

The app will be available at **http://localhost:3000**

---

## 📡 API Reference

All endpoints are prefixed with `/api`. Protected routes require a `Bearer` token in the `Authorization` header.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/health` | ❌ | Health check |
| `POST` | `/api/auth/register` | ❌ | Register a new user |
| `POST` | `/api/auth/login` | ❌ | Login and receive a token |
| `POST` | `/api/chat` | ✅ | Send a message to the AI analyst |
| `GET` | `/api/candles?symbol=AAPL&range=3mo&interval=1d` | ❌ | Fetch OHLC candle data |
| `POST` | `/api/terminal-analyze` | ✅ | Run AI analysis on terminal chart |
| `GET` | `/api/history` | ✅ | Get user's search history |
| `DELETE` | `/api/history/:id` | ✅ | Delete a specific history entry |
| `DELETE` | `/api/history` | ✅ | Clear all history |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js, Express 4.x |
| **AI / LLM** | Groq SDK (LLaMA via Groq Cloud) |
| **Database** | PostgreSQL (production) / JSON files (local fallback) |
| **Charting** | TradingView Lightweight Charts |
| **Market Data** | Yahoo Finance API, Stooq.com CSV |
| **Technical Analysis** | Custom pattern detection engine + `trading-signals` library (EMA, RSI) |
| **Auth** | PBKDF2 password hashing, HMAC-SHA256 signed tokens |
| **Frontend** | Vanilla HTML/CSS/JS, Chart.js, Font Awesome, Google Fonts (Poppins, JetBrains Mono) |
| **Deployment** | Vercel (serverless) |

---

## 🌐 Deployment (Vercel)

The project is pre-configured for **Vercel** deployment:

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

Set these environment variables in your Vercel project dashboard:
- `GROQ_API_KEY`
- `DATABASE_URL` (PostgreSQL connection string)
- `JWT_SECRET`

The `vercel.json` routes the API to the Express backend and serves the frontend as static files.

---

## 📌 Supported Markets

| Market | Symbol Format | Example |
|--------|--------------|---------|
| US Stocks | `TICKER` | `AAPL`, `TSLA`, `GOOGL` |
| NSE India | `TICKER.NS` | `RELIANCE.NS`, `TCS.NS`, `INFY.NS` |
| BSE India | `TICKER.BO` | `RELIANCE.BO` |
| Forex | `PAIR=X` | `USDINR=X`, `EURUSD=X` |
| Crypto | `TICKER-USD` | `BTC-USD`, `ETH-USD` |

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **ISC License** — see the [package.json](package.json) for details.

---

<p align="center">
  Built with ❤️ by the TradeMind team
</p>
