// noinspection JSUnusedGlobalSymbols

import {GaugeEntity, GaugeRewardToken, Pair, Token} from '../types/schema'
import {Address, BigDecimal, BigInt} from '@graphprotocol/graph-ts';
import {ClaimRewards, Deposit, GaugeAbi, NotifyReward, Withdraw} from '../types/templates/GaugeTemplate/GaugeAbi';
import {PairAbi} from '../types/templates/GaugeTemplate/PairAbi';
import {ZERO_BD, ZERO_BI} from './constants';
import {calculateApr, formatUnits} from './helpers';


// ********************************************************
//                MAIN LOGIC
// ********************************************************

export function handleNotify(event: NotifyReward): void {
  const gauge = getGauge(event.address);
  updateGaugeToken(gauge, event.params.reward.toHexString());
}


export function handleDeposit(event: Deposit): void {
  const gauge = getGauge(event.address);
  const tokens = gauge.rewardTokensAddresses;
  for (let i = 0; i < tokens.length; i++) {
    updateGaugeToken(gauge, tokens[i]);
  }
}

export function handleWithdraw(event: Withdraw): void {
  const gauge = getGauge(event.address);
  const tokens = gauge.rewardTokensAddresses;
  for (let i = 0; i < tokens.length; i++) {
    updateGaugeToken(gauge, tokens[i]);
  }
}

export function handleClaimRewards(event: ClaimRewards): void {
  const gauge = getGauge(event.address);
  const tokens = gauge.rewardTokensAddresses;
  for (let i = 0; i < tokens.length; i++) {
    updateGaugeToken(gauge, tokens[i]);
  }
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
): void {
  const gaugeCtr = GaugeAbi.bind(Address.fromString(gauge.id));
  const token = getOrCreateToken(rewardTokenAdr)
  const pair = Pair.load(gauge.pair) as Pair;

  let rewardToken = GaugeRewardToken.load(gauge.id+rewardTokenAdr);
  if (!rewardToken) {
    rewardToken = new GaugeRewardToken(gauge.id+rewardTokenAdr);
    rewardToken.gauge = gauge.id;
    rewardToken.token = rewardTokenAdr;

    // add static address to the gauge
    const arr = gauge.rewardTokensAddresses;
    arr.push(rewardTokenAdr);
    gauge.rewardTokensAddresses = arr;
    gauge.save();
  }

  // will be zero if a pair not exist
  const tokenPriceETH = token.derivedETH;
  let pairPriceETH = ZERO_BD;
  if (pair.totalSupply.notEqual(ZERO_BD)) {
    pairPriceETH = pair.reserveETH.div(pair.totalSupply);
  }

  const totalSupplyETH = formatUnits(gaugeCtr.derivedSupply(), BigInt.fromI32(18)).times(pairPriceETH);

  const rewardRate = formatUnits(gaugeCtr.rewardPerToken(Address.fromString(rewardTokenAdr)), token.decimals);
  const amountETH = rewardRate.times(totalSupplyETH).times(tokenPriceETH)

  rewardToken.amountETH = amountETH;
  rewardToken.apr = calculateApr(ZERO_BI, BigInt.fromI32(60 * 60 * 24 * 7), amountETH, totalSupplyETH);

  rewardToken.save();
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

