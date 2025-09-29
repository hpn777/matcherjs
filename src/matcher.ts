import { ElementId, OrderId, Quantity, Price, PriorityFlag, OrderSide, TimeInForce, OrderType, Trade } from './types'

// Instrument book contains buy and sell sides for a single instrument
type InstrumentBook = { [K in OrderSide]: Buckets }

// Order modification request with priority flag to determine if order loses time priority
type OrderModify = {
  orderId: OrderId
  price: Price
  quantity: Quantity
  filled: Quantity
  priorityFlag: PriorityFlag  // Determines if order retains or loses time priority
}

// Core order structure representing a market participant's intent to trade
type Order = {
  price: Price           // Limit price (0n for market orders)
  tif: TimeInForce      // Order duration/behavior (Day, IOC, FOK)
  orderId: OrderId      // Unique identifier for the order
  filled: Quantity      // Amount already executed
  instrumentId: number  // Security/instrument identifier
  side: OrderSide      // Buy (0) or Sell (1)
  type: OrderType      // Limit or PostOnly
  quantity: Quantity   // Total order size
}

// Book order extends Order with index for efficient removal from price level
type BookOrder = Order & {
  index?: number  // Position within the price level for O(1) cancellation
}

/**
 * Price level bucket containing all orders at a specific price point.
 * Orders within a bucket are processed in time priority (FIFO).
 */
class Bucket {
  public ordersVec: Array<BookOrder>  // Orders at this price level in time priority
  public quantity: Quantity = 0n      // Total resting quantity at this price
  public nrOfOrders = 0              // Count of orders at this price level
  public constructor(public price: Price = 0n) {
    this.ordersVec = new Array<BookOrder>()
  }
}

/**
 * Price-ordered collection of buckets for one side of the book.
 * Maintains both map (O(1) price lookup) and vector (price priority iteration).
 */
class Buckets {
  public priceMap: Map<Price, Bucket>  // Fast price-to-bucket lookup
  public priceVec: Array<Bucket>       // Price-ordered buckets for matching
  public constructor() {
    this.priceMap = new Map()
    this.priceVec = new Array<Bucket>()
  }
}

// OrderBook structure: Map<instrumentId, [sellSide, buySide]>
// Each side maintains price-ordered buckets with time priority within each price level
/**
 * Central limit order book matching engine implementing price-time priority.
 * Supports multiple instruments, various order types, and time-in-force options.
 * 
 * Matching Algorithm:
 * 1. Find opposing orders that can trade with incoming order
 * 2. Execute trades in price-time priority across multiple price levels
 * 3. Handle partial fills and remaining quantities based on TimeInForce
 * 4. Post remaining quantity to book (unless IOC/FOK or fully filled)
 */
export class Matcher {
  private tradeId = 0;  // Monotonic trade identifier
  private ordersMap = new Map<OrderId, BookOrder>()  // All live orders for O(1) lookup
  private book = new Map<ElementId, InstrumentBook>();  // Per-instrument order books

  /**
   * Core matching algorithm that processes an incoming order against the book.
   * 
   * Algorithm Flow:
   * 1. Check for crossing orders on opposite side
   * 2. Execute trades in price-time priority, potentially crossing multiple price levels
   * 3. Handle TimeInForce constraints (IOC executes available, FOK requires full fill)
   * 4. Post remaining quantity to book if appropriate
   * 
   * @param order - Incoming order to match
   * @returns Array of trades generated, empty if no matching occurred
   */
  add = (order: Order): Trade[] => {
    let trades: Trade[] = []
    let applied = false

    // Find best opposing price level that can trade with this order
    let neg_bucket = this.getNegBucket(order);
    if (neg_bucket) {
      // PostOnly orders cannot execute immediately - they must post to book
      if (order.type === OrderType.PostOnly) return trades;

      // Collect order cancellations to execute after matching is complete
      const transactions: Array<() => void> = [];

      let orderRemindVolume = order.quantity;  // Remaining quantity to fill
      let tradedVolume = 0n;                  // Volume of current trade

      let opposite_volume: Quantity = 0n;     // Total available volume at current price
      let bookIndex = 0;                      // Current position within price level
      let opposite: Order | undefined;        // Current opposing order

      let negBucketLength = neg_bucket.nrOfOrders;
      // Process orders in time priority within current price level
      while (neg_bucket && bookIndex < negBucketLength) {
        opposite = neg_bucket.ordersVec[bookIndex];
        opposite_volume += opposite.quantity;

        // Calculate trade size as minimum of remaining quantities
        tradedVolume = orderRemindVolume < opposite.quantity ? orderRemindVolume : opposite.quantity;
        trades.push({
          tid: this.tradeId++,
          // Ensure consistent trade reporting: buy order ID first, then sell order ID
          bOrderId: opposite.side ? opposite.orderId : order.orderId,
          sOrderId: opposite.side ? order.orderId : opposite.orderId,
          volume: tradedVolume,
          price: opposite.price,  // Trade at resting order's price (price improvement for aggressor)
        });

        orderRemindVolume = orderRemindVolume - tradedVolume;
        bookIndex++;

        if (opposite_volume < order.quantity) {
          // Opposing order will be completely filled - schedule for removal
          const oppRef = opposite;
          transactions.push(() => {
            this.cancel(oppRef.orderId);
          });

          // Multi-level crossing: move to next better price level when current level exhausted
          // This elegant single-line addition enables crossing multiple price levels
          if (bookIndex === negBucketLength && opposite.price !== order.price) {
            const nb = this.getNegBucket(order, neg_bucket.price);
            if (nb) {
              neg_bucket = nb;           // Move to next price level
              bookIndex = 0;             // Reset position in new level
              negBucketLength = neg_bucket.nrOfOrders;
            }
          }
        } else if (opposite_volume === order.quantity) {
          // Perfect match - both orders completely filled
          const oppRef = opposite;
          transactions.push(() => {
            this.cancel(oppRef.orderId);
          });
          break;
        } else {
          // Incoming order completely filled, opposing order partially filled
          break;
        }
      }

      // Handle TimeInForce constraints after matching phase
      if (order.tif !== TimeInForce.FOK && opposite_volume < order.quantity) {
        // Partial fill acceptable - execute trades and post remainder (unless IOC)
        transactions.forEach((x) => x());
        applied = true
        order.filled = (order.filled || 0n) + opposite_volume;

        // Post remaining quantity to book (Day orders only, IOC does not post)
        if (order.tif !== TimeInForce.IOC) {
          const bucket = this.getBucket(order);
          this._add(order);
        }
      } else if (opposite_volume === order.quantity) {
        // Complete fill - execute all trades
        transactions.forEach((x) => x());
        applied = true
      } else if (opposite_volume > order.quantity && opposite) {
        // Incoming order completely filled, update opposing order's remaining quantity
        transactions.forEach((x) => x());
        applied = true
        opposite.filled = tradedVolume;
        opposite.quantity = opposite.quantity - tradedVolume;
      }
    } else if (order.tif === TimeInForce.Day) {
      // No crossing possible - post Day orders directly to book
      this._add(order);
    }

    return applied ? trades : []
  };

  /**
   * Internal method to add an order to the book without matching.
   * Maintains price-time priority and updates all necessary data structures.
   */
  private _add = (order: BookOrder) => {
    // Only add orders with valid prices that can rest on the book
    if (
      order.price !== 0n &&
      order.tif !== TimeInForce.IOC &&
      order.tif !== TimeInForce.FOK
    ) {
      const bucket = this.getBucket(order)
      bucket.quantity += this.getLeavesQty(order)  // Update total quantity at price level
      order.index = bucket.nrOfOrders            // Set order's position for fast removal
      bucket.ordersVec[bucket.nrOfOrders] = order  // Add to end (time priority)
      bucket.nrOfOrders++
    }

    // Always maintain order lookup map for modifications and cancellations
    this.ordersMap.set(order.orderId, order)
  }

  /**
   * Modifies an existing order's price and/or quantity.
   * Priority flag determines if the order retains its time priority or moves to back of queue.
   */
  modify = (orderModify: OrderModify) => {
    const oldOrder = this.ordersMap.get(orderModify.orderId)
    if (!oldOrder) {
      return
    }
    const oldLeaves = this.getLeavesQty(oldOrder)

    if (orderModify.priorityFlag === PriorityFlag.Lost) {
      // Modification loses time priority - cancel and re-add as new order
      this.cancel(orderModify.orderId)
      oldOrder.price = orderModify.price
      oldOrder.quantity = orderModify.quantity
      oldOrder.filled = orderModify.filled
      this.add(oldOrder)
    } else {
      // Modification retains time priority - update in place
      oldOrder.price = orderModify.price
      const bucket = this.getBucket(oldOrder)
      bucket.quantity += orderModify.quantity - oldLeaves  // Adjust bucket total
      oldOrder.quantity = orderModify.quantity
      oldOrder.filled = orderModify.filled
    }
  }

  /**
   * Removes an order from the book and all tracking structures.
   * Maintains array compactness by shifting remaining orders and updating indices.
   */
  cancel = (orderId: bigint) => {
    const order = this.ordersMap.get(orderId)
    if (!order) {
      return
    }

    // Only orders resting on book need bucket cleanup
    if (
      order.tif !== TimeInForce.IOC &&
      order.tif !== TimeInForce.FOK
    ) {
      const bucket = this.getBucket(order)
      let idx = order.index as number
      if (idx >= 0) {
        bucket.nrOfOrders--
        // Update bucket total quantity
        bucket.quantity -= this.getLeavesQty(order)
        
        // Compact array by shifting orders left and updating their indices
        while (idx < bucket.nrOfOrders) {
          bucket.ordersVec[idx] = bucket.ordersVec[idx+1]
          bucket.ordersVec[idx].index = idx  // Update index after shift
          idx++
        }
        bucket.ordersVec[idx] = undefined as any  // Clear last position
      }
    }

    this.ordersMap.delete(orderId)
  }

  /**
   * Public API to retrieve order details by ID.
   * Used for order status queries and testing.
   */
  getOrder = (orderId: bigint) => {
    return this.ordersMap.get(orderId)
  }

  /**
   * Gets or creates the price bucket for an order on its side of the book.
   * Maintains price priority ordering: best prices first in the array.
   * - Buy side: highest prices first (descending order)  
   * - Sell side: lowest prices first (ascending order)
   */
  private getBucket = (order: Order) => {
    let pricePoint: Bucket | undefined
    const { side } = order
    
    // Get or create instrument book
    let security = this.book.get(order.instrumentId)
    if (security === undefined) {
      security = { 0 : new Buckets(), 1: new Buckets() }
      this.book.set(order.instrumentId, security)
    }

    const securitySide = security[side]
    pricePoint = securitySide.priceMap.get(order.price)
    
    if (pricePoint === undefined) {
      // Create new price level and insert in price priority order
      pricePoint = new Bucket(order.price)
      let i = securitySide.priceVec.length

      if (side === OrderSide.Buy) {
        // Buy side: insert in descending price order (best bid first)
        while (i > 0 && securitySide.priceVec[i - 1].price < order.price) {
          securitySide.priceVec[i] = securitySide.priceVec[i - 1]
          i--
        }
      } else {
        // Sell side: insert in ascending price order (best offer first)
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

  /**
   * Finds the best opposing price level that can trade with the incoming order.
   * 
   * @param order - Incoming order seeking matches
   * @param refPrice - Optional reference price for multi-level crossing (finds next better level)
   * @returns Bucket containing opposing orders that can trade, or undefined if no crossing
   * 
   * Matching Logic:
   * - Buy orders match against sells at price <= buy price
   * - Sell orders match against buys at price >= sell price  
   * - For multi-level crossing, refPrice helps find the next better price level
   */
  private getNegBucket(order: Order, refPrice?: Price): Bucket | undefined {
    const side = order.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy
    const security = this.book.get(order.instrumentId);
    if (security !== undefined) {
      const priceLevel = order.price;

      let i = 0;
      if (side === OrderSide.Buy) {
        // Looking for buy orders: check if best bid >= our sell price
        if (security[side].priceVec[0] && security[side].priceVec[0].price >= priceLevel) {
          if (refPrice) {
            // Multi-level crossing: find next price level better than refPrice
            while (security[side].priceVec[i] && security[side].priceVec[i].price > priceLevel) {
              if (security[side].priceVec[i].price < refPrice) break;
              i++;
            }
          }
        } else {
          return;  // No crossing possible
        }
      } else {
        // Looking for sell orders: check if best offer <= our buy price  
        if (security[side].priceVec[0] && security[side].priceVec[0].price <= priceLevel) {
          if (refPrice) {
            // Multi-level crossing: find next price level better than refPrice
            while (security[side].priceVec[i] && security[side].priceVec[i].price < priceLevel) {
              if (security[side].priceVec[i].price > refPrice) break;
              i++;
            }
          }
        } else {
          return;  // No crossing possible
        }
      }

      const orders = security[side].priceVec[i];
      return orders;
    }
    return undefined;
  }

  /**
   * Calculates the remaining (unfilled) quantity of an order.
   * Used for updating bucket totals and determining tradeable quantity.
   */
  private getLeavesQty = (order: Order | OrderModify) => {
    return order.filled ? order.quantity - order.filled : order.quantity
  }
}

export default Matcher;
