from __future__ import annotations

import time
from datetime import datetime
from typing import Any

import polars as pl

import database as db
from backend.market_data import MarketDataError, fetch_daily_closes, fetch_recent_daily_closes


TIME_SLOT_LIMITS = {
    "5d": 5,
    "10d": 10,
    "1m": 23,
    "3m": 66,
    "1y": 252,
    "all": None,
}

BENCHMARKS = [
    {"id": "0050.TW", "label": "Taiwan 50", "symbol": "0050.TW"},
    {"id": "SPY", "label": "S&P 500", "symbol": "SPY"},
    {"id": "QQQ", "label": "Nasdaq 100", "symbol": "QQQ"},
    {"id": "DIA", "label": "Dow Jones", "symbol": "DIA"},
    {"id": "IWM", "label": "Russell 2000", "symbol": "IWM"},
]

_TODAY_PNL_TTL_SECONDS = 60
_today_pnl_cache: tuple[float, dict[str, float]] | None = None


def usd_rate() -> float:
    return float(db.get_setting("usd_twd_rate", "32.5"))


def to_twd(amount: float, currency: str) -> float:
    return float(amount) * usd_rate() if currency == "USD" else float(amount)


def fee_cfg() -> dict[str, float]:
    get = lambda key, default: float(db.get_setting(key, default))
    return {
        "tw_comm": get("tw_commission_rate", "0.001425"),
        "tw_lot_min": get("tw_lot_min_fee", "20"),
        "tw_odd_comm": get("tw_odd_commission_rate", "0.000855"),
        "tw_odd_min": get("tw_odd_min_fee", "1"),
        "tw_stock_tax": get("tw_stock_tax_rate", "0.003"),
        "tw_etf_tax": get("tw_etf_tax_rate", "0.001"),
        "us_comm": get("us_commission_rate", "0.001"),
        "us_min": get("us_min_fee", "1.0"),
    }


def est_sell_cost(market: str, symbol: str, shares: float, price: float) -> float:
    cfg = fee_cfg()
    amount = float(shares) * float(price)
    if market == "TW":
        is_lot = shares == int(shares) and int(shares) % 1000 == 0
        commission = (
            max(round(amount * cfg["tw_comm"]), int(cfg["tw_lot_min"]))
            if is_lot
            else max(round(amount * cfg["tw_odd_comm"]), int(cfg["tw_odd_min"]))
        )
        tax_rate = cfg["tw_etf_tax"] if symbol.startswith("00") else cfg["tw_stock_tax"]
        return float(commission + round(amount * tax_rate))
    if market == "US":
        return float(max(round(amount * cfg["us_comm"], 2), cfg["us_min"]))
    return 0.0


def calc_trade_fee(market: str, shares: float, price: float) -> dict[str, Any]:
    cfg = fee_cfg()
    amount = float(shares) * float(price)
    if market == "TW":
        is_lot = shares == int(shares) and int(shares) % 1000 == 0
        if is_lot:
            fee = max(round(amount * cfg["tw_comm"]), int(cfg["tw_lot_min"]))
            note = f"整張 x {cfg['tw_comm'] * 100:.4f}%，最低 NT${int(cfg['tw_lot_min'])}"
        else:
            fee = max(round(amount * cfg["tw_odd_comm"]), int(cfg["tw_odd_min"]))
            note = f"零股 x {cfg['tw_odd_comm'] * 100:.4f}%，最低 NT${int(cfg['tw_odd_min'])}"
    elif market == "US":
        fee = max(round(amount * cfg["us_comm"], 2), cfg["us_min"])
        note = f"美股 x {cfg['us_comm'] * 100:.3f}%，最低 ${cfg['us_min']}"
    else:
        fee = 0.0
        note = ""
    return {"fee": float(fee), "note": note}


def account_twd_value(account: dict[str, Any]) -> float:
    if account.get("twd_cost") is not None:
        return float(account["twd_cost"])
    return to_twd(account["balance"], account["currency"])


def holdings_with_metrics() -> list[dict[str, Any]]:
    rows = []
    for h in db.get_holdings():
        price = h["last_price"] or h["avg_cost"]
        value = h["shares"] * price
        cost = h["shares"] * h["avg_cost"]
        sell_cost = est_sell_cost(h["market"], h["symbol"], h["shares"], price)
        pnl = value - cost - sell_cost
        pct = pnl / cost * 100 if cost else 0
        rows.append(
            {
                **h,
                "price": price,
                "market_value": value,
                "cost": cost,
                "sell_cost": sell_cost,
                "pnl": pnl,
                "return_pct": pct,
                "market_value_twd": to_twd(value, h["currency"]),
                "cost_twd": to_twd(cost, h["currency"]),
                "pnl_twd": to_twd(pnl, h["currency"]),
            }
        )
    return rows


def overview() -> dict[str, Any]:
    accounts = db.get_accounts()
    holdings = holdings_with_metrics()
    accounts_df = pl.DataFrame(accounts) if accounts else pl.DataFrame()
    holdings_df = pl.DataFrame(holdings) if holdings else pl.DataFrame()

    cash_twd = (
        sum(account_twd_value(account) for account in accounts)
        if not accounts_df.is_empty()
        else 0.0
    )
    stock_value_twd = (
        float(holdings_df.select(pl.col("market_value_twd").sum()).item())
        if not holdings_df.is_empty()
        else 0.0
    )
    stock_cost_twd = (
        float(holdings_df.select(pl.col("cost_twd").sum()).item())
        if not holdings_df.is_empty()
        else 0.0
    )
    stock_pnl_twd = (
        float(holdings_df.select(pl.col("pnl_twd").sum()).item())
        if not holdings_df.is_empty()
        else 0.0
    )
    by_market = (
        holdings_df.group_by("market")
        .agg(pl.col("market_value_twd").sum().alias("value_twd"))
        .to_dicts()
        if not holdings_df.is_empty()
        else []
    )

    allocation = [{"label": "現金", "value": cash_twd}]
    allocation.extend(
        {
            "label": "台股" if row["market"] == "TW" else "美股",
            "value": row["value_twd"],
        }
        for row in by_market
    )

    accounts_view = [
        {**account, "twd_value": account_twd_value(account)} for account in accounts
    ]
    return {
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "rate": usd_rate(),
        "rate_updated": db.get_setting("rate_updated", "未設定"),
        "metrics": {
            "total_twd": cash_twd + stock_value_twd,
            "cash_twd": cash_twd,
            "stock_value_twd": stock_value_twd,
            "stock_pnl_twd": stock_pnl_twd,
            "stock_return_pct": stock_pnl_twd / stock_cost_twd * 100 if stock_cost_twd else 0,
            "today_pnl_twd": None,
            "today_return_pct": None,
        },
        "allocation": allocation,
        "accounts": accounts_view,
        "holdings": holdings,
    }


def benchmark_options() -> list[dict[str, str]]:
    return BENCHMARKS


def _market_symbol(row: dict[str, Any]) -> str:
    if row["market"] == "TW" and not row["symbol"].endswith((".TW", ".TWO")):
        return f"{row['symbol']}.TW"
    return row["symbol"]


def _slice_by_slot(rows: list[dict[str, Any]], slot: str) -> list[dict[str, Any]]:
    rows = sorted(rows, key=lambda row: row["date"])
    limit = TIME_SLOT_LIMITS.get(slot, 23)
    return rows[-limit:] if limit else rows


def _returns_from_values(rows: list[dict[str, Any]], value_key: str, output_key: str) -> list[dict[str, Any]]:
    valid = [row for row in rows if row.get(value_key) and row[value_key] > 0]
    if not valid:
        return []
    base = valid[0][value_key]
    return [
        {
            "date": row["date"],
            output_key: (row[value_key] / base - 1) * 100,
            value_key: row[value_key],
        }
        for row in valid
    ]


def today_stock_pnl(holdings: list[dict[str, Any]] | None = None) -> dict[str, float]:
    global _today_pnl_cache
    if holdings is None and _today_pnl_cache is not None:
        ts, value = _today_pnl_cache
        if time.time() - ts < _TODAY_PNL_TTL_SECONDS:
            return value

    holdings = holdings if holdings is not None else holdings_with_metrics()
    current_value = 0.0
    previous_value = 0.0

    for holding in holdings:
        symbol = _market_symbol(holding)
        try:
            closes = fetch_recent_daily_closes(symbol, months=2)
        except MarketDataError:
            continue
        latest = sorted(closes.items())[-2:]
        if len(latest) < 2:
            continue
        previous_close = latest[0][1]
        current_price = holding["price"] or latest[1][1]
        current_value += to_twd(holding["shares"] * current_price, holding["currency"])
        previous_value += to_twd(holding["shares"] * previous_close, holding["currency"])

    pnl = current_value - previous_value if previous_value else 0.0
    result = {
        "today_pnl_twd": pnl,
        "today_return_pct": pnl / previous_value * 100 if previous_value else 0.0,
    }
    if holdings is not None:
        _today_pnl_cache = (time.time(), result)
    return result


def performance_series(slot: str = "5d", benchmark: str = "0050.TW", account_id: int | None = None) -> dict[str, Any]:
    holdings = holdings_with_metrics()
    if account_id is not None:
        holdings = [row for row in holdings if int(row["account_id"]) == int(account_id)]

    full = slot == "all"
    errors: list[dict[str, str]] = []
    value_rows: list[dict[str, Any]] = []

    for holding in holdings:
        symbol = _market_symbol(holding)
        try:
            closes = fetch_daily_closes(symbol, full=full)
        except MarketDataError as exc:
            errors.append({"symbol": holding["symbol"], "error": str(exc)})
            continue

        for day, close in closes.items():
            value_rows.append(
                {
                    "date": day,
                    "symbol": holding["symbol"],
                    "value_twd": to_twd(holding["shares"] * close, holding["currency"]),
                }
            )

    portfolio_returns: list[dict[str, Any]] = []
    if value_rows:
        portfolio_values = (
            pl.DataFrame(value_rows)
            .group_by("date")
            .agg(pl.col("value_twd").sum().alias("portfolio_value"))
            .sort("date")
            .to_dicts()
        )
        portfolio_values = _slice_by_slot(portfolio_values, slot)
        portfolio_returns = _returns_from_values(portfolio_values, "portfolio_value", "portfolio_return")

    benchmark_meta = next((item for item in BENCHMARKS if item["id"] == benchmark), BENCHMARKS[0])
    benchmark_returns: list[dict[str, Any]] = []
    try:
        benchmark_rows = [
            {"date": day, "benchmark_value": close}
            for day, close in fetch_daily_closes(benchmark_meta["symbol"], full=full).items()
        ]
        benchmark_rows = _slice_by_slot(benchmark_rows, slot)
        benchmark_returns = _returns_from_values(benchmark_rows, "benchmark_value", "benchmark_return")
    except MarketDataError as exc:
        errors.append({"symbol": benchmark_meta["symbol"], "error": str(exc)})

    by_date: dict[str, dict[str, Any]] = {
        row["date"]: {"date": row["date"], "portfolio_return": row["portfolio_return"]}
        for row in portfolio_returns
    }
    for row in benchmark_returns:
        by_date.setdefault(row["date"], {"date": row["date"]})
        by_date[row["date"]]["benchmark_return"] = row["benchmark_return"]

    series = [
        row
        for row in sorted(by_date.values(), key=lambda item: item["date"])
        if "portfolio_return" in row or "benchmark_return" in row
    ]

    return {
        "slot": slot,
        "benchmark": benchmark_meta,
        "account_id": account_id,
        "series": series,
        "errors": errors,
    }


def export_csv_bytes(rows: list[dict[str, Any]]) -> bytes:
    if not rows:
        return b""
    return pl.DataFrame(rows).write_csv().encode("utf-8-sig")
