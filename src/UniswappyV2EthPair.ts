import * as _ from "lodash";
import { BigNumber, constants, Contract, providers, utils } from "ethers";
import { UNISWAP_PAIR_ABI, UNISWAP_QUERY_ABI } from "./abi";
import { UNISWAP_LOOKUP_CONTRACT_ADDRESS, V3_TOKENS, WETH_ADDRESS } from "./addresses";
import { EthMarket, MultipleCallData, TokenBalances } from "./EthMarket";
import { ETHER } from "./utils";
import { MarketsByToken } from "./Arbitrage";

// batch count limit helpful for testing, loading entire set of uniswap markets takes a long time to load
const BATCH_COUNT_LIMIT = 100;
const UNISWAP_BATCH_SIZE = 1000;

// Markets must hold more WETH than this to be evaluated
const MIN_WETH_RESERVE = ETHER;

// Not necessary, slightly speeds up loading initialization when we know tokens are bad
// Estimate gas will ensure we aren't submitting bad bundles, but bad tokens waste time
const BLACKLISTED_TOKENS = [
  "0xD75EA151a61d06868E31F8988D28DFE5E9df57B4",
];

const pairInterface = new utils.Interface(UNISWAP_PAIR_ABI);

interface GroupedMarkets {
  marketsByToken: MarketsByToken;
  allMarketPairs: Array<UniswappyV2EthPair>;
}

function getLookupContract(provider: providers.JsonRpcProvider): Contract {
  return new Contract(UNISWAP_LOOKUP_CONTRACT_ADDRESS, UNISWAP_QUERY_ABI, provider);
}

// The non-WETH side of a WETH pair
function getPairedToken(pair: EthMarket): string {
  return pair.tokens[0] === WETH_ADDRESS ? pair.tokens[1] : pair.tokens[0];
}

// Pools order token0/token1 by address; reserves are returned in that order
function sortTokens(tokenA: string, tokenB: string): Array<string> {
  return tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
}

export class UniswappyV2EthPair extends EthMarket {
  private _tokenBalances: TokenBalances;

  constructor(marketAddress: string, tokens: Array<string>, protocol: string) {
    super(marketAddress, tokens, protocol);
    this._tokenBalances = _.zipObject(tokens, [BigNumber.from(0), BigNumber.from(0)]);
  }

  static async getUniswappyMarkets(provider: providers.JsonRpcProvider, factoryAddress: string): Promise<Array<UniswappyV2EthPair>> {
    const uniswapQuery = getLookupContract(provider);

    const marketPairs = new Array<UniswappyV2EthPair>();
    for (let start = 0; start < BATCH_COUNT_LIMIT * UNISWAP_BATCH_SIZE; start += UNISWAP_BATCH_SIZE) {
      const pairs: Array<Array<string>> = (await uniswapQuery.functions.getPairsByIndexRange(factoryAddress, start, start + UNISWAP_BATCH_SIZE))[0];
      for (const [token0, token1, marketAddress] of pairs) {
        let tokenAddress: string;
        if (token0 === WETH_ADDRESS) {
          tokenAddress = token1;
        } else if (token1 === WETH_ADDRESS) {
          tokenAddress = token0;
        } else {
          continue;
        }
        if (!BLACKLISTED_TOKENS.includes(tokenAddress)) {
          marketPairs.push(new UniswappyV2EthPair(marketAddress, [token0, token1], ""));
        }
      }
      if (pairs.length < UNISWAP_BATCH_SIZE) {
        break;
      }
    }
    return marketPairs;
  }

  static async getUniswapV3Pools(provider: providers.JsonRpcProvider, factoryAddress: string): Promise<Array<UniswappyV2EthPair>> {
    const uniswapQuery = getLookupContract(provider);

    const marketPairs = new Array<UniswappyV2EthPair>();
    for (const tokenAddress of Object.values(V3_TOKENS)) {
      const [poolAddress] = await uniswapQuery.functions.getPairsByPool(factoryAddress, tokenAddress, WETH_ADDRESS);
      if (poolAddress !== constants.AddressZero) {
        marketPairs.push(new UniswappyV2EthPair(poolAddress, sortTokens(tokenAddress, WETH_ADDRESS), ""));
      }
    }
    return marketPairs;
  }

  static async getUniswapMarketsByToken(provider: providers.JsonRpcProvider, v2FactoryAddresses: Array<string>, v3FactoryAddresses: Array<string>): Promise<GroupedMarkets> {
    const allPairs = _.flatten(await Promise.all([
      ...v2FactoryAddresses.map(factoryAddress => UniswappyV2EthPair.getUniswappyMarkets(provider, factoryAddress)),
      ...v3FactoryAddresses.map(factoryAddress => UniswappyV2EthPair.getUniswapV3Pools(provider, factoryAddress)),
    ]));

    // A token needs at least two markets to be arbitraged
    const allMarketPairs = _.flatten(
      _.values(_.groupBy(allPairs, getPairedToken)).filter(markets => markets.length > 1)
    );

    await UniswappyV2EthPair.updateReserves(provider, allMarketPairs);

    const marketsByToken = _.groupBy(
      allMarketPairs.filter(pair => pair.getBalance(WETH_ADDRESS).gt(MIN_WETH_RESERVE)),
      getPairedToken
    );

    return {
      marketsByToken,
      allMarketPairs,
    };
  }

  static async updateReserves(provider: providers.JsonRpcProvider, allMarketPairs: Array<UniswappyV2EthPair>): Promise<void> {
    const uniswapQuery = getLookupContract(provider);
    const pairAddresses = allMarketPairs.map(marketPair => marketPair.marketAddress);
    console.log("Updating markets, count:", pairAddresses.length);
    const reserves: Array<Array<BigNumber>> = (await uniswapQuery.functions.getReservesByPairs(pairAddresses))[0];
    allMarketPairs.forEach((marketPair, i) => {
      marketPair.setReservesViaOrderedBalances([reserves[i][0], reserves[i][1]]);
    });
  }

  getBalance(tokenAddress: string): BigNumber {
    const balance = this._tokenBalances[tokenAddress];
    if (balance === undefined) throw new Error("bad token");
    return balance;
  }

  setReservesViaOrderedBalances(balances: Array<BigNumber>): void {
    this._tokenBalances = _.zipObject(this.tokens, balances);
  }

  getTokensIn(tokenIn: string, tokenOut: string, amountOut: BigNumber): BigNumber {
    const reserveIn = this._tokenBalances[tokenIn];
    const reserveOut = this._tokenBalances[tokenOut];
    return this.getAmountIn(reserveIn, reserveOut, amountOut);
  }

  getTokensOut(tokenIn: string, tokenOut: string, amountIn: BigNumber): BigNumber {
    const reserveIn = this._tokenBalances[tokenIn];
    const reserveOut = this._tokenBalances[tokenOut];
    return this.getAmountOut(reserveIn, reserveOut, amountIn);
  }

  getAmountIn(reserveIn: BigNumber, reserveOut: BigNumber, amountOut: BigNumber): BigNumber {
    const numerator: BigNumber = reserveIn.mul(amountOut).mul(1000);
    const denominator: BigNumber = reserveOut.sub(amountOut).mul(997);
    return numerator.div(denominator).add(1);
  }

  getAmountOut(reserveIn: BigNumber, reserveOut: BigNumber, amountIn: BigNumber): BigNumber {
    const amountInWithFee: BigNumber = amountIn.mul(997);
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(1000).add(amountInWithFee);
    return numerator.div(denominator);
  }

  async sellTokensToNextMarket(tokenIn: string, amountIn: BigNumber, ethMarket: EthMarket): Promise<MultipleCallData> {
    const exchangeCall = await this.sellTokens(tokenIn, amountIn, ethMarket.marketAddress);
    return {
      data: [exchangeCall],
      targets: [this.marketAddress],
    };
  }

  async sellTokens(tokenIn: string, amountIn: BigNumber, recipient: string): Promise<string> {
    // function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data)
    let amount0Out = BigNumber.from(0);
    let amount1Out = BigNumber.from(0);
    if (tokenIn === this.tokens[0]) {
      amount1Out = this.getTokensOut(tokenIn, this.tokens[1], amountIn);
    } else if (tokenIn === this.tokens[1]) {
      amount0Out = this.getTokensOut(tokenIn, this.tokens[0], amountIn);
    } else {
      throw new Error("Bad token input address");
    }
    return pairInterface.encodeFunctionData("swap", [amount0Out, amount1Out, recipient, []]);
  }
}
