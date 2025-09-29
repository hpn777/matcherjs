import { describe, it, expect, beforeEach } from 'vitest'
import Matcher from '../src/matcher'
import { OrderSide, TimeInForce, OrderType, type Trade } from '../src/types'

const INS = 7

describe('TimeInForce behaviors', () => {
  let matcher: Matcher

  beforeEach(() => {
    matcher = new Matcher()
  })

  it('DAY posts order when there is no match', () => {
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

  it('IOC executes available and does not post remainder', () => {
    // Resting buy 5
    matcher.add({
      orderId: 1n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 5n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    // IOC sell 10 @100 should execute 5 and not post remainder
    const ret = matcher.add({
      orderId: 2n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 100n,
      quantity: 10n,
      filled: 0n,
      tif: TimeInForce.IOC,
      type: OrderType.Limit,
    })

    expect(ret.length).toBe(1)
    expect(ret[0].price).toBe(100n)
    expect(ret[0].volume).toBe(5n)
    expect(matcher.getOrder(2n)).toBeUndefined()
  })

  it('FOK cancels if full quantity cannot be immediately filled', () => {
    // Resting offer: only 3 available at 100
    matcher.add({
      orderId: 3n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 100n,
      quantity: 3n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    // FOK buy wants 5 at 100 -> should not execute or post
    const ret = matcher.add({
      orderId: 4n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 5n,
      filled: 0n,
      tif: TimeInForce.FOK,
      type: OrderType.Limit,
    })

    expect(ret).toEqual([])
    expect(matcher.getOrder(4n)).toBeUndefined()

    // Resting offer remains unchanged
    const o3 = matcher.getOrder(3n)
    expect(o3).toBeDefined()
    expect(o3?.price).toBe(100n)
    expect(o3?.quantity).toBe(3n)
  })
})
