let marketRemainingSec = null;
const RING_C = 2 * Math.PI * 42;
const FEED_LIMIT = 120;

const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");
const snapshotEl = document.getElementById("snapshot");
const indicatorStatsEl = document.getElementById("indicatorStats");
const policyInfoEl = document.getElementById("policyInfo");
const historyEl = document.getElementById("history");
const statsEl = document.getElementById("stats");
const accuracyValueEl = document.getElementById("accuracyValue");
const accuracyArcEl = document.getElementById("accuracyArc");
const whaleStatsEl = document.getElementById("whaleStats");
const whalesEl = document.getElementById("whales");

const feed = JSON.parse(localStorage.getItem("pm_prediction_feed") || "[]");

function sideFromProb(p) {
  return p >= 0.5 ? "YES" : "NO";
}
function fmt(n, d = 4) {
  return Number(n).toFixed(d);
}
function fmtCountdown(sec) {
  const s = Math.max(0, Number(sec || 0));
  const mm = String(Math.floor(s / 60)).padStart(1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function badge(side) {
  if (side === "YES") return `<span class="badge badge--yes">YES</span>`;
  if (side === "NO") return `<span class="badge badge--no">NO</span>`;
  return `<span class="badge badge--neutral">${side}</span>`;
}

function gateBadge(pass) {
  return pass
    ? '<span class="badge badge--yes">ENTER</span>'
    : '<span class="badge badge--neutral">HOLD</span>';
}

function setStatus(loading) {
  if (loading) {
    statusEl.textContent = "Loading";
    statusEl.className = "status-pill status-pill--loading";
    refreshBtn.classList.add("is-loading");
  } else {
    statusEl.textContent = "Ready";
    statusEl.className = "status-pill status-pill--ready";
    refreshBtn.classList.remove("is-loading");
  }
}

async function refreshPrediction() {
  setStatus(true);
  try {
    const res = await fetch("/api/prediction");
    const data = await res.json();
    const p5 = data.prediction.pUp5m;
    const side = data.prediction.side || sideFromProb(p5);
    const sideClass = side === "YES" ? "stat-tile__value--yes" : "stat-tile__value--no";

    const meta = data.marketMeta || {};
    const remain = Number(meta.remainingSec ?? -1);
    marketRemainingSec = remain >= 0 ? remain : null;
    const remainText = remain >= 0 ? fmtCountdown(remain) : "—";
    const gatePass = Boolean(data.gate?.passConfidence && data.gate?.passTime);

    snapshotEl.innerHTML = `
      <div class="stat-tile stat-tile--wide">
        <div class="stat-tile__label">Market</div>
        <div class="stat-tile__value">${escapeHtml(data.marketId)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__label">Current YES</div>
        <div class="stat-tile__value stat-tile__value--prob">${fmt(data.currentYes)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__label">Pred (5m)</div>
        <div class="stat-tile__value ${sideClass}">${side}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__label">P(UP)</div>
        <div class="stat-tile__value stat-tile__value--prob">${fmt(p5, 3)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__label">Confidence</div>
        <div class="stat-tile__value">${fmt(data.prediction.confidence, 2)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__label">Gate</div>
        <div class="stat-tile__value ${data.gate?.passConfidence && data.gate?.passTime ? "stat-tile__value--yes" : "stat-tile__value--no"}">
          ${gatePass ? "ENTER" : "HOLD"}
        </div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__label">Slug</div>
        <div class="stat-tile__value" style="font-size:0.75rem">${escapeHtml(meta.slug || "—")}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__label">Ends in</div>
        <div class="stat-tile__value"><span id="remainTimer">${remainText}</span></div>
      </div>
      <div class="stat-tile stat-tile--wide">
        <div class="stat-tile__label">Question</div>
        <div class="stat-tile__value" style="font-size:0.8rem;font-weight:500">${escapeHtml(meta.question || "—")}</div>
      </div>
    `;

    const indicators = data.indicators || {};
    indicatorStatsEl.innerHTML = `
      <div class="stat-tile"><div class="stat-tile__label">EMA Fast</div><div class="stat-tile__value">${fmt(indicators.emaFast || 0, 4)}</div></div>
      <div class="stat-tile"><div class="stat-tile__label">EMA Slow</div><div class="stat-tile__value">${fmt(indicators.emaSlow || 0, 4)}</div></div>
      <div class="stat-tile"><div class="stat-tile__label">EMA Signal</div><div class="stat-tile__value">${fmt(indicators.emaSignal || 0, 4)}</div></div>
      <div class="stat-tile"><div class="stat-tile__label">RSI</div><div class="stat-tile__value">${fmt(indicators.rsi || 0, 1)}</div></div>
      <div class="stat-tile"><div class="stat-tile__label">Trend Score</div><div class="stat-tile__value">${fmt(indicators.trendScore || 0, 3)}</div></div>
      <div class="stat-tile stat-tile--wide"><div class="stat-tile__label">Entry Gate</div><div class="stat-tile__value">${data.gate?.passConfidence ? "Confidence pass" : "Confidence fail"} | ${data.gate?.passTime ? "Time pass" : "Time fail"} | threshold=${fmt(data.gate?.confidenceThreshold || 0.8,2)}</div></div>
    `;
    policyInfoEl.innerHTML = `
      <div class="stat-tile"><div class="stat-tile__label">Confidence threshold</div><div class="stat-tile__value">${fmt(data.gate?.confidenceThreshold || 0.8, 2)}</div></div>
      <div class="stat-tile"><div class="stat-tile__label">Min whale winrate</div><div class="stat-tile__value">${((data.gate?.whaleMinWinrate || 0.7) * 100).toFixed(0)}%</div></div>
      <div class="stat-tile"><div class="stat-tile__label">Force exit</div><div class="stat-tile__value">${data.gate?.forceExitSeconds ?? 3}s before expiry</div></div>
      <div class="stat-tile"><div class="stat-tile__label">Current gate status</div><div class="stat-tile__value ${gatePass ? "stat-tile__value--yes" : "stat-tile__value--no"}">${gatePass ? "ALLOW ENTER" : "HOLD"}</div></div>
    `;

    const thresholdPct = ((data.gate?.confidenceThreshold ?? 0.8) * 100).toFixed(0);
    const whaleMinWr = ((data.gate?.whaleMinWinrate ?? 0.7) * 100).toFixed(0);
    whaleStatsEl.textContent = `Filtered wallets: ${data.eligibleWallets?.length || 0} · Min winrate ${whaleMinWr}% · Confidence gate ${thresholdPct}% · Remaining ${remainText}`;
    const wallets = data.eligibleWallets || [];
    whalesEl.innerHTML =
      wallets
        .map((w) => {
          const bias = w.netYes > 0 ? "YES" : w.netYes < 0 ? "NO" : "—";
          const b = bias === "YES" ? "badge--yes" : bias === "NO" ? "badge--no" : "badge--neutral";
          return `<tr><td>${w.wallet.slice(0, 6)}…${w.wallet.slice(-4)}</td><td>${(100 * (w.winrate || 0)).toFixed(1)}%</td><td>$${fmt(w.yesNotional, 2)}</td><td>$${fmt(w.noNotional, 2)}</td><td>$${fmt(w.netYes, 2)}</td><td>$${fmt(w.gross, 2)}</td><td><span class="badge ${b}">${bias}</span></td></tr>`;
        })
        .join("") ||
      '<tr><td colspan="7" class="empty-cell">No qualifying wallets for current sample.</td></tr>';

    feed.push({
      ts: Date.now(),
      marketId: data.marketId,
      side,
      pUp: p5,
      conf: data.prediction.confidence,
      gatePass
    });
    if (feed.length > FEED_LIMIT) feed.splice(0, feed.length - FEED_LIMIT);
    localStorage.setItem("pm_prediction_feed", JSON.stringify(feed));
    renderHistory();
  } finally {
    setStatus(false);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderHistory() {
  const total = feed.length;
  historyEl.innerHTML = total
    ? feed
        .slice()
        .reverse()
        .map(
          (x) => `
    <tr class="${x.gatePass ? "row--win" : "row--lose"}">
      <td>${new Date(x.ts).toLocaleString()}</td>
      <td>${escapeHtml(String(x.marketId))}</td>
      <td>${badge(x.side)}</td>
      <td>${fmt(x.pUp, 3)}</td>
      <td>${fmt(x.conf, 2)}</td>
      <td>${gateBadge(x.gatePass)}</td>
    </tr>
  `
        )
        .join("")
    : '<tr><td colspan="6" class="empty-cell">No predictions yet. Click <strong>Get prediction</strong>.</td></tr>';
  const enterReady = feed.filter((x) => x.gatePass).length;
  const rate = total ? (enterReady / total) * 100 : 0;

  if (accuracyArcEl) {
    accuracyArcEl.style.strokeDasharray = String(RING_C);
    accuracyArcEl.style.strokeDashoffset = total ? String(RING_C * (1 - rate / 100)) : String(RING_C);
  }
  accuracyValueEl.textContent = total ? `${rate.toFixed(1)}%` : "—";
  statsEl.innerHTML = `<strong style="color:var(--text)">${total}</strong> snapshots · <strong style="color:var(--success)">${enterReady}</strong> enter-ready`;
}

document.getElementById("refresh").addEventListener("click", () => refreshPrediction().catch(console.error));

function tickMarketTimer() {
  if (marketRemainingSec == null) return;
  marketRemainingSec = Math.max(0, marketRemainingSec - 1);
  const el = document.getElementById("remainTimer");
  if (el) el.textContent = fmtCountdown(marketRemainingSec);

  if (marketRemainingSec === 0) {
    refreshPrediction().catch(() => {});
  }
}

renderHistory();
refreshPrediction().catch(console.error);
setInterval(tickMarketTimer, 1000);
