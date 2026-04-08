import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// Token addresses on Polygon
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
const WMATIC_ADDRESS = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270" as const;

// QuickSwap Router v2
const QUICKSWAP_ROUTER = "0xa5E0829CaCEd8fdFD4Fe4D4c98F2593E90C94B2f" as const;

// ERC20 ABI for approve and balanceOf
const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "allowance",
    type: "function",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// QuickSwap Router ABI
const ROUTER_ABI = [
  {
    name: "swapExactTokensForTokens",
    type: "function",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ type: "uint256[]" }],
    stateMutability: "nonpayable",
  },
  {
    name: "WETH",
    type: "function",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const;

export interface GasBalance {
  maticBalance: bigint;
  maticBalanceFormatted: string;
  usdcBalance: bigint;
  usdcBalanceFormatted: string;
  sufficient: boolean;
}

export interface GasManagerConfig {
  privateKey: `0x${string}`;
  rpcUrl: string;
  minMaticBalance: bigint;   // in wei (18 decimals)
  swapAmountMatic: bigint;    // in wei (18 decimals)
  minUsdcBalance: bigint;     // in micro units (6 decimals)
}

let config: GasManagerConfig | null = null;
let walletAddress: `0x${string}` | null = null;

export function initGasManager(cfg: GasManagerConfig): void {
  config = cfg;
  const account = privateKeyToAccount(cfg.privateKey);
  walletAddress = account.address;
  console.log(`[GasManager] Initialized for wallet: ${walletAddress}`);
}

function getPublicClient() {
  if (!config) throw new Error("GasManager not initialized");
  return createPublicClient({
    chain: polygon,
    transport: http(config.rpcUrl),
  });
}

function getWalletClient() {
  if (!config) throw new Error("GasManager not initialized");
  return createWalletClient({
    account: privateKeyToAccount(config.privateKey),
    chain: polygon,
    transport: http(config.rpcUrl),
  });
}

/**
 * Check current MATIC and USDC balances.
 */
export async function checkBalance(): Promise<GasBalance> {
  if (!config || !walletAddress) {
    throw new Error("GasManager not initialized");
  }

  const publicClient = getPublicClient();

  // Get MATIC balance (native token)
  const maticBalance = await publicClient.getBalance({ address: walletAddress });

  // Get USDC balance
  const usdcBalance = (await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [walletAddress],
  })) as bigint;

  const sufficient = maticBalance >= config.minMaticBalance;

  return {
    maticBalance,
    maticBalanceFormatted: formatUnits(maticBalance, 18),
    usdcBalance,
    usdcBalanceFormatted: formatUnits(usdcBalance, 6),
    sufficient,
  };
}

/**
 * Ensure there is enough MATIC for gas. Swap if needed.
 * Returns true if sufficient gas is available.
 */
export async function ensureGas(): Promise<boolean> {
  if (!config) throw new Error("GasManager not initialized");

  const balance = await checkBalance();

  if (balance.sufficient) {
    console.log(`[GasManager] MATIC balance sufficient: ${balance.maticBalanceFormatted}`);
    return true;
  }

  console.log(`[GasManager] MATIC balance low: ${balance.maticBalanceFormatted} (min: ${formatUnits(config.minMaticBalance, 18)})`);
  console.log(`[GasManager] USDC balance: ${balance.usdcBalanceFormatted}`);

  // Check if we have enough USDC to swap
  if (balance.usdcBalance < config.minUsdcBalance) {
    console.error(`[GasManager] USDC balance too low to swap: ${balance.usdcBalanceFormatted}`);
    return false;
  }

  // Perform the swap
  return await swapUsdcToMatic();
}

/**
 * Swap USDC.e to WMATIC (which can be used as MATIC for gas).
 */
async function swapUsdcToMatic(): Promise<boolean> {
  if (!config || !walletAddress) throw new Error("GasManager not initialized");

  console.log(`[GasManager] Swapping USDC.e to WMATIC...`);

  const publicClient = getPublicClient();
  const walletClient = getWalletClient();

  try {
    // Check current allowance
    const currentAllowance = (await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [walletAddress, QUICKSWAP_ROUTER],
    })) as bigint;

    // Amount of USDC to swap (leave minUsdcBalance in wallet)
    const usdcBalance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [walletAddress],
    }) as bigint;

    const swapAmount = usdcBalance - parseUnits(`${config.minUsdcBalance}`, 6);

    if (swapAmount <= 0n) {
      console.error(`[GasManager] Not enough USDC to swap`);
      return false;
    }

    console.log(`[GasManager] Swap amount: ${formatUnits(swapAmount, 6)} USDC`);

    // Approve QuickSwap router if needed
    if (currentAllowance < swapAmount) {
      console.log(`[GasManager] Approving QuickSwap router...`);
      const approveHash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [QUICKSWAP_ROUTER, swapAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      console.log(`[GasManager] Approval confirmed`);
    }

    // Get expected output amount (for slippage calculation)
    const wmaticOut = (await publicClient.readContract({
      address: QUICKSWAP_ROUTER,
      abi: ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [swapAmount, [USDC_ADDRESS, WMATIC_ADDRESS]],
    })) as bigint[];

    // Add 3% slippage tolerance
    const amountOutMin = (wmaticOut[1] * 97n) / 100n;

    // Build swap transaction
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes

    console.log(`[GasManager] Expected WMATIC out: ${formatUnits(wmaticOut[1], 18)}`);
    console.log(`[GasManager] Min acceptable: ${formatUnits(amountOutMin, 18)} (3% slippage)`);

    // Execute swap
    const hash = await walletClient.writeContract({
      address: QUICKSWAP_ROUTER,
      abi: ROUTER_ABI,
      functionName: "swapExactTokensForTokens",
      args: [swapAmount, amountOutMin, [USDC_ADDRESS, WMATIC_ADDRESS], walletAddress, deadline],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === "success") {
      console.log(`[GasManager] ✅ Swap successful! Tx: ${hash}`);
      return true;
    } else {
      console.error(`[GasManager] ❌ Swap failed (tx reverted)`);
      return false;
    }
  } catch (e) {
    console.error(`[GasManager] Swap error: ${e}`);
    return false;
  }
}

/**
 * Get wallet address.
 */
export function getWalletAddress(): `0x${string}` | null {
  return walletAddress;
}
