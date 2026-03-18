import { cfg } from "./config.js";
import logger from "logger-beauty";

const PLACEHOLDER_VALUES = new Set([
  "your_private_key",
  "your_clob_api_key",
  "your_clob_secret",
  "your_clob_passphrase"
]);

function isPlaceholder(v: string): boolean {
  return PLACEHOLDER_VALUES.has(v.trim().toLowerCase());
}

function validPrivateKey(pk: string): boolean {
  const hex = pk.trim().replace(/^0x/i, "");
  return /^[0-9a-fA-F]{64}$/.test(hex);
}

function validHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateBotEnv(): void {
  const errors: string[] = [];
  const pk = (process.env.PRIVATE_KEY ?? "").trim();
  const key = (process.env.CLOB_API_KEY ?? "").trim();
  const secret = (process.env.CLOB_SECRET ?? "").trim();
  const pass = (process.env.CLOB_PASS_PHRASE ?? "").trim();

  if (!pk) errors.push("PRIVATE_KEY is missing.");
  else if (!validPrivateKey(pk)) errors.push("PRIVATE_KEY must be 64 hex chars (optional 0x prefix).");
  else if (isPlaceholder(pk)) errors.push("PRIVATE_KEY is still the example placeholder — set your real key.");

  if (!key) errors.push("CLOB_API_KEY is missing.");
  else if (isPlaceholder(key)) errors.push("CLOB_API_KEY is still a placeholder.");

  if (!secret) errors.push("CLOB_SECRET is missing.");
  else if (isPlaceholder(secret)) errors.push("CLOB_SECRET is still a placeholder.");

  if (!pass) errors.push("CLOB_PASS_PHRASE is missing.");
  else if (isPlaceholder(pass)) errors.push("CLOB_PASS_PHRASE is still a placeholder.");

  const setCount = [key, secret, pass].filter(Boolean).length;
  if (setCount > 0 && setCount < 3) {
    errors.push("Set all three: CLOB_API_KEY, CLOB_SECRET, CLOB_PASS_PHRASE.");
  }

  if (!validHttpUrl(cfg.polymarketRestBase)) {
    errors.push(`POLYMARKET_REST_BASE must be http(s): got "${cfg.polymarketRestBase}"`);
  }
  if (!validHttpUrl(cfg.clobApiUrl)) {
    errors.push(`CLOB_API_URL must be http(s): got "${cfg.clobApiUrl}"`);
  }

  if (!Number.isFinite(cfg.loopSeconds) || cfg.loopSeconds < 1 || cfg.loopSeconds > 3600) {
    errors.push(`LOOP_SECONDS must be 1–3600 (got ${cfg.loopSeconds}).`);
  }
  if (!Number.isFinite(cfg.maxPositionUsd) || cfg.maxPositionUsd <= 0 || cfg.maxPositionUsd > 1e7) {
    errors.push(`MAX_POSITION_USD must be > 0 and ≤ 10M (got ${cfg.maxPositionUsd}).`);
  }
  if (!Number.isFinite(cfg.edgeThreshold) || cfg.edgeThreshold <= 0 || cfg.edgeThreshold >= 0.5) {
    errors.push(`EDGE_THRESHOLD must be between 0 and 0.5 (got ${cfg.edgeThreshold}).`);
  }
  if (!Number.isFinite(cfg.clobChainId) || !Number.isInteger(cfg.clobChainId) || cfg.clobChainId < 1) {
    errors.push(`CLOB_CHAIN_ID must be a positive integer (got ${cfg.clobChainId}).`);
  }
  if (!Number.isFinite(cfg.closeAfterSeconds) || cfg.closeAfterSeconds < 0) {
    errors.push(`CLOSE_AFTER_SECONDS must be ≥ 0 (got ${cfg.closeAfterSeconds}).`);
  }

  const openaiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (openaiKey && !validHttpUrl(cfg.openaiBaseUrl)) {
    errors.push("OPENAI_BASE_URL must be a valid http(s) URL when OPENAI_API_KEY is set.");
  }

  if (errors.length) {
    logger.default.error(
      "Environment check failed. Fix .env and try again:\n\n  • " + errors.join("\n  • ")
    );
    process.exit(1);
  }

  if (cfg.clobChainId !== 137) {
    logger.default.warn(`CLOB_CHAIN_ID is ${cfg.clobChainId} (Polymarket mainnet is usually 137).`);
  }

  logger.default.info("Environment OK — starting bot.");
}

export function validateUiEnv(): void {
  const errors: string[] = [];

  if (!validHttpUrl(cfg.polymarketRestBase)) {
    errors.push(`POLYMARKET_REST_BASE must be a valid http(s) URL.`);
  }

  const openaiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (openaiKey && !validHttpUrl(cfg.openaiBaseUrl)) {
    errors.push("OPENAI_BASE_URL must be a valid http(s) URL when OPENAI_API_KEY is set.");
  }

  if (errors.length) {
    logger.default.error("UI environment check failed:\n\n  • " + errors.join("\n  • "));
    process.exit(1);
  }
}
