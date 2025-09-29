import { ElementId, OrderId, Quantity, Price, PriorityFlag, OrderSide, TimeInForce, OrderType, Trade } from './types'

type InstrumentBook = { [K in OrderSide]: Buckets }

type OrderModify = {
  orderId: OrderId
  price: Price
  quantity: Quantity
  filled: Quantity
  priorityFlag: PriorityFlag
}

type Order = {
  price: Price
  tif: TimeInForce
  orderId: OrderId
  filled: Quantity
  instrumentId: number
  side: OrderSide
  type: OrderType
  quantity: Quantity
}

type BookOrder = Order & {
  index?: number
}

class Bucket {
  public ordersVec: Array<BookOrder>
  public quantity: Quantity = 0n
  public nrOfOrders = 0
  public constructor(public price: Price = 0n) {
    this.ordersVec = new Array<BookOrder>()
  }
}

class Buckets {
  public priceMap: Map<Price, Bucket>
  public priceVec: Array<Bucket>
  public constructor() {
    this.priceMap = new Map()
    this.priceVec = new Array<Bucket>()
  }
}

// OrderBook structure: Map<security, [sellSide, buySide]>
// Each side is an array of [price, bucket[]], where bucket is Order[]
export class Matcher {
  private tradeId = 0;
  private ordersMap = new Map<OrderId, BookOrder>()
  private book = new Map<ElementId, InstrumentBook>();

  add = (order: Order): Trade[] => {
    let trades: Trade[] = []
    let applied = false

    let neg_bucket = this.getNegBucket(order);
    if (neg_bucket) {
      if (order.type === OrderType.PostOnly) return trades;

      const transactions: Array<() => void> = [];

      let orderRemindVolume = order.quantity;
      let tradedVolume = 0n;

      let opposite_volume: Quantity = 0n;
      let bookIndex = 0;
      let opposite: Order | undefined;

      let negBucketLength = neg_bucket.nrOfOrders;
      while (neg_bucket && bookIndex < negBucketLength) {
        opposite = neg_bucket.ordersVec[bookIndex];
        opposite_volume += opposite.quantity;

        tradedVolume = orderRemindVolume < opposite.quantity ? orderRemindVolume : opposite.quantity;
        trades.push({
          tid: this.tradeId++,
          bOrderId: opposite.side ? opposite.orderId : order.orderId,
          sOrderId: opposite.side ? order.orderId : opposite.orderId,
          volume: tradedVolume,
          price: opposite.price,
        });

        orderRemindVolume = orderRemindVolume - tradedVolume;
        bookIndex++;

        if (opposite_volume < order.quantity) {
          const oppRef = opposite;
          transactions.push(() => {
            this.cancel(oppRef.orderId);
          });

          if (bookIndex < negBucketLength && opposite.price !== order.price) {
            const nb = this.getNegBucket(order, opposite.price);
            if (nb) {
              neg_bucket = nb;
              bookIndex = 0;
              negBucketLength = neg_bucket.nrOfOrders;
            }
          }
        } else if (opposite_volume === order.quantity) {
          const oppRef = opposite;
          transactions.push(() => {
            this.cancel(oppRef.orderId);
          });
          break;
        } else {
          break;
        }
      }

      if (order.tif !== TimeInForce.FOK && opposite_volume < order.quantity) {
        transactions.forEach((x) => x());
        applied = true
        order.filled = (order.filled || 0n) + opposite_volume;

        if (order.tif !== TimeInForce.IOC) {
          const bucket = this.getBucket(order);
          this._add(order);
        }
      } else if (opposite_volume === order.quantity) {
        transactions.forEach((x) => x());
        applied = true
      } else if (opposite_volume > order.quantity && opposite) {
        transactions.forEach((x) => x());
        applied = true
        opposite.filled = tradedVolume;
        opposite.quantity = opposite.quantity - tradedVolume;
      }
    } else if (order.tif === TimeInForce.Day) {
      this._add(order);
    }

    return applied ? trades : []
  };

  private _add = (order: BookOrder) => {
    if (
      order.price !== 0n &&
      order.tif !== TimeInForce.IOC &&
      order.tif !== TimeInForce.FOK
    ) {
      const bucket = this.getBucket(order)
      bucket.quantity += this.getLeavesQty(order)
      order.index = bucket.nrOfOrders
      bucket.ordersVec[bucket.nrOfOrders] = order
      bucket.nrOfOrders++
    }

    this.ordersMap.set(order.orderId, order)
  }

  modify = (orderModify: OrderModify) => {
    const oldOrder = this.ordersMap.get(orderModify.orderId)
    if (!oldOrder) {
      return
    }
    const oldLeaves = this.getLeavesQty(oldOrder)

    if (orderModify.priorityFlag === PriorityFlag.Lost) {
      this.cancel(orderModify.orderId)
      oldOrder.price = orderModify.price
      oldOrder.quantity = orderModify.quantity
      oldOrder.filled = orderModify.filled
      this.add(oldOrder)
    } else {
      oldOrder.price = orderModify.price
      const bucket = this.getBucket(oldOrder)
      bucket.quantity += orderModify.quantity - oldLeaves
      oldOrder.quantity = orderModify.quantity
      oldOrder.filled = orderModify.filled
    }
  }

  cancel = (orderId: bigint) => {
    const order = this.ordersMap.get(orderId)
    if (!order) {
      return
    }

    if (
      order.tif !== TimeInForce.IOC &&
      order.tif !== TimeInForce.FOK
    ) {
      const bucket = this.getBucket(order)
      let idx = order.index as number
      if (idx >= 0) {
        bucket.nrOfOrders--
        // update quantity
        bucket.quantity -= this.getLeavesQty(order)
        // remove order from ordersVec
        while (idx < bucket.nrOfOrders) {
          bucket.ordersVec[idx] = bucket.ordersVec[idx+1]
          bucket.ordersVec[idx].index = idx
          idx++
        }
        bucket.ordersVec[idx] = undefined as any
      }
    }

    this.ordersMap.delete(orderId)
  }

  getOrder = (orderId: bigint) => {
    return this.ordersMap.get(orderId)
  }

  private getBucket = (order: Order) => {
    let pricePoint: Bucket | undefined
    const { side } = order
    let security = this.book.get(order.instrumentId)
    if (security === undefined) {
      security = { 0 : new Buckets(), 1: new Buckets() }
      this.book.set(order.instrumentId, security)
    }

    const securitySide = security[side]
    pricePoint = securitySide.priceMap.get(order.price)
    if (pricePoint === undefined) {
      pricePoint = new Bucket(order.price)
      let i = securitySide.priceVec.length

      if (side === OrderSide.Buy) {
        while (i > 0 && securitySide.priceVec[i - 1].price < order.price) {
          securitySide.priceVec[i] = securitySide.priceVec[i - 1]
          i--
        }
      } else {
        while (i > 0 && securitySide.priceVec[i - 1].price > order.price) {
          securitySide.priceVec[i] = securitySide.priceVec[i - 1]
          i--
        }
      }
      securitySide.priceVec[i] = pricePoint
      securitySide.priceMap.set(order.price, pricePoint)
    }

    return pricePoint
  }

  private getNegBucket(order: Order, refPrice?: Price): Bucket | undefined {
    const side = order.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy
    const security = this.book.get(order.instrumentId);
    if (security !== undefined) {
      const priceLevel = order.price;

      let i = 0;
      if (side === OrderSide.Buy) {
        if (security[side].priceVec[0] && security[side].priceVec[0].price >= priceLevel) {
          if (refPrice) {
            while (security[side].priceVec[i] && security[side].priceVec[i].price > priceLevel) {
              if (security[side].priceVec[i].price < refPrice) break;
              i++;
            }
          }
        } else {
          return;
        }
      } else {
        if (security[side].priceVec[0] && security[side].priceVec[0].price <= priceLevel) {
          if (refPrice) {
            while (security[side].priceVec[i] && security[side].priceVec[i].price < priceLevel) {
              if (security[side].priceVec[i].price > refPrice) break;
              i++;
            }
          }
        } else {
          return;
        }
      }

      const orders = security[side].priceVec[i];
      return orders;
    }
    return undefined;
  }

  private getLeavesQty = (order: Order | OrderModify) => {
    return order.filled ? order.quantity - order.filled : order.quantity
  }
}

export default Matcher;
