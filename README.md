# Finance Tracker

A local-first portfolio tracker built with a React + MUI frontend, a FastAPI backend, SQLite persistence, and Polars for tabular summaries and CSV exports.

All personal financial data is stored locally in `finance.db`.

## Setup

```bash
python -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
npm install
```

## Run

Start the API and web app together:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:api
npm run dev:web
```

Local URLs:

- Web app: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8000`

## Market Data

The project uses `.env` for market data configuration:

```env
MARKET_DATA_API_PROVIDER=alphavantage
MARKET_DATA_API_KEY=
MARKET_DATA_API_URL=
MARKET_DATA_HISTORY_API_URL=
USD_TWD_API_SYMBOL=USDTWD
```

Taiwan stock data is fetched with [`twstock`](https://github.com/mlouielu/twstock):

- Realtime quotes: `twstock.realtime.get`
- Daily history: `twstock.Stock(...).fetch_from`
- Required packages: `twstock`, `lxml`

US stocks and non-Taiwan benchmarks use the configured market data provider. The default adapter supports Alpha Vantage:

- Quotes: `GLOBAL_QUOTE`
- Daily history: `TIME_SERIES_DAILY`
- USD/TWD: `CURRENCY_EXCHANGE_RATE`

For another provider, set:

- `MARKET_DATA_API_URL` for realtime quotes
- `MARKET_DATA_HISTORY_API_URL` for daily history

Both custom URLs can use `{symbol}` and `{api_key}` placeholders.

## Architecture

```text
finance-tracker/
├── app.py                    # FastAPI entry point
├── backend/
│   ├── main.py               # API routes
│   ├── finance.py            # portfolio metrics, P/L, Polars summaries
│   └── market_data.py        # twstock + env-driven market data adapters
├── database.py               # SQLite persistence layer
├── frontend/src/main.jsx     # React + MUI frontend
├── scripts/
│   └── import_fubon_pdfs.py  # Fubon statement PDF importer
├── package.json
├── requirements.txt
├── .env
└── .env.example
```

## Features

| Page | Features |
| --- | --- |
| Overview | KPI cards, allocation chart, portfolio performance line chart, sidebar account balances |
| Accounts | Add accounts, adjust balances, record deposits, withdrawals, and transfers |
| Holdings | View holdings, update prices manually or from market data, add stocks |
| Trades | Record buy/sell transactions, estimate fees, delete transactions and recalculate holdings |
| Transactions | View and delete account cash movements |
| Settings | Update USD/TWD, refresh exchange rate, configure fees, export CSV backups |

## Performance Chart

The overview performance chart supports:

- Time ranges: `5D`, `10D`, `1M`, `3M`, `1Y`, `ALL`
- Default range: `5D`
- Default benchmark: Taiwan 50 (`0050.TW`)
- Account filter: all accounts or a single account
- Tooltip values for portfolio return, benchmark return, and portfolio value

Short ranges use a recent-history fast path and in-memory caching to avoid repeated slow market-data calls.

## Import Fubon PDF Statements

Put encrypted Fubon securities monthly statement PDFs in `pdf/`, then run:

```bash
FUBON_PDF_PASSWORD='your-password' python scripts/import_fubon_pdfs.py
```

The importer:

- Backs up `finance.db` first
- Clears the current database
- Imports detected stock trades
- Rebuilds stock master records and holdings
- Imports margin table rows as normal trades with notes preserving the original type

The current data model does not separately model margin debt. If a statement does not include cash ledger rows, the cash account balance is reconstructed from trade cash flows only.

## Data And Privacy

- `finance.db` is local and ignored by Git.
- `finance.db.backup.*` is ignored by Git.
- `pdf/` is ignored by Git.
- `.env` is ignored by Git.

Do not commit statement PDFs, database backups, or API keys.
