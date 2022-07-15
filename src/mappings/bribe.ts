// noinspection JSUnusedGlobalSymbols

import {BribeEntity, BribeToken, BribeUser, Token} from '../types/schema'
import {BribeAbi, ClaimRewards, Deposit, NotifyReward, Withdraw} from '../types/templates/BribeTemplate/BribeAbi';
import {Address, BigDecimal, BigInt, ByteArray, log, store} from '@graphprotocol/graph-ts';
import {calculateApr, formatUnits} from './helpers';
import {ZERO_BI} from './constants';
import {PairAbi} from '../types/templates/BribeTemplate/PairAbi';

// ********************************************************
//                MAIN LOGIC
// ********************************************************

export function handleNotify(event: NotifyReward): void {
  const bribe = BribeEntity.load(event.address.toHexString()) as BribeEntity;
  updateBribeToken(bribe, event.params.reward.toHexString())
}


export function handleDeposit(event: Deposit): void {
  const bribe = BribeEntity.load(event.address.toHexString()) as BribeEntity;
  const tokens = bribe.bribeTokensAdr;
  for (let i = 0; i < tokens.length; i++) {
    updateBribeToken(bribe, tokens[i]);
  }

  const user = getOrCreateBribeUser(addressToVeId(event.params.from), event.address.toHexString());
  user.save();
}

export function handleWithdraw(event: Withdraw): void {
  const bribe = BribeEntity.load(event.address.toHexString()) as BribeEntity;
  const tokens = bribe.bribeTokensAdr;
  for (let i = 0; i < tokens.length; i++) {
    updateBribeToken(bribe, tokens[i]);
  }
  // in bribe contract user always withdraw full amount, you can just delete the record
  store.remove('BribeUser', addressToVeId(event.params.from));
}

export function handleClaimRewards(event: ClaimRewards): void {
  const bribe = BribeEntity.load(event.address.toHexString()) as BribeEntity;
  updateBribeToken(bribe, event.params.reward.toHexString());
}

// ********************************************************
//                HELPERS
// ********************************************************

export function addressToVeId(adr: Address): string {
  return BigInt.fromString(trimHexToInt(adr.toHex())).toString();
}

function trimHexToInt(hex: string): string {
  log.info("TRIM {}", [hex]);
  // @ts-ignore
  hex = hex.replace('0x', '');

  for (let i = 0; i < 100; i++) {
    // @ts-ignore
    if (hex.startsWith('0')) {
      // @ts-ignore
      hex = hex.replace('0', '');
    } else {
      break
    }
  }
  // @ts-ignore
  if (hex.length % 2 != 0) {
    hex = '0' + hex;
  }
  log.info("TRIM RESULT {}", [hex]);
  // @ts-ignore
  return BigInt.fromI32(I32.parseInt(hex, 16)).toString()
}

function getOrCreateBribeUser(veId: string, bribeAdr: string): BribeUser {
  let user = BribeUser.load(bribeAdr+veId);
  if (!user) {
    user = new BribeUser(bribeAdr+veId);
    user.bribe = bribeAdr
    user.veNFT = veId
  }
  return user;
}

function updateBribeToken(
  bribe: BribeEntity,
  rewardTokenAdr: string,
): void {
  const bribeCtr = BribeAbi.bind(Address.fromString(bribe.id));
  const token = getOrCreateToken(rewardTokenAdr)
  const veToken = getOrCreateToken(bribe.veUnderlying);

  let bribeToken = BribeToken.load(bribe.id+rewardTokenAdr)
  // it could be a new token, create if not exist
  if (!bribeToken) {
    bribeToken = new BribeToken(bribe.id+rewardTokenAdr)
    bribeToken.bribe = bribe.id;
    bribeToken.token = token.id;
    const arr = bribe.bribeTokensAdr;
    arr.push(rewardTokenAdr)
    bribe.bribeTokensAdr = arr;
    bribe.save();
  }

  // will be zero if a pair not exist
  const tokenPrice = token.derivedETH;
  const vePrice = veToken.derivedETH;
  const totalSupplyETH = formatUnits(bribeCtr.derivedSupply(), BigInt.fromI32(18)).times(vePrice);

  const rewardRate = formatUnits(bribeCtr.rewardPerToken(Address.fromString(rewardTokenAdr)), token.decimals);
  const amountETH = rewardRate.times(totalSupplyETH).times(tokenPrice)

  bribeToken.amountETH = amountETH;
  bribeToken.apr = calculateApr(ZERO_BI, BigInt.fromI32(60 * 60 * 24 * 7), amountETH, totalSupplyETH);

  bribeToken.save();
}

function getOrCreateToken(tokenAdr: string): Token {
  let token = Token.load(tokenAdr);

  if (!token) {
    token = new Token(tokenAdr);
    const tokenCtr = PairAbi.bind(Address.fromString(tokenAdr));

    token.symbol = tokenCtr.symbol()
    token.name = tokenCtr.name()
    token.decimals = BigInt.fromI32(tokenCtr.decimals())
    token.totalSupply = BigInt.fromI32(0)
    token.tradeVolume = BigDecimal.fromString('0')
    token.tradeVolumeUSD = BigDecimal.fromString('0')
    token.untrackedVolumeUSD = BigDecimal.fromString('0')
    token.whitelist = [];
    token.txCount = BigInt.fromI32(0)
    token.totalLiquidity = BigDecimal.fromString('0')
    token.derivedETH = BigDecimal.fromString('0')
    token.isWhitelisted = false
    token.save();
  }

  return token;
}

