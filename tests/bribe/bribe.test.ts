import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  createMockedFunction,
  describe,
  test
} from "matchstick-as/assembly/index"
import {Address, BigDecimal, ethereum} from "@graphprotocol/graph-ts"
import {newMockEvent} from "matchstick-as";
import {Deposit, NotifyReward} from '../../src/types/templates/BribeTemplate/BribeAbi';
import {
  BRIBE_ADR, BRIBE_ENTITY, BRIBE_TOKEN_ENTITY, BRIBE_USER_ENTITY,
  createBribe,
  REWARD_ADR,
  REWARD_AMOUNT,
  LEFT,
  TOTAL_SUPPLY, USER_ADR,
  VE_UNDERLYING_ADR, PERIOD_FINISH
} from './bribe-utils';
import {ADDRESS_ZERO, ZERO_BI} from '../../src/mappings/constants';
import {addressToVeId, handleDeposit, handleNotify} from '../../src/mappings/bribe';
import {createToken, mockTokenFunctions} from '../utils';


beforeEach(() => {
  createBribe();
})

afterEach(() => {
  clearStore();
})

describe("bribe-tests", () => {

  test('handleNotify test', () => {

    createMockedFunction(Address.fromString(BRIBE_ADR), "derivedSupply", "derivedSupply():(uint256)")
      .returns([ethereum.Value.fromUnsignedBigInt(TOTAL_SUPPLY)])
    createMockedFunction(Address.fromString(BRIBE_ADR), "periodFinish", "periodFinish(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(Address.fromString(REWARD_ADR))])
      .returns([ethereum.Value.fromUnsignedBigInt(PERIOD_FINISH)])
    createMockedFunction(Address.fromString(BRIBE_ADR), "left", "left(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(Address.fromString(REWARD_ADR))])
      .returns([ethereum.Value.fromUnsignedBigInt(LEFT)])

    mockTokenFunctions(REWARD_ADR);
    mockTokenFunctions(VE_UNDERLYING_ADR);

    createToken(REWARD_ADR, BigDecimal.fromString('1'));
    createToken(VE_UNDERLYING_ADR, BigDecimal.fromString('1'));

    // @ts-ignore
    const event = changetype<NotifyReward>(newMockEvent());
    event.block.timestamp = ZERO_BI
    event.address = Address.fromString(BRIBE_ADR);
    event.parameters = [];
    event.parameters.push(new ethereum.EventParam("from", ethereum.Value.fromAddress(Address.fromString(ADDRESS_ZERO))))
    event.parameters.push(new ethereum.EventParam("reward", ethereum.Value.fromAddress(Address.fromString(REWARD_ADR))))
    event.parameters.push(new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(REWARD_AMOUNT)))

    handleNotify(event);

    assert.fieldEquals(BRIBE_TOKEN_ENTITY, BRIBE_ADR + REWARD_ADR, 'totalSupply', '100')
    assert.fieldEquals(BRIBE_TOKEN_ENTITY, BRIBE_ADR + REWARD_ADR, 'totalSupplyETH', '100')
    assert.fieldEquals(BRIBE_TOKEN_ENTITY, BRIBE_ADR + REWARD_ADR, 'left', '3')
    assert.fieldEquals(BRIBE_TOKEN_ENTITY, BRIBE_ADR + REWARD_ADR, 'leftETH', '3')
    assert.fieldEquals(BRIBE_TOKEN_ENTITY, BRIBE_ADR + REWARD_ADR, 'apr', '1095')
  })

  test('deposit test', () => {

    createMockedFunction(Address.fromString(BRIBE_ADR), "totalSupply", "totalSupply():(uint256)")
      .returns([ethereum.Value.fromUnsignedBigInt(TOTAL_SUPPLY)])
    createMockedFunction(Address.fromString(BRIBE_ADR), "rewardRate", "rewardRate(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(Address.fromString(REWARD_ADR))])
      .returns([ethereum.Value.fromUnsignedBigInt(LEFT)])

    mockTokenFunctions(REWARD_ADR);
    mockTokenFunctions(VE_UNDERLYING_ADR);

    // @ts-ignore
    const event = changetype<Deposit>(newMockEvent());
    event.parameters = [];
    event.address = Address.fromString(BRIBE_ADR);
    event.parameters.push(new ethereum.EventParam("from", ethereum.Value.fromAddress(Address.fromString(USER_ADR))))
    event.parameters.push(new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(REWARD_AMOUNT)))

    handleDeposit(event);

    assert.stringEquals('26', addressToVeId(Address.fromString(USER_ADR)));
    assert.fieldEquals(BRIBE_USER_ENTITY, BRIBE_ADR + addressToVeId(Address.fromString(USER_ADR)), 'bribe', BRIBE_ADR)
  })

  test('addressToVeId test', () => {
    assert.stringEquals('26', addressToVeId(Address.fromString('0x000000000000000000000000000000000000001a')));
    assert.stringEquals('17', addressToVeId(Address.fromString('0x0000000000000000000000000000000000000011')));
    assert.stringEquals('1', addressToVeId(Address.fromString('0x0000000000000000000000000000000000000001')));
    assert.stringEquals('9', addressToVeId(Address.fromString('0x0000000000000000000000000000000000000009')));
    assert.stringEquals('5', addressToVeId(Address.fromString('0x0000000000000000000000000000000000000005')));
    assert.stringEquals('1365', addressToVeId(Address.fromString('0x0000000000000000000000000000000000000555')));
    assert.stringEquals('21845', addressToVeId(Address.fromString('0x0000000000000000000000000000000000005555')));
    assert.stringEquals('349525', addressToVeId(Address.fromString('0x0000000000000000000000000000000000055555')));
  })

})
