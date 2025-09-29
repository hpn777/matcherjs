import { describe, it, expect, beforeEach } from 'vitest'
import Matcher from '../src/matcher'
import { OrderSide, TimeInForce, OrderType, type Trade } from '../src/types'

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
      type: 1,
    })
    expect(ret).toEqual([])

    const ord = matcher.getOrder(1n)
    expect(ord).toBeDefined()
    expect(ord!.price).toBe(100n)
    expect(ord!.side).toBe(OrderSide.Buy)
  })

  it('matches buy and sell at best price', () => {
    const events: Trade[][] = []
    matcher.on('match', (t: Trade[]) => events.push(t))

    // Add best offer first
    matcher.add({
      orderId: 11n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 100n,
      quantity: 5n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: 1,
    })

    // Crossing bid
    const ret = matcher.add({
      orderId: 12n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 101n,
      quantity: 5n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: 1,
    })

    expect(ret.length).toBe(1)
    expect(ret[0].volume).toBe(5n)
    expect(ret[0].price).toBe(100n)
    expect(ret[0].bOrderId).toBe(12n)
    expect(ret[0].sOrderId).toBe(11n)

    // Both orders fully executed and removed
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
      type: 1,
    })

    matcher.cancel(21n)

    expect(matcher.getOrder(21n)).toBeUndefined()
  })

  it('modify retained priority adjusts at same price', () => {
    matcher.add({
      orderId: 31n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 10n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: 1,
    })

    matcher.modify({
      orderId: 31n,
      price: 100n,
      quantity: 15n,
      filled: 0n,
      priorityFlag: 0x0002, // PriorityFlag.Retained
    })

    const ord = matcher.getOrder(31n)
    expect(ord).toBeDefined()
    expect(ord!.price).toBe(100n)
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
      type: 1,
    })

    matcher.modify({
      orderId: 41n,
      price: 90n,
      quantity: 10n,
      filled: 0n,
      priorityFlag: 0x0001, // PriorityFlag.Lost
    })

    const ord = matcher.getOrder(41n)
    expect(ord).toBeDefined()
    expect(ord!.price).toBe(90n)
  })

  it('rejects PostOnly when it would cross (buy vs best ask)', () => {
    const events: Trade[][] = []
    matcher.on('match', (t: Trade[]) => events.push(t))

    // Resting best ask 105
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
    expect(matcher.getOrder(101n)).toBeDefined()
  })

  it('posts PostOnly buy when it does not cross (below best ask)', () => {
    const events: Trade[][] = []
    matcher.on('match', (t: Trade[]) => events.push(t))

    // Resting best ask 120
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

    // PostOnly buy at 110 does not cross -> should post
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
    const ord = matcher.getOrder(112n)
    expect(ord).toBeDefined()
    expect(ord!.price).toBe(110n)
    expect(ord!.side).toBe(OrderSide.Buy)
  })

  it('posts PostOnly sell when it does not cross (above best bid)', () => {
    const events: Trade[][] = []
    matcher.on('match', (t: Trade[]) => events.push(t))

    // Resting best bid 90
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

    // PostOnly sell at 100 does not cross -> should post
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
    const ord = matcher.getOrder(122n)
    expect(ord).toBeDefined()
    expect(ord!.price).toBe(100n)
    expect(ord!.side).toBe(OrderSide.Sell)
  })
})
