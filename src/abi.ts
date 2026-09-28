export const UNISWAP_QUERY_ABI = [
  "function getPairsByIndexRange(address _uniswapFactory, uint256 _start, uint256 _stop) view returns (address[3][])",
  "function getPairsByPool(address _uniswapFactory, address _token1, address _token2) view returns (address)",
  "function getReservesByPairs(address[] _pairs) view returns (uint256[2][])",
];

export const BUNDLE_EXECUTOR_ABI = [
  "function uniswapWeth(uint256 _wethAmountToFirstMarket, uint256 _ethAmountToCoinbase, address[] _targets, bytes[] _payloads) payable",
  "function call(address _to, uint256 _value, bytes _data) payable returns (bytes)",
];

export const UNISWAP_PAIR_ABI = [
  "function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)",
];
