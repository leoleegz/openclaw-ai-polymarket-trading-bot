# Openclaw AI Polymarket Trading Bot — Modification Plan

## Overview

Based on `solcanine/openclaw-ai-polymarket-trading-bot` (TypeScript), adding:
1. **Auto Redeem** — Automatic position redemption after market settlement
2. **Gas Management** — Auto-swap USDC.e to MATIC/POL for gas
3. **Market Duration Selection** — Support for 5m and 15m BTC markets
4. **MiniMax LLM Support** — Use MiniMax as LLM provider

---

## 1. Project Structure (Existing)

```
openclaw-ai-polymarket-trading-bot/
├── src/
│   ├── main.ts                    # Entry point: loop every N seconds
│   ├── config.ts                  # Reads .env, exposes cfg
│   ├── envCheck.ts                # Startup validation
│   ├── types/index.ts             # Shared types
│   ├── connectors/
│   │   ├── polymarket.ts         # Gamma API + Data API
│   │   ├── orderExecution.ts     # CLOB client wrapper
│   │   └── walletPerformance.ts   # Wallet winrate lookup
│   ├── engine/
│   │   ├── features.ts           # EMA/RSI + winrate-filtered features
│   │   ├── predictor.ts          # pUp5m prediction
│   │   ├── strategy.ts          # HOLD / OPEN / FORCE_CLOSE
│   │   └── positionStore.ts      # Position persistence (open-positions.json)
│   └── ui/
│       ├── server.ts             # Compare UI server (port 8787)
│       └── index.html            # Compare UI frontend
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 2. New Features Implementation Plan

### 2.1 Auto Redeem

**Problem**: Original bot force-closes before settlement but does NOT redeem winnings.

**Solution**: Add a background RedeemManager that:
1. Monitors closed positions
2. Checks if market has resolved
3. If position won → calls `redeemPosition()`
4. Updates position status

**Files to modify**:

| File | Changes |
|------|---------|
| `src/types/index.ts` | Add `RedeemResult`, `SettledPosition` types |
| `src/connectors/orderExecution.ts` | Add `redeemPosition()` method |
| `src/engine/positionStore.ts` | Add `getClosedPositions()`, `markRedeemed()` |
| `src/main.ts` | Add `RedeemManager` background loop |

**New file**: `src/engine/redeemManager.ts`

```typescript
// Pseudocode
class RedeemManager {
  async start() {
    setInterval(() => this.checkAndRedeem(), 30_000)
  }

  async checkAndRedeem() {
    const closed = positionStore.getClosedPositions()
    for (const pos of closed) {
      const market = await polymarket.getMarket(pos.conditionId)
      if (market.resolved) {
        const outcome = market.yesPrice >= 0.5 ? 'YES' : 'NO'
        if (pos.side === outcome) {
          await orderExecutor.redeemPosition(pos)
          positionStore.markRedeemed(pos.id)
        }
      }
    }
  }
}
```

---

### 2.2 Gas Management (Auto Swap)

**Problem**: Polygon requires MATIC/POL for gas. If gas runs out, trades fail.

**Solution**: Before each trade, check MATIC balance. If low, swap USDC.e → MATIC via QuickSwap.

**Files to modify**:

| File | Changes |
|------|---------|
| `src/config.ts` | Add `MIN_POL_BALANCE`, `AUTO_SWAP_GAS` config |
| `.env.example` | Add gas management config |

**New file**: `src/connectors/gasManager.ts`

```typescript
// Pseudocode
class GasManager {
  async ensureGas(): Promise<boolean> {
    const balance = await this.getMaticBalance()
    if (balance >= cfg.MIN_POL_BALANCE) return true

    // Swap USDC.e → MATIC via QuickSwap
    return await this.swapUsdcToMatic()
  }

  async swapUsdcToMatic(): Promise<boolean> {
    // Use QuickSwap router to swap USDC.e → WMATIC → MATIC
    // Sign and send swap transaction with user's private key
  }
}
```

**Dependencies**: `viem` or `ethers` for web3 interactions.

---

### 2.3 Market Duration Selection (5m / 15m)

**Problem**: Original bot only supports 5m BTC markets.

**Solution**: Add `BTC_MARKET_DURATION` config (5 or 15).

**Files to modify**:

| File | Changes |
|------|---------|
| `src/config.ts` | Add `BTC_MARKET_DURATION: number` |
| `src/connectors/polymarket.ts` | Update market selection to filter by duration |
| `src/engine/features.ts` | Adjust Binance kline interval based on duration |

**Config changes**:

```typescript
// .env
BTC_MARKET_DURATION=5    // 5 or 15 minutes
```

**Logic**:

| Duration | Binance Kline | EMA Periods |
|----------|--------------|-------------|
| 5 min | 1m | fast=5, slow=13 |
| 15 min | 5m | fast=5, slow=13 (same periods, more data) |

---

### 2.4 MiniMax LLM Support

**Problem**: Original only supports OpenAI API.

**Solution**: Add `LLM_PROVIDER` config option.

**Files to modify**:

| File | Changes |
|------|---------|
| `src/config.ts` | Add `LLM_PROVIDER: 'openai' \| 'minimax'` |
| `src/engine/predictor.ts` | Use appropriate API base URL based on provider |

**Config changes**:

```typescript
// .env
LLM_PROVIDER=minimax
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=MiniMax-M2.7-highspeed
```

**Code changes**:

```typescript
// In predictor.ts
const baseUrl = cfg.LLM_PROVIDER === 'minimax'
  ? 'https://api.minimax.chat/v1'
  : cfg.OPENAI_BASE_URL

const model = cfg.LLM_PROVIDER === 'minimax'
  ? 'MiniMax-M2.7-highspeed'
  : cfg.OPENAI_MODEL
```

---

## 3. Implementation Order

### Phase 1: Foundation (Low Risk)
1. Fork and clone the repo
2. Add `BTC_MARKET_DURATION` config
3. Add `LLM_PROVIDER` for MiniMax
4. Test basic bot runs correctly

### Phase 2: Core Feature (Medium Risk)
5. Implement **Auto Redeem**
6. Test redemption flow
7. Verify closed positions get redeemed

### Phase 3: Infrastructure (Medium Risk)
8. Implement **Gas Management**
9. Test USDC.e → MATIC swap
10. Verify gas top-up works

### Phase 4: Polish (Low Risk)
11. Update Compare UI if needed
12. Update documentation
13. Final testing

---

## 4. New Dependencies

```json
{
  "dependencies": {
    // Existing
    "@polymarket/clob-client": "^0.x.x",
    "dotenv": "^16.x.x",
    "viem": "^2.x.x"  // For web3 / gas swap
  }
}
```

---

## 5. Security Considerations

| Item | Action |
|------|--------|
| Private key | Only stored in .env, never in code |
| RPC URL | Use reputable providers (Infura/Alchemy) |
| Gas swap | Only swap small amounts, keep MIN_USDC_BALANCE |
| Unlimited approval | Use limited approval amounts |

---

## 6. Testing Checklist

- [ ] Bot runs without errors
- [ ] Market selection works for 5m and 15m
- [ ] LLM bias works with MiniMax
- [ ] Position opens correctly
- [ ] Force close works near settlement
- [ ] Auto redeem triggers after settlement
- [ ] Gas swap works when POL is low
- [ ] Compare UI shows correct predictions

---

## 7. Time Estimate

| Phase | Task | Time |
|-------|-------|------|
| 1 | Fork, setup, basic config | 1-2 hours |
| 2 | Auto Redeem implementation | 2-3 hours |
| 3 | Gas Management implementation | 2-3 hours |
| 4 | MiniMax support + testing | 1-2 hours |
| **Total** | | **6-10 hours** |
