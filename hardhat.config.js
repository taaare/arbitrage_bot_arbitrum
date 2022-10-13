require("@nomiclabs/hardhat-waffle");
require("dotenv").config();

module.exports = {
  solidity: "0.8.17",
  networks: {
    arbitrum: {
      url: process.env.L2_RPC,
      accounts: [process.env.PRIVKEY],
    },
  },
};
