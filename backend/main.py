from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import database as db
from backend import finance
from backend.market_data import MarketDataError, fetch_quote, fetch_usd_twd_rate


app = FastAPI(title="Finance Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    db.init_db()
    db.seed_initial_data()


class AccountCreate(BaseModel):
    name: str
    type: Literal["bank", "securities"] = "bank"
    currency: Literal["TWD", "USD"] = "TWD"
    balance: float = 0
    notes: str = ""


class AccountAdjust(BaseModel):
    balance: float
    twd_cost: float | None = None
    notes: str = ""
    date: str = Field(default_factory=lambda: date.today().isoformat())


class AccountTransactionCreate(BaseModel):
    type: Literal["transfer", "deposit", "withdrawal"]
    amount: float
    currency: Literal["TWD", "USD"] = "TWD"
    from_id: int | None = None
    to_id: int | None = None
    exchange_rate: float = 1
    date: str = Field(default_factory=lambda: date.today().isoformat())
    notes: str = ""


class StockCreate(BaseModel):
    symbol: str
    name: str
    market: Literal["TW", "US"]
    currency: Literal["TWD", "USD"]
    account_id: int


class StockTransactionCreate(BaseModel):
    stock_id: int
    type: Literal["buy", "sell"]
    shares: float
    price: float
    fee: float = 0
    date: str = Field(default_factory=lambda: date.today().isoformat())
    notes: str = ""


class SettingUpdate(BaseModel):
    key: str
    value: Any


class FeeSettings(BaseModel):
    tw_commission_rate: float
    tw_lot_min_fee: float
    tw_odd_commission_rate: float
    tw_odd_min_fee: float
    tw_stock_tax_rate: float
    tw_etf_tax_rate: float
    us_commission_rate: float
    us_min_fee: float


@app.get("/api/bootstrap")
def bootstrap() -> dict[str, Any]:
    return {
        "overview": finance.overview(),
        "accounts": db.get_accounts(),
        "stocks": db.get_stocks(),
        "holdings": finance.holdings_with_metrics(),
        "stockTransactions": db.get_stock_transactions(),
        "accountTransactions": db.get_account_transactions(),
        "fees": finance.fee_cfg(),
        "benchmarks": finance.benchmark_options(),
    }


@app.get("/api/overview")
def get_overview() -> dict[str, Any]:
    return finance.overview()


@app.get("/api/today-pnl")
def get_today_pnl() -> dict[str, float]:
    return finance.today_stock_pnl()


@app.get("/api/performance")
def get_performance(
    slot: Literal["5d", "10d", "1m", "3m", "1y", "all"] = "5d",
    benchmark: str = "0050.TW",
    account_id: int | None = None,
) -> dict[str, Any]:
    return finance.performance_series(slot=slot, benchmark=benchmark, account_id=account_id)


@app.post("/api/accounts")
def add_account(payload: AccountCreate) -> dict[str, str]:
    db.add_account(payload.name, payload.type, payload.currency, payload.balance, payload.notes)
    return {"status": "ok"}


@app.patch("/api/accounts/{account_id}")
def adjust_account(account_id: int, payload: AccountAdjust) -> dict[str, str]:
    account = next((a for a in db.get_accounts(False) if a["id"] == account_id), None)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    db.record_account_transaction(
        "adjustment",
        payload.balance,
        account["currency"],
        payload.date,
        to_id=account_id,
        notes=payload.notes,
    )
    if account["currency"] == "USD":
        db.update_account_twd_cost(account_id, payload.twd_cost)
    return {"status": "ok"}


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: int) -> dict[str, str]:
    db.delete_account(account_id)
    return {"status": "ok"}


@app.post("/api/account-transactions")
def add_account_transaction(payload: AccountTransactionCreate) -> dict[str, str]:
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    db.record_account_transaction(
        payload.type,
        payload.amount,
        payload.currency,
        payload.date,
        from_id=payload.from_id,
        to_id=payload.to_id,
        exchange_rate=payload.exchange_rate,
        notes=payload.notes,
    )
    return {"status": "ok"}


@app.delete("/api/account-transactions/{tx_id}")
def delete_account_transaction(tx_id: int) -> dict[str, str]:
    db.delete_account_transaction(tx_id)
    return {"status": "ok"}


@app.post("/api/stocks")
def add_stock(payload: StockCreate) -> dict[str, str]:
    db.add_stock(payload.symbol, payload.name, payload.market, payload.currency, payload.account_id)
    return {"status": "ok"}


@app.post("/api/stocks/{stock_id}/price")
def update_price(stock_id: int, payload: dict[str, float]) -> dict[str, str]:
    price = float(payload.get("price", 0))
    if price <= 0:
        raise HTTPException(status_code=400, detail="Price must be greater than 0")
    db.update_last_price(stock_id, price)
    return {"status": "ok"}


@app.post("/api/stocks/{stock_id}/refresh-price")
def refresh_price(stock_id: int) -> dict[str, Any]:
    stock = next((s for s in db.get_stocks() if s["id"] == stock_id), None)
    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")
    symbol = f"{stock['symbol']}.TW" if stock["market"] == "TW" else stock["symbol"]
    try:
        price = round(fetch_quote(symbol), 4)
    except MarketDataError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    db.update_last_price(stock_id, price)
    return {"status": "ok", "price": price}


@app.post("/api/stocks/refresh-prices")
def refresh_prices() -> dict[str, Any]:
    updated = []
    errors = []
    for stock in db.get_stocks():
        symbol = f"{stock['symbol']}.TW" if stock["market"] == "TW" else stock["symbol"]
        try:
            price = round(fetch_quote(symbol), 4)
            db.update_last_price(stock["id"], price)
            updated.append({"symbol": stock["symbol"], "price": price})
        except MarketDataError as exc:
            errors.append({"symbol": stock["symbol"], "error": str(exc)})
    db.set_setting("rate_updated", datetime.now().strftime("%Y-%m-%d %H:%M"))
    return {"status": "ok", "updated": updated, "errors": errors}


@app.get("/api/trade-fee")
def trade_fee(market: str, shares: float, price: float) -> dict[str, Any]:
    return finance.calc_trade_fee(market, shares, price)


@app.post("/api/stock-transactions")
def add_stock_transaction(payload: StockTransactionCreate) -> dict[str, str]:
    if payload.shares <= 0 or payload.price <= 0:
        raise HTTPException(status_code=400, detail="Shares and price must be greater than 0")
    holdings = {h["stock_id"]: h["shares"] for h in db.get_holdings()}
    if payload.type == "sell" and payload.shares > holdings.get(payload.stock_id, 0):
        raise HTTPException(status_code=400, detail="Sell shares exceed current holding")
    db.record_stock_transaction(
        payload.stock_id,
        payload.type,
        payload.shares,
        payload.price,
        payload.fee,
        payload.date,
        payload.notes,
    )
    return {"status": "ok"}


@app.delete("/api/stock-transactions/{tx_id}")
def delete_stock_transaction(tx_id: int) -> dict[str, str]:
    db.delete_stock_transaction(tx_id)
    return {"status": "ok"}


@app.patch("/api/settings")
def update_setting(payload: SettingUpdate) -> dict[str, str]:
    db.set_setting(payload.key, payload.value)
    return {"status": "ok"}


@app.patch("/api/settings/fees")
def update_fees(payload: FeeSettings) -> dict[str, str]:
    for key, value in payload.model_dump().items():
        db.set_setting(key, value)
    return {"status": "ok"}


@app.post("/api/settings/refresh-usd-twd")
def refresh_usd_twd() -> dict[str, Any]:
    try:
        rate = round(fetch_usd_twd_rate(), 4)
    except MarketDataError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    db.set_setting("usd_twd_rate", rate)
    db.set_setting("rate_updated", datetime.now().strftime("%Y-%m-%d %H:%M"))
    return {"status": "ok", "rate": rate}


@app.get("/api/export/{dataset}")
def export_dataset(dataset: str) -> Response:
    exports = {
        "accounts": db.get_accounts,
        "holdings": finance.holdings_with_metrics,
        "stocks": db.get_stocks,
        "stock-transactions": db.get_stock_transactions,
        "account-transactions": db.get_account_transactions,
    }
    if dataset not in exports:
        raise HTTPException(status_code=404, detail="Unknown export dataset")
    return Response(
        finance.export_csv_bytes(exports[dataset]()),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="finance_{dataset}.csv"'},
    )
