import {Deposit, Withdraw} from '../types/templates/VeTemplate/VeAbi';
import {User, VeEntity, VeNFTEntity} from '../types/schema';
import {ADDRESS_ZERO, ZERO_BD} from './constants';
import {formatUnits} from './helpers';
import {Address, BigInt, store} from '@graphprotocol/graph-ts';
import {Transfer} from "../types/Controller/VeAbi";

export function handleDeposit(event: Deposit): void {
  const ve = getVe(event.address.toHexString())
  const veNft = getOrCreateVeNFT(
    event.params.tokenId.toString(),
    event.params.provider.toHexString(),
    event.address.toHexString()
  );

  // exclude for MERGE
  if (event.params.depositType !== 4) {
    ve.totalLocked = ve.totalLocked.minus(veNft.lockedAmount);
  }

  veNft.lockedAmount = veNft.lockedAmount.plus(formatUnits(event.params.value, BigInt.fromI32(18)))
  veNft.lockedEnd = event.params.locktime.toI32()

  // exclude for MERGE
  if (event.params.depositType !== 4) {
    ve.totalNFTs = ve.totalNFTs + 1;
    ve.totalLocked = ve.totalLocked.plus(veNft.lockedAmount);
    ve.save();
  }
  veNft.save();
}

export function handleWithdraw(event: Withdraw): void {
  const ve = getVe(event.address.toHexString())
  ve.totalLocked = ve.totalLocked.minus(formatUnits(event.params.value, BigInt.fromI32(18)));
  ve.save();
}

export function handleTransfer(event: Transfer): void {
  if (event.params.to.equals(Address.fromString(ADDRESS_ZERO))) {
    // just remove entity coz burn
    store.remove('VeNFTEntity', event.params.tokenId.toString());
    const ve = getVe(event.address.toHexString())
    ve.totalNFTs = ve.totalNFTs - 1;
    ve.save();
  }
  // if (!event.params.from.equals(Address.fromString(ADDRESS_ZERO)) && !event.params.to.equals(Address.fromString(ADDRESS_ZERO))) {
  const veNft = getOrCreateVeNFT(
    event.params.tokenId.toString(),
    event.params.from.toHexString(),
    event.address.toHexString()
  );
  veNft.user = event.params.to.toHexString();

  let user = User.load(event.params.to.toHexString())
  if (!user) {
    user = new User(event.params.to.toHexString());
    user.usdSwapped = ZERO_BD;
    user.save();
  }

  veNft.save();
  // }
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
