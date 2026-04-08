import fs from "node:fs";
import path from "node:path";
import type { LivePosition, Condition } from "../types/index.js";

export type PositionStatus = "open" | "closed" | "redeemed";

export interface Position {
  conditionId: string;
  side: "YES" | "NO";
  entryPrice: number;
  amount: number;
  orderID: string;
  openedAt: number; // Unix timestamp ms
  closedAt?: number;
  closeReason?: string;
  status: PositionStatus;
  redeemResult?: Record<string, unknown>;
}

const POSITIONS_FILE = "open-positions.json";

let positions: Map<string, Position> = new Map();
let closedPositions: Position[] = [];

export function loadPositions(): void {
  try {
    if (fs.existsSync(POSITIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf-8"));
      positions = new Map(Object.entries(data.open || {}));
      closedPositions = data.closed || [];
      log(`Loaded ${positions.size} open positions, ${closedPositions.length} closed`);
    }
  } catch (e) {
    log(`Failed to load positions: ${e}`);
  }
}

function save(): void {
  try {
    const open: Record<string, Position> = Object.fromEntries(positions);
    fs.writeFileSync(
      POSITIONS_FILE,
      JSON.stringify({ open, closed: closedPositions }, null, 2)
    );
  } catch (e) {
    log(`Failed to save positions: ${e}`);
  }
}

export function hasPosition(conditionId: string): boolean {
  return positions.has(conditionId);
}

export function getPosition(conditionId: string): Position | undefined {
  return positions.get(conditionId);
}

export function addPosition(
  conditionId: string,
  side: "YES" | "NO",
  entryPrice: number,
  amount: number,
  orderID: string
): void {
  positions.set(conditionId, {
    conditionId,
    side,
    entryPrice,
    amount,
    orderID,
    openedAt: Date.now(),
    status: "open",
  });
  save();
  log(`Position added: ${conditionId} ${side} @ ${entryPrice}`);
}

export function removePosition(conditionId: string, reason: string = "unknown"): Position | undefined {
  const position = positions.get(conditionId);
  if (!position) return undefined;

  position.closedAt = Date.now();
  position.closeReason = reason;
  position.status = "closed";
  positions.delete(conditionId);
  closedPositions.push(position);
  save();
  log(`Position closed: ${conditionId} (${reason})`);
  return position;
}

export function getOpenConditionIds(): string[] {
  return Array.from(positions.keys());
}

// ===== NEW: Closed Position Management for Auto Redeem =====

/**
 * Get all closed positions that haven't been redeemed yet.
 */
export function getClosedPositions(): Position[] {
  return closedPositions.filter((p) => p.status === "closed");
}

/**
 * Mark a position as redeemed.
 */
export function markRedeemed(conditionId: string, result?: Record<string, unknown>): void {
  const idx = closedPositions.findIndex((p) => p.conditionId === conditionId);
  if (idx !== -1) {
    closedPositions[idx].status = "redeemed";
    closedPositions[idx].redeemResult = result;
    save();
    log(`Position redeemed: ${conditionId}`);
  }
}

/**
 * Get all redeemed positions (history).
 */
export function getRedeemedPositions(): Position[] {
  return closedPositions.filter((p) => p.status === "redeemed");
}

/**
 * Clean up old closed positions (optional maintenance).
 */
export function cleanupOldClosed(keepCount: number = 100): void {
  const toKeep = closedPositions.slice(-keepCount);
  if (toKeep.length < closedPositions.length) {
    closedPositions = toKeep;
    save();
    log(`Cleaned up closed positions, kept ${keepCount}`);
  }
}

function log(msg: string): void {
  console.log(`[PositionStore] ${msg}`);
}
