import { describe, it, expect, beforeEach } from 'vitest'
import Matcher, { OrderSide, TimeInForce, type Trade } from '../src/Matcher'

const INS = 1

describe('Matcher', () => {
  let matcher: Matcher

  beforeEach(() => {
    matcher = new Matcher()
  })

  it('adds DAY buy order to book when no match', () => {
    matcher.add({
      orderId: 1n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 10n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: 1,
    })

    const sec = matcher.book.get(INS)!
    const bids = sec[OrderSide.Buy]

    expect(bids.priceVec.length).toBe(1)
    expect(bids.priceVec[0].price).toBe(100n)
    expect(bids.priceVec[0].nrOfOrders).toBe(1)
    expect(bids.priceVec[0].ordersVec[0].orderId).toBe(1n)
    expect(bids.priceVec[0].quantity).toBe(10n)
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
    matcher.add({
      orderId: 12n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 101n,
      quantity: 5n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: 1,
    })

    expect(events.length).toBe(1)
    expect(events[0][0].volume).toBe(5n)
    expect(events[0][0].price).toBe(100n)
    expect(events[0][0].bOrderId).toBe(12n)
    expect(events[0][0].sOrderId).toBe(11n)

    const sec = matcher.book.get(INS)!
    const offers = sec[OrderSide.Sell]
    const bids = sec[OrderSide.Buy]

    // Offer bucket exists but is empty after cancel during match
    expect(offers.priceVec.length).toBe(1)
    expect(offers.priceVec[0].nrOfOrders).toBe(0)
    expect(offers.priceVec[0].quantity).toBe(0n)
    // No resting bid was added (fully executed incoming)
    expect(bids.priceVec.length).toBe(0)
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

    const sec = matcher.book.get(INS)!
    const bids = sec[OrderSide.Buy]
    expect(bids.priceVec[0].nrOfOrders).toBe(0)
    expect(bids.priceVec[0].quantity).toBe(0n)
  })

  it('modify retained priority adjusts quantity at same price', () => {
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

    const sec = matcher.book.get(INS)!
    const bids = sec[OrderSide.Buy]
    expect(bids.priceVec.length).toBe(1)
    expect(bids.priceVec[0].price).toBe(100n)
    expect(bids.priceVec[0].nrOfOrders).toBe(1)
    expect(bids.priceVec[0].quantity).toBe(15n)
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

    const sec = matcher.book.get(INS)!
    const bids = sec[OrderSide.Buy]

    // Old price bucket exists but empty after cancel
    expect(bids.priceVec[0].price).toBe(100n)
    expect(bids.priceVec[0].nrOfOrders).toBe(0)

    // New price bucket added with resting order
    expect(bids.priceVec[1].price).toBe(90n)
    expect(bids.priceVec[1].nrOfOrders).toBe(1)
    expect(bids.priceVec[1].ordersVec[0].orderId).toBe(41n)
  })
})
