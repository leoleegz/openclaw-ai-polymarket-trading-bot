import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import type { ApiKeyCreds } from "@polymarket/clob-client";
import { cfg } from "../config.js";

let _publicClient: ClobClient | null = null;
let _client: ClobClient | null = null;
let _clientInit: Promise<ClobClient> | null = null;

function getPublicClient(): ClobClient {
  if (!_publicClient) {
    _publicClient = new ClobClient(cfg.clobApiUrl, cfg.clobChainId);
  }
  return _publicClient;
}

function hasManualClobCreds(): boolean {
  const k = (cfg.clobApiKey ?? "").trim();
  const s = (cfg.clobSecret ?? "").trim();
  const p = (cfg.clobPassphrase ?? "").trim();
  return Boolean(k && s && p);
}

async function getClient(): Promise<ClobClient> {
  if (_client) return _client;
  if (_clientInit) return _clientInit;

  _clientInit = (async () => {
    if (!cfg.privateKey?.trim()) {
      throw new Error("Live trading needs PRIVATE_KEY in .env");
    }
    const signer = new Wallet(cfg.privateKey.trim());

    let creds: ApiKeyCreds;
    if (hasManualClobCreds()) {
      creds = {
        key: cfg.clobApiKey!.trim(),
        secret: cfg.clobSecret!.trim(),
        passphrase: cfg.clobPassphrase!.trim()
      };
    } else {
      const l1 = new ClobClient(cfg.clobApiUrl, cfg.clobChainId, signer);
      creds = await l1.createOrDeriveApiKey();
    }

    _client = new ClobClient(cfg.clobApiUrl, cfg.clobChainId, signer, creds);
    return _client;
  })();

  try {
    return await _clientInit;
  } catch (e) {
    _clientInit = null;
    throw e;
  }
}

export type TokenIds = { yesTokenId: string; noTokenId: string };

export async function getTokenIdsForCondition(conditionId: string): Promise<TokenIds | null> {
  try {
    const client = getPublicClient();
    const market = await client.getMarket(conditionId);
    const tokens = (market as { tokens?: Array<{ outcome: string; token_id: string }> }).tokens;
    if (!tokens || tokens.length < 2) return null;
    const yesToken = tokens.find((t) => /yes|up/i.test(t.outcome ?? ""));
    const noToken = tokens.find((t) => /no|down/i.test(t.outcome ?? ""));
    if (!yesToken || !noToken) return null;
    return { yesTokenId: yesToken.token_id, noTokenId: noToken.token_id };
  } catch {
    return null;
  }
}

export type PlaceOrderParams = {
  tokenId: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  orderType?: "GTC" | "FOK" | "FAK";
};

export type PlaceOrderResult = {
  success: boolean;
  orderID?: string;
  status?: string;
  errorMsg?: string;
};

export async function placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
  const client = await getClient();
  const { tokenId, side, size, price, orderType = "GTC" } = params;
  const sideEnum = side === "BUY" ? Side.BUY : Side.SELL;

  try {
    if (orderType === "GTC") {
      const res = await client.createAndPostOrder(
        { tokenID: tokenId, price, size, side: sideEnum },
        undefined,
        OrderType.GTC
      );
      return {
        success: res.success ?? true,
        orderID: res.orderID,
        status: res.status
      };
    }
    const marketType = orderType === "FAK" ? OrderType.FAK : OrderType.FOK;
    const marketOrder = await client.createAndPostMarketOrder(
      {
        tokenID: tokenId,
        side: sideEnum,
        amount: size,
        price
      },
      undefined,
      marketType
    );
    return {
      success: marketOrder.success ?? true,
      orderID: marketOrder.orderID,
      status: marketOrder.status
    };
  } catch (e: unknown) {
    const err = e as Error;
    return {
      success: false,
      errorMsg: err.message ?? String(e)
    };
  }
}

export async function buy(
  tokenId: string,
  amountUsd: number,
  priceLimit: number
): Promise<PlaceOrderResult> {
  return placeOrder({
    tokenId,
    side: "BUY",
    size: amountUsd,
    price: priceLimit,
    orderType: "FOK"
  });
}

export async function sell(
  tokenId: string,
  sizeShares: number,
  priceLimit: number
): Promise<PlaceOrderResult> {
  return placeOrder({
    tokenId,
    side: "SELL",
    size: sizeShares,
    price: priceLimit,
    orderType: "FOK"
  });
}

// ===== Auto Redeem =====

export async function redeemPosition(
  conditionId: string,
  orderID: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    const client = await getClient();
    console.log(`[OrderExecution] Redeeming position: condition=${conditionId} order=${orderID}`);

    // Call Polymarket CLOB redeem function
    const result = await client.redeemPositions({
      conditionId,
      orderId: orderID,
    });

    console.log(`[OrderExecution] Redeem successful: ${JSON.stringify(result)}`);
    return { success: true, result };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[OrderExecution] Redeem failed: ${error}`);
    return { success: false, error };
  }
}
