const hre = require("hardhat");

async function main() {
  // The bot wallet allowed to call uniswapWeth
  const executorAddress = process.env.EXECUTOR_ADDRESS;
  if (!executorAddress) {
    throw new Error("Must provide EXECUTOR_ADDRESS environment variable. Please see README.md");
  }

  const BundleExecutor = await hre.ethers.getContractFactory("BundleExecutor");
  const bundleExecutor = await BundleExecutor.deploy(executorAddress);
  await bundleExecutor.deployed();

  console.log("BundleExecutor deployed to:", bundleExecutor.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
