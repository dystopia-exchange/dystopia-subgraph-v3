// noinspection JSUnusedGlobalSymbols

import {GaugeEntity, GaugeRewardToken, Pair, Token} from '../types/schema'
import {Address, BigDecimal, BigInt, log} from '@graphprotocol/graph-ts';
import {ClaimRewards, Deposit, GaugeAbi, NotifyReward, Withdraw} from '../types/templates/GaugeTemplate/GaugeAbi';
import {PairAbi} from '../types/templates/GaugeTemplate/PairAbi';
import {BI_18, ZERO_BD, ZERO_BI} from './constants';
import {
  calculateApr,
  convertTokenToDecimal,
  createGaugePosition,
  createLiquidityPosition,
  formatUnits
} from './helpers';


// ********************************************************
//                MAIN LOGIC
// ********************************************************

export function handleNotify(event: NotifyReward): void {
  const gauge = getGauge(event.address);
  updateGaugeToken(gauge, event.params.reward.toHexString(), BigInt.fromI32(0), event.block.timestamp);
}


export function handleDeposit(event: Deposit): void {
  const gauge = getGauge(event.address);
  const tokens = gauge.rewardTokensAddresses;
  for (let i = 0; i < tokens.length; i++) {
    updateGaugeToken(gauge, tokens[i], event.params.amount, event.block.timestamp);
  }

  let userGaugePosition = createGaugePosition(event.address, event.params.from)
  userGaugePosition.stakedLiquidityTokenBalance = userGaugePosition.stakedLiquidityTokenBalance.plus(convertTokenToDecimal(event.params.amount, BI_18))
  userGaugePosition.save()
}

export function handleWithdraw(event: Withdraw): void {
  const gauge = getGauge(event.address);
  const tokens = gauge.rewardTokensAddresses;
  for (let i = 0; i < tokens.length; i++) {
    updateGaugeToken(gauge, tokens[i], event.params.amount.neg(), event.block.timestamp);
  }

  let userGaugePosition = createGaugePosition(event.address, event.params.from)
  userGaugePosition.stakedLiquidityTokenBalance = userGaugePosition.stakedLiquidityTokenBalance.minus(convertTokenToDecimal(event.params.amount, BI_18))
  userGaugePosition.save()
}

export function handleClaimRewards(event: ClaimRewards): void {
  const gauge = getGauge(event.address);
  const tokens = gauge.rewardTokensAddresses;
  for (let i = 0; i < tokens.length; i++) {
    updateGaugeToken(gauge, tokens[i], BigInt.fromI32(0), event.block.timestamp);
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
  amount: BigInt,
  now: BigInt,
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

  gauge.totalSupply = gauge.totalSupply.plus(formatUnits(amount, BigInt.fromI32(18)));
  gauge.totalSupplyETH = gauge.totalSupply.times(pairPriceETH);

  gauge.save();
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

