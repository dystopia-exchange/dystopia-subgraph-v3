import {Deposit, Withdraw} from '../types/templates/VeTemplate/VeAbi';
import {VeEntity, VeNFTEntity} from '../types/schema';
import {ZERO_BD} from './constants';
import {formatUnits} from './helpers';
import {Address, BigInt, store} from '@graphprotocol/graph-ts';

export function handleDeposit(event: Deposit): void {
  const ve = getVe(event.address.toHexString())
  const veNft = getOrCreateVeNFT(
    event.params.tokenId.toString(),
    event.params.provider.toHexString(),
    event.address.toHexString()
  );

  ve.totalLocked = ve.totalLocked.minus(veNft.lockedAmount);

  veNft.lockedAmount = veNft.lockedAmount.plus(formatUnits(event.params.value, BigInt.fromI32(18)))
  veNft.lockedEnd = event.params.locktime.toI32()


  ve.totalNFTs = ve.totalNFTs + 1;
  ve.totalLocked = ve.totalLocked.plus(veNft.lockedAmount);
  ve.save();

  veNft.save();
}

export function handleWithdraw(event: Withdraw): void {
  // just remove entity coz burn
  store.remove('VeNFTEntity', event.params.tokenId.toString());

  const ve = getVe(event.address.toHexString())

  ve.totalLocked = ve.totalLocked.minus(formatUnits(event.params.value, BigInt.fromI32(18)));
  ve.totalNFTs = ve.totalNFTs - 1;

  ve.save();
}

// ********************************************************
//                      HELPERS
// ********************************************************

function getVe(adr: string): VeEntity {
  return VeEntity.load(adr) as VeEntity;
}

function getOrCreateVeNFT(veId: string, userAdr: string, veAdr: string): VeNFTEntity {
  let ve = VeNFTEntity.load(veId);
  if (!ve) {
    ve = new VeNFTEntity(veId);
    ve.ve = veAdr
    ve.user = userAdr
    ve.lockedAmount = ZERO_BD
    ve.lockedEnd = 0
    ve.attachments = 0
    ve.voteIds = []
  }
  return ve;
}
