# 個人資產追蹤工具

本專案已改為 React + MUI 前端、FastAPI 後端、SQLite 本機資料庫。資料仍存在同目錄的 `finance.db`，表格彙總與 CSV 匯出使用 Polars，不再使用 pandas。

## 安裝

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
npm install
```

## 設定即時行情 API

專案根目錄已建立 `.env`：

```env
MARKET_DATA_API_PROVIDER=alphavantage
MARKET_DATA_API_KEY=
MARKET_DATA_API_URL=
MARKET_DATA_HISTORY_API_URL=
USD_TWD_API_SYMBOL=USDTWD
```

台股行情使用 [`twstock`](https://github.com/mlouielu/twstock)：

- 即時價：`twstock.realtime.get`
- 歷史日線：`twstock.Stock(...).fetch_from`
- 依賴：`twstock`、`lxml`

美股與其他基準指數預設支援 Alpha Vantage：

- 股票報價：`GLOBAL_QUOTE`
- USD/TWD 匯率：`CURRENCY_EXCHANGE_RATE`

如果你使用其他行情服務，可以填 `MARKET_DATA_API_URL`，後端會替換 `{symbol}` 與 `{api_key}`，並從 JSON 回應中讀取第一個可用的即時價格欄位。

持倉報酬率折線圖需要日線歷史資料。台股會透過 `twstock` 抓 TWSE/TPEX；美股與其他基準預設 Alpha Vantage 使用 `TIME_SERIES_DAILY`。若使用其他服務，可填 `MARKET_DATA_HISTORY_API_URL`，同樣支援 `{symbol}` 與 `{api_key}` 佔位。

## 啟動

同時啟動 API 與 React：

```bash
npm run dev
```

分開啟動：

```bash
npm run dev:api
npm run dev:web
```

開啟：

- 前端：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8000`

## 架構

```text
finance-tracker/
├── app.py                  # FastAPI entry point
├── backend/
│   ├── main.py             # API routes
│   ├── finance.py          # Polars summaries, fee and P/L calculations
│   └── market_data.py      # .env-driven market data adapter
├── database.py             # SQLite persistence layer
├── frontend/src/main.jsx   # React + MUI app
├── package.json
├── requirements.txt
├── .env
└── .env.example
```

## 功能

| 頁面 | 功能 |
|------|------|
| 總覽 | 資產 KPI、配置圖、持倉報酬折線圖、帳戶餘額 |
| 帳戶管理 | 新增帳戶、調整餘額、轉帳 / 存提 |
| 持股管理 | 查看持倉、手動更新現價、自動抓取行情、新增股票 |
| 股票買賣 | 記錄買賣、估算手續費、刪除交易並重算持倉 |
| 資金異動 | 查看與刪除資金異動 |
| 設定 | 更新匯率、抓取 USD/TWD、調整手續費、匯出 CSV |
