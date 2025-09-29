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
    const ord = matcher.getOrder(1n)
    expect(ord).toBeDefined()
    expect(ord!.price).toBe(100n)
    expect(ord!.side).toBe(OrderSide.Buy)
  })

  it('IOC does not post', () => {
    const events: Trade[][] = []
    matcher.on('match', (t: Trade[]) => events.push(t))
    
    matcher.add({
      orderId: 11n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 5n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    const ret = matcher.add({
      orderId: 12n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 100n,
      quantity: 10n,
      filled: 0n,
      tif: TimeInForce.IOC,
      type: OrderType.Limit,
    })

    // Should execute available 5 and not post remainder
    expect(ret.length).toBe(1)
    expect(ret[0].price).toBe(100n)
    expect(ret[0].volume).toBe(5n)

    const order = matcher.getOrder(12n)
    expect(order).toBeUndefined()
  })

  it('FOK cancels if full quantity cannot be immediately filled', () => {
    const events: Trade[][] = []
    matcher.on('match', (t: Trade[]) => events.push(t))

    // Resting offer: only 3 available at 100
    matcher.add({
      orderId: 21n,
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
      orderId: 22n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 5n,
      filled: 0n,
      tif: TimeInForce.FOK,
      type: OrderType.Limit,
    })

    // No trades and no order posted
    expect(ret).toEqual([])
    expect(events.length).toBe(0)
    expect(matcher.getOrder(22n)).toBeUndefined()

    // Resting offer remains unchanged
    expect(matcher.getOrder(21n)).toBeDefined()
  })
})
