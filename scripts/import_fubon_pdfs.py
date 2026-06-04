from __future__ import annotations

import os
import re
import shutil
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import pdfplumber

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import database as db


PDF_DIR = Path("pdf")
PASSWORD_ENV = "FUBON_PDF_PASSWORD"
ACCOUNT_NAME = "富邦證券 台股帳"


def clean(value: Any) -> str:
    return (value or "").replace("\n", "").replace(" ", "").strip()


def parse_amount(value: Any) -> float:
    text = clean(value).replace(",", "")
    return float(text) if text else 0.0


def parse_roc_date(value: str) -> str:
    year, month, day = [int(part) for part in clean(value).split("/")]
    return f"{year + 1911:04d}-{month:02d}-{day:02d}"


def stock_name(raw: str) -> str:
    return clean(raw).replace("*", "")


def get_tw_symbol(name: str) -> str:
    try:
        import twstock
    except ImportError as exc:
        raise RuntimeError("twstock is required. Run `python -m pip install -r requirements.txt`.") from exc

    normalized = stock_name(name)
    for code, info in twstock.codes.items():
        if getattr(info, "name", "") == normalized:
            return code
    fallback = {
        "國巨": "2327",
        "台積電": "2330",
        "旺宏": "2337",
        "聯發科": "2454",
        "元大台灣50": "0050",
        "元大台灣50正2": "00631L",
        "台灣虎航": "6757",
    }
    if normalized in fallback:
        return fallback[normalized]
    raise RuntimeError(f"Cannot map stock name to Taiwan symbol: {name}")


def extract_transactions(password: str) -> list[dict[str, Any]]:
    txs: list[dict[str, Any]] = []
    for path in sorted(PDF_DIR.glob("*.pdf")):
        with pdfplumber.open(path, password=password) as pdf:
            for page in pdf.pages:
                for table in page.extract_tables():
                    if not table:
                        continue
                    header = [clean(cell) for cell in table[0]]

                    if len(header) == 15 and header[:4] == ["交易日期", "交割日期", "交易類別", "證券名稱"]:
                        for row in table[1:]:
                            row = [clean(cell) for cell in row]
                            if not row or not re.match(r"\d{3}/\d{2}/\d{2}", row[0]):
                                continue
                            tx_type = "buy" if "買" in row[2] else "sell"
                            fee = parse_amount(row[8]) + parse_amount(row[9])
                            txs.append(
                                {
                                    "source": path.name,
                                    "date": parse_roc_date(row[0]),
                                    "settlement_date": parse_roc_date(row[1]),
                                    "original_type": row[2],
                                    "type": tx_type,
                                    "name": stock_name(row[3]),
                                    "symbol": get_tw_symbol(row[3]),
                                    "shares": parse_amount(row[5]),
                                    "price": parse_amount(row[6]),
                                    "amount": parse_amount(row[7]),
                                    "fee": fee,
                                    "notes": f"{path.name} / {row[2]} / 交割日 {parse_roc_date(row[1])}",
                                }
                            )

                    if len(header) == 21 and "融資" in "".join(header):
                        for row in table[1:]:
                            row = [clean(cell) for cell in row]
                            if not row or not re.match(r"\d{3}/\d{2}/\d{2}", row[0]):
                                continue
                            tx_type = "buy" if "買" in row[2] else "sell"
                            fee = parse_amount(row[8]) + parse_amount(row[9]) + parse_amount(row[12])
                            txs.append(
                                {
                                    "source": path.name,
                                    "date": parse_roc_date(row[0]),
                                    "settlement_date": parse_roc_date(row[1]),
                                    "original_type": row[2],
                                    "type": tx_type,
                                    "name": stock_name(row[3]),
                                    "symbol": get_tw_symbol(row[3]),
                                    "shares": parse_amount(row[5]),
                                    "price": parse_amount(row[6]),
                                    "amount": parse_amount(row[7]),
                                    "fee": fee,
                                    "notes": f"{path.name} / {row[2]}（融資表匯入為一般交易）/ 交割日 {parse_roc_date(row[1])}",
                                }
                            )

    return sorted(txs, key=lambda item: (item["date"], item["source"], item["symbol"], item["type"]))


def clear_database(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = OFF")
    for table in [
        "account_transactions",
        "stock_transactions",
        "holdings",
        "stocks",
        "accounts",
        "settings",
    ]:
        conn.execute(f"DELETE FROM {table}")
        conn.execute("DELETE FROM sqlite_sequence WHERE name=?", (table,))
    conn.execute("PRAGMA foreign_keys = ON")
    conn.commit()


def import_transactions(txs: list[dict[str, Any]]) -> dict[str, Any]:
    db.init_db()
    conn = db.get_conn()
    backup_path = Path(f"finance.db.backup.{datetime.now().strftime('%Y%m%d%H%M%S')}")
    if Path("finance.db").exists():
        shutil.copy2("finance.db", backup_path)

    clear_database(conn)
    db.set_setting("usd_twd_rate", "32.5")
    db.set_setting("initialized", "1")
    db.add_account(ACCOUNT_NAME, "securities", "TWD", 0, "從富邦證券 PDF 月對帳單匯入")
    account_id = db.get_accounts()[0]["id"]

    stock_ids: dict[str, int] = {}
    for tx in txs:
        if tx["symbol"] not in stock_ids:
            stock_ids[tx["symbol"]] = db.add_stock(tx["symbol"], tx["name"], "TW", "TWD", account_id)

    for tx in txs:
        db.record_stock_transaction(
            stock_ids[tx["symbol"]],
            tx["type"],
            tx["shares"],
            tx["price"],
            tx["fee"],
            tx["date"],
            tx["notes"],
        )

    by_symbol = defaultdict(float)
    for tx in txs:
        by_symbol[tx["symbol"]] += tx["shares"] if tx["type"] == "buy" else -tx["shares"]

    return {
        "backup": str(backup_path) if backup_path.exists() else None,
        "transactions": len(txs),
        "stocks": len(stock_ids),
        "holdings": dict(sorted((symbol, shares) for symbol, shares in by_symbol.items() if shares)),
        "account_id": account_id,
    }


def main() -> None:
    password = os.getenv(PASSWORD_ENV)
    if not password:
        raise SystemExit(f"Set {PASSWORD_ENV} before running this importer.")
    txs = extract_transactions(password)
    if not txs:
        raise SystemExit("No transactions found in PDF files.")
    result = import_transactions(txs)
    print(result)


if __name__ == "__main__":
    main()
