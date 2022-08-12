import {Address, log} from '@graphprotocol/graph-ts'
import {Bundle, Pair, PairMap, Token} from '../types/schema'
import {BigDecimal} from '@graphprotocol/graph-ts/index'
import {generatePairMapID} from './helpers'
import {
  MINIMUM_LIQUIDITY_THRESHOLD_USD,
  ONE_BD,
  stablecoins,
  usdcAddress,
  usdcWethPairAddress,
  wethAddress,
  whitelisted,
  ZERO_BD
} from './constants';


export function getEthPriceInUSD(): BigDecimal {
  //For now we will only use USDC_WETH pair for ETH prices
  let usdcPair = Pair.load(usdcWethPairAddress().toHexString());
  if (usdcPair !== null) {
    if (Address.fromString(usdcPair.token0).equals(wethAddress())) {
      return usdcPair.token1Price;
    } else {
      return usdcPair.token0Price;
    }
  } else {
    log.warning('USDC/WETH PAIR NOT FOUND', [])
    return ZERO_BD
  }
}

export function isOnWhitelist(token: string): boolean {
  // @ts-ignore
  for (let i = 0; i < whitelisted().length; i++) {
    // @ts-ignore
    if (Address.fromString(token).equals(whitelisted()[i])) return true
  }
  return false
}

export function isOnStablecoinList(token: string): boolean {
  // @ts-ignore
  for (let i = 0; i < stablecoins().length; i++) {
    // @ts-ignore
    if (Address.fromString(token).equals(stablecoins()[i])) return true
  }
  return false
}

/**
 * Search through graph to find derived Eth per token.
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (wethAddress().equals(Address.fromString(token.id))) {
    return ONE_BD
  }

  let wl = whitelisted();

  // USDC fetch price ONLY from weth-usdc
  if (usdcAddress().equals(Address.fromString(token.id))) {
    wl = [wethAddress()]
  } else
    // other stablecoins fetch price ONLY with xxx-USDC
  if (isOnStablecoinList(token.id)) {
    wl = [usdcAddress()]
  }

  let bestPrice = ZERO_BD
  let bestLiquidity = ZERO_BD

  // loop through whitelist and check if paired with any
  // @ts-ignore
  for (let i = 0; i < wl.length; ++i) {

    // @ts-ignore
    const pairMapStable = PairMap.load(generatePairMapID(token.id, wl[i].toHex(), true));
    // @ts-ignore
    const pairMapVolatile = PairMap.load(generatePairMapID(token.id, wl[i].toHex(), false));

    if (!!pairMapStable) {
      const data = findBest(
        pairMapStable.pair,
        token.id,
        bestPrice,
        bestLiquidity
      );

      // @ts-ignore
      bestPrice = data[0]
      // @ts-ignore
      bestLiquidity = data[1]
    }

    if (!!pairMapVolatile) {
      const data = findBest(
        pairMapVolatile.pair,
        token.id,
        bestPrice,
        bestLiquidity
      );

      // @ts-ignore
      bestPrice = data[0]
      // @ts-ignore
      bestLiquidity = data[1]
    }

  }
  return bestPrice
}

function findBest(
  pairAdr: string,
  tokenAdr: string,
  bestPrice: BigDecimal,
  bestLiquidity: BigDecimal
): BigDecimal[] {
  let pair = Pair.load(pairAdr) as Pair;
  if (pair.reserveUSD.gt(MINIMUM_LIQUIDITY_THRESHOLD_USD) && pair.reserveUSD.gt(bestLiquidity)) {

    if (Address.fromString(pair.token0).equals(Address.fromString(tokenAdr))) {
      let token1 = Token.load(pair.token1) as Token
      bestPrice = pair.token1Price.times(token1.derivedETH) // token1 per our token * Eth per token 1
      bestLiquidity = pair.reserveUSD
    }
    if (Address.fromString(pair.token1).equals(Address.fromString(tokenAdr))) {
      let token0 = Token.load(pair.token0) as Token
      bestPrice = pair.token0Price.times(token0.derivedETH) // token0 per our token * ETH per token 0
      bestLiquidity = pair.reserveUSD
    }
  }
  return [bestPrice, bestLiquidity];
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  bundle: Bundle
): BigDecimal {
  if (!bundle || !token0 || !token1) {
    return ZERO_BD
  }
  let ethPrice = bundle.ethPrice
  let token0DerivedETH = token0.derivedETH
  let token1DerivedETH = token1.derivedETH
  if (!ethPrice || !token0DerivedETH || !token1DerivedETH) {
    return ZERO_BD
  }
  let price0 = token0DerivedETH.times(ethPrice)
  let price1 = token1DerivedETH.times(ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (isOnWhitelist(token0.id) && isOnWhitelist(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (isOnWhitelist(token0.id) && !isOnWhitelist(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!isOnWhitelist(token0.id) && isOnWhitelist(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  bundle: Bundle
): BigDecimal {
  let ethPrice = bundle.ethPrice
  let token0DerivedETH = token0.derivedETH
  let token1DerivedETH = token1.derivedETH
  if (!ethPrice || !token0DerivedETH || !token1DerivedETH) {
    return ZERO_BD
  }
  let price0 = token0DerivedETH.times(ethPrice)
  let price1 = token1DerivedETH.times(ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (isOnWhitelist(token0.id) && isOnWhitelist(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (isOnWhitelist(token0.id) && !isOnWhitelist(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!isOnWhitelist(token0.id) && isOnWhitelist(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
