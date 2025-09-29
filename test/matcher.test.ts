import { describe, it, expect, beforeEach } from 'vitest'
import Matcher from '../src/matcher'
import { OrderSide, TimeInForce, OrderType } from '../src/types'

const INS = 1

describe('Matcher', () => {
  let matcher: Matcher

  beforeEach(() => {
    matcher = new Matcher()
  })

  it('adds DAY buy order to book when no match', () => {
    const ret = matcher.add({
      orderId: 1n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 10n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })
    expect(ret).toEqual([])

    const o = matcher.getOrder(1n)
    expect(o).toBeDefined()
    expect(o?.price).toBe(100n)
    expect(o?.quantity).toBe(10n)
  })

  it('matches buy and sell at best price', () => {
    matcher.add({
      orderId: 11n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 100n,
      quantity: 5n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    const ret = matcher.add({
      orderId: 12n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 101n,
      quantity: 5n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    expect(ret.length).toBe(1)
    expect(ret[0].volume).toBe(5n)
    expect(ret[0].price).toBe(100n)
    expect(ret[0].bOrderId).toBe(12n)
    expect(ret[0].sOrderId).toBe(11n)

    // Both orders consumed/removed
    expect(matcher.getOrder(11n)).toBeUndefined()
    expect(matcher.getOrder(12n)).toBeUndefined()
  })

  it('cancel removes resting order', () => {
    matcher.add({
      orderId: 21n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 10n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    matcher.cancel(21n)
    expect(matcher.getOrder(21n)).toBeUndefined()
  })

  it('modify retained priority adjusts effective quantity at same price', () => {
    matcher.add({
      orderId: 31n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 10n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    matcher.modify({
      orderId: 31n,
      price: 100n,
      quantity: 15n,
      filled: 0n,
      priorityFlag: 0x0002, // PriorityFlag.Retained
    })

    // Cross with 15 sell and verify full 15 executes
    const ret = matcher.add({
      orderId: 33n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 100n,
      quantity: 15n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })
    expect(ret.length).toBe(1)
    expect(ret[0].volume).toBe(15n)
    // Original order fully consumed
    expect(matcher.getOrder(31n)).toBeUndefined()
  })

  it('modify lost priority moves order to new price', () => {
    matcher.add({
      orderId: 41n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 10n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    matcher.modify({
      orderId: 41n,
      price: 90n,
      quantity: 10n,
      filled: 0n,
      priorityFlag: 0x0001, // PriorityFlag.Lost
    })

    const o = matcher.getOrder(41n)
    expect(o).toBeDefined()
    expect(o?.price).toBe(90n)
  })

  it('rejects PostOnly when it would cross (buy vs best ask)', () => {
    matcher.add({
      orderId: 101n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 105n,
      quantity: 100n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    const ret = matcher.add({
      orderId: 102n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 110n,
      quantity: 50n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.PostOnly,
    })

    expect(ret).toEqual([])
    expect(matcher.getOrder(102n)).toBeUndefined()
    const ask = matcher.getOrder(101n)
    expect(ask).toBeDefined()
    expect(ask?.price).toBe(105n)
  })

  it('posts PostOnly buy when it does not cross (below best ask)', () => {
    matcher.add({
      orderId: 111n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 120n,
      quantity: 100n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    const ret = matcher.add({
      orderId: 112n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 110n,
      quantity: 40n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.PostOnly,
    })

    expect(ret).toEqual([])
    const o = matcher.getOrder(112n)
    expect(o).toBeDefined()
    expect(o?.price).toBe(110n)
    expect(o?.quantity).toBe(40n)
  })

  it('posts PostOnly sell when it does not cross (above best bid)', () => {
    matcher.add({
      orderId: 121n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 90n,
      quantity: 100n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    const ret = matcher.add({
      orderId: 122n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 100n,
      quantity: 25n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.PostOnly,
    })

    expect(ret).toEqual([])
    const o = matcher.getOrder(122n)
    expect(o).toBeDefined()
    expect(o?.price).toBe(100n)
    expect(o?.quantity).toBe(25n)
  })
})
