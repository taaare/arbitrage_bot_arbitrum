const hre = require("hardhat");

async function main() {
  const UniswapFlashQuery = await hre.ethers.getContractFactory("UniswapFlashQuery");
  const flashQuery = await UniswapFlashQuery.deploy();
  await flashQuery.deployed();

  console.log("UniswapFlashQuery deployed to:", flashQuery.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
