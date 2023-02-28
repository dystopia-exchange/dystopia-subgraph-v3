// noinspection JSUnusedGlobalSymbols

import {Address} from '@graphprotocol/graph-ts'
import {Bundle, Pair, PairMap, Token, UniswapFactory} from '../types/schema'
import {PairCreated} from '../types/Factory/FactoryAbi'
import {PairTemplate} from '../types/templates'
import {
  fetchTokenDecimals,
  fetchTokenName,
  fetchTokenSymbol,
  fetchTokenTotalSupply,
  generatePairMapID,
} from './helpers'
import {ADDRESS_ZERO, DEFAULT_STABLE_FEE, DEFAULT_VOLATILE_FEE, ZERO_BD, ZERO_BI} from './constants'
import {isOnWhitelist} from './pricing'


export function handleNewPair(event: PairCreated): void {
  // load factory (create if first exchange)
  let factory = UniswapFactory.load(event.address.toHexString())
  if (factory === null) {
    factory = new UniswapFactory(event.address.toHexString())
    factory.pairCount = 0
    factory.totalVolumeETH = ZERO_BD
    factory.totalLiquidityETH = ZERO_BD
    factory.totalVolumeUSD = ZERO_BD
    factory.untrackedVolumeUSD = ZERO_BD
    factory.totalLiquidityUSD = ZERO_BD
    factory.txCount = ZERO_BI

    // create new bundle
    let bundle = new Bundle('1')
    bundle.ethPrice = ZERO_BD
    bundle.save()
  }
  factory.pairCount = factory.pairCount + 1
  factory.save()

  // create the tokens
  let token0 = getOrCreateToken(event.params.token0.toHexString());
  let token1 = getOrCreateToken(event.params.token1.toHexString());

  if (isOnWhitelist(token1.id)) {
    let white0 = token0.whitelist
    white0.push(event.params.pair.toHexString())
    token0.whitelist = white0
  }

  if (isOnWhitelist(token0.id)) {
    let white1 = token1.whitelist
    white1.push(event.params.pair.toHexString())
    token1.whitelist = white1
  }

  const pair = new Pair(event.params.pair.toHexString()) as Pair

  pair.factory = factory.id;
  pair.token0 = token0.id
  pair.token1 = token1.id
  pair.symbol = fetchTokenSymbol(event.params.pair)
  pair.name = fetchTokenName(event.params.pair)
  pair.isStable = event.params.stable
  pair.liquidityProviderCount = ZERO_BI
  pair.createdAtTimestamp = event.block.timestamp
  pair.createdAtBlockNumber = event.block.number
  pair.txCount = ZERO_BI
  pair.reserve0 = ZERO_BD
  pair.reserve1 = ZERO_BD
  pair.trackedReserveETH = ZERO_BD
  pair.reserveETH = ZERO_BD
  pair.reserveUSD = ZERO_BD
  pair.totalSupply = ZERO_BD
  pair.volumeToken0 = ZERO_BD
  pair.volumeToken1 = ZERO_BD
  pair.volumeUSD = ZERO_BD
  pair.untrackedVolumeUSD = ZERO_BD
  pair.token0Price = ZERO_BD
  pair.token1Price = ZERO_BD

  if(event.params.stable) {
    pair.fee = DEFAULT_STABLE_FEE;
  } else {
    pair.fee = DEFAULT_VOLATILE_FEE;
  }

  pair.gauge = ADDRESS_ZERO
  pair.gaugebribes = ADDRESS_ZERO

  const pairMap01 = new PairMap(generatePairMapID(pair.token0, pair.token1, pair.isStable));
  pairMap01.pair = pair.id;
  pairMap01.save();

  const pairMap10 = new PairMap(generatePairMapID(pair.token1, pair.token0, pair.isStable));
  pairMap10.pair = pair.id;
  pairMap10.save();

  // create the tracked contract based on the template
  PairTemplate.create(event.params.pair)

  // save updated values
  token0.save()
  token1.save()
  pair.save()
  factory.save()
}

function getOrCreateToken(tokenAdr: string): Token {
  let token = Token.load(tokenAdr)
  if (token === null) {
    token = new Token(tokenAdr)
    token.symbol = fetchTokenSymbol(Address.fromString(tokenAdr))
    token.name = fetchTokenName(Address.fromString(tokenAdr))
    token.totalSupply = fetchTokenTotalSupply(Address.fromString(tokenAdr))
    token.decimals = fetchTokenDecimals(Address.fromString(tokenAdr))
    token.derivedETH = ZERO_BD
    token.tradeVolume = ZERO_BD
    token.tradeVolumeUSD = ZERO_BD
    token.untrackedVolumeUSD = ZERO_BD
    token.totalLiquidity = ZERO_BD
    token.isWhitelisted = false
    token.whitelist = []
    token.txCount = ZERO_BI
  }
  return token;
}
