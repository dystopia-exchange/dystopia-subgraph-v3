import {Address, BigDecimal, BigInt, ethereum} from '@graphprotocol/graph-ts'
import {Bundle, LiquidityPosition, LiquidityPositionSnapshot, Pair, Token, User} from '../types/schema'
import {DAY, ONE_BI, ZERO_BD, ZERO_BI} from './constants';
import {PairAbi} from '../types/Factory/PairAbi';
import {ERC20SymbolBytes} from '../types/Factory/ERC20SymbolBytes';
import {ERC20NameBytes} from '../types/Factory/ERC20NameBytes';


export function abs(n: BigDecimal): BigDecimal {
  if (n.lt(ZERO_BD)) {
    return n.neg();
  }
  return n;
}

export function formatUnits(amount: BigInt, decimals: BigInt): BigDecimal {
  return amount.toBigDecimal().div(exponentToBigDecimal(decimals))
}

export function parseUnits(amount: BigDecimal, decimals: BigInt): BigInt {
  if (decimals == ZERO_BI) {
    return BigInt.fromString(amount.toString());
  }
  return BigInt.fromString(amount.times(exponentToBigDecimal(decimals)).toString())
}

export function calculateApr(
  timeStart: BigInt,
  timeEnd: BigInt,
  profitUSD: BigDecimal,
  supplyUSD: BigDecimal,
): BigDecimal {
  const period = timeEnd.minus(timeStart).toBigDecimal();
  if (period.equals(ZERO_BD) || supplyUSD.equals(ZERO_BD)) {
    return ZERO_BD;
  }
  return profitUSD.div(supplyUSD).div(period.div(DAY)).times(BigDecimal.fromString('36500'));
}

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = ZERO_BI; i.lt(decimals as BigInt); i = i.plus(ONE_BI)) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

export function convertTokenToDecimal(tokenAmount: BigInt, exchangeDecimals: BigInt): BigDecimal {
  if (exchangeDecimals == ZERO_BI) {
    return tokenAmount.toBigDecimal()
  }
  return tokenAmount.toBigDecimal().div(exponentToBigDecimal(exchangeDecimals))
}

export function isNullEthValue(value: string): boolean {
  return value == '0x0000000000000000000000000000000000000000000000000000000000000001'
}

export function generatePairMapID(tokenA: string, tokenB: string, isStable: boolean): string {
  // @ts-ignore
  return tokenA.toLowerCase() + tokenB.toLowerCase() + (isStable ? '_s' : '_v');
}

export function fetchTokenSymbol(tokenAddress: Address): string {
  let contract = PairAbi.bind(tokenAddress)
  let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress)

  // try types string and bytes32 for symbol
  let symbolValue = 'unknown'
  let symbolResult = contract.try_symbol()
  if (symbolResult.reverted) {
    let symbolResultBytes = contractSymbolBytes.try_symbol()
    if (!symbolResultBytes.reverted) {
      // for broken pairs that have no symbol function exposed
      if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
        symbolValue = symbolResultBytes.value.toString()
      }
    }
  } else {
    symbolValue = symbolResult.value
  }

  return symbolValue
}

export function fetchTokenName(tokenAddress: Address): string {
  let contract = PairAbi.bind(tokenAddress)
  let contractNameBytes = ERC20NameBytes.bind(tokenAddress)

  // try types string and bytes32 for name
  let nameValue = 'unknown'
  let nameResult = contract.try_name()
  if (nameResult.reverted) {
    let nameResultBytes = contractNameBytes.try_name()
    if (!nameResultBytes.reverted) {
      // for broken exchanges that have no name function exposed
      if (!isNullEthValue(nameResultBytes.value.toHexString())) {
        nameValue = nameResultBytes.value.toString()
      }
    }
  } else {
    nameValue = nameResult.value
  }

  return nameValue
}

export function fetchTokenTotalSupply(tokenAddress: Address): BigInt {
  let contract = PairAbi.bind(tokenAddress)
  let totalSupplyValue = BigInt.fromI32(0);
  let totalSupplyResult = contract.try_totalSupply()
  if (!totalSupplyResult.reverted) {
    totalSupplyValue = totalSupplyResult.value
  }
  return totalSupplyValue
}

export function fetchTokenDecimals(tokenAddress: Address): BigInt {
  let contract = PairAbi.bind(tokenAddress)
  let decimalValue = 0;
  let decimalResult = contract.try_decimals()
  if (!decimalResult.reverted) {
    decimalValue = decimalResult.value
  }
  return BigInt.fromI32(decimalValue)
}

export function createLiquidityPosition(exchange: Address, user: Address): LiquidityPosition {
  let id = exchange.toHexString() + '-' + user.toHexString()
  let liquidityTokenBalance = LiquidityPosition.load(id)
  if (liquidityTokenBalance === null) {
    let pair = Pair.load(exchange.toHexString()) as Pair;
    pair.liquidityProviderCount = pair.liquidityProviderCount.plus(ONE_BI)
    pair.save()

    liquidityTokenBalance = new LiquidityPosition(id)
    liquidityTokenBalance.liquidityTokenBalance = ZERO_BD
    liquidityTokenBalance.pair = exchange.toHexString()
    liquidityTokenBalance.user = user.toHexString()
  }
  return liquidityTokenBalance;
}

export function createUser(address: Address): User {
  let user = User.load(address.toHexString())
  if (user === null) {
    user = new User(address.toHexString())
    user.usdSwapped = ZERO_BD
    user.save()
  }
  return user;
}

export function createLiquiditySnapshot(position: LiquidityPosition, event: ethereum.Event): void {
  let timestamp = event.block.timestamp.toI32()
  let bundle = Bundle.load('1')
  if (!position || !position.pair || !bundle) {
    return
  }

  const pair = Pair.load(position.pair) as Pair
  let token0 = Token.load(pair.token0) as Token
  let token1 = Token.load(pair.token1) as Token

  let ethPrice = bundle.ethPrice;

  // create new snapshot
  const snapshot = new LiquidityPositionSnapshot(position.id + timestamp.toString())
  snapshot.timestamp = timestamp
  snapshot.block = event.block.number.toI32()
  snapshot.user = position.user
  snapshot.pair = position.pair

  if (ethPrice) {
    let token0PriceUSD = token0.derivedETH.times(bundle.ethPrice) as BigDecimal
    if (token0PriceUSD) {
      snapshot.token0PriceUSD = token0PriceUSD
    }
    let token1PriceUSD = token1.derivedETH.times(bundle.ethPrice);
    if (token1PriceUSD) {
      snapshot.token1PriceUSD = token1PriceUSD
    }
  }
  snapshot.reserve0 = pair.reserve0
  snapshot.reserve1 = pair.reserve1
  snapshot.reserveUSD = pair.reserveUSD
  snapshot.liquidityTokenTotalSupply = pair.totalSupply
  snapshot.liquidityTokenBalance = position.liquidityTokenBalance
  snapshot.liquidityPosition = position.id
  snapshot.save()
}
