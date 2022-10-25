const hre = require("hardhat");

async function main() {
  const BundleExecutor = await hre.ethers.getContractFactory("BundleExecutor");
  const greeter = await BundleExecutor.deploy('0x99524283D8e71628b878Eb0C263765FaB051Aa02');

  await greeter.deployed();

  console.log("Greeter deployed to:", greeter.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });