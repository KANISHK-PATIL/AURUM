
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const PAGES = [
  ['overview', 'Overview', '◫'],
  ['screener', 'Relative-Value Screener', '⌕'],
  ['comparison', 'Contract Comparison', '⇄'],
  ['curve', 'Futures Curve', '⌁'],
  ['costs', 'Cost Calculator', '₹'],
  ['data', 'Dataset & Signals', '▤'],
  ['settings', 'Settings', '⚙']
];

const money = n =>
  n == null || !Number.isFinite(Number(n))
    ? '—'
    : `₹${Number(n).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;

const pct = n =>
  n == null || !Number.isFinite(Number(n))
    ? '—'
    : `${Number(n) > 0 ? '+' : ''}${Number(n).toFixed(2)}%`;

const num = n =>
  n == null ? '—' : Number(n).toLocaleString('en-IN');

const unique = a => [...new Set(a)];

function downloadCsv(filename, rows) {
  if (!rows?.length) return;

  const cols = Object.keys(rows[0]);
  const csv = [
    cols.join(','),
    ...rows.map(row =>
      cols
        .map(col => `"${String(row[col] ?? '').replaceAll('"', '""')}"`)
        .join(',')
    )
  ].join('\n');

  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  );

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Sparkline({ values = [] }) {
  const safe = values
    .map(Number)
    .filter(Number.isFinite);

  if (safe.length < 2) {
    return <div className="chart-empty">More history needed</div>;
  }

  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const span = max - min || 1;

  const points = safe
    .map(
      (value, index) =>
        `${(index / (safe.length - 1)) * 100},${38 - ((value - min) / span) * 32}`
    )
    .join(' ');

  return (
    <svg
      className="sparkline"
      viewBox="0 0 100 42"
      preserveAspectRatio="none"
      role="img"
      aria-label="Historical price trend"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function App() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem('aurum-theme') || 'light'
  );

  const [page, setPage] = useState('overview');
  const [sessions, setSessions] = useState([]);
  const [date, setDate] = useState('');
  const [payload, setPayload] = useState(null);

  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('ALL');
  const [symbol, setSymbol] = useState('ALL');
  const [sort, setSort] = useState('basisPct');

  const [pairA, setPairA] = useState('GOLDM');
  const [pairB, setPairB] = useState('GOLDPETAL');
  const [unit, setUnit] = useState('gram');

  const [lotGrams, setLotGrams] = useState(100);
  const [brokerage, setBrokerage] = useState(20);
  const [exchangePct, setExchangePct] = useState(0.0026);
  const [sellTaxPct, setSellTaxPct] = useState(0.1);
  const [gstPct, setGstPct] = useState(18);

  const [spotPerGram, setSpotPerGram] = useState('');
  const [riskFreePct, setRiskFreePct] = useState(6.5);
  const [carryPct, setCarryPct] = useState(0);

  const [apiError, setApiError] = useState('');

  // Historical GOLDM observations for the Overview chart.
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('aurum-theme', theme);
  }, [theme]);

  async function request(url, options) {
    const response = await fetch(url, options);
    const body = await response.text();

    let json = {};

    try {
      json = body ? JSON.parse(body) : {};
    } catch {
      throw new Error(`API returned an invalid response (${response.status}).`);
    }

    if (!response.ok) {
      throw new Error(json.error || `Request failed (${response.status})`);
    }

    return json;
  }

  async function loadRows(selectedDate) {
    setLoading(true);
    setApiError('');

    try {
      const result = await request(
        `/api/rows${
          selectedDate
            ? `?date=${encodeURIComponent(selectedDate)}`
            : ''
        }`
      );

      setPayload(result);
      setDate(result.date);
    } catch (error) {
      setPayload(null);
      setApiError(error.message || 'Unable to load market data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSessions() {
      try {
        const result = await request('/api/sessions');

        if (cancelled) return;

        const dates = result.dates || [];
        setSessions(dates);

        await loadRows(dates.at(-1) || '');
      } catch (error) {
        if (!cancelled) {
          setLoading(false);
          setApiError(error.message || 'Unable to connect to the backend.');
        }
      }
    }

    loadSessions();

    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch real historical observations, independently of the selected session.
  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError('');

      try {
        const result = await request('/api/history?symbol=GOLDM');

        if (cancelled) return;

        const observations = Array.isArray(result.rows)
          ? result.rows
          : [];

        setHistory(
          observations
            .filter(
              row =>
                row.date &&
                Number.isFinite(Number(row.price)) &&
                Number(row.price) > 0
            )
            .map(row => ({
              ...row,
              // The API's sample values are 10 times the per-gram price.
              // Convert the quoted GOLDM price to rupees per gram.
              priceRupees: Number(row.price) / 10
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        );
      } catch (error) {
        if (!cancelled) {
          setHistory([]);
          setHistoryError(
            error.message || 'Could not load historical prices.'
          );
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nodes = document.querySelectorAll('.reveal');

    if (!('IntersectionObserver' in window)) {
      nodes.forEach(node => node.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      entries =>
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 }
    );

    nodes.forEach(node => observer.observe(node));

    return () => observer.disconnect();
  }, [page, payload, loading, history]);

  const allRows = payload?.rows || [];
  const symbols = unique(allRows.map(row => row.symbol));

  const rows = useMemo(
    () =>
      allRows
        .filter(
          row =>
            `${row.symbol} ${row.expiry} ${row.why} ${(row.tags || []).join(' ')}`
              .toLowerCase()
              .includes(query.toLowerCase()) &&
            (tag === 'ALL' || row.tags?.includes(tag)) &&
            (symbol === 'ALL' || row.symbol === symbol)
        )
        .sort((a, b) => {
          const av = a[sort];
          const bv = b[sort];

          return typeof av === 'number' && typeof bv === 'number'
            ? bv - av
            : String(av ?? '').localeCompare(String(bv ?? ''));
        }),
    [allRows, query, tag, symbol, sort]
  );

  const rich = allRows.filter(row => row.tags?.includes('RICH')).length;
  const cheap = allRows.filter(row => row.tags?.includes('CHEAP')).length;

  const basisRows = allRows.filter(row => row.basisPct != null);

  const avg = basisRows.length
    ? basisRows.reduce((sum, row) => sum + row.basisPct, 0) /
      basisRows.length
    : null;

  const pairRows = allRows.filter(row =>
    [pairA, pairB].includes(row.symbol)
  );

  const aRow = pairRows.find(row => row.symbol === pairA);
  const bRow = pairRows.find(row => row.symbol === pairB);

  const spread = aRow && bRow ? bRow.pg - aRow.pg : null;

  const spreadPct =
    aRow && bRow && aRow.pg
      ? (bRow.pg / aRow.pg - 1) * 100
      : null;

  const expiring = [...allRows]
    .sort((a, b) => a.days - b.days)
    .filter(row => row.days >= 0)
    .slice(0, 5);

  const tags = unique(allRows.flatMap(row => row.tags || []));

  const nav = () => (
    <nav className="top-navigation">
      <div className="brand">
        <span className="brand-mark">Au</span>
        <div>
          <b>Aurum</b>
          <small></small>
        </div>
      </div>

      <div className="top-nav-links" aria-label="Main navigation">
        {PAGES.map(([id, label, icon]) => (
          <button
            key={id}
            className={`nav-item ${page === id ? 'active' : ''}`}
            onClick={() => setPage(id)}
            title={label}
          >
            <span className="nav-icon">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="nav-right">
        <button
          className="theme-toggle"
          onClick={() =>
            setTheme(current => current === 'dark' ? 'light' : 'dark')
          }
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? '☼' : '☾'}
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </nav>
  );

  const heading = PAGES.find(item => item[0] === page)?.[1] || 'Overview';

  const topbar = () => (
    <header className="page-top">
      <div>
        <div className="crumb">
          AURUM <span>/</span> WORKSPACE <span>/</span> {heading.toUpperCase()}
        </div>
        <h1>{heading}</h1>
      </div>

      <div className="top-actions">
        <label className="session-picker">
          Market session
          <select
            value={date}
            onChange={event => loadRows(event.target.value)}
            disabled={loading}
          >
            {sessions.map(session => (
              <option key={session} value={session}>{session}</option>
            ))}
          </select>
        </label>

        <button
          className="btn btn-quiet"
          onClick={() => loadRows(date)}
          disabled={loading}
        >
          ↻ Refresh
        </button>
      </div>
    </header>
  );

  const panel = (title, sub, content, extra = null) => (
    <section className="panel reveal">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {extra}
      </div>
      {content}
    </section>
  );

  const metric = (label, value, sub, cls = '', trend = null) => (
    <article className="metric-card" key={label}>
      <span>{label}</span>
      <strong className={cls}>{value}</strong>
      <small>{sub}</small>
      {trend && <div className="metric-spark"><Sparkline values={trend} /></div>}
    </article>
  );

  const table = (data, compact = false) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Contract / expiry</th>
            <th className="num">₹ / gram</th>
            <th className="num">Fair value</th>
            <th className="num">Cost / gram</th>
            <th className="num">Spread vs fair</th>
            <th className="num">Exit status</th>
            <th>Signal / tags</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan="7" className="empty">Loading market session…</td></tr>
          ) : data.length ? (
            data.map((row, index) => (
              <tr
                key={`${row.symbol}-${row.expiry}`}
                style={{ '--row-index': index }}
                className="data-row"
              >
                <td>
                  <b className="symbol">{row.symbol}</b>
                  <div className="muted">{row.expiry} · {row.days} days left</div>
                </td>
                <td className="num price">{money(row.pg)}</td>
                <td className="num">{money(row.fair)}</td>
                <td className="num">{money(row.costPerGram)}</td>
                <td className={`num ${row.basisPct > 0 ? 'rich-text' : row.basisPct < 0 ? 'cheap-text' : ''}`}>
                  {pct(row.basisPct)}
                </td>
                <td className="num">
                  <span className={`status-chip ${row.exitGuard?.status?.includes('EXIT') || row.exitGuard?.status?.includes('ACT') ? 'warn' : ''}`}>
                    {row.exitGuard?.status || 'ACTIVE'}
                  </span>
                </td>
                <td>
                  <div className="tags">
                    {(row.tags || []).slice(0, compact ? 2 : 4).map(item => (
                      <span key={item} className={`tag ${item.toLowerCase()}`}>
                        {item}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr><td colSpan="7" className="empty">No rows match the current filters.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const chartCard = (title, sub, values, meta) => (
    <div className="chart-card">
      <div className="chart-title">
        <div>
          <h3>{title}</h3>
          <p>{sub}</p>
        </div>
        <span className="chart-meta">{meta || '60 SESSIONS'}</span>
      </div>
      <Sparkline values={values} />
      <div className="chart-foot">
        <span>Historical direction</span>
        <b>Daily observations</b>
      </div>
    </div>
  );

  function renderPage() {
    if (page === 'overview') {
      return (
        <>
          <div className="hero-strip reveal">
            <div>
              <p className="eyebrow"> / {date || 'LATEST SESSION'}</p>
              <h2>Read the spread.<br /><em>Not just the price.</em></h2>
              <p>
                Compare MCX gold futures on a common per-gram basis, evaluate
                round-trip trading costs, and manage contract expiry exit guards.
              </p>
            </div>

            <div className="hero-stamp hero-3d" aria-label="Animated three-dimensional gold sphere">
              <div className="orb-scene" aria-hidden="true">
                <div className="gold-orb"><span className="orb-glint"></span></div>
              </div>
              <span className="orb-label">Au</span>
              <small>GOLD<br />ANALYTICS</small>
            </div>
          </div>

          {payload?.brief && panel(
            'Daily Market Brief',
            'Generated contract summary and positioning overview',
            <p className="daily-brief-text">{payload.brief}</p>
          )}

          <div className="metrics reveal">
            {metric('Contracts & expiries', allRows.length, 'Available observations')}
            {metric('Rich vs fair', rich, 'Above configured threshold', 'rich-text')}
            {metric('Cheap vs fair', cheap, 'Below configured threshold', 'cheap-text')}
            {metric('Average basis', pct(avg), 'Mean distance from fair')}
          </div>

          <div className="two-col">
            {panel(
              'Market pulse',
              'Normalized contract prices and current deviations',
              <>
                {chartCard(
                  'Price ladder',
                  'Historical GOLDM Bhavcopy · ₹ per gram',
                  history.map(row => row.priceRupees),
                  historyLoading ? 'LOADING' : `${history.length} OBSERVATIONS`
                )}

                {historyError && (
                  <p className="muted">{historyError}</p>
                )}

                {historyLoading && (
                  <p className="muted">Loading historical Bhavcopy prices…</p>
                )}

                {!historyLoading && !historyError && history.length === 0 && (
                  <p className="muted">No historical GOLDM observations returned.</p>
                )}

                {history.length > 0 && (
                  <div className="mini-list">
                    {history.slice(-5).reverse().map(row => (
                      <div key={`${row.date}-${row.expiry}`}>
                        <span>
                          <b>GOLDM</b>
                          <small>{row.date} · Expiry {row.expiry}</small>
                        </span>
                        <strong>{money(row.priceRupees)}</strong>
                        <em className="muted">Bhavcopy</em>
                      </div>
                    ))}
                  </div>
                )}

                <div className="divider-line"></div>

                <div className="mini-list">
                  {allRows.slice(0, 4).map(row => (
                    <div key={row.symbol + row.expiry}>
                      <span>
                        <b>{row.symbol}</b>
                        <small>{row.expiry}</small>
                      </span>
                      <strong>{money(row.pg)}</strong>
                      <em className={row.basisPct >= 0 ? 'rich-text' : 'cheap-text'}>
                        {pct(row.basisPct)}
                      </em>
                    </div>
                  ))}
                </div>
              </>
            )}

            {panel(
              'Expiry watch & Exit guards',
              'Nearest contract expiries and exit countdowns',
              <div className="expiry-list">
                {expiring.map(row => (
                  <div key={row.symbol + row.expiry}>
                    <div>
                      <b>{row.symbol}</b>
                      <small>{row.expiry}</small>
                    </div>
                    <strong>{row.days}d</strong>
                    <span className={
                      row.exitGuard?.status?.includes('EXIT') ||
                      row.exitGuard?.status?.includes('ACT')
                        ? 'warning'
                        : 'muted'
                    }>
                      {row.exitGuard?.status || 'Active'}
                    </span>
                  </div>
                ))}
                {!expiring.length && (
                  <p className="muted">No expiry metadata available.</p>
                )}
              </div>
            )}
          </div>

          {panel(
            'Latest relative-value observations',
            'Sort and open the screener for the full set',
            table(
              [...allRows]
                .sort((a, b) => Math.abs(b.basisPct ?? 0) - Math.abs(a.basisPct ?? 0))
                .slice(0, 6),
              true
            ),
            <button className="btn btn-quiet" onClick={() => setPage('screener')}>
              Open screener ↗
            </button>
          )}
        </>
      );
    }

    if (page === 'screener') {
      return (
        <>
          <div className="filter-bar reveal">
            <label>
              Search
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Symbol, expiry, tag…"
              />
            </label>

            <label>
              Contract
              <select value={symbol} onChange={event => setSymbol(event.target.value)}>
                <option value="ALL">All contracts</option>
                {symbols.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label>
              Signal tag
              <select value={tag} onChange={event => setTag(event.target.value)}>
                <option value="ALL">All tags</option>
                {tags.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label>
              Rank by
              <select value={sort} onChange={event => setSort(event.target.value)}>
                <option value="basisPct">Absolute deviation</option>
                <option value="costPerGram">Cost per gram</option>
                <option value="zBasis">Z-score</option>
                <option value="volume">Volume</option>
                <option value="days">Days to expiry</option>
                <option value="pg">Price</option>
              </select>
            </label>

            <button className="btn" onClick={() => downloadCsv(`aurum-screener-${date || 'data'}.csv`, rows)}>
              Export CSV ↓
            </button>
          </div>

          {panel(
            'Opportunity ranking',
            `${rows.length} of ${allRows.length} observations · transparent ranking by selected metric`,
            table(rows)
          )}
        </>
      );
    }

    if (page === 'comparison') {
      return (
        <>
          <section className="panel reveal">
            <div className="panel-head">
              <div>
                <h2>Pairwise contract comparison</h2>
                <p>Compare normalized prices on a common basis.</p>
              </div>
            </div>

            <div className="pair-controls">
              <label>
                Contract A
                <select value={pairA} onChange={event => setPairA(event.target.value)}>
                  {symbols.map(item => <option key={item}>{item}</option>)}
                </select>
              </label>
              <span className="versus">VS</span>
              <label>
                Contract B
                <select value={pairB} onChange={event => setPairB(event.target.value)}>
                  {symbols.map(item => <option key={item}>{item}</option>)}
                </select>
              </label>
            </div>

            <div className="metrics pair-metrics">
              {metric(`${pairA} · per gram`, money(aRow?.pg), 'Current normalized price')}
              {metric(`${pairB} · per gram`, money(bRow?.pg), 'Current normalized price')}
              {metric('Absolute spread', spread == null ? '—' : money(spread), 'B minus A', spread > 0 ? 'rich-text' : 'cheap-text')}
              {metric('Relative spread', pct(spreadPct), 'Percentage deviation', spreadPct > 0 ? 'rich-text' : 'cheap-text')}
            </div>

            <div className="two-col">
              <div className="chart-card">
                <h3>Price ratio</h3>
                <strong className="big-value">
                  {aRow && bRow ? (bRow.pg / aRow.pg).toFixed(6) : '—'}
                </strong>
                <p>Contract B / Contract A</p>
              </div>
              <div className="chart-card">
                <h3>Expiry alignment</h3>
                <strong className="big-value">
                  {aRow && bRow ? (aRow.expiry === bRow.expiry ? 'Same expiry' : 'Different expiries') : '—'}
                </strong>
                <p>Expiry mismatch can distort relative-value comparisons.</p>
              </div>
            </div>
          </section>

          {panel(
            'Contract observations',
            'Current-session values from the selected pair',
            table(pairRows)
          )}
        </>
      );
    }

    if (page === 'curve') {
      return (
        <>
          <div className="metrics">
            {metric('Curve state', allRows.length ? 'Observed' : 'Unavailable', 'Requires expiry metadata')}
            {metric('Visible expiries', unique(allRows.map(row => row.expiry)).length, 'Across current contracts')}
            {metric('Contango tags', allRows.filter(row => row.tags?.includes('CONTANGO')).length, 'Tagged by backend')}
            {metric('Backwardation tags', allRows.filter(row => row.tags?.includes('BACKWARDATION')).length, 'Tagged by backend')}
          </div>

          {panel(
            'Futures term structure',
            'Sorted by expiry date · prices shown per gram',
            <div className="curve-list">
              {[...allRows]
                .sort((a, b) => a.expiry.localeCompare(b.expiry))
                .map(row => (
                  <div key={row.symbol + row.expiry} className="curve-row">
                    <span>{row.symbol}<small>{row.expiry}</small></span>
                    <div className="curve-track">
                      <i style={{
                        width: `${Math.max(
                          4,
                          Math.min(
                            100,
                            row.pg / Math.max(...allRows.map(item => item.pg), 1) * 100
                          )
                        )}%`
                      }} />
                    </div>
                    <b>{money(row.pg)}</b>
                    <em>{row.days}d</em>
                  </div>
                ))}
            </div>
          )}
        </>
      );
    }

    if (page === 'costs') {
      const selected = allRows.find(row => row.symbol === pairA) || allRows[0];
      const price = selected?.pg || 0;
      const lot = Math.max(0, Number(lotGrams) || 0);
      const turnover = price * lot;
      const brokerageCost = Math.max(0, Number(brokerage) || 0) * 2;
      const exchangeCost = turnover * Math.max(0, Number(exchangePct) || 0) / 100 * 2;
      const sellTaxCost = turnover * Math.max(0, Number(sellTaxPct) || 0) / 100;
      const feeSubtotal = brokerageCost + exchangeCost + sellTaxCost;
      const gstCost = feeSubtotal * Math.max(0, Number(gstPct) || 0) / 100;
      const totalCost = feeSubtotal + gstCost;
      const costPerGram = lot > 0 ? totalCost / lot : 0;

      const fair =
        Number(spotPerGram) > 0 && selected
          ? Number(spotPerGram) *
            (1 + ((Number(riskFreePct) + Number(carryPct)) / 100) * selected.days / 365)
          : null;

      const gap = fair == null ? null : Math.abs(price - fair);

      return (
        <>
          <div className="feature-intro reveal">
            <span className="eyebrow">AURUM / TRADING TOOLKIT</span>
            <h2>Know your cost before you trade.</h2>
            <p>Estimate round-trip charges using editable assumptions. These are estimates, not broker quotes.</p>
          </div>

          <div className="two-col">
            {panel(
              'Round-trip cost calculator',
              'Adjust contract, lot size and estimated charges',
              <div className="calculator-grid">
                <label>Contract
                  <select value={pairA} onChange={event => setPairA(event.target.value)}>
                    {symbols.map(item => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label>Lot size (grams)
                  <input type="number" min="1" value={lotGrams} onChange={event => setLotGrams(event.target.value)} />
                </label>
                <label>Brokerage per order (₹)
                  <input type="number" min="0" step="1" value={brokerage} onChange={event => setBrokerage(event.target.value)} />
                </label>
                <label>Exchange charge (% turnover, per leg)
                  <input type="number" min="0" step="0.0001" value={exchangePct} onChange={event => setExchangePct(event.target.value)} />
                </label>
                <label>Sell-side tax (%)
                  <input type="number" min="0" step="0.01" value={sellTaxPct} onChange={event => setSellTaxPct(event.target.value)} />
                </label>
                <label>GST on estimated fees (%)
                  <input type="number" min="0" step="0.1" value={gstPct} onChange={event => setGstPct(event.target.value)} />
                </label>
              </div>
            )}

            {panel(
              'Your estimated cost',
              'Calculated from the selected session price',
              <div className="cost-results">
                <div><span>Latest price per gram</span><b>{money(price)}</b></div>
                <div><span>Lot turnover</span><b>{money(turnover)}</b></div>
                <div><span>Brokerage (buy + sell)</span><b>{money(brokerageCost)}</b></div>
                <div><span>Exchange charges (both legs)</span><b>{money(exchangeCost)}</b></div>
                <div><span>Sell-side tax</span><b>{money(sellTaxCost)}</b></div>
                <div><span>Estimated GST</span><b>{money(gstCost)}</b></div>
                <div className="cost-total"><span>Total estimated round-trip cost</span><b>{money(totalCost)}</b></div>
                <div className="cost-total"><span>Estimated cost per gram</span><b>{money(costPerGram)}</b></div>
              </div>
            )}
          </div>

          {panel(
            'Fair-value sensitivity',
            'Enter a verified spot price to enable an indicative fair-value estimate',
            <>
              <div className="calculator-grid">
                <label>Spot price (₹/gram)
                  <input type="number" min="0" step="0.01" placeholder="Enter verified spot price" value={spotPerGram} onChange={event => setSpotPerGram(event.target.value)} />
                </label>
                <label>Annual risk-free rate (%)
                  <input type="number" step="0.1" value={riskFreePct} onChange={event => setRiskFreePct(event.target.value)} />
                </label>
                <label>Additional carry (%)
                  <input type="number" step="0.1" value={carryPct} onChange={event => setCarryPct(event.target.value)} />
                </label>
              </div>

              <div className="metrics">
                {metric('Selected contract', selected?.symbol || '—', selected?.expiry || 'No contract selected')}
                {metric('Indicative fair value', fair == null ? 'Enter spot price' : money(fair), fair == null ? 'No fabricated price' : 'Model estimate')}
                {metric('Absolute price-to-fair gap', gap == null ? '—' : money(gap), 'Per gram')}
                {metric('Cost vs gap', gap == null ? '—' : costPerGram >= gap ? 'COST ≥ GAP' : 'COST < GAP', gap == null ? 'Requires spot input' : 'Estimated cost compared with gap', gap != null && costPerGram >= gap ? 'warn-text' : '')}
              </div>

              <p className="callout">
                Educational estimate only. Enter your broker's actual fee schedule for a closer estimate. No live spot price is fetched.
              </p>
            </>
          )}
        </>
      );
    }

    if (page === 'data') {
      return (
        <>
          <div className="feature-intro reveal">
            <span className="eyebrow">DATA TRANSPARENCY</span>
            <h2>Know what powers each signal.</h2>
            <p>Review the selected session, imported contracts and missing inputs before interpreting a relative-value signal.</p>
          </div>

          <div className="metrics">
            {metric('Selected session', date || '—', 'Bhavcopy date')}
            {metric('Data source', payload?.source || allRows[0]?.source || 'Unknown', 'Reported by backend')}
            {metric('Rows in session', allRows.length, 'Contract and expiry observations')}
            {metric('Spot input', Number(spotPerGram) > 0 ? money(Number(spotPerGram)) : 'Not configured', 'Set in Cost Calculator')}
          </div>

          {panel(
            'Data coverage',
            'Contracts available in the selected session',
            <div className="coverage-grid">
              {['GOLDM', 'GOLDTEN', 'GOLDGUINEA', 'GOLDPETAL'].map(item => {
                const found = allRows.filter(row => row.symbol === item);

                return (
                  <div className="coverage-card" key={item}>
                    <span className={`coverage-dot ${found.length ? 'ok' : ''}`}></span>
                    <b>{item}</b>
                    <strong>{found.length ? `${found.length} row(s)` : 'Missing'}</strong>
                    <small>
                      {found.length
                        ? `Expiry: ${found.map(row => row.expiry).join(', ')}`
                        : 'No rows returned for this session'}
                    </small>
                  </div>
                );
              })}
            </div>
          )}

          {panel(
            'Signal audit',
            'Count of each tag in the selected session',
            <div className="signal-audit">
              {tags.map(item => (
                <div key={item}>
                  <span className={`tag ${item.toLowerCase()}`}>{item}</span>
                  <b>{allRows.filter(row => row.tags?.includes(item)).length}</b>
                </div>
              ))}
            </div>
          )}

          {panel('Current observations', 'Exact values returned by the backend', table(allRows))}

          <div className="callout">
            Fair value depends on your spot price and model assumptions. The expiry guard excludes weekends but does not include an authoritative MCX holiday calendar.
          </div>
        </>
      );
    }

    if (page === 'settings') {
      return (
        <section className="panel reveal">
          <div className="panel-head">
            <div>
              <h2>Research settings</h2>
              <p>Configure local display and analysis units.</p>
            </div>
          </div>

          <div className="settings-grid">
            <label>Display unit
              <select value={unit} onChange={event => setUnit(event.target.value)}>
                <option value="gram">₹ per gram</option>
                <option value="10g">₹ per 10 grams</option>
                <option value="kg">₹ per kilogram</option>
              </select>
            </label>

            <label>Default comparison A
              <select value={pairA} onChange={event => setPairA(event.target.value)}>
                {symbols.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label>Default comparison B
              <select value={pairB} onChange={event => setPairB(event.target.value)}>
                {symbols.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>

          <div className="callout">
            Display conversion: {unit === 'gram'
              ? '₹ per gram'
              : unit === '10g'
                ? '₹ per 10 grams (per-gram value × 10)'
                : '₹ per kilogram (per-gram value × 1,000)'}.
            The main table remains per gram for consistent comparison.
          </div>
        </section>
      );
    }

    return null;
  }

  return (
    <div className="app-shell">
      {nav()}

      <main className="main-content">
        {topbar()}

        {apiError && (
          <div className="error-banner">
            <b>Market data unavailable</b>
            <span>{apiError}</span>
            <button className="btn btn-quiet" onClick={() => loadRows(date)}>
              Retry
            </button>
          </div>
        )}

        {renderPage()}

        <footer className="app-footer"><span></span></footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
