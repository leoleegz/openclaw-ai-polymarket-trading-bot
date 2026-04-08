import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple in-memory store for comparisons
interface Comparison {
  id: string;
  predictedSide: "YES" | "NO";
  entryPrice: number;
  exitPrice: number;
  correct: boolean;
  settledAt: string;
}

const comparisons: Comparison[] = [];
let lastPrediction: { side: string; confidence: number; pUp: number; yesPrice: number } | null = null;

const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Polymarket Compare UI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: #00d4ff; margin-bottom: 20px; }
    h2 { color: #fff; margin: 20px 0 10px; font-size: 1.2rem; }
    .card { background: #16213e; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #0f3460; }
    .btn { background: #00d4ff; color: #1a1a2e; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: bold; }
    .btn:hover { background: #00b8e6; }
    .stat { background: #0f3460; padding: 12px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 1.5rem; font-weight: bold; color: #00d4ff; }
    .stat-label { font-size: 0.8rem; color: #888; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-top: 15px; }
    input { background: #0f3460; border: 1px solid #333; color: #fff; padding: 10px; border-radius: 8px; width: 100%; }
    .result { padding: 15px; border-radius: 8px; margin-top: 15px; }
    .result-success { background: #0d3d2d; border: 1px solid #00ff88; }
    .result-error { background: #3d0d0d; border: 1px solid #ff4444; }
    .result-info { background: #0d2d3d; border: 1px solid #00d4ff; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #0f3460; }
    .correct { color: #00ff88; }
    .incorrect { color: #ff4444; }
    .side-yes { color: #00ff88; }
    .side-no { color: #ff4444; }
    .loader { display: inline-block; width: 20px; height: 20px; border: 2px solid #00d4ff; border-radius: 50%; border-top-color: transparent; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>🦞 Polymarket Compare UI</h1>

    <div class="card">
      <h2>🔍 Get Prediction</h2>
      <p style="color:#888;margin-bottom:15px;">Click to get current market prediction snapshot</p>
      <button class="btn" onclick="getPrediction()">Get Prediction</button>
      <div id="pred-result" style="display:none; margin-top:15px;">
        <div class="grid">
          <div class="stat"><div class="stat-value" id="pred-side">-</div><div class="stat-label">Predicted</div></div>
          <div class="stat"><div class="stat-value" id="pred-conf">-</div><div class="stat-label">Confidence</div></div>
          <div class="stat"><div class="stat-value" id="pred-pup">-</div><div class="stat-label">pUp</div></div>
          <div class="stat"><div class="stat-value" id="pred-price">-</div><div class="stat-label">YES Price</div></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>⏱️ Auto Compare</h2>
      <p style="color:#888;margin-bottom:15px;">Get prediction first, then start comparison</p>
      <div style="margin-bottom:15px;">
        <label style="display:block;margin-bottom:5px;color:#888;">Entry YES Price</label>
        <input type="number" id="entry-price" step="0.001" placeholder="0.5000">
      </div>
      <div style="margin-bottom:15px;">
        <label style="display:block;margin-bottom:5px;color:#888;">Auto Settle Delay (seconds)</label>
        <input type="number" id="delay-seconds" value="300" placeholder="300">
      </div>
      <button class="btn" id="compare-btn" onclick="startCompare()" disabled>Start Compare</button>
      <div id="compare-result" style="display:none; margin-top:15px;"></div>
    </div>

    <div class="card">
      <h2>📜 History</h2>
      <div class="grid">
        <div class="stat"><div class="stat-value" id="stat-total">0</div><div class="stat-label">Total</div></div>
        <div class="stat"><div class="stat-value" id="stat-correct">0</div><div class="stat-label">Correct</div></div>
        <div class="stat"><div class="stat-value" id="stat-accuracy">0%</div><div class="stat-label">Accuracy</div></div>
      </div>
      <div id="history-table" style="display:none;margin-top:15px;">
        <table><thead><tr><th>Time</th><th>Predicted</th><th>Entry</th><th>Exit</th><th>Result</th></tr></thead><tbody id="history-body"></tbody></table>
      </div>
    </div>
  </div>

  <script>
    let lastPred = null;

    async function getPrediction() {
      const btn = event.target;
      btn.disabled = true;
      btn.innerHTML = '<span class="loader"></span> Fetching...';
      try {
        const resp = await fetch('/api/prediction');
        const data = await resp.json();
        lastPred = data;
        document.getElementById('pred-side').textContent = data.side;
        document.getElementById('pred-side').className = 'stat-value ' + (data.side === 'YES' ? 'side-yes' : 'side-no');
        document.getElementById('pred-conf').textContent = (data.confidence * 100).toFixed(0) + '%';
        document.getElementById('pred-pup').textContent = data.pUp.toFixed(3);
        document.getElementById('pred-price').textContent = data.yesPrice.toFixed(4);
        document.getElementById('entry-price').value = data.yesPrice.toFixed(4);
        document.getElementById('pred-result').style.display = 'block';
        document.getElementById('compare-btn').disabled = false;
        loadHistory();
      } catch (e) { alert('Error: ' + e.message); }
      btn.disabled = false;
      btn.innerHTML = 'Get Prediction';
    }

    async function startCompare() {
      if (!lastPred) { alert('Get prediction first'); return; }
      const entryPrice = parseFloat(document.getElementById('entry-price').value);
      const delay = parseInt(document.getElementById('delay-seconds').value);
      const btn = document.getElementById('compare-btn');
      btn.disabled = true;
      btn.innerHTML = 'Waiting for settlement...';
      setTimeout(async () => {
        try {
          const resp = await fetch('/api/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entryPrice, delaySeconds: delay })
          });
          const result = await resp.json();
          const div = document.getElementById('compare-result');
          div.style.display = 'block';
          div.innerHTML = '<div class="result ' + (result.correct ? 'result-success' : 'result-error') + '">' +
            '<strong>' + (result.correct ? '✅ CORRECT' : '❌ INCORRECT') + '</strong><br>' +
            'Predicted: ' + result.predictedSide + ' | Entry: ' + result.entryPrice + ' | Exit: ' + result.exitPrice +
            '</div>';
          loadHistory();
        } catch (e) { alert('Error: ' + e.message); }
        btn.disabled = false;
        btn.innerHTML = 'Start Compare';
      }, delay * 1000 + 1000);
    }

    async function loadHistory() {
      try {
        const resp = await fetch('/api/history');
        const data = await resp.json();
        document.getElementById('stat-total').textContent = data.total;
        document.getElementById('stat-correct').textContent = data.correct;
        document.getElementById('stat-accuracy').textContent = (data.accuracy * 100).toFixed(0) + '%';
        if (data.history.length > 0) {
          document.getElementById('history-table').style.display = 'block';
          document.getElementById('history-body').innerHTML = data.history.map(c => {
            const time = new Date(c.settledAt).toLocaleTimeString();
            return '<tr><td>' + time + '</td><td class="' + (c.predictedSide === 'YES' ? 'side-yes' : 'side-no') + '">' + c.predictedSide + '</td><td>' + c.entryPrice.toFixed(4) + '</td><td>' + c.exitPrice.toFixed(4) + '</td><td class="' + (c.correct ? 'correct' : 'incorrect') + '">' + (c.correct ? '✅' : '❌') + '</td></tr>';
          }).join('');
        }
      } catch (e) { console.error(e); }
    }

    loadHistory();
  </script>
</body>
</html>`;

const PORT = 8787;

// API endpoints
async function handleApiPrediction(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    // Import connector dynamically
    const { PolymarketConnector } = await import("./connectors/polymarket.js");
    const connector = new PolymarketConnector("https://gamma-api.polymarket.com");
    const ticks = await connector.getMarketTicks(20);

    if (ticks.length < 3) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Not enough ticks" }));
      return;
    }

    // Get wallet data
    const marketId = ticks[ticks.length - 1].marketId;
    const whale = await connector.getWhaleFlow(marketId);
    const wallets = (whale.participants ?? []).map((p: { wallet: string }) => p.wallet);

    // Build features (simplified)
    const { buildFeatures } = await import("./engine/features.js");
    const { predict } = await import("./engine/predictor.js");
    const { getWalletWinrates } = await import("./connectors/walletPerformance.js");

    const walletWinrates = await getWalletWinrates(wallets);
    const features = buildFeatures(ticks, whale, walletWinrates);
    const pred = predict(features, 0);

    lastPrediction = {
      side: pred.side,
      confidence: pred.confidence,
      pUp: pred.pUp5m,
      yesPrice: features.yesPrice,
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(lastPrediction));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}

async function handleApiCompare(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  if (!lastPrediction) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Get prediction first" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const { entryPrice, delaySeconds } = JSON.parse(body);

      // Wait for delay
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));

      // Get current price as exit price
      const { PolymarketConnector } = await import("./connectors/polymarket.js");
      const connector = new PolymarketConnector("https://gamma-api.polymarket.com");
      const ticks = await connector.getMarketTicks(1);
      const exitPrice = ticks[0]?.yesPrice ?? 0.5;

      const actualSide = exitPrice >= entryPrice ? "YES" : "NO";
      const correct = lastPrediction.side === actualSide;

      const comparison: Comparison = {
        id: Date.now().toString(),
        predictedSide: lastPrediction.side as "YES" | "NO",
        entryPrice,
        exitPrice,
        correct,
        settledAt: new Date().toISOString(),
      };

      comparisons.unshift(comparison);
      if (comparisons.length > 100) comparisons.pop();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        predictedSide: comparison.predictedSide,
        entryPrice: comparison.entryPrice,
        exitPrice: comparison.exitPrice,
        correct: comparison.correct,
      }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });
}

async function handleApiHistory(req: http.IncomingMessage, res: http.ServerResponse) {
  const total = comparisons.length;
  const correct = comparisons.filter((c) => c.correct).length;

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      history: comparisons,
      total,
      correct,
      accuracy: total > 0 ? correct / total : 0,
    })
  );
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/api/prediction") {
      await handleApiPrediction(req, res);
    } else if (url.pathname === "/api/compare") {
      await handleApiCompare(req, res);
    } else if (url.pathname === "/api/history") {
      await handleApiHistory(req, res);
    } else if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(UI_HTML);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
});

server.listen(PORT, () => {
  console.log(`Compare UI running at http://localhost:${PORT}`);
});
