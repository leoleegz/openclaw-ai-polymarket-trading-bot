import { cfg } from "../config.js";
import { getClosedPositions, markRedeemed } from "./positionStore.js";
import { redeemPosition, getClient } from "../connectors/orderExecution.js";

const REDEEM_INTERVAL_MS = cfg.redeemCheckInterval * 1000;

let running = false;
let intervalId: NodeJS.Timeout | null = null;

/**
 * Start the RedeemManager background loop.
 */
export function startRedeemManager(): void {
  if (running) {
    console.log("[RedeemManager] Already running");
    return;
  }

  running = true;
  console.log(`[RedeemManager] Started (interval: ${cfg.redeemCheckInterval}s)`);

  // Run immediately once, then on interval
  runRedeemLoop();
  intervalId = setInterval(runRedeemLoop, REDEEM_INTERVAL_MS);
}

/**
 * Stop the RedeemManager background loop.
 */
export function stopRedeemManager(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  running = false;
  console.log("[RedeemManager] Stopped");
}

/**
 * Main redeem loop: check all closed positions and redeem winners.
 */
async function runRedeemLoop(): Promise<void> {
  if (!running) return;

  try {
    const closedPositions = getClosedPositions();

    if (closedPositions.length === 0) {
      return;
    }

    console.log(`[RedeemManager] Checking ${closedPositions.length} closed positions...`);

    for (const position of closedPositions) {
      await processPosition(position);
    }
  } catch (e) {
    console.error(`[RedeemManager] Error in redeem loop: ${e}`);
  }
}

/**
 * Process a single closed position for redemption.
 */
async function processPosition(position: ReturnType<typeof getClosedPositions>[0]): Promise<void> {
  try {
    // Get market info to check if resolved
    const client = await getClient();
    const market = await client.getMarket(position.conditionId);

    if (!market) {
      console.log(`[RedeemManager] Market not found: ${position.conditionId}`);
      return;
    }

    // Check if market is resolved
    if (!isMarketResolved(market)) {
      console.log(`[RedeemManager] Market not yet resolved: ${position.conditionId}`);
      return;
    }

    // Determine outcome
    const yesPrice = parseFloat(String(market.yesPrice || 0));
    const outcome = yesPrice >= 0.5 ? "YES" : "NO";

    console.log(`[RedeemManager] Market ${position.conditionId} resolved: ${outcome} (yesPrice=${yesPrice})`);

    // Check if our position won
    if (position.side !== outcome) {
      console.log(`[RedeemManager] Position lost: ${position.side} vs ${outcome}`);
      // Mark as closed but not redeemed (it was a losing position)
      return;
    }

    console.log(`[RedeemManager] Position WON: ${position.side}! Redeeming...`);

    // Redeem the winning position
    const result = await redeemPosition(position.conditionId, position.orderID);

    if (result.success) {
      markRedeemed(position.conditionId, result.result as Record<string, unknown>);
      console.log(`[RedeemManager] ✅ Redeemed: ${position.conditionId}`);
    } else {
      console.error(`[RedeemManager] ❌ Redeem failed: ${result.error}`);
    }
  } catch (e) {
    console.error(`[RedeemManager] Error processing position ${position.conditionId}: ${e}`);
  }
}

/**
 * Check if a market has been resolved.
 */
function isMarketResolved(market: Record<string, unknown>): boolean {
  // Market is resolved if:
  // 1. resolved flag is true
  // 2. Or end_date has passed AND prices have converged (yesPrice close to 0 or 1)
  if (market.resolved === true) {
    return true;
  }

  // Check if end date has passed
  const endDate = market.endDate as string | undefined;
  if (endDate) {
    const endTime = new Date(endDate).getTime();
    const now = Date.now();
    if (now > endTime) {
      // End date has passed, check if price has converged
      const yesPrice = parseFloat(String(market.yesPrice || 0));
      // Consider resolved if price is very close to 0 or 1
      if (yesPrice < 0.01 || yesPrice > 0.99) {
        return true;
      }
    }
  }

  return false;
}
