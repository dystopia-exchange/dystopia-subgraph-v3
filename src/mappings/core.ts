// noinspection JSUnusedGlobalSymbols

import {BigDecimal, BigInt, store} from '@graphprotocol/graph-ts'
import {
  Bundle,
  Burn as BurnEvent,
  Mint as MintEvent,
  Pair,
  Swap as SwapEvent,
  Token,
  Transaction,
  UniswapFactory
} from '../types/schema'
import {Burn, Mint, PairAbi as PairContract, Swap, Sync, Transfer} from '../types/templates/PairTemplate/PairAbi'
import {updatePairDayData, updatePairHourData, updateTokenDayData, updateUniswapDayData} from './dayUpdates'
import {findEthPerToken, getEthPriceInUSD, getTrackedLiquidityUSD, getTrackedVolumeUSD} from './pricing'
import {convertTokenToDecimal, createLiquidityPosition, createLiquiditySnapshot, createUser,} from './helpers'
import {ADDRESS_ZERO, BI_18, ONE_BI, ZERO_BD} from './constants';

// *******************************************************************
//                     HANDLERS
// *******************************************************************

export function handleTransfer(event: Transfer): void {
  // ignore initial transfers for first adds
  if (event.params.to.toHexString() == ADDRESS_ZERO && event.params.value.equals(BigInt.fromI32(1000))) {
    return
  }

  // get pair and load contract
  const pair = Pair.load(event.address.toHexString()) as Pair;
  let pairContract = PairContract.bind(event.address)
  const factory = UniswapFactory.load(pair.factory) as UniswapFactory;
  let transactionHash = event.transaction.hash.toHexString()

  // user stats
  let from = event.params.from
  let to = event.params.to
  createUser(from)
  createUser(to)

  // liquidity token amount being transfered
  let value = convertTokenToDecimal(event.params.value, BI_18)

  // get or create transaction
  let transaction = Transaction.load(transactionHash)
  if (transaction === null) {
    transaction = new Transaction(transactionHash)
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.burns = []
    transaction.swaps = []
  }

  // mints
  let mints = transaction.mints
  if (from.toHexString() == ADDRESS_ZERO) {
    // update total supply
    pair.totalSupply = pair.totalSupply.plus(value)
    pair.save()

    // create new mint if no mints so far or if last one is done already
    if (mints.length === 0 || isCompleteMint(mints[mints.length - 1])) {
      let mint = new MintEvent(
        event.transaction.hash.toHexString() + '-' + BigInt.fromI32(mints.length).toString()
      )
      mint.transaction = transaction.id
      mint.pair = pair.id
      mint.to = to
      mint.liquidity = value
      mint.timestamp = transaction.timestamp
      mint.transaction = transaction.id
      mint.save()

      // update mints in transaction
      transaction.mints = mints.concat([mint.id])

      factory.save()
    }
  }

  // case where direct send first on ETH withdrawls
  if (event.params.to.toHexString() == pair.id) {
    let burns = transaction.burns
    let burn = new BurnEvent(
      event.transaction.hash.toHexString() + '-' + BigInt.fromI32(burns.length).toString()
    )
    burn.transaction = transaction.id
    burn.pair = pair.id
    burn.liquidity = value
    burn.timestamp = transaction.timestamp
    burn.to = event.params.to
    burn.sender = event.params.from
    burn.needsComplete = true
    burn.transaction = transaction.id
    burn.save()

    burns.push(burn.id)
    transaction.burns = burns
  }

  // burn
  if (event.params.to.toHexString() == ADDRESS_ZERO) {
    pair.totalSupply = pair.totalSupply.minus(value)
    pair.save()

    // this is a new instance of a logical burn
    let burns = transaction.burns
    let burn: BurnEvent
    if (burns.length > 0) {
      let currentBurn = BurnEvent.load(burns[burns.length - 1]) as BurnEvent
      if (currentBurn.needsComplete) {
        burn = currentBurn
      } else {
        burn = new BurnEvent(
          event.transaction.hash.toHexString() + '-' + BigInt.fromI32(burns.length).toString()
        )
        burn.transaction = transaction.id
        burn.needsComplete = false
        burn.pair = pair.id
        burn.liquidity = value
        burn.transaction = transaction.id
        burn.timestamp = transaction.timestamp
      }
    } else {
      burn = new BurnEvent(
        event.transaction.hash.toHexString() + '-' + BigInt.fromI32(burns.length).toString()
      )
      burn.transaction = transaction.id
      burn.needsComplete = false
      burn.pair = pair.id
      burn.liquidity = value
      burn.transaction = transaction.id
      burn.timestamp = transaction.timestamp
    }

    // if this logical burn included a fee mint, account for this
    if (mints.length !== 0 && !isCompleteMint(mints[mints.length - 1])) {
      let mint = MintEvent.load(mints[mints.length - 1])
      if (mint) {
        burn.feeTo = mint.to
        burn.feeLiquidity = mint.liquidity
        // remove the logical mint
        store.remove('Mint', mints[mints.length - 1])
        // update the transaction
        mints.pop()
        transaction.mints = mints
      }
    }
    burn.save()
    // if accessing last one, replace it
    if (burn.needsComplete) {
      burns[burns.length - 1] = burn.id
    }
    // else add new one
    else {
      burns.push(burn.id)
    }
    transaction.burns = burns
  }

  if (from.toHexString() != ADDRESS_ZERO && from.toHexString() != pair.id) {
    let fromUserLiquidityPosition = createLiquidityPosition(event.address, from)
    fromUserLiquidityPosition.liquidityTokenBalance = convertTokenToDecimal(pairContract.balanceOf(from), BI_18)
    fromUserLiquidityPosition.save()
    createLiquiditySnapshot(fromUserLiquidityPosition, event)
  }

  if (event.params.to.toHexString() != ADDRESS_ZERO && to.toHexString() != pair.id) {
    let toUserLiquidityPosition = createLiquidityPosition(event.address, to)
    toUserLiquidityPosition.liquidityTokenBalance = convertTokenToDecimal(pairContract.balanceOf(to), BI_18)
    toUserLiquidityPosition.save()
    createLiquiditySnapshot(toUserLiquidityPosition, event)
  }

  transaction.save()
}

export function handleSync(event: Sync): void {
  let pair = Pair.load(event.address.toHex()) as Pair
  let token0 = Token.load(pair.token0) as Token
  let token1 = Token.load(pair.token1) as Token
  let uniswap = UniswapFactory.load(pair.factory) as UniswapFactory

  // reset factory liquidity by subtracting only tracked liquidity
  uniswap.totalLiquidityETH = uniswap.totalLiquidityETH.minus(pair.trackedReserveETH as BigDecimal)

  // reset token total liquidity amounts
  token0.totalLiquidity = token0.totalLiquidity.minus(pair.reserve0)
  token1.totalLiquidity = token1.totalLiquidity.minus(pair.reserve1)

  pair.reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals)
  pair.reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals)

  if (pair.isStable) {
    if (pair.reserve1.notEqual(ZERO_BD)) {
      pair.token0Price = getStablePrice(pair.reserve0, pair.reserve1)
    } else pair.token0Price = ZERO_BD
    if (pair.reserve0.notEqual(ZERO_BD)) {
      pair.token1Price = getStablePrice(pair.reserve1, pair.reserve0)
    } else pair.token1Price = ZERO_BD
  } else {
    if (pair.reserve1.notEqual(ZERO_BD)) pair.token0Price = pair.reserve0.div(pair.reserve1)
    else pair.token0Price = ZERO_BD
    if (pair.reserve0.notEqual(ZERO_BD)) pair.token1Price = pair.reserve1.div(pair.reserve0)
    else pair.token1Price = ZERO_BD
  }

  // update ETH price now that reserves could have changed
  let bundle = Bundle.load('1') as Bundle

  bundle.ethPrice = getEthPriceInUSD()

  token0.derivedETH = findEthPerToken(token0)
  token1.derivedETH = findEthPerToken(token1)

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityETH: BigDecimal
  if (bundle.ethPrice.notEqual(ZERO_BD)) {
    trackedLiquidityETH = getTrackedLiquidityUSD(
      pair.reserve0,
      token0,
      pair.reserve1,
      token1,
      bundle
    ).div(bundle.ethPrice);
  } else {
    trackedLiquidityETH = ZERO_BD
  }

  // use derived amounts within pair
  pair.trackedReserveETH = trackedLiquidityETH
  pair.reserveETH = pair.reserve0
    .times(token0.derivedETH)
    .plus(pair.reserve1.times(token1.derivedETH))
  pair.reserveUSD = pair.reserveETH.times(bundle.ethPrice)

  // use tracked amounts globally
  uniswap.totalLiquidityETH = uniswap.totalLiquidityETH.plus(trackedLiquidityETH)
  uniswap.totalLiquidityUSD = uniswap.totalLiquidityETH.times(bundle.ethPrice)

  // now correctly set liquidity amounts for each token
  token0.totalLiquidity = token0.totalLiquidity.plus(pair.reserve0)
  token1.totalLiquidity = token1.totalLiquidity.plus(pair.reserve1)

  // save entities
  bundle.save()
  pair.save()
  uniswap.save()
  token0.save()
  token1.save()
}

export function handleMint(event: Mint): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString()) as Transaction
  let mints = transaction.mints
  let mint = MintEvent.load(mints[mints.length - 1]) as MintEvent
  let pair = Pair.load(event.address.toHex()) as Pair
  let uniswap = UniswapFactory.load(pair.factory) as UniswapFactory

  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)
  if (!token0 || !token1) {
    return
  }

  // update exchange info (except balances, sync will cover that)
  let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals)

  // update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // get new amounts of USD and ETH for tracking
  let bundle = Bundle.load('1') as Bundle

  let ethPrice = bundle.ethPrice
  let token0DerivedETH = token0.derivedETH
  let token1DerivedETH = token1.derivedETH

  let amountTotalUSD = token1DerivedETH
    .times(token1Amount)
    .plus(token0DerivedETH.times(token0Amount))
    .times(ethPrice)

  // update txn counts
  pair.txCount = pair.txCount.plus(ONE_BI)
  uniswap.txCount = uniswap.txCount.plus(ONE_BI)

  mint.sender = event.params.sender
  mint.amount0 = token0Amount as BigDecimal
  mint.amount1 = token1Amount as BigDecimal
  mint.logIndex = event.logIndex
  mint.amountUSD = amountTotalUSD as BigDecimal

  // save entities
  token0.save()
  token1.save()
  pair.save()
  uniswap.save()
  mint.save()

  // update the LP position
  //let liquidityPosition = createLiquidityPosition(event.address, mint.to as Address)
  //createLiquiditySnapshot(liquidityPosition, event)

  // update day entities
  let dpd = updatePairDayData(pair, event)
  let phd = updatePairHourData(pair, event)
  let udd = updateUniswapDayData(uniswap, event)
  let tdd0 = updateTokenDayData(token0, event, bundle)
  let tdd1 = updateTokenDayData(token1, event, bundle)
  dpd.save()
  phd.save()
  udd.save()
  tdd0.save()
  tdd1.save()
}

export function handleBurn(event: Burn): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString()) as Transaction
  let burns = transaction.burns
  let burn = BurnEvent.load(burns[burns.length - 1]) as BurnEvent
  let pair = Pair.load(event.address.toHex()) as Pair
  let uniswap = UniswapFactory.load(pair.factory) as UniswapFactory

  //update token info
  let token0 = Token.load(pair.token0) as Token
  let token1 = Token.load(pair.token1) as Token

  let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals)

  // update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // get new amounts of USD and ETH for tracking
  let bundle = Bundle.load('1') as Bundle
  let token0DerivedETH = token0.derivedETH
  let token1DerivedETH = token1.derivedETH

  let amountTotalUSD = token1DerivedETH
    .times(token1Amount)
    .plus(token0DerivedETH.times(token0Amount))
    .times(bundle.ethPrice)

  // update txn counts
  uniswap.txCount = uniswap.txCount.plus(ONE_BI)
  pair.txCount = pair.txCount.plus(ONE_BI)

  // update burn
  // burn.sender = event.params.sender
  burn.amount0 = token0Amount as BigDecimal
  burn.amount1 = token1Amount as BigDecimal
  // burn.to = event.params.to
  burn.logIndex = event.logIndex
  burn.amountUSD = amountTotalUSD as BigDecimal

  // update global counter and save
  token0.save()
  token1.save()
  pair.save()
  uniswap.save()
  burn.save()

  // update the LP position
  //let liquidityPosition = createLiquidityPosition(event.address, burn.sender as Address)
  //createLiquiditySnapshot(liquidityPosition, event)

  // update day entities
  let dpd = updatePairDayData(pair as Pair, event)
  let phd = updatePairHourData(pair as Pair, event)
  let udd = updateUniswapDayData(uniswap as UniswapFactory, event)
  let tdd0 = updateTokenDayData(token0 as Token, event, bundle as Bundle)
  let tdd1 = updateTokenDayData(token1 as Token, event, bundle as Bundle)
  dpd.save()
  phd.save()
  udd.save()
  tdd0.save()
  tdd1.save()
}

export function handleSwap(event: Swap): void {
  let pair = Pair.load(event.address.toHexString()) as Pair

  let token0 = Token.load(pair.token0) as Token
  let token1 = Token.load(pair.token1) as Token

  let amount0In = convertTokenToDecimal(event.params.amount0In, token0.decimals)
  let amount1In = convertTokenToDecimal(event.params.amount1In, token1.decimals)
  let amount0Out = convertTokenToDecimal(event.params.amount0Out, token0.decimals)
  let amount1Out = convertTokenToDecimal(event.params.amount1Out, token1.decimals)

  // totals for volume updates
  let amount0Total = amount0Out.plus(amount0In)
  let amount1Total = amount1Out.plus(amount1In)

  // ETH/USD prices
  let bundle = Bundle.load('1') as Bundle
  let token0DerivedETH = token0.derivedETH
  let token1DerivedETH = token1.derivedETH
  let ethPrice = bundle.ethPrice

  // get total amounts of derived USD and ETH for tracking
  let derivedAmountETH = token1DerivedETH
    .times(amount1Total)
    .plus(token0DerivedETH.times(amount0Total))
    .div(BigDecimal.fromString('2'))
  let derivedAmountUSD = derivedAmountETH.times(ethPrice)

  // only accounts for volume through white listed tokens
  let trackedAmountUSD = getTrackedVolumeUSD(amount0Total, token0, amount1Total, token1, bundle)

  let trackedAmountETH: BigDecimal
  if (ethPrice.equals(ZERO_BD)) {
    trackedAmountETH = ZERO_BD
  } else {
    trackedAmountETH = trackedAmountUSD.div(bundle.ethPrice)
  }

  // update token0 global volume and token liquidity stats
  token0.tradeVolume = token0.tradeVolume.plus(amount0Total)
  token0.tradeVolumeUSD = token0.tradeVolumeUSD.plus(trackedAmountUSD)
  token0.untrackedVolumeUSD = token0.untrackedVolumeUSD.plus(derivedAmountUSD)

  // update token1 global volume and token liquidity stats
  token1.tradeVolume = token1.tradeVolume.plus(amount1Total)
  token1.tradeVolumeUSD = token1.tradeVolumeUSD.plus(trackedAmountUSD)
  token1.untrackedVolumeUSD = token1.untrackedVolumeUSD.plus(derivedAmountUSD)

  // update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // update pair volume data, use tracked amount if we have it as its probably more accurate
  pair.volumeUSD = pair.volumeUSD.plus(trackedAmountUSD)
  pair.volumeToken0 = pair.volumeToken0.plus(amount0Total)
  pair.volumeToken1 = pair.volumeToken1.plus(amount1Total)
  pair.untrackedVolumeUSD = pair.untrackedVolumeUSD.plus(derivedAmountUSD)
  pair.txCount = pair.txCount.plus(ONE_BI)

  // update global values, only used tracked amounts for volume
  let uniswap = UniswapFactory.load(pair.factory) as UniswapFactory
  uniswap.totalVolumeUSD = uniswap.totalVolumeUSD.plus(trackedAmountUSD)
  uniswap.totalVolumeETH = uniswap.totalVolumeETH.plus(trackedAmountETH)
  uniswap.untrackedVolumeUSD = uniswap.untrackedVolumeUSD.plus(derivedAmountUSD)
  uniswap.txCount = uniswap.txCount.plus(ONE_BI)

  // update user info
  const user = createUser(event.params.sender)
  user.usdSwapped = user.usdSwapped.plus(trackedAmountUSD);

  // save entities
  pair.save()
  token0.save()
  token1.save()
  uniswap.save()

  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction === null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.swaps = []
    transaction.burns = []
  }
  let swaps = transaction.swaps
  let swap = new SwapEvent(
    event.transaction.hash.toHexString() + '-' + BigInt.fromI32(swaps.length).toString()
  )

  // update swap event
  swap.transaction = transaction.id
  swap.pair = pair.id
  swap.timestamp = transaction.timestamp
  swap.sender = event.params.sender
  swap.amount0In = amount0In
  swap.amount1In = amount1In
  swap.amount0Out = amount0Out
  swap.amount1Out = amount1Out
  swap.to = event.params.to
  swap.from = event.transaction.from
  swap.logIndex = event.logIndex
  // use the tracked amount if we have it
  swap.amountUSD = trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD
  swap.save()

  // update the transaction
  swaps.push(swap.id)
  transaction.swaps = swaps
  transaction.save()

  // update day entities
  let pairDayData = updatePairDayData(pair as Pair, event)
  let pairHourData = updatePairHourData(pair as Pair, event)
  let uniswapDayData = updateUniswapDayData(uniswap as UniswapFactory, event)
  let token0DayData = updateTokenDayData(token0 as Token, event, bundle as Bundle)
  let token1DayData = updateTokenDayData(token1 as Token, event, bundle as Bundle)

  // swap specific updating
  uniswapDayData.dailyVolumeUSD = uniswapDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  uniswapDayData.dailyVolumeETH = uniswapDayData.dailyVolumeETH.plus(trackedAmountETH)
  uniswapDayData.dailyVolumeUntracked = uniswapDayData.dailyVolumeUntracked.plus(derivedAmountUSD)
  uniswapDayData.save()

  // swap specific updating for pair
  pairDayData.dailyVolumeToken0 = pairDayData.dailyVolumeToken0.plus(amount0Total)
  pairDayData.dailyVolumeToken1 = pairDayData.dailyVolumeToken1.plus(amount1Total)
  pairDayData.dailyVolumeUSD = pairDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  pairDayData.save()

  // update hourly pair data
  pairHourData.hourlyVolumeToken0 = pairHourData.hourlyVolumeToken0.plus(amount0Total)
  pairHourData.hourlyVolumeToken1 = pairHourData.hourlyVolumeToken1.plus(amount1Total)
  pairHourData.hourlyVolumeUSD = pairHourData.hourlyVolumeUSD.plus(trackedAmountUSD)
  pairHourData.save()

  // swap specific updating for token0
  token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken.plus(amount0Total)
  token0DayData.dailyVolumeETH = token0DayData.dailyVolumeETH.plus(amount0Total.times(token0.derivedETH as BigDecimal))
  token0DayData.dailyVolumeUSD = token0DayData.dailyVolumeUSD.plus(
    amount0Total.times(token0.derivedETH as BigDecimal).times(bundle.ethPrice)
  )
  token0DayData.save()

  // swap specific updating
  token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken.plus(amount1Total)
  token1DayData.dailyVolumeETH = token1DayData.dailyVolumeETH.plus(amount1Total.times(token1.derivedETH as BigDecimal))
  token1DayData.dailyVolumeUSD = token1DayData.dailyVolumeUSD.plus(
    amount1Total.times(token1.derivedETH as BigDecimal).times(bundle.ethPrice)
  )
  token1DayData.save()
}

// *******************************************************************
//                     HELPERS
// *******************************************************************

function isCompleteMint(mintId: string): boolean {
  let mint = MintEvent.load(mintId)
  return mint !== null && mint.sender !== null // sufficient checks
}

function getStablePrice(reserves0: BigDecimal, reserves1: BigDecimal,): BigDecimal {
  const xy = _k(reserves0, reserves1);
  return reserves1.minus(_getY(reserves0.plus(BigDecimal.fromString('1').div(BI_18.toBigDecimal())), xy, reserves1)).times(BI_18.toBigDecimal());
}

function _k(
  _x: BigDecimal,
  _y: BigDecimal,
): BigDecimal {
  const _a = _x.times(_y);
  const _b = _x.times(_x).plus(_y.times(_y));
  // x3y+y3x >= k
  return _a.times(_b);
}

function _getY(x0: BigDecimal, xy: BigDecimal, y: BigDecimal): BigDecimal {
  for (let i = 0; i < 255; i++) {
    const yPrev = y;
    const k = _f(x0, y);
    if (k.lt(xy)) {
      const dy = xy.minus(k).div(_d(x0, y));
      y = y.plus(dy);
    } else {
      const dy = k.minus(xy).div(_d(x0, y));
      y = y.minus(dy);
    }
    if (_closeTo(y, yPrev, BigDecimal.fromString('1'))) {
      break;
    }
  }
  return y;
}

function _f(x0: BigDecimal, y: BigDecimal): BigDecimal {
  return x0.times(y.times(y).times(y)).plus(y.times(x0.times(x0).times(x0)))
}

function _d(x0: BigDecimal, y: BigDecimal): BigDecimal {
  return BigDecimal.fromString('3').times(x0).times(y.times(y))
    .plus(x0.times(x0).times(x0))
}

function _closeTo(a: BigDecimal, b: BigDecimal, target: BigDecimal): boolean {
  if (a.gt(b)) {
    if (a.minus(b).le(target)) {
      return true;
    }
  } else {
    if (b.minus(a).le(target)) {
      return true;
    }
  }
  return false;
}
