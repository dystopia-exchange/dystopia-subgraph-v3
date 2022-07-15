// noinspection JSUnusedGlobalSymbols

import {SetVeDist, SetVoter} from '../types/Controller/ControllerAbi';
import {VeDistEntity, VeEntity, VoterEntity} from '../types/schema';
import {ZERO_BD} from './constants';
import {VeDistTemplate, VeTemplate, VoterTemplate} from '../types/templates';
import {VeDistAbi} from '../types/Controller/VeDistAbi';
import {Address} from '@graphprotocol/graph-ts';
import {VeAbi} from '../types/Controller/VeAbi';
import {MintableAbi} from '../types/Controller/MintableAbi';

export function handleSetVeDist(event: SetVeDist): void {
  let veDist = VeDistEntity.load(event.params.value.toHexString());
  const veDistCtr = VeDistAbi.bind(event.params.value);
  if (!veDist) {
    veDist = new VeDistEntity(event.params.value.toHexString());
    veDist.ve = veDistCtr.votingEscrow().toHexString();
    veDist.rewardToken = veDistCtr.token().toHexString();
    veDist.minter = veDistCtr.depositor().toHexString();
    veDist.apr = ZERO_BD
    VeDistTemplate.create(event.params.value);
    veDist.save();
  }
  createVe(veDistCtr.votingEscrow().toHexString());
}

export function handleSetVoter(event: SetVoter): void {
  let voter = VoterEntity.load(event.params.value.toHexString());
  if (!voter) {
    voter = new VoterEntity(event.params.value.toHexString())
    VoterTemplate.create(event.params.value);
    voter.save();
  }
}

function createVe(veAdr: string): void {
  let ve = VeEntity.load(veAdr);
  if (!ve) {
    ve = new VeEntity(veAdr);
    const veCtr = VeAbi.bind(Address.fromString(veAdr));

    ve.totalNFTs = 0
    ve.totalLocked = ZERO_BD
    ve.underlying = veCtr.token().toHexString();
    const mintable = MintableAbi.bind(Address.fromString(ve.underlying))
    ve.underlyingMinter = mintable.minter().toHexString();

    VeTemplate.create(Address.fromString(veAdr));
    ve.save();
  }
}
