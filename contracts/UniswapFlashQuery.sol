//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

// Covers both V2 (allPairs) and V3 (getPool) factories
interface IUniswapFactory {
    function allPairs(uint256) external view returns (address);
    function allPairsLength() external view returns (uint256);
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

// In order to quickly load up data from Uniswap-like market, this contract allows easy iteration with a single eth_call
contract UniswapFlashQuery {
    // Token balances in token0/token1 order; works for V2 pairs and V3 pools
    function getReservesByPairs(IUniswapV2Pair[] calldata _pairs) external view returns (uint256[2][] memory) {
        uint256[2][] memory result = new uint256[2][](_pairs.length);
        for (uint i = 0; i < _pairs.length; i++) {
            IUniswapV2Pair _pair = _pairs[i];
            result[i][0] = IERC20(_pair.token0()).balanceOf(address(_pair));
            result[i][1] = IERC20(_pair.token1()).balanceOf(address(_pair));
        }
        return result;
    }

    function getPairsByIndexRange(IUniswapFactory _uniswapFactory, uint256 _start, uint256 _stop) external view returns (address[3][] memory)  {
        uint256 _allPairsLength = _uniswapFactory.allPairsLength();
        if (_stop > _allPairsLength) {
            _stop = _allPairsLength;
        }
        require(_stop >= _start, "start cannot be higher than stop");
        uint256 _qty = _stop - _start;
        address[3][] memory result = new address[3][](_qty);
        for (uint i = 0; i < _qty; i++) {
            IUniswapV2Pair _uniswapPair = IUniswapV2Pair(_uniswapFactory.allPairs(_start + i));
            result[i][0] = _uniswapPair.token0();
            result[i][1] = _uniswapPair.token1();
            result[i][2] = address(_uniswapPair);
        }
        return result;
    }

    // Uniswap V3 pool for the pair at the 0.05% fee tier
    function getPairsByPool(IUniswapFactory _uniswapFactory, address _token1, address _token2) external view returns (address) {
        return _uniswapFactory.getPool(_token1, _token2, 500);
    }
}
