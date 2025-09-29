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

  it('generates multiple trades from single order crossing multiple price levels', () => {
    // Add multiple sell orders at different price levels
    matcher.add({
      orderId: 201n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 100n,
      quantity: 10n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    matcher.add({
      orderId: 202n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 101n,
      quantity: 15n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    matcher.add({
      orderId: 203n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 102n,
      quantity: 20n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    // Add large buy order that crosses all three price levels
    const ret = matcher.add({
      orderId: 204n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 105n,
      quantity: 40n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    // Should generate 3 trades across multiple price levels
    expect(ret.length).toBe(3)

    // First trade: 10 @ 100 (best price first)
    expect(ret[0].volume).toBe(10n)
    expect(ret[0].price).toBe(100n)
    expect(ret[0].bOrderId).toBe(204n)
    expect(ret[0].sOrderId).toBe(201n)

    // Second trade: 15 @ 101
    expect(ret[1].volume).toBe(15n)
    expect(ret[1].price).toBe(101n)
    expect(ret[1].bOrderId).toBe(204n)
    expect(ret[1].sOrderId).toBe(202n)

    // Third trade: 15 @ 102 (partial fill of 20 quantity)
    expect(ret[2].volume).toBe(15n)
    expect(ret[2].price).toBe(102n)
    expect(ret[2].bOrderId).toBe(204n)
    expect(ret[2].sOrderId).toBe(203n)

    // First two orders should be fully consumed
    expect(matcher.getOrder(201n)).toBeUndefined()
    expect(matcher.getOrder(202n)).toBeUndefined()

    // Third order should have 5 remaining (20 - 15)
    const remaining = matcher.getOrder(203n)
    expect(remaining).toBeDefined()
    expect(remaining?.quantity).toBe(5n)
    expect(remaining?.price).toBe(102n)

    // Buy order should be fully consumed
    expect(matcher.getOrder(204n)).toBeUndefined()
  })

  it('generates multiple trades with partial fill of incoming order', () => {
    // Add sell orders at different levels
    matcher.add({
      orderId: 301n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 95n,
      quantity: 5n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    matcher.add({
      orderId: 302n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 96n,
      quantity: 8n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    // Large buy order that partially fills and posts remainder
    const ret = matcher.add({
      orderId: 303n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 100n,
      quantity: 20n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    // Should generate 2 trades
    expect(ret.length).toBe(2)

    // First trade: 5 @ 95
    expect(ret[0].volume).toBe(5n)
    expect(ret[0].price).toBe(95n)

    // Second trade: 8 @ 96
    expect(ret[1].volume).toBe(8n)
    expect(ret[1].price).toBe(96n)

    // Sell orders should be consumed
    expect(matcher.getOrder(301n)).toBeUndefined()
    expect(matcher.getOrder(302n)).toBeUndefined()

    // Buy order should remain with remainder posted (20 - 5 - 8 = 7)
    const buyOrder = matcher.getOrder(303n)
    expect(buyOrder).toBeDefined()
    expect(buyOrder?.quantity).toBe(20n)
    expect(buyOrder?.filled).toBe(13n)
    expect(buyOrder?.price).toBe(100n)
  })

  it('matches orders at same price level within single bucket', () => {
    // Add multiple sell orders at same price level
    matcher.add({
      orderId: 301n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 100n,
      quantity: 8n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    matcher.add({
      orderId: 302n,
      instrumentId: INS,
      side: OrderSide.Sell,
      price: 100n,
      quantity: 12n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    // Large buy order that crosses multiple orders at same price
    const ret = matcher.add({
      orderId: 303n,
      instrumentId: INS,
      side: OrderSide.Buy,
      price: 101n,
      quantity: 15n,
      filled: 0n,
      tif: TimeInForce.Day,
      type: OrderType.Limit,
    })

    // Should generate multiple trades at same price level
    expect(ret.length).toBe(2)

    // First trade: 8 @ 100
    expect(ret[0].volume).toBe(8n)
    expect(ret[0].price).toBe(100n)
    expect(ret[0].sOrderId).toBe(301n)

    // Second trade: 7 @ 100 (partial fill of second order)
    expect(ret[1].volume).toBe(7n)
    expect(ret[1].price).toBe(100n)
    expect(ret[1].sOrderId).toBe(302n)

    // First sell order consumed
    expect(matcher.getOrder(301n)).toBeUndefined()

    // Second sell order partially filled
    const remaining = matcher.getOrder(302n)
    expect(remaining).toBeDefined()
    expect(remaining?.quantity).toBe(5n) // 12 - 7

    // Buy order fully consumed
    expect(matcher.getOrder(303n)).toBeUndefined()
  })
})
