import { BigNumber, Contract, Wallet } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { WETH_ADDRESS } from "./addresses";
import { EthMarket } from "./EthMarket";
import { ETHER, bigNumberToDecimal } from "./utils";

export interface CrossedMarketDetails {
  profit: BigNumber;
  volume: BigNumber;
  tokenAddress: string;
  buyFromMarket: EthMarket;
  sellToMarket: EthMarket;
}

export type MarketsByToken = { [tokenAddress: string]: Array<EthMarket> };

// TODO: implement binary search (assuming linear/exponential global maximum profitability)
const TEST_VOLUMES = [
  ETHER.div(100),
  ETHER.div(10),
  ETHER.div(6),
  ETHER.div(4),
  ETHER.div(2),
  ETHER.div(1),
  ETHER.mul(2),
  ETHER.mul(5),
  ETHER.mul(10),
];

// WETH amount used to quote each market's price
const PRICE_QUOTE_VOLUME = ETHER.div(100);
const MIN_PROFIT = ETHER.div(1000);
const MAX_GAS_ESTIMATE = 1400000;

function getProfit(buyFromMarket: EthMarket, sellToMarket: EthMarket, tokenAddress: string, volume: BigNumber): BigNumber {
  const tokensOut = buyFromMarket.getTokensOut(WETH_ADDRESS, tokenAddress, volume);
  const proceeds = sellToMarket.getTokensOut(tokenAddress, WETH_ADDRESS, tokensOut);
  return proceeds.sub(volume);
}

export function getBestCrossedMarket(crossedMarkets: Array<EthMarket>[], tokenAddress: string): CrossedMarketDetails | undefined {
  let bestCrossedMarket: CrossedMarketDetails | undefined = undefined;
  for (const [sellToMarket, buyFromMarket] of crossedMarkets) {
    for (const size of TEST_VOLUMES) {
      const profit = getProfit(buyFromMarket, sellToMarket, tokenAddress, size);
      if (bestCrossedMarket !== undefined && profit.lt(bestCrossedMarket.profit)) {
        // If the next size up lost value, meet halfway. TODO: replace with real binary search
        const trySize = size.add(bestCrossedMarket.volume).div(2);
        const tryProfit = getProfit(buyFromMarket, sellToMarket, tokenAddress, trySize);
        if (tryProfit.gt(bestCrossedMarket.profit)) {
          bestCrossedMarket = { volume: trySize, profit: tryProfit, tokenAddress, sellToMarket, buyFromMarket };
        }
        break;
      }
      bestCrossedMarket = { volume: size, profit, tokenAddress, sellToMarket, buyFromMarket };
    }
  }
  return bestCrossedMarket;
}

export class Arbitrage {
  constructor(
    private readonly executorWallet: Wallet,
    private readonly flashbotsProvider: FlashbotsBundleProvider,
    private readonly bundleExecutorContract: Contract,
  ) {}

  static printCrossedMarket(crossedMarket: CrossedMarketDetails): void {
    const buyTokens = crossedMarket.buyFromMarket.tokens;
    const sellTokens = crossedMarket.sellToMarket.tokens;
    console.log(
      `Profit: ${bigNumberToDecimal(crossedMarket.profit)} Volume: ${bigNumberToDecimal(crossedMarket.volume)}\n` +
      `${crossedMarket.buyFromMarket.protocol} (${crossedMarket.buyFromMarket.marketAddress})\n` +
      `  ${buyTokens[0]} => ${buyTokens[1]}\n` +
      `${crossedMarket.sellToMarket.protocol} (${crossedMarket.sellToMarket.marketAddress})\n` +
      `  ${sellTokens[0]} => ${sellTokens[1]}\n` +
      `\n`
    );
  }

  async evaluateMarkets(marketsByToken: MarketsByToken): Promise<Array<CrossedMarketDetails>> {
    const bestCrossedMarkets = new Array<CrossedMarketDetails>();

    for (const [tokenAddress, markets] of Object.entries(marketsByToken)) {
      const pricedMarkets = markets.map(ethMarket => ({
        ethMarket,
        buyTokenPrice: ethMarket.getTokensIn(tokenAddress, WETH_ADDRESS, PRICE_QUOTE_VOLUME),
        sellTokenPrice: ethMarket.getTokensOut(WETH_ADDRESS, tokenAddress, PRICE_QUOTE_VOLUME),
      }));

      const crossedMarkets = new Array<Array<EthMarket>>();
      for (const pricedMarket of pricedMarkets) {
        for (const pm of pricedMarkets) {
          if (pm.sellTokenPrice.gt(pricedMarket.buyTokenPrice)) {
            crossedMarkets.push([pricedMarket.ethMarket, pm.ethMarket]);
          }
        }
      }

      const bestCrossedMarket = getBestCrossedMarket(crossedMarkets, tokenAddress);
      if (bestCrossedMarket !== undefined && bestCrossedMarket.profit.gt(MIN_PROFIT)) {
        bestCrossedMarkets.push(bestCrossedMarket);
      }
    }
    bestCrossedMarkets.sort((a, b) => a.profit.lt(b.profit) ? 1 : a.profit.gt(b.profit) ? -1 : 0);
    return bestCrossedMarkets;
  }

  // TODO: take more than 1
  async takeCrossedMarkets(bestCrossedMarkets: CrossedMarketDetails[], blockNumber: number, minerRewardPercentage: number): Promise<void> {
    for (const bestCrossedMarket of bestCrossedMarkets) {
      const { buyFromMarket, sellToMarket, tokenAddress, volume, profit } = bestCrossedMarket;
      console.log("Send this much WETH", volume.toString(), "get this much profit", profit.toString());
      const buyCalls = await buyFromMarket.sellTokensToNextMarket(WETH_ADDRESS, volume, sellToMarket);
      const intermediateAmount = buyFromMarket.getTokensOut(WETH_ADDRESS, tokenAddress, volume);
      const sellCallData = await sellToMarket.sellTokens(tokenAddress, intermediateAmount, this.bundleExecutorContract.address);

      const targets: Array<string> = [...buyCalls.targets, sellToMarket.marketAddress];
      const payloads: Array<string> = [...buyCalls.data, sellCallData];
      console.log({ targets, payloads });
      const minerReward = profit.mul(minerRewardPercentage).div(100);
      const transaction = await this.bundleExecutorContract.populateTransaction.uniswapWeth(volume, minerReward, targets, payloads, {
        gasPrice: BigNumber.from(1),
        gasLimit: BigNumber.from(1000000),
      });

      try {
        const estimateGas = await this.bundleExecutorContract.provider.estimateGas({
          ...transaction,
          from: this.executorWallet.address,
        });
        if (estimateGas.gt(MAX_GAS_ESTIMATE)) {
          console.log("EstimateGas succeeded, but suspiciously large: " + estimateGas.toString());
          continue;
        }
        transaction.gasLimit = estimateGas.mul(2);
      } catch (e) {
        console.warn(`Estimate gas failure for ${JSON.stringify(bestCrossedMarket)}`);
        continue;
      }
      const bundledTransactions = [
        {
          signer: this.executorWallet,
          transaction,
        },
      ];
      console.log(bundledTransactions);
      const signedBundle = await this.flashbotsProvider.signBundle(bundledTransactions);
      const simulation = await this.flashbotsProvider.simulate(signedBundle, blockNumber + 1);
      if ("error" in simulation || simulation.firstRevert !== undefined) {
        console.log(`Simulation Error on token ${tokenAddress}, skipping`);
        continue;
      }
      console.log(`Submitting bundle, profit sent to miner: ${bigNumberToDecimal(simulation.coinbaseDiff)}, effective gas price: ${bigNumberToDecimal(simulation.coinbaseDiff.div(simulation.totalGasUsed), 9)} GWEI`);
      await Promise.all([blockNumber + 1, blockNumber + 2].map(targetBlockNumber =>
        this.flashbotsProvider.sendRawBundle(signedBundle, targetBlockNumber)
      ));
      return;
    }
    throw new Error("No arbitrage submitted to relay");
  }
}
