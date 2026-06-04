import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
  alpha,
  createTheme
} from "@mui/material";
import {
  AccountBalance,
  Add,
  Delete,
  Download,
  Edit,
  DarkMode,
  LightMode,
  Paid,
  ReceiptLong,
  Refresh,
  Save,
  Settings,
  ShowChart,
  SwapHoriz,
  TrendingUp
} from "@mui/icons-material";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis
} from "recharts";

const api = {
  async request(path, options = {}) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || response.statusText);
    }
    return response.json().catch(() => ({}));
  },
  get: (path) => api.request(path),
  post: (path, body) => api.request(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: (path, body) => api.request(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (path) => api.request(path, { method: "DELETE" })
};

const makeTheme = (mode) => {
  const dark = mode === "dark";
  const colors = {
    primary: dark ? "#8fb4ff" : "#1f4fd8",
    primaryStrong: dark ? "#a8c5ff" : "#163ea5",
    bg: dark ? "#0b0f17" : "#f5f6f8",
    paper: dark ? "#111827" : "#ffffff",
    paperSoft: dark ? "#0f172a" : "#f9fafb",
    text: dark ? "#e5e7eb" : "#111827",
    muted: dark ? "#9ca3af" : "#667085",
    divider: dark ? "#243041" : "#e5e7eb",
    tableHead: dark ? "#0f172a" : "#f9fafb",
    success: dark ? "#7dd3a8" : "#047857",
    error: dark ? "#fca5a5" : "#dc2626",
    warning: dark ? "#f6c177" : "#b45309"
  };

  return createTheme({
    palette: {
      mode,
      primary: { main: colors.primary, dark: colors.primaryStrong },
      secondary: { main: colors.muted },
      success: { main: colors.success },
      error: { main: colors.error },
      warning: { main: colors.warning },
      background: { default: colors.bg, paper: colors.paper },
      text: { primary: colors.text, secondary: colors.muted },
      divider: colors.divider
    },
    custom: colors,
    typography: {
      fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      h5: { fontWeight: 700, letterSpacing: 0 },
      h6: { fontWeight: 700, letterSpacing: 0 },
      body2: { letterSpacing: 0 },
      button: { textTransform: "none", fontWeight: 600 }
    },
    shape: { borderRadius: 8 },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            borderColor: colors.divider
          }
        }
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { minHeight: 38 },
          contained: { boxShadow: "none" },
          outlined: { borderColor: colors.divider, color: colors.text }
        }
      },
      MuiTextField: { defaultProps: { size: "small" } },
      MuiFormControl: { defaultProps: { size: "small" } },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottomColor: colors.divider,
            padding: "10px 14px",
            whiteSpace: "nowrap"
          },
          head: {
            backgroundColor: colors.tableHead,
            color: colors.muted,
            fontSize: 12,
            fontWeight: 700
          }
        }
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 6, fontWeight: 600 }
        }
      }
    }
  });
};

const drawerWidth = 264;
const tabs = [
  ["overview", "總覽", <ShowChart />],
  ["accounts", "帳戶管理", <AccountBalance />],
  ["holdings", "持股管理", <TrendingUp />],
  ["trades", "股票買賣", <SwapHoriz />],
  ["transactions", "資金異動", <ReceiptLong />],
  ["settings", "設定", <Settings />]
];

const fmtTwd = (n) => `NT$ ${Number(n || 0).toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;
const fmtUsd = (n) => `$ ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtMoney = (n, currency) => (currency === "USD" ? fmtUsd(n) : fmtTwd(n));
const fmtNum = (n, digits = 2) => Number(n || 0).toLocaleString("zh-TW", { maximumFractionDigits: digits });
const fmtPct = (n) => (n == null ? "-" : `${fmtNum(n)}%`);
const today = () => new Date().toISOString().slice(0, 10);
const allocationColorsFor = (mode) => mode === "dark"
  ? ["#8fb4ff", "#6b7280", "#4b5563"]
  : ["#1f4fd8", "#64748b", "#94a3b8"];
const pnlColor = (value) => (Number(value) >= 0 ? "error.main" : "success.main");
const timeSlots = [
  ["5d", "5D"],
  ["10d", "10D"],
  ["1m", "1M"],
  ["3m", "3M"],
  ["1y", "1Y"],
  ["all", "ALL"]
];

function MetricCard({ label, value, sub, tone = "primary" }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        height: "100%",
        minHeight: 118,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between"
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>{label}</Typography>
      <Box>
        <Typography
          variant="h5"
          sx={{
            color: `${tone}.main`,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.25
          }}
        >
          {value}
        </Typography>
        {sub && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{sub}</Typography>}
      </Box>
    </Paper>
  );
}

function Section({ title, action, children }) {
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "stretch", sm: "center" }}
        justifyContent="space-between"
        spacing={1.5}
        sx={{ px: 2.5, py: 1.75, borderBottom: 1, borderColor: "divider" }}
      >
        <Typography variant="h6" sx={{ fontSize: 17 }}>{title}</Typography>
        {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
      </Stack>
      <Box sx={{ p: 2.5 }}>{children}</Box>
    </Paper>
  );
}

function DataTable({ columns, rows, empty = "尚無資料" }) {
  if (!rows?.length) return <Alert severity="info">{empty}</Alert>;
  return (
    <Box sx={{ overflowX: "auto", mx: -2.5, my: -2.5 }}>
      <Table size="small" sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>{columns.map((c) => <TableCell key={c.key} align={c.align}>{c.label}</TableCell>)}</TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, idx) => (
            <TableRow key={row.id ?? `${row.symbol ?? "row"}-${idx}`} hover>
              {columns.map((c) => <TableCell key={c.key} align={c.align} sx={{ fontVariantNumeric: c.align === "right" ? "tabular-nums" : "normal" }}>{c.render ? c.render(row) : row[c.key]}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function PerformanceTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const values = Object.fromEntries(payload.map((item) => [item.dataKey, item.value]));
  return (
    <Paper variant="outlined" sx={{ p: 1.25, minWidth: 180, boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)" }}>
      <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>{label}</Typography>
      <Stack spacing={0.5}>
        <Stack direction="row" justifyContent="space-between" spacing={2}>
          <Typography variant="caption" color="text.secondary">投組報酬</Typography>
          <Typography variant="caption" sx={{ fontWeight: 700, color: pnlColor(values.portfolio_return || 0), fontVariantNumeric: "tabular-nums" }}>
            {values.portfolio_return == null ? "-" : `${fmtNum(values.portfolio_return)}%`}
          </Typography>
        </Stack>
        <Stack direction="row" justifyContent="space-between" spacing={2}>
          <Typography variant="caption" color="text.secondary">投組市值</Typography>
          <Typography variant="caption" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {values.portfolio_value == null ? "-" : fmtTwd(values.portfolio_value)}
          </Typography>
        </Stack>
        <Stack direction="row" justifyContent="space-between" spacing={2}>
          <Typography variant="caption" color="text.secondary">基準報酬</Typography>
          <Typography variant="caption" sx={{ fontWeight: 700, color: pnlColor(values.benchmark_return || 0), fontVariantNumeric: "tabular-nums" }}>
            {values.benchmark_return == null ? "-" : `${fmtNum(values.benchmark_return)}%`}
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}

function PerformanceChart({ accounts, benchmarks, paletteMode }) {
  const [slot, setSlot] = useState("5d");
  const [benchmark, setBenchmark] = useState("0050.TW");
  const [accountId, setAccountId] = useState("all");
  const [result, setResult] = useState({ series: [], errors: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ slot, benchmark });
    if (accountId !== "all") params.set("account_id", accountId);
    setLoading(true);
    api.get(`/api/performance?${params.toString()}`)
      .then(setResult)
      .catch((err) => setResult({ series: [], errors: [{ symbol: "API", error: err.message }] }))
      .finally(() => setLoading(false));
  }, [slot, benchmark, accountId]);

  const gridColor = paletteMode === "dark" ? "#263244" : "#eef0f3";
  const tickColor = paletteMode === "dark" ? "#9ca3af" : "#667085";
  const portfolioColor = paletteMode === "dark" ? "#8fb4ff" : "#1f4fd8";
  const benchmarkColor = paletteMode === "dark" ? "#9ca3af" : "#64748b";

  return (
    <Section
      title="持倉報酬率"
      action={
        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }}>
          <FormControl sx={{ minWidth: 112 }}>
            <InputLabel>期間</InputLabel>
            <Select label="期間" value={slot} onChange={(e) => setSlot(e.target.value)}>
              {timeSlots.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth: 168 }}>
            <InputLabel>基準</InputLabel>
            <Select label="基準" value={benchmark} onChange={(e) => setBenchmark(e.target.value)}>
              {(benchmarks || []).map((item) => <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth: 176 }}>
            <InputLabel>帳戶</InputLabel>
            <Select label="帳戶" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <MenuItem value="all">全部帳戶</MenuItem>
              {accounts.map((account) => <MenuItem key={account.id} value={String(account.id)}>{account.name}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      }
    >
      {result.errors?.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {result.errors.map((item) => `${item.symbol}: ${item.error}`).join("；")}
        </Alert>
      )}
      <Box sx={{ height: 330, opacity: loading ? 0.55 : 1 }}>
        {result.series?.length ? (
          <ResponsiveContainer>
            <LineChart data={result.series} margin={{ top: 8, right: 24, left: 4, bottom: 4 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: tickColor }} tickMargin={8} />
              <YAxis tick={{ fontSize: 12, fill: tickColor }} tickFormatter={(value) => `${fmtNum(value, 1)}%`} width={56} />
              <ChartTooltip content={<PerformanceTooltip />} />
              <Legend verticalAlign="top" height={32} />
              <Line type="monotone" dataKey="portfolio_return" name="投組報酬" stroke={portfolioColor} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls />
              <Line type="monotone" dataKey="benchmark_return" name="基準報酬" stroke={benchmarkColor} strokeWidth={2.2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Box sx={{ height: "100%", display: "grid", placeItems: "center", color: "text.secondary" }}>
            <Typography variant="body2">{loading ? "載入歷史報酬中" : "沒有可顯示的歷史報酬資料"}</Typography>
          </Box>
        )}
      </Box>
    </Section>
  );
}

function Overview({ data, accounts, benchmarks, paletteMode, todayPnl }) {
  const allocationColors = allocationColorsFor(paletteMode);
  const todayPnlValue = todayPnl?.today_pnl_twd ?? data.metrics.today_pnl_twd;
  const todayPnlPct = todayPnl?.today_return_pct ?? data.metrics.today_return_pct;
  return (
    <Stack spacing={2.5}>
      <Grid container spacing={2} justifyContent="center">
        <Grid item xs={12} sm={6} md={4} lg={2.4}><MetricCard label="總資產（折台幣）" value={fmtTwd(data.metrics.total_twd)} /></Grid>
        <Grid item xs={12} sm={6} md={4} lg={2.4}><MetricCard label="現金部位" value={fmtTwd(data.metrics.cash_twd)} tone="secondary" /></Grid>
        <Grid item xs={12} sm={6} md={4} lg={2.4}><MetricCard label="股票市值" value={fmtTwd(data.metrics.stock_value_twd)} tone="secondary" /></Grid>
        <Grid item xs={12} sm={6} md={4} lg={2.4}><MetricCard label="今日損益" value={todayPnlValue == null ? "載入中" : fmtTwd(todayPnlValue)} sub={fmtPct(todayPnlPct)} tone={(todayPnlValue ?? 0) >= 0 ? "error" : "success"} /></Grid>
        <Grid item xs={12} sm={6} md={4} lg={2.4}><MetricCard label="累積損益" value={fmtTwd(data.metrics.stock_pnl_twd)} sub={`${fmtNum(data.metrics.stock_return_pct)}%`} tone={data.metrics.stock_pnl_twd >= 0 ? "error" : "success"} /></Grid>
      </Grid>
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Section title="資產配置">
            <Box sx={{ height: 260 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.allocation} dataKey="value" nameKey="label" innerRadius={58} outerRadius={92}>
                    {data.allocation.map((_, i) => <Cell key={i} fill={allocationColors[i % allocationColors.length]} />)}
                  </Pie>
                  <ChartTooltip formatter={(value) => fmtTwd(value)} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
            <Stack spacing={1}>
              {data.allocation.map((row, i) => (
                <Stack key={row.label} direction="row" alignItems="center" justifyContent="space-between">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box sx={{ width: 10, height: 10, borderRadius: 1, bgcolor: allocationColors[i % allocationColors.length] }} />
                    <Typography variant="body2" color="text.secondary">{row.label}</Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtTwd(row.value)}</Typography>
                </Stack>
              ))}
            </Stack>
          </Section>
        </Grid>
        <Grid item xs={12} md={8}>
          <PerformanceChart accounts={accounts} benchmarks={benchmarks} paletteMode={paletteMode} />
        </Grid>
      </Grid>
    </Stack>
  );
}

function AccountDialog({ account, onClose, onSave }) {
  const [form, setForm] = useState({
    name: account?.name || "",
    type: account?.type || "bank",
    currency: account?.currency || "TWD",
    balance: account?.balance || 0,
    twd_cost: account?.twd_cost || "",
    notes: "",
    date: today()
  });
  const edit = Boolean(account);
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{edit ? "調整帳戶" : "新增帳戶"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {!edit && <TextField label="帳戶名稱" value={form.name} onChange={set("name")} fullWidth />}
          {!edit && (
            <Stack direction="row" spacing={2}>
              <FormControl fullWidth><InputLabel>類型</InputLabel><Select label="類型" value={form.type} onChange={set("type")}><MenuItem value="bank">銀行</MenuItem><MenuItem value="securities">證券</MenuItem></Select></FormControl>
              <FormControl fullWidth><InputLabel>幣別</InputLabel><Select label="幣別" value={form.currency} onChange={set("currency")}><MenuItem value="TWD">TWD</MenuItem><MenuItem value="USD">USD</MenuItem></Select></FormControl>
            </Stack>
          )}
          <TextField label={edit ? "新餘額" : "初始餘額"} type="number" value={form.balance} onChange={set("balance")} fullWidth />
          {edit && account.currency === "USD" && <TextField label="折台幣金額（換匯成本）" type="number" value={form.twd_cost} onChange={set("twd_cost")} fullWidth />}
          {edit && <TextField label="日期" type="date" value={form.date} onChange={set("date")} InputLabelProps={{ shrink: true }} fullWidth />}
          <TextField label="備註" value={form.notes} onChange={set("notes")} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button startIcon={<Save />} variant="contained" onClick={() => onSave({ ...form, balance: Number(form.balance), twd_cost: form.twd_cost === "" ? null : Number(form.twd_cost) })}>儲存</Button>
      </DialogActions>
    </Dialog>
  );
}

function Accounts({ data, onRefresh, notify }) {
  const [dialog, setDialog] = useState(null);
  const [tx, setTx] = useState({ type: "transfer", amount: 0, currency: "TWD", from_id: "", to_id: "", exchange_rate: data.overview.rate, date: today(), notes: "" });
  const saveAccount = async (payload) => {
    if (dialog?.id) await api.patch(`/api/accounts/${dialog.id}`, payload);
    else await api.post("/api/accounts", payload);
    setDialog(null); notify("帳戶已儲存"); onRefresh();
  };
  const saveTx = async () => {
    await api.post("/api/account-transactions", { ...tx, amount: Number(tx.amount), exchange_rate: Number(tx.exchange_rate), from_id: tx.from_id || null, to_id: tx.to_id || null });
    notify("資金異動已記錄"); onRefresh();
  };
  return (
    <Stack spacing={2.5}>
      <Section title="現有帳戶" action={<Button startIcon={<Add />} variant="contained" onClick={() => setDialog({})}>新增</Button>}>
        <DataTable rows={data.accounts} columns={[
          { key: "name", label: "帳戶" },
          { key: "type", label: "類型", render: (r) => <Chip size="small" label={r.type === "bank" ? "銀行" : "證券"} /> },
          { key: "balance", label: "餘額", align: "right", render: (r) => fmtMoney(r.balance, r.currency) },
          { key: "value", label: "折台幣", align: "right", render: (r) => fmtTwd(r.twd_cost ?? (r.currency === "USD" ? r.balance * data.overview.rate : r.balance)) },
          { key: "actions", label: "", align: "right", render: (r) => <Stack direction="row" spacing={1} justifyContent="flex-end"><Tooltip title="調整"><IconButton onClick={() => setDialog(r)}><Edit /></IconButton></Tooltip><Tooltip title="刪除"><IconButton color="error" onClick={async () => { await api.delete(`/api/accounts/${r.id}`); notify("帳戶已刪除"); onRefresh(); }}><Delete /></IconButton></Tooltip></Stack> }
        ]} />
      </Section>
      <Section title="資金轉帳 / 存提">
        <Grid container spacing={2}>
          <Grid item xs={12} md={2}><FormControl fullWidth><InputLabel>類型</InputLabel><Select label="類型" value={tx.type} onChange={(e) => setTx({ ...tx, type: e.target.value })}><MenuItem value="transfer">轉帳</MenuItem><MenuItem value="deposit">存入</MenuItem><MenuItem value="withdrawal">提出</MenuItem></Select></FormControl></Grid>
          <Grid item xs={12} md={2}><FormControl fullWidth><InputLabel>從帳戶</InputLabel><Select label="從帳戶" value={tx.from_id} onChange={(e) => setTx({ ...tx, from_id: e.target.value })}><MenuItem value="">無</MenuItem>{data.accounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}</Select></FormControl></Grid>
          <Grid item xs={12} md={2}><FormControl fullWidth><InputLabel>到帳戶</InputLabel><Select label="到帳戶" value={tx.to_id} onChange={(e) => setTx({ ...tx, to_id: e.target.value })}><MenuItem value="">無</MenuItem>{data.accounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}</Select></FormControl></Grid>
          <Grid item xs={12} md={2}><TextField label="金額" type="number" value={tx.amount} onChange={(e) => setTx({ ...tx, amount: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={2}><TextField label="USD/TWD" type="number" value={tx.exchange_rate} onChange={(e) => setTx({ ...tx, exchange_rate: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={2}><Button startIcon={<Save />} variant="contained" onClick={saveTx} fullWidth sx={{ height: 56 }}>記錄</Button></Grid>
        </Grid>
      </Section>
      {dialog && <AccountDialog account={dialog.id ? dialog : null} onClose={() => setDialog(null)} onSave={saveAccount} />}
    </Stack>
  );
}

function Holdings({ data, onRefresh, notify }) {
  const [stock, setStock] = useState({ symbol: "", name: "", market: "US", currency: "USD", account_id: data.accounts[0]?.id || "" });
  const [price, setPrice] = useState({ stock_id: data.stocks[0]?.id || "", price: 0 });
  const refreshAll = async () => {
    const res = await api.post("/api/stocks/refresh-prices");
    notify(`已更新 ${res.updated.length} 檔${res.errors.length ? `，${res.errors.length} 檔失敗` : ""}`);
    onRefresh();
  };
  return (
    <Stack spacing={2.5}>
      <Section title="更新股價" action={<Button startIcon={<Refresh />} variant="contained" onClick={refreshAll}>自動更新全部</Button>}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={5}><FormControl fullWidth><InputLabel>股票</InputLabel><Select label="股票" value={price.stock_id} onChange={(e) => setPrice({ ...price, stock_id: e.target.value })}>{data.stocks.map((s) => <MenuItem key={s.id} value={s.id}>{s.name} ({s.symbol})</MenuItem>)}</Select></FormControl></Grid>
          <Grid item xs={12} md={4}><TextField label="現價" type="number" value={price.price} onChange={(e) => setPrice({ ...price, price: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={3}><Button startIcon={<Save />} variant="outlined" onClick={async () => { await api.post(`/api/stocks/${price.stock_id}/price`, { price: Number(price.price) }); notify("股價已更新"); onRefresh(); }} fullWidth sx={{ height: 56 }}>手動更新</Button></Grid>
        </Grid>
      </Section>
      <Section title="持倉明細">
        <DataTable rows={data.holdings} columns={[
          { key: "name", label: "名稱" },
          { key: "symbol", label: "代號" },
          { key: "market", label: "市場" },
          { key: "shares", label: "股數", align: "right", render: (r) => fmtNum(r.shares, 4) },
          { key: "avg_cost", label: "均價", align: "right", render: (r) => fmtNum(r.avg_cost, 3) },
          { key: "price", label: "現價", align: "right", render: (r) => fmtNum(r.price, 3) },
          { key: "market_value", label: "市值", align: "right", render: (r) => fmtMoney(r.market_value, r.currency) },
          { key: "pnl", label: "損益", align: "right", render: (r) => <Typography color={pnlColor(r.pnl)} sx={{ fontWeight: 700 }}>{fmtMoney(r.pnl, r.currency)}</Typography> },
          { key: "return_pct", label: "報酬", align: "right", render: (r) => `${fmtNum(r.return_pct)}%` }
        ]} />
      </Section>
      <Section title="新增股票">
        <Grid container spacing={2}>
          <Grid item xs={12} md={2}><TextField label="代號" value={stock.symbol} onChange={(e) => setStock({ ...stock, symbol: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={3}><TextField label="名稱" value={stock.name} onChange={(e) => setStock({ ...stock, name: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={2}><FormControl fullWidth><InputLabel>市場</InputLabel><Select label="市場" value={stock.market} onChange={(e) => setStock({ ...stock, market: e.target.value, currency: e.target.value === "US" ? "USD" : "TWD" })}><MenuItem value="US">US</MenuItem><MenuItem value="TW">TW</MenuItem></Select></FormControl></Grid>
          <Grid item xs={12} md={3}><FormControl fullWidth><InputLabel>帳戶</InputLabel><Select label="帳戶" value={stock.account_id} onChange={(e) => setStock({ ...stock, account_id: e.target.value })}>{data.accounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}</Select></FormControl></Grid>
          <Grid item xs={12} md={2}><Button startIcon={<Add />} variant="contained" onClick={async () => { await api.post("/api/stocks", { ...stock, account_id: Number(stock.account_id) }); notify("股票已新增"); onRefresh(); }} fullWidth sx={{ height: 56 }}>新增</Button></Grid>
        </Grid>
      </Section>
    </Stack>
  );
}

function Trades({ data, onRefresh, notify }) {
  const [trade, setTrade] = useState({ stock_id: data.stocks[0]?.id || "", type: "buy", shares: 1, price: 0, fee: 0, date: today(), notes: "" });
  const selected = data.stocks.find((s) => s.id === Number(trade.stock_id));
  useEffect(() => {
    if (!selected || !trade.shares || !trade.price) return;
    api.get(`/api/trade-fee?market=${selected.market}&shares=${trade.shares}&price=${trade.price}`).then((res) => setTrade((t) => ({ ...t, fee: res.fee }))).catch(() => {});
  }, [selected?.market, trade.shares, trade.price]);
  return (
    <Stack spacing={2.5}>
      <Section title="新增買賣">
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}><FormControl fullWidth><InputLabel>股票</InputLabel><Select label="股票" value={trade.stock_id} onChange={(e) => setTrade({ ...trade, stock_id: e.target.value })}>{data.stocks.map((s) => <MenuItem key={s.id} value={s.id}>{s.name} ({s.symbol})</MenuItem>)}</Select></FormControl></Grid>
          <Grid item xs={12} md={2}><FormControl fullWidth><InputLabel>類型</InputLabel><Select label="類型" value={trade.type} onChange={(e) => setTrade({ ...trade, type: e.target.value })}><MenuItem value="buy">買入</MenuItem><MenuItem value="sell">賣出</MenuItem></Select></FormControl></Grid>
          <Grid item xs={6} md={1.5}><TextField label="股數" type="number" value={trade.shares} onChange={(e) => setTrade({ ...trade, shares: e.target.value })} fullWidth /></Grid>
          <Grid item xs={6} md={1.5}><TextField label="成交價" type="number" value={trade.price} onChange={(e) => setTrade({ ...trade, price: e.target.value })} fullWidth /></Grid>
          <Grid item xs={6} md={1.5}><TextField label="手續費" type="number" value={trade.fee} onChange={(e) => setTrade({ ...trade, fee: e.target.value })} fullWidth /></Grid>
          <Grid item xs={6} md={1.5}><TextField label="日期" type="date" value={trade.date} onChange={(e) => setTrade({ ...trade, date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
          <Grid item xs={12}><TextField label="備註" value={trade.notes} onChange={(e) => setTrade({ ...trade, notes: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12}><Button startIcon={<Save />} variant="contained" onClick={async () => { await api.post("/api/stock-transactions", { ...trade, stock_id: Number(trade.stock_id), shares: Number(trade.shares), price: Number(trade.price), fee: Number(trade.fee) }); notify("交易已記錄"); onRefresh(); }}>確認送出</Button></Grid>
        </Grid>
      </Section>
      <Section title="交易歷史">
        <DataTable rows={data.stockTransactions} columns={[
          { key: "date", label: "日期" },
          { key: "name", label: "名稱" },
          { key: "type", label: "類型", render: (r) => <Chip size="small" variant="outlined" color={r.type === "buy" ? "success" : "error"} label={r.type === "buy" ? "買入" : "賣出"} /> },
          { key: "shares", label: "股數", align: "right", render: (r) => fmtNum(r.shares, 4) },
          { key: "price", label: "成交價", align: "right", render: (r) => fmtNum(r.price, 3) },
          { key: "fee", label: "手續費", align: "right", render: (r) => fmtMoney(r.fee, r.currency) },
          { key: "actions", label: "", align: "right", render: (r) => <IconButton color="error" onClick={async () => { await api.delete(`/api/stock-transactions/${r.id}`); notify("交易已刪除"); onRefresh(); }}><Delete /></IconButton> }
        ]} />
      </Section>
    </Stack>
  );
}

function Transactions({ data, onRefresh, notify }) {
  return (
    <Section title="資金異動紀錄">
      <DataTable rows={data.accountTransactions} columns={[
        { key: "date", label: "日期" },
        { key: "type", label: "類型" },
        { key: "from_name", label: "從", render: (r) => r.from_name || "無" },
        { key: "to_name", label: "到", render: (r) => r.to_name || "無" },
        { key: "amount", label: "金額", align: "right", render: (r) => fmtMoney(r.amount, r.currency) },
        { key: "exchange_rate", label: "匯率", align: "right", render: (r) => Number(r.exchange_rate) === 1 ? "-" : fmtNum(r.exchange_rate, 4) },
        { key: "notes", label: "備註" },
        { key: "actions", label: "", align: "right", render: (r) => <IconButton color="error" onClick={async () => { await api.delete(`/api/account-transactions/${r.id}`); notify("紀錄已刪除"); onRefresh(); }}><Delete /></IconButton> }
      ]} />
    </Section>
  );
}

function SettingsPage({ data, onRefresh, notify }) {
  const [rate, setRate] = useState(data.overview.rate);
  const [fees, setFees] = useState({
    tw_commission_rate: data.fees.tw_comm,
    tw_lot_min_fee: data.fees.tw_lot_min,
    tw_odd_commission_rate: data.fees.tw_odd_comm,
    tw_odd_min_fee: data.fees.tw_odd_min,
    tw_stock_tax_rate: data.fees.tw_stock_tax,
    tw_etf_tax_rate: data.fees.tw_etf_tax,
    us_commission_rate: data.fees.us_comm,
    us_min_fee: data.fees.us_min
  });
  const saveFees = async () => {
    await api.patch("/api/settings/fees", Object.fromEntries(Object.entries(fees).map(([k, v]) => [k, Number(v)])));
    notify("手續費設定已儲存"); onRefresh();
  };
  return (
    <Stack spacing={2.5}>
      <Section title="USD/TWD 匯率" action={<Button startIcon={<Refresh />} variant="outlined" onClick={async () => { const res = await api.post("/api/settings/refresh-usd-twd"); setRate(res.rate); notify("匯率已自動更新"); onRefresh(); }}>自動抓取</Button>}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField label="匯率" type="number" value={rate} onChange={(e) => setRate(e.target.value)} />
          <Button startIcon={<Save />} variant="contained" onClick={async () => { await api.patch("/api/settings", { key: "usd_twd_rate", value: Number(rate) }); notify("匯率已儲存"); onRefresh(); }}>手動更新</Button>
        </Stack>
      </Section>
      <Section title="手續費設定">
        <Grid container spacing={2}>
          {Object.entries(fees).map(([key, value]) => <Grid item xs={12} md={3} key={key}><TextField label={key} type="number" value={value} onChange={(e) => setFees({ ...fees, [key]: e.target.value })} fullWidth /></Grid>)}
          <Grid item xs={12}><Button startIcon={<Save />} variant="contained" onClick={saveFees}>儲存手續費設定</Button></Grid>
        </Grid>
      </Section>
      <Section title="匯出備份">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {["accounts", "holdings", "stocks", "stock-transactions", "account-transactions"].map((name) => (
            <Button key={name} startIcon={<Download />} href={`/api/export/${name}`} variant="outlined">{name}</Button>
          ))}
        </Stack>
      </Section>
    </Stack>
  );
}

function App() {
  const [active, setActive] = useState("overview");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");
  const [todayPnl, setTodayPnl] = useState(null);
  const [paletteMode, setPaletteMode] = useState(() => localStorage.getItem("finance-theme") || "light");
  const load = async () => {
    try {
      setData(await api.get("/api/bootstrap"));
      setTodayPnl(null);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    api.get("/api/today-pnl")
      .then((result) => { if (!cancelled) setTodayPnl(result); })
      .catch(() => { if (!cancelled) setTodayPnl({ today_pnl_twd: null, today_return_pct: null }); });
    return () => { cancelled = true; };
  }, [data?.overview?.updated_at]);
  useEffect(() => { localStorage.setItem("finance-theme", paletteMode); }, [paletteMode]);
  const theme = useMemo(() => makeTheme(paletteMode), [paletteMode]);
  const title = useMemo(() => tabs.find(([key]) => key === active)?.[1] || "資產追蹤", [active]);
  const pageProps = { data, onRefresh: load, notify: setSnack };
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
        <Drawer
          variant="permanent"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: {
              width: drawerWidth,
              boxSizing: "border-box",
              borderRightColor: "divider",
              bgcolor: "background.paper"
            }
          }}
        >
          <Toolbar sx={{ px: 2.5, minHeight: "68px !important" }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 2,
                bgcolor: "primary.main",
                color: paletteMode === "dark" ? "#0b0f17" : "#fff",
                display: "grid",
                placeItems: "center",
                mr: 1.5
              }}
            >
              <Paid fontSize="small" />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontSize: 17, lineHeight: 1.2 }}>資產追蹤</Typography>
              <Typography variant="caption" color="text.secondary">Local portfolio</Typography>
            </Box>
          </Toolbar>
          <Divider />
          <List sx={{ p: 1.25 }}>
            {tabs.map(([key, label, icon]) => {
              const selected = active === key;
              return (
                <ListItemButton
                  key={key}
                  selected={selected}
                  onClick={() => setActive(key)}
                  sx={{
                    minHeight: 44,
                    mb: 0.5,
                    borderRadius: 1.5,
                    color: selected ? "primary.main" : "text.secondary",
                    "&.Mui-selected": {
                      bgcolor: (theme) => alpha(theme.palette.primary.main, paletteMode === "dark" ? 0.16 : 0.1),
                      color: "primary.main"
                    },
                    "&.Mui-selected:hover": {
                      bgcolor: (theme) => alpha(theme.palette.primary.main, paletteMode === "dark" ? 0.22 : 0.14)
                    }
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>{React.cloneElement(icon, { fontSize: "small" })}</ListItemIcon>
                  <ListItemText
                    primary={label}
                    primaryTypographyProps={{
                      fontSize: 14,
                      fontWeight: selected ? 700 : 600
                    }}
                  />
                </ListItemButton>
              );
            })}
          </List>
          <Box sx={{ mt: "auto", p: 2.5 }}>
            <Stack spacing={1.25}>
              <Paper variant="outlined" sx={{ p: 1.75, bgcolor: (theme) => theme.custom.paperSoft }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 700, mb: 1 }}>帳戶餘額</Typography>
                <Stack spacing={1}>
                  {(data?.overview?.accounts || []).slice(0, 4).map((account) => (
                    <Box key={account.id}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {account.name}
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {fmtMoney(account.balance, account.currency)}
                      </Typography>
                    </Box>
                  ))}
                  {data?.overview?.accounts?.length > 4 && (
                    <Typography variant="caption" color="text.secondary">另 {data.overview.accounts.length - 4} 個帳戶</Typography>
                  )}
                </Stack>
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.75, bgcolor: (theme) => theme.custom.paperSoft }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>USD/TWD</Typography>
              <Typography variant="h6" color="primary" sx={{ mt: 0.25, fontVariantNumeric: "tabular-nums" }}>{data?.overview?.rate?.toFixed(4) || "-"}</Typography>
              <Typography variant="caption" color="text.secondary">{data?.overview?.rate_updated || "未設定"}</Typography>
              </Paper>
            </Stack>
          </Box>
        </Drawer>
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
          <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Toolbar sx={{ minHeight: "68px !important", px: { xs: 2, md: 3 } }}>
              <Box>
                <Typography variant="h5" sx={{ fontSize: 22 }}>{title}</Typography>
                <Typography variant="body2" color="text.secondary">資料儲存在本機 SQLite，介面即時讀取 API</Typography>
              </Box>
              <Box sx={{ flex: 1 }} />
              <Tooltip title={paletteMode === "dark" ? "切換淺色主題" : "切換深色主題"}>
                <IconButton onClick={() => setPaletteMode((mode) => mode === "dark" ? "light" : "dark")}>
                  {paletteMode === "dark" ? <LightMode /> : <DarkMode />}
                </IconButton>
              </Tooltip>
              <Tooltip title="重新整理"><IconButton onClick={load}><Refresh /></IconButton></Tooltip>
            </Toolbar>
          </AppBar>
          <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1480, mx: "auto" }}>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {!data ? <Alert severity="info">載入中</Alert> : (
              <>
                {active === "overview" && <Overview data={data.overview} accounts={data.accounts} benchmarks={data.benchmarks} paletteMode={paletteMode} todayPnl={todayPnl} />}
                {active === "accounts" && <Accounts {...pageProps} />}
                {active === "holdings" && <Holdings {...pageProps} />}
                {active === "trades" && <Trades {...pageProps} />}
                {active === "transactions" && <Transactions {...pageProps} />}
                {active === "settings" && <SettingsPage {...pageProps} />}
              </>
            )}
          </Box>
        </Box>
      </Box>
      <Snackbar open={Boolean(snack)} autoHideDuration={2600} onClose={() => setSnack("")} message={snack} />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
