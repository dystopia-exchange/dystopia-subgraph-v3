import {createMockedFunction} from 'matchstick-as';
import {Address, BigDecimal, BigInt, ethereum} from '@graphprotocol/graph-ts';
import {BRIBE_ADR, TOTAL_SUPPLY} from './bribe/bribe-utils';
import {Token} from '../src/types/schema';
import {PairAbi} from '../src/types/templates/BribeTemplate/PairAbi';

export function mockTokenFunctions(adr: string): void {
  createMockedFunction(Address.fromString(adr), "symbol", "symbol():(string)")
    .returns([ethereum.Value.fromString('MOCK_TOKEN')])
  createMockedFunction(Address.fromString(adr), "name", "name():(string)")
    .returns([ethereum.Value.fromString('Mock token')])
  createMockedFunction(Address.fromString(adr), "decimals", "decimals():(uint8)")
    .returns([ethereum.Value.fromI32(9)])
}

export function createToken(
  tokenAdr: string,
  derivedETH: BigDecimal
): void {
  const token = new Token(tokenAdr);

  token.symbol = 'mock token'
  token.name = 'mock token'
  token.decimals = BigInt.fromI32(10)
  token.totalSupply = BigInt.fromI32(0)
  token.tradeVolume = BigDecimal.fromString('0')
  token.tradeVolumeUSD = BigDecimal.fromString('0')
  token.untrackedVolumeUSD = BigDecimal.fromString('0')
  token.whitelist = [];
  token.txCount = BigInt.fromI32(0)
  token.totalLiquidity = BigDecimal.fromString('0')
  token.derivedETH = derivedETH
  token.isWhitelisted = false
  token.save();
}
