simple-arbitrage-arbitrum
================
This repository contains a simple, mechanical system for discovering, evaluating, rating, and submitting arbitrage opportunities to the Flashbots bundle endpoint. This script is very unlikely to be profitable, as many users have access to it, and it is targeting well-known Ethereum opportunities.

I modified the simple-arbitrage repository in order to allow for its use on Arbitrum when the network was in its early stages. Due to the simple nature of the arbitrage method, this bot generates very little revenue. However, this could be used as a basis for a more complex arbitrage bot. Given deeper analysis of decentralized exchange markets & while using more fleshed-out risk models, optimal arbitrage pathing, and multi-dex routing, it can be made more profitable. See https://arxiv.org/pdf/1911.03380

Yes, I know the private key to the wallet is *somewhere* in this repo. <3 github repo scrapers

How it works
============
- `src/UniswappyV2EthPair.ts` loads every WETH pair from the SushiSwap factory, plus the Uniswap V3 WETH pools of the tokens listed in `src/addresses.ts`, using the `UniswapFlashQuery` lookup contract.
- On every block, `src/Arbitrage.ts` refreshes reserves, finds token markets whose prices have crossed, sizes the trade, and submits the best one through the `BundleExecutor` contract.
- `contracts/` holds both contracts; `scripts/` deploys them with Hardhat.

Environment Variables
=====================
Set these in the shell or in a `.env` file (see `.env.example`).

- **ETHEREUM_RPC_URL** _[Optional, default: https://arb1.arbitrum.io/rpc]_ - Arbitrum RPC endpoint
- **PRIVATE_KEY** - Private key for the EOA that submits transactions (also the deployer for `npm run deploy:*`)
- **BUNDLE_EXECUTOR_ADDRESS** - Address of the deployed BundleExecutor contract
- **FLASHBOTS_RELAY_SIGNING_KEY** _[Optional, default: random]_ - Flashbots submissions require an Ethereum private key to sign transaction payloads. This newly-created account does not need to hold any funds or correlate to any on-chain activity, it just needs to be used across multiple Flashbots RPC requests to identify requests related to same searcher. Please see https://docs.flashbots.net/flashbots-auction/searchers/faq#do-i-need-authentication-to-access-the-flashbots-relay
- **HEALTHCHECK_URL** _[Optional]_ - Health check URL, hit only after successfully submitting a bundle.
- **MINER_REWARD_PERCENTAGE** _[Optional, default 80]_ - 0 -> 100, what percentage of overall profitability to send to miner.
- **EXECUTOR_ADDRESS** _[Deploy only]_ - Bot wallet address allowed to call the BundleExecutor
- **ARB_API** _[Optional]_ - Arbiscan API key for contract verification

Usage
======================
1. Generate a new bot wallet address and extract the private key into a raw 32-byte format.
2. Deploy the included BundleExecutor.sol to Arbitrum, from a secured account, with the address of the newly created wallet as the constructor argument
3. Transfer WETH to the newly deployed BundleExecutor

_It is important to keep both the bot wallet private key and bundleExecutor owner private key secure. The bot wallet attempts to not lose WETH inside an arbitrage, but a malicious user would be able to drain the contract._

```
$ npm install
$ cp .env.example .env    # fill in the values

# Deploy the contracts (skip any you already have deployed)
$ npm run deploy:flash-query    # then update UNISWAP_LOOKUP_CONTRACT_ADDRESS in src/addresses.ts
$ PRIVATE_KEY=__OWNER_PRIVATE_KEY__ \
    EXECUTOR_ADDRESS=__BOT_WALLET_ADDRESS__ \
      npm run deploy:executor

# Run the bot
$ npm run start
```

Development
===========
```
$ npm run build     # compile TypeScript to build/
$ npm run lint
$ npm test
$ npm run compile   # compile contracts with Hardhat
```
