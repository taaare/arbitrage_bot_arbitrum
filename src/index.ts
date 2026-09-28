import "dotenv/config";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { Contract, providers, Wallet } from "ethers";
import { get } from "https";
import { BUNDLE_EXECUTOR_ABI } from "./abi";
import { V2_FACTORY_ADDRESSES, V3_FACTORY_ADDRESSES } from "./addresses";
import { Arbitrage } from "./Arbitrage";
import { UniswappyV2EthPair } from "./UniswappyV2EthPair";
import { getDefaultRelaySigningKey } from "./utils";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.warn(`Must provide ${name} environment variable. Please see README.md`);
    process.exit(1);
  }
  return value;
}

const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL || "https://arb1.arbitrum.io/rpc";
const PRIVATE_KEY = requireEnv("PRIVATE_KEY");
const BUNDLE_EXECUTOR_ADDRESS = requireEnv("BUNDLE_EXECUTOR_ADDRESS");
const FLASHBOTS_RELAY_SIGNING_KEY = process.env.FLASHBOTS_RELAY_SIGNING_KEY || getDefaultRelaySigningKey();
const MINER_REWARD_PERCENTAGE = parseInt(process.env.MINER_REWARD_PERCENTAGE || "80");
const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL || "";

const provider = new providers.StaticJsonRpcProvider(ETHEREUM_RPC_URL);

const arbitrageSigningWallet = new Wallet(PRIVATE_KEY);
const flashbotsRelaySigningWallet = new Wallet(FLASHBOTS_RELAY_SIGNING_KEY);

function healthcheck() {
  if (HEALTHCHECK_URL === "") {
    return;
  }
  get(HEALTHCHECK_URL).on("error", console.error);
}

async function main() {
  console.log("Searcher Wallet Address: " + arbitrageSigningWallet.address);
  console.log("Flashbots Relay Signing Wallet Address: " + flashbotsRelaySigningWallet.address);
  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, flashbotsRelaySigningWallet);
  const arbitrage = new Arbitrage(
    arbitrageSigningWallet,
    flashbotsProvider,
    new Contract(BUNDLE_EXECUTOR_ADDRESS, BUNDLE_EXECUTOR_ABI, provider),
  );

  const markets = await UniswappyV2EthPair.getUniswapMarketsByToken(provider, V2_FACTORY_ADDRESSES, V3_FACTORY_ADDRESSES);
  provider.on("block", async (blockNumber) => {
    await UniswappyV2EthPair.updateReserves(provider, markets.allMarketPairs);
    const bestCrossedMarkets = await arbitrage.evaluateMarkets(markets.marketsByToken);
    if (bestCrossedMarkets.length === 0) {
      console.log("No crossed markets");
      return;
    }
    bestCrossedMarkets.forEach(Arbitrage.printCrossedMarket);
    arbitrage.takeCrossedMarkets(bestCrossedMarkets, blockNumber, MINER_REWARD_PERCENTAGE).then(healthcheck).catch(console.error);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
