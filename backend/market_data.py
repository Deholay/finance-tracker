from __future__ import annotations

import os
import time
from datetime import date, datetime
from typing import Any

import requests
from dotenv import load_dotenv


load_dotenv()


class MarketDataError(RuntimeError):
    pass


_QUOTE_TTL_SECONDS = 60
_DAILY_TTL_SECONDS = 60 * 30
_quote_cache: dict[str, tuple[float, float]] = {}
_daily_cache: dict[tuple[str, bool], tuple[float, dict[str, float]]] = {}
_recent_daily_cache: dict[tuple[str, int], tuple[float, dict[str, float]]] = {}


def _cache_get(cache: dict[Any, tuple[float, Any]], key: Any, ttl: int) -> Any | None:
    entry = cache.get(key)
    if not entry:
        return None
    ts, value = entry
    if time.time() - ts > ttl:
        cache.pop(key, None)
        return None
    return value


def _cache_set(cache: dict[Any, tuple[float, Any]], key: Any, value: Any) -> Any:
    cache[key] = (time.time(), value)
    return value


def _request_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    try:
        response = requests.get(url, params=params, timeout=15)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        raise MarketDataError(str(exc)) from exc


def _extract_first_number(payload: Any) -> float | None:
    if isinstance(payload, dict):
        for key in ("05. price", "price", "last", "last_price", "c", "close", "rate", "Realtime Currency Exchange Rate"):
            if key in payload:
                value = payload[key]
                if key == "Realtime Currency Exchange Rate" and isinstance(value, dict):
                    return _extract_first_number(value)
                try:
                    return float(value)
                except (TypeError, ValueError):
                    pass
        for value in payload.values():
            found = _extract_first_number(value)
            if found is not None:
                return found
    if isinstance(payload, list):
        for value in payload:
            found = _extract_first_number(value)
            if found is not None:
                return found
    return None


def _api_key() -> str:
    return os.getenv("MARKET_DATA_API_KEY", "").strip()


def _is_tw_symbol(symbol: str) -> bool:
    normalized = symbol.upper()
    return normalized.endswith((".TW", ".TWO")) or normalized.replace(".", "").isdigit()


def _tw_symbol(symbol: str) -> str:
    return symbol.upper().replace(".TW", "").replace(".TWO", "")


def _patch_twstock_twse(twstock: Any) -> None:
    stock_mod = twstock.stock
    if getattr(stock_mod.TWSEFetcher, "_finance_tracker_patched", False):
        return
    original = stock_mod.TWSEFetcher._make_datatuple

    def clean_int(raw: Any) -> int:
        text = str(raw).replace(",", "").strip()
        try:
            return int(text) if text not in ("", "--", "**") else 0
        except ValueError:
            return 0

    def clean_float(raw: Any) -> float | None:
        text = str(raw).replace(",", "").strip()
        return None if text in ("", "--") else float(text)

    def make_datatuple(fetcher: Any, data: list[Any]) -> Any:
        if len(data) != 10:
            return original(fetcher, data)

        sign = str(data[7]).strip()
        change_raw = str(data[8]).replace(",", "").strip()
        try:
            change = float(change_raw)
        except ValueError:
            change = 0.0
        if sign == "-":
            change = -abs(change)

        return stock_mod.DATATUPLE(
            datetime.strptime(fetcher._convert_date(data[0]), "%Y/%m/%d"),
            clean_int(data[1]),
            clean_int(data[2]),
            clean_float(data[3]),
            clean_float(data[4]),
            clean_float(data[5]),
            clean_float(data[6]),
            change,
            clean_int(data[9]),
        )

    stock_mod.TWSEFetcher._make_datatuple = make_datatuple
    stock_mod.TWSEFetcher._finance_tracker_patched = True


def _fetch_tw_quote(symbol: str) -> float:
    try:
        import twstock
    except ImportError as exc:
        raise MarketDataError(f"twstock dependency is not available: {exc}. Run `pip install -r requirements.txt`.") from exc

    _patch_twstock_twse(twstock)
    sid = _tw_symbol(symbol)
    try:
        payload = twstock.realtime.get(sid)
    except Exception as exc:
        raise MarketDataError(f"twstock realtime lookup failed for {sid}: {exc}") from exc
    if not payload or not payload.get("success"):
        raise MarketDataError(f"twstock realtime lookup failed for {sid}")

    realtime = payload.get("realtime", {})
    for key in ("latest_trade_price", "open", "high", "low"):
        raw = realtime.get(key)
        try:
            price = float(raw)
        except (TypeError, ValueError):
            continue
        if price > 0:
            return price
    raise MarketDataError(f"No usable twstock realtime price found for {sid}")


def _fetch_tw_daily_closes(symbol: str, full: bool = False) -> dict[str, float]:
    try:
        import twstock
    except ImportError as exc:
        raise MarketDataError(f"twstock dependency is not available: {exc}. Run `pip install -r requirements.txt`.") from exc

    _patch_twstock_twse(twstock)
    sid = _tw_symbol(symbol)
    stock = twstock.Stock(sid, initial_fetch=False)
    today = date.today()
    start_year = 2000 if full else max(2000, today.year - 2)
    start_month = 1 if full else today.month

    try:
        rows = stock.fetch_from(start_year, start_month)
    except Exception as exc:
        raise MarketDataError(f"twstock history lookup failed for {sid}: {exc}") from exc

    closes: dict[str, float] = {}
    for row in rows:
        close = getattr(row, "close", None)
        row_date = getattr(row, "date", None)
        if not row_date:
            continue
        try:
            price = float(close)
        except (TypeError, ValueError):
            continue
        if price > 0:
            closes[row_date.date().isoformat()] = price
    if not closes:
        raise MarketDataError(f"No usable twstock daily closes found for {sid}")
    return closes


def _fetch_tw_recent_daily_closes(symbol: str, months: int = 2) -> dict[str, float]:
    try:
        import twstock
    except ImportError as exc:
        raise MarketDataError(f"twstock dependency is not available: {exc}. Run `pip install -r requirements.txt`.") from exc

    _patch_twstock_twse(twstock)
    sid = _tw_symbol(symbol)
    stock = twstock.Stock(sid, initial_fetch=False)
    today = date.today()
    closes: dict[str, float] = {}

    year = today.year
    month = today.month
    for _ in range(max(1, months)):
        try:
            rows = stock.fetch(year, month)
        except Exception as exc:
            raise MarketDataError(f"twstock recent history lookup failed for {sid}: {exc}") from exc
        for row in rows:
            close = getattr(row, "close", None)
            row_date = getattr(row, "date", None)
            if not row_date:
                continue
            try:
                price = float(close)
            except (TypeError, ValueError):
                continue
            if price > 0:
                closes[row_date.date().isoformat()] = price
        month -= 1
        if month == 0:
            month = 12
            year -= 1

    if not closes:
        raise MarketDataError(f"No usable twstock recent daily closes found for {sid}")
    return closes


def fetch_quote(symbol: str) -> float:
    cache_key = symbol.upper()
    cached = _cache_get(_quote_cache, cache_key, _QUOTE_TTL_SECONDS)
    if cached is not None:
        return cached

    if _is_tw_symbol(symbol):
        return _cache_set(_quote_cache, cache_key, _fetch_tw_quote(symbol))

    api_url = os.getenv("MARKET_DATA_API_URL", "").strip()
    provider = os.getenv("MARKET_DATA_API_PROVIDER", "alphavantage").strip().lower()
    api_key = _api_key()

    if api_url:
        url = api_url.format(symbol=symbol, api_key=api_key)
        payload = _request_json(url, {})
    elif provider == "alphavantage":
        if not api_key:
            raise MarketDataError("MARKET_DATA_API_KEY is not set in .env")
        payload = _request_json(
            "https://www.alphavantage.co/query",
            {"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": api_key},
        )
    else:
        raise MarketDataError(f"Unsupported MARKET_DATA_API_PROVIDER: {provider}")

    price = _extract_first_number(payload)
    if price is None or price <= 0:
        raise MarketDataError(f"No usable price found for {symbol}")
    return _cache_set(_quote_cache, cache_key, price)


def fetch_daily_closes(symbol: str, full: bool = False) -> dict[str, float]:
    cache_key = (symbol.upper(), full)
    cached = _cache_get(_daily_cache, cache_key, _DAILY_TTL_SECONDS)
    if cached is not None:
        return cached

    if _is_tw_symbol(symbol):
        return _cache_set(_daily_cache, cache_key, _fetch_tw_daily_closes(symbol, full=full))

    api_url = os.getenv("MARKET_DATA_HISTORY_API_URL", "").strip()
    provider = os.getenv("MARKET_DATA_API_PROVIDER", "alphavantage").strip().lower()
    api_key = _api_key()

    if api_url:
        url = api_url.format(symbol=symbol, api_key=api_key)
        payload = _request_json(url, {})
    elif provider == "alphavantage":
        if not api_key:
            raise MarketDataError("MARKET_DATA_API_KEY is not set in .env")
        payload = _request_json(
            "https://www.alphavantage.co/query",
            {
                "function": "TIME_SERIES_DAILY",
                "symbol": symbol,
                "outputsize": "full" if full else "compact",
                "apikey": api_key,
            },
        )
    else:
        raise MarketDataError(f"Unsupported MARKET_DATA_API_PROVIDER: {provider}")

    series = payload.get("Time Series (Daily)") if isinstance(payload, dict) else None
    if not isinstance(series, dict):
        raise MarketDataError(f"No daily history found for {symbol}")

    closes: dict[str, float] = {}
    for day, values in series.items():
        if not isinstance(values, dict):
            continue
        close = values.get("4. close") or values.get("close") or values.get("adjusted_close")
        try:
            closes[day] = float(close)
        except (TypeError, ValueError):
            continue
    if not closes:
        raise MarketDataError(f"No usable daily closes found for {symbol}")
    return _cache_set(_daily_cache, cache_key, closes)


def fetch_recent_daily_closes(symbol: str, months: int = 2) -> dict[str, float]:
    cache_key = (symbol.upper(), months)
    cached = _cache_get(_recent_daily_cache, cache_key, _DAILY_TTL_SECONDS)
    if cached is not None:
        return cached

    if _is_tw_symbol(symbol):
        return _cache_set(_recent_daily_cache, cache_key, _fetch_tw_recent_daily_closes(symbol, months=months))

    closes = fetch_daily_closes(symbol, full=False)
    return _cache_set(_recent_daily_cache, cache_key, dict(sorted(closes.items())[-45:]))


def fetch_usd_twd_rate() -> float:
    api_key = _api_key()
    provider = os.getenv("MARKET_DATA_API_PROVIDER", "alphavantage").strip().lower()
    if provider == "alphavantage":
        if not api_key:
            raise MarketDataError("MARKET_DATA_API_KEY is not set in .env")
        payload = _request_json(
            "https://www.alphavantage.co/query",
            {
                "function": "CURRENCY_EXCHANGE_RATE",
                "from_currency": "USD",
                "to_currency": "TWD",
                "apikey": api_key,
            },
        )
    else:
        symbol = os.getenv("USD_TWD_API_SYMBOL", "USDTWD").strip()
        return fetch_quote(symbol)

    rate = _extract_first_number(payload)
    if rate is None or rate <= 0:
        raise MarketDataError("No usable USD/TWD rate found")
    return rate
