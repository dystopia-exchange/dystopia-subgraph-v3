// noinspection JSUnusedGlobalSymbols

import {GaugeEntity, GaugeRewardToken, GaugeUserPosition, Pair, Token} from '../types/schema'
import {Address, BigDecimal, BigInt, log} from '@graphprotocol/graph-ts';
import {ClaimRewards, Deposit, GaugeAbi, NotifyReward, Withdraw} from '../types/templates/GaugeTemplate/GaugeAbi';
import {PairAbi} from '../types/templates/GaugeTemplate/PairAbi';
import {ZERO_BD, ZERO_BI} from './constants';
import {calculateApr, formatUnits} from './helpers';


// ********************************************************
//                MAIN LOGIC
// ********************************************************

export function handleNotify(event: NotifyReward): void {
  const gauge = getGauge(event.address);
  updateGaugeToken(gauge, event.params.reward.toHexString(), event.block.timestamp);
  gauge.save();
}


export function handleDeposit(event: Deposit): void {
  const gauge = getGauge(event.address);
  const tokens = gauge.rewardTokensAddresses;
  let pairPriceETH = ZERO_BD;
  for (let i = 0; i < tokens.length; i++) {
    pairPriceETH = updateGaugeToken(gauge, tokens[i], event.block.timestamp);
  }

  updateGaugeSupply(gauge, event.params.amount, pairPriceETH)

  // USER POSITION
  const pos = getOrCreateGaugeUserPosition(gauge.id, event.params.from.toHexString());
  // assume only LP tokens with 18 decimals
  pos.balance = pos.balance.plus(formatUnits(event.params.amount, BigInt.fromI32(18)))
  gauge.totalDerivedSupply = gauge.totalDerivedSupply.minus(pos.derivedBalance);
  pos.derivedBalance = formatUnits(GaugeAbi.bind(event.address).derivedBalance(event.params.from), BigInt.fromI32(18));
  gauge.totalDerivedSupply = gauge.totalDerivedSupply.plus(pos.derivedBalance);

  pos.save();
  gauge.save();
}

export function handleWithdraw(event: Withdraw): void {
  const gauge = getGauge(event.address);
  const tokens = gauge.rewardTokensAddresses;
  let pairPriceETH = ZERO_BD;
  for (let i = 0; i < tokens.length; i++) {
    pairPriceETH = updateGaugeToken(gauge, tokens[i], event.block.timestamp);
  }
  updateGaugeSupply(gauge, event.params.amount.neg(), pairPriceETH)


  // USER POSITION
  const pos = getOrCreateGaugeUserPosition(gauge.id, event.params.from.toHexString());
  // assume only LP tokens with 18 decimals
  pos.balance = pos.balance.minus(formatUnits(event.params.amount, BigInt.fromI32(18)))
  gauge.totalDerivedSupply = gauge.totalDerivedSupply.minus(pos.derivedBalance);
  pos.derivedBalance = formatUnits(GaugeAbi.bind(event.address).derivedBalance(event.params.from), BigInt.fromI32(18));
  gauge.totalDerivedSupply = gauge.totalDerivedSupply.plus(pos.derivedBalance);

  pos.save();
  gauge.save();
}

export function handleClaimRewards(event: ClaimRewards): void {
  const gauge = getGauge(event.address);
  const tokens = gauge.rewardTokensAddresses;
  for (let i = 0; i < tokens.length; i++) {
    updateGaugeToken(gauge, tokens[i], event.block.timestamp);
  }

  gauge.save();
}

// ********************************************************
//                HELPERS
// ********************************************************


function getGauge(adr: Address): GaugeEntity {
  return GaugeEntity.load(adr.toHexString()) as GaugeEntity;
}

function updateGaugeToken(
  gauge: GaugeEntity,
  rewardTokenAdr: string,
  now: BigInt,
): BigDecimal {
  const gaugeCtr = GaugeAbi.bind(Address.fromString(gauge.id));
  const token = getOrCreateToken(rewardTokenAdr)
  const pair = Pair.load(gauge.pair) as Pair;

  let rewardToken = GaugeRewardToken.load(gauge.id + rewardTokenAdr);
  if (!rewardToken) {
    rewardToken = new GaugeRewardToken(gauge.id + rewardTokenAdr);
    rewardToken.gauge = gauge.id;
    rewardToken.token = rewardTokenAdr;

    // add static address to the gauge
    const arr = gauge.rewardTokensAddresses;
    arr.push(rewardTokenAdr);
    gauge.rewardTokensAddresses = arr;
  }

  // will be zero if a pair not exist
  const tokenPriceETH = token.derivedETH;
  let pairPriceETH = ZERO_BD;
  if (pair.totalSupply.notEqual(ZERO_BD)) {
    pairPriceETH = pair.reserveETH.div(pair.totalSupply);
  }

  const totalSupply = formatUnits(gaugeCtr.totalSupply(), BigInt.fromI32(18));
  const totalSupplyETH = totalSupply.times(pairPriceETH);

  const left = formatUnits(gaugeCtr.left(Address.fromString(rewardTokenAdr)), token.decimals);
  const finishPeriod = gaugeCtr.periodFinish(Address.fromString(rewardTokenAdr));
  const leftETH = left.times(tokenPriceETH)

  rewardToken.totalSupply = totalSupply;
  rewardToken.totalSupplyETH = totalSupplyETH;
  rewardToken.left = left;
  rewardToken.leftETH = leftETH;
  rewardToken.apr = calculateApr(now, finishPeriod, leftETH, totalSupplyETH);

  rewardToken.save();

  return pairPriceETH;
}

function updateGaugeSupply(gauge: GaugeEntity, amount: BigInt, pairPriceETH: BigDecimal): void {
  gauge.totalSupply = gauge.totalSupply.plus(formatUnits(amount, BigInt.fromI32(18)));
  gauge.totalSupplyETH = gauge.totalSupply.times(pairPriceETH);
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

function getOrCreateGaugeUserPosition(gaugeAdr: string, userAdr: string): GaugeUserPosition {
  let pos = GaugeUserPosition.load(gaugeAdr + userAdr);
  if (!pos) {
    pos = new GaugeUserPosition(gaugeAdr + userAdr);
    pos.gauge = gaugeAdr;
    pos.user = userAdr;
    pos.balance = ZERO_BD;
    pos.derivedBalance = ZERO_BD;
  }
  return pos;
}

