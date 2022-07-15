import {CheckpointToken} from '../types/templates/VeDistTemplate/VeDistAbi';
import {Token, VeDistEntity, VeEntity} from '../types/schema';
import {ZERO_BI} from './constants';
import {calculateApr, formatUnits} from './helpers';
import {BigInt} from '@graphprotocol/graph-ts';

export function handleCheckpointToken(event: CheckpointToken): void {
  const veDist = getVeDist(event.address.toHexString());

  const ve = VeEntity.load(veDist.ve) as VeEntity;

  // rewards and total locked in the same tokens
  veDist.apr = calculateApr(ZERO_BI, BigInt.fromI32(60 * 60 * 24 * 7), formatUnits(event.params.tokens, BigInt.fromI32(18)), ve.totalLocked)

  veDist.save();
}

function getVeDist(adr: string): VeDistEntity {
  return VeDistEntity.load(adr) as VeDistEntity
}
