import {BigDecimal, BigInt} from "@graphprotocol/graph-ts";
import {BribeEntity} from "../../src/types/schema";
import {parseUnits} from '../../src/mappings/helpers';


export const BRIBE_ENTITY = 'BribeEntity';
export const BRIBE_TOKEN_ENTITY = 'BribeToken';
export const BRIBE_USER_ENTITY = 'BribeUser';

export const BRIBE_ADR = '0x1100000000000000000000000000000000000001';
export const REWARD_ADR = '0x1100000000000000000000000000000000000002';
export const VE_ADR = '0x1100000000000000000000000000000000000003';
export const VE_UNDERLYING_ADR = '0x1100000000000000000000000000000000000004';
export const PAIR_ADR = '0x1100000000000000000000000000000000000005';
export const USER_ADR = '0x000000000000000000000000000000000000001a';

export const REWARD_AMOUNT = BigInt.fromI32(10_000);
export const TOTAL_SUPPLY = parseUnits(BigDecimal.fromString('100'), BigInt.fromI32(18));
export const LEFT = parseUnits(BigDecimal.fromString('3'), BigInt.fromI32(10));

export const PERIOD_FINISH = BigInt.fromI32(60 * 60 * 24)


export function createBribe(): void {
  const bribe = new BribeEntity(BRIBE_ADR);

  bribe.pair = PAIR_ADR
  bribe.ve = VE_ADR
  bribe.veUnderlying = VE_UNDERLYING_ADR;
  bribe.bribeTokensAdr = [];

  bribe.save();
}
