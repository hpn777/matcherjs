import Matcher from './matcher'
import { OrderSide, OrderType, TimeInForce, Price, Quantity, OrderId, PriorityFlag } from './types'

// Simple fast seeded RNG (Mulberry32)
function mulberry32(seed: number) {
  let t = seed >>> 0
  return function () {
    t += 0x6D2B79F5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.includes('=') ? a.split('=') : [a, argv[i + 1]]
      const key = k.replace(/^--/, '')
      if (v !== undefined && !v.startsWith('--')) {
        out[key] = v
        if (!a.includes('=')) i++
      } else {
        out[key] = 'true'
      }
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const durationSec = Number(args['duration'] ?? 10)
const maxOpenOrders = Number(args['max-open'] ?? args['maxOpen'] ?? 100_000)
const tradeToOrderRatio = Math.max(0, Math.min(1, Number(args['trade-ratio'] ?? args['tradeRatio'] ?? 0.3)))
const modifyRatio = Math.max(0, Math.min(1, Number(args['modify-ratio'] ?? args['modifyRatio'] ?? 0.1))) // Default 10% modifications
const numInstruments = Math.max(1, Number(args['instruments'] ?? 8))
const seed = Number(args['seed'] ?? Date.now())

const rnd = mulberry32(seed)

// Price ranges for generating realistic orders
const MIN_PRICE: Price = 100n
const MAX_PRICE: Price = 10000n

// Track open orders for realistic modify/cancel operations
interface TrackedOrder { 
  instrumentId: number
  side: OrderSide
  price: Price 
}

const openOrders = new Map<OrderId, TrackedOrder>()
const ordersByInstrument: Array<{ [OrderSide.Buy]: OrderId[]; [OrderSide.Sell]: OrderId[] }> = []

// Initialize tracking arrays for each instrument
for (let i = 0; i < numInstruments; i++) {
  ordersByInstrument[i] = { [OrderSide.Buy]: [], [OrderSide.Sell]: [] }
}

let nextOrderId: OrderId = 1n
const matcher = new Matcher()

// Performance counters
let addCount = 0
let modifyCount = 0
let cancelCount = 0
let tradeCount = 0

function randomInstrument(): number {
  return Math.floor(rnd() * numInstruments)
}

function randomSide(): OrderSide {
  return rnd() < 0.5 ? OrderSide.Buy : OrderSide.Sell
}

function randomQuantity(): Quantity {
  return BigInt(Math.floor(rnd() * 1000) + 1)
}

function randomPrice(side: OrderSide, shouldCross: boolean = false): Price {
  if (shouldCross) {
    // Generate prices that might cross existing orders
    return BigInt(Math.floor(rnd() * (Number(MAX_PRICE) - Number(MIN_PRICE))) + Number(MIN_PRICE))
  } else {
    // Generate non-crossing prices (conservative approach)
    if (side === OrderSide.Buy) {
      return BigInt(Math.floor(rnd() * 1000) + Number(MIN_PRICE))
    } else {
      return BigInt(Math.floor(rnd() * 1000) + Number(MAX_PRICE) - 1000)
    }
  }
}

function getRandomExistingOrder(instrumentId?: number, side?: OrderSide): OrderId | undefined {
  if (openOrders.size === 0) return undefined
  
  if (instrumentId !== undefined && side !== undefined) {
    const orders = ordersByInstrument[instrumentId][side]
    if (orders.length === 0) return undefined
    
    // Clean up stale orders and return a valid one
    for (let i = orders.length - 1; i >= 0; i--) {
      const orderId = orders[i]
      if (matcher.getOrder(orderId)) {
        return orderId
      } else {
        // Remove stale order
        orders.splice(i, 1)
        openOrders.delete(orderId)
      }
    }
    return undefined
  }
  
  // Return any random existing order
  const orderIds = Array.from(openOrders.keys())
  for (let attempts = 0; attempts < 5; attempts++) {
    const randomId = orderIds[Math.floor(rnd() * orderIds.length)]
    if (matcher.getOrder(randomId)) {
      return randomId
    }
  }
  return undefined
}

function trackOrder(orderId: OrderId, instrumentId: number, side: OrderSide, price: Price) {
  openOrders.set(orderId, { instrumentId, side, price })
  ordersByInstrument[instrumentId][side].push(orderId)
}

function untrackOrder(orderId: OrderId) {
  const order = openOrders.get(orderId)
  if (!order) return
  
  const orders = ordersByInstrument[order.instrumentId][order.side]
  const index = orders.indexOf(orderId)
  if (index >= 0) {
    orders.splice(index, 1)
  }
  openOrders.delete(orderId)
}

function performAdd() {
  const instrumentId = randomInstrument()
  const side = randomSide()
  const shouldCross = rnd() < tradeToOrderRatio
  const price = randomPrice(side, shouldCross)
  
  const order = {
    price,
    tif: TimeInForce.Day,
    orderId: nextOrderId++,
    filled: 0n,
    instrumentId,
    side,
    type: OrderType.Limit,
    quantity: randomQuantity(),
  }

  const trades = matcher.add(order)
  addCount++
  tradeCount += trades.length

  // Track consumed orders (remove them from tracking)
  if (trades.length > 0) {
    const consumedOrders = new Set<OrderId>()
    for (const trade of trades) {
      if (trade.bOrderId !== order.orderId) consumedOrders.add(trade.bOrderId)
      if (trade.sOrderId !== order.orderId) consumedOrders.add(trade.sOrderId)
    }
    
    for (const orderId of consumedOrders) {
      if (!matcher.getOrder(orderId)) {
        untrackOrder(orderId)
      }
    }
  }

  // Track the new order if it's resting in the book
  if (matcher.getOrder(order.orderId)) {
    trackOrder(order.orderId, instrumentId, side, price)
  }
}

function performModify() {
  const orderId = getRandomExistingOrder()
  if (!orderId) {
    performAdd()
    return
  }

  const existingOrder = matcher.getOrder(orderId)
  if (!existingOrder) {
    untrackOrder(orderId)
    performAdd()
    return
  }

  const trackedOrder = openOrders.get(orderId)
  if (!trackedOrder) {
    performAdd()
    return
  }

  const newPrice = randomPrice(existingOrder.side)
  const newQuantity = randomQuantity()
  const priorityFlag = rnd() < 0.3 ? PriorityFlag.Lost : PriorityFlag.Retained

  matcher.modify({
    orderId,
    price: newPrice,
    quantity: newQuantity,
    filled: existingOrder.filled || 0n,
    priorityFlag,
  })

  modifyCount++

  // Update tracking if order still exists
  if (matcher.getOrder(orderId)) {
    trackedOrder.price = newPrice
  } else {
    untrackOrder(orderId)
  }
}

function performCancel() {
  const orderId = getRandomExistingOrder()
  if (!orderId) {
    performAdd()
    return
  }

  matcher.cancel(orderId)
  cancelCount++
  untrackOrder(orderId)
}

// Pre-generate all test data
console.log('Generating test data...')

interface TestOperation {
  type: 'add' | 'modify' | 'cancel'
  order?: any
  modifyData?: any
  orderId?: OrderId
}

// Estimate operations needed (rough calculation)
const estimatedOpsPerSecond = 100000 // Conservative estimate
const totalEstimatedOps = durationSec * estimatedOpsPerSecond
const testOperations: TestOperation[] = []

// Warmup: pre-populate the book with some orders
console.log('Pre-generating warmup orders...')
const warmupTarget = Math.min(Math.floor(maxOpenOrders * 0.1), 10000)
const warmupOrders: any[] = []

for (let i = 0; i < warmupTarget; i++) {
  const instrumentId = randomInstrument()
  const side = randomSide()
  const price = randomPrice(side, false) // Non-crossing for warmup
  
  warmupOrders.push({
    price,
    tif: TimeInForce.Day,
    orderId: nextOrderId++,
    filled: 0n,
    instrumentId,
    side,
    type: OrderType.Limit,
    quantity: randomQuantity(),
  })
}

console.log('Pre-generating test operations...')
// Track simulated order state for data generation
const simulatedOrders = new Map<OrderId, TrackedOrder>()
const simulatedOrdersByInst: Array<{ [OrderSide.Buy]: OrderId[]; [OrderSide.Sell]: OrderId[] }> = []
for (let i = 0; i < numInstruments; i++) {
  simulatedOrdersByInst[i] = { [OrderSide.Buy]: [], [OrderSide.Sell]: [] }
}

function simulateTrackOrder(orderId: OrderId, instrumentId: number, side: OrderSide, price: Price) {
  simulatedOrders.set(orderId, { instrumentId, side, price })
  simulatedOrdersByInst[instrumentId][side].push(orderId)
}

function simulateGetRandomOrder(): OrderId | undefined {
  if (simulatedOrders.size === 0) return undefined
  const orderIds = Array.from(simulatedOrders.keys())
  return orderIds[Math.floor(rnd() * orderIds.length)]
}

function simulateRemoveOrder(orderId: OrderId) {
  const order = simulatedOrders.get(orderId)
  if (!order) return
  
  const orders = simulatedOrdersByInst[order.instrumentId][order.side]
  const index = orders.indexOf(orderId)
  if (index >= 0) orders.splice(index, 1)
  simulatedOrders.delete(orderId)
}

// Add warmup orders to simulation tracking
for (const order of warmupOrders) {
  simulateTrackOrder(order.orderId, order.instrumentId, order.side, order.price)
}

// Generate test operations
for (let i = 0; i < totalEstimatedOps; i++) {
  const currentOpenOrders = simulatedOrders.size
  
  if (currentOpenOrders >= maxOpenOrders) {
    // At capacity, only modify or cancel
    if (rnd() < 0.5) {
      // Generate modify
      const orderId = simulateGetRandomOrder()
      if (orderId) {
        const trackedOrder = simulatedOrders.get(orderId)
        if (trackedOrder) {
          const newPrice = randomPrice(trackedOrder.side === OrderSide.Buy ? OrderSide.Buy : OrderSide.Sell)
          const newQuantity = randomQuantity()
          const priorityFlag = rnd() < 0.3 ? PriorityFlag.Lost : PriorityFlag.Retained
          
          testOperations.push({
            type: 'modify',
            orderId,
            modifyData: {
              orderId,
              price: newPrice,
              quantity: newQuantity,
              filled: 0n,
              priorityFlag,
            }
          })
        }
      }
    } else {
      // Generate cancel
      const orderId = simulateGetRandomOrder()
      if (orderId) {
        testOperations.push({
          type: 'cancel',
          orderId
        })
        simulateRemoveOrder(orderId)
      }
    }
  } else {
    // Normal operation with configurable modify ratio
    // Remaining operations split between add and cancel
    
    const addRatio = 0.5
    const cancelRatio = 1 - addRatio - modifyRatio // Cancel ratio capped at 50% and scales with modify ratio
    
    const operation = rnd()
    if (operation < addRatio) {
      // Generate add
      const instrumentId = randomInstrument()
      const side = randomSide()
      const shouldCross = rnd() < tradeToOrderRatio
      const price = randomPrice(side, shouldCross)
      const orderId = nextOrderId++
      
      const order = {
        price,
        tif: TimeInForce.Day,
        orderId,
        filled: 0n,
        instrumentId,
        side,
        type: OrderType.Limit,
        quantity: randomQuantity(),
      }
      
      testOperations.push({
        type: 'add',
        order
      })
      
      // Simulate that it might get added to book (simplified)
      if (!shouldCross || rnd() > 0.5) {
        simulateTrackOrder(orderId, instrumentId, side, price)
      }
      
    } else if (operation < addRatio + modifyRatio) {
      // Generate modify
      const orderId = simulateGetRandomOrder()
      if (orderId) {
        const trackedOrder = simulatedOrders.get(orderId)
        if (trackedOrder) {
          const newPrice = randomPrice(trackedOrder.side === OrderSide.Buy ? OrderSide.Buy : OrderSide.Sell)
          const newQuantity = randomQuantity()
          const priorityFlag = rnd() < 0.3 ? PriorityFlag.Lost : PriorityFlag.Retained
          
          testOperations.push({
            type: 'modify',
            orderId,
            modifyData: {
              orderId,
              price: newPrice,
              quantity: newQuantity,
              filled: 0n,
              priorityFlag,
            }
          })
        }
      }
    } else {
      // Generate cancel
      const orderId = simulateGetRandomOrder()
      if (orderId) {
        testOperations.push({
          type: 'cancel',
          orderId
        })
        simulateRemoveOrder(orderId)
      }
    }
  }
}

console.log(`Generated ${testOperations.length.toLocaleString()} test operations`)
console.log(`Generated ${warmupOrders.length.toLocaleString()} warmup orders`)

// Execute warmup phase
console.log('Executing warmup phase...')
for (const order of warmupOrders) {
  const trades = matcher.add(order)
  if (matcher.getOrder(order.orderId)) {
    trackOrder(order.orderId, order.instrumentId, order.side, order.price)
  }
}

console.log(`Starting pure performance test...`)
console.log(`Parameters: duration=${durationSec}s, maxOpen=${maxOpenOrders}, tradeRatio=${tradeToOrderRatio}, modifyRatio=${modifyRatio}, instruments=${numInstruments}, seed=${seed}`)

// Reset counters after warmup
addCount = 0
modifyCount = 0
cancelCount = 0
tradeCount = 0

// Pure performance test loop - only execute pre-generated operations
const startTime = process.hrtime.bigint()
let operationIndex = 0

while (operationIndex < testOperations.length) {
  const op = testOperations[operationIndex]
  
  switch (op.type) {
    case 'add':
      const trades = matcher.add(op.order!)
      addCount++
      tradeCount += trades.length
      
      // Track consumed orders
      if (trades.length > 0) {
        const consumedOrders = new Set<OrderId>()
        for (const trade of trades) {
          if (trade.bOrderId !== op.order!.orderId) consumedOrders.add(trade.bOrderId)
          if (trade.sOrderId !== op.order!.orderId) consumedOrders.add(trade.sOrderId)
        }
        
        for (const orderId of consumedOrders) {
          if (!matcher.getOrder(orderId)) {
            untrackOrder(orderId)
          }
        }
      }
      
      // Track new order if resting
      if (matcher.getOrder(op.order!.orderId)) {
        trackOrder(op.order!.orderId, op.order!.instrumentId, op.order!.side, op.order!.price)
      }
      break
      
    case 'modify':
      if (matcher.getOrder(op.orderId!)) {
        matcher.modify(op.modifyData!)
        modifyCount++
        
        // Update tracking if order still exists
        if (matcher.getOrder(op.orderId!)) {
          const trackedOrder = openOrders.get(op.orderId!)
          if (trackedOrder) {
            trackedOrder.price = op.modifyData!.price
          }
        } else {
          untrackOrder(op.orderId!)
        }
      }
      break
      
    case 'cancel':
      if (matcher.getOrder(op.orderId!)) {
        matcher.cancel(op.orderId!)
        cancelCount++
        untrackOrder(op.orderId!)
      }
      break
  }
  
  operationIndex++
  
  // Check if we should stop based on time
  if (operationIndex % 10000 === 0) { // Check time every 10k operations
    if (process.hrtime.bigint() >= startTime + BigInt(durationSec) * 1_000_000_000n) {
      break
    }
  }
}

const actualDuration = Number(process.hrtime.bigint() - startTime) / 1_000_000_000
const totalEvents = addCount + modifyCount + cancelCount
const actualOpsExecuted = operationIndex

// Results
console.log('\n--- Performance Results ---')
console.log(`Actual duration: ${actualDuration.toFixed(2)}s`)
console.log(`Operations executed: ${actualOpsExecuted.toLocaleString()} / ${testOperations.length.toLocaleString()} generated`)
console.log(`Total events: ${totalEvents.toLocaleString()}`)
console.log(`  - Adds: ${addCount.toLocaleString()} (${(addCount/totalEvents*100).toFixed(1)}%)`)
console.log(`  - Modifies: ${modifyCount.toLocaleString()} (${(modifyCount/totalEvents*100).toFixed(1)}%)`)
console.log(`  - Cancels: ${cancelCount.toLocaleString()} (${(cancelCount/totalEvents*100).toFixed(1)}%)`)
console.log(`Trades generated: ${tradeCount.toLocaleString()}`)
console.log(`Final open orders: ${openOrders.size.toLocaleString()}`)
console.log('')
console.log('--- Pure Matcher Throughput ---')
console.log(`Total events/sec: ${(totalEvents / actualDuration).toFixed(0)}`)
console.log(`Adds/sec: ${(addCount / actualDuration).toFixed(0)}`)
console.log(`Modifies/sec: ${(modifyCount / actualDuration).toFixed(0)}`)
console.log(`Cancels/sec: ${(cancelCount / actualDuration).toFixed(0)}`)
console.log(`Trades/sec: ${(tradeCount / actualDuration).toFixed(0)}`)
console.log(`Trade-to-add ratio: ${addCount > 0 ? (tradeCount / addCount * 100).toFixed(1) : '0'}%`)
console.log(`Modify-to-add ratio: ${addCount > 0 ? (modifyCount / addCount * 100).toFixed(1) : '0'}%`)
console.log(`Operations/sec: ${(actualOpsExecuted / actualDuration).toFixed(0)} (including skipped operations)`)