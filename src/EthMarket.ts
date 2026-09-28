import { BigNumber } from "ethers";

export interface TokenBalances {
  [tokenAddress: string]: BigNumber;
}

export interface MultipleCallData {
  targets: Array<string>;
  data: Array<string>;
}

export abstract class EthMarket {
  constructor(
    readonly marketAddress: string,
    readonly tokens: Array<string>,
    readonly protocol: string,
  ) {}

  abstract getTokensOut(tokenIn: string, tokenOut: string, amountIn: BigNumber): BigNumber;

  abstract getTokensIn(tokenIn: string, tokenOut: string, amountOut: BigNumber): BigNumber;

  abstract sellTokensToNextMarket(tokenIn: string, amountIn: BigNumber, ethMarket: EthMarket): Promise<MultipleCallData>;

  abstract sellTokens(tokenIn: string, amountIn: BigNumber, recipient: string): Promise<string>;
}
