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
    matcher.add({
      orderId: 1n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 10n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    const sec = matcher.book.get(INS)!
    const bids = sec[OrderSide.Buy]
    expect(bids.priceVec.length).toBe(1)
    expect(bids.priceVec[0].price).toBe(100n)
    expect(bids.priceVec[0].nrOfOrders).toBe(1)
    expect(bids.priceVec[0].quantity).toBe(10n)
  })

  it('IOC does not post', () => {
    const events: Trade[][] = []
    matcher.on('match', (t: Trade[]) => events.push(t))
    
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

    matcher.add({
      orderId: 2n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 100n,
      quantity: 10n,
      filled: 0n,
      tif: TimeInForce.IOC,
      type: OrderType.Limit,
    })

    // No match happened and nothing should be posted
    expect(events.length).toBe(1)
    expect(events[0].length).toBe(1)
    expect(events[0][0].price).toBe(100n)
    expect(events[0][0].volume).toBe(5n)
    const order = matcher.getOrder(2n)
    expect(order).toBeUndefined()
  })

  it('FOK cancels if full quantity cannot be immediately filled', () => {
    const events: Trade[][] = []
    matcher.on('match', (t: Trade[]) => events.push(t))

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
    matcher.add({
      orderId: 4n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 5n,
      filled: 0n,
      tif: TimeInForce.FOK,
      type: OrderType.Limit,
    })

    expect(events.length).toBe(0)

    // Resting offer remains unchanged
    const sec = matcher.book.get(INS)!
    const asks = sec[OrderSide.Sell]
    expect(asks.priceVec.length).toBe(1)
    expect(asks.priceVec[0].price).toBe(100n)
    expect(asks.priceVec[0].nrOfOrders).toBe(1)
    expect(asks.priceVec[0].quantity).toBe(3n)

    // No resting FOK buy posted
    const bids = sec[OrderSide.Buy]
    expect(bids.priceVec.length).toBe(0)
  })
})
