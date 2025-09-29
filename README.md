# matcherjs

A fast, minimal matching engine written in TypeScript. Ships CommonJS output for Node.js with type declarations.

- Order types: LIMIT, POST_ONLY
- Time in force (TIF): DAY, IOC, FOK
- Emits a single `match` event per add that executes, and also returns the executed trades from `add()`.

## Requirements
- Node.js 18+ (for BigInt and modern TS target)

## Install (local clone)
- Install deps: `npm i`
- Build: `npm run build`
- Test: `npm test`

## NPM scripts
- `build` – compile TS to `dist/`
- `watch` – compile in watch mode
- `clean` – remove `dist/`
- `test` / `test:watch` – run Vitest tests
- `perf` – run performance benchmark (see Performance Testing below)

## Usage

### JavaScript (CommonJS)
```js
const Matcher = require('matcherjs/dist/matcher.js'); // after publishing to npm
// const Matcher = require('./dist/matcher.js'); // local build

const matcher = new Matcher();
matcher.on('match', (trades) => {
  console.log('trades', trades);
});

// All numeric quantities/prices/ids use BigInt
matcher.add({
  orderId: 1n,
  instrumentId: 1001,
  side: 1,            // OrderSide.Buy
  price: 100n,
  quantity: 10n,
  filled: 0n,
  tif: 0x0001,        // TimeInForce.Day
  type: 0x0001,       // OrderType.Limit
});
```

### TypeScript
```ts
import Matcher from 'matcherjs/dist/matcher';
import { OrderSide, TimeInForce, OrderType } from 'matcherjs/dist/types';

const m = new Matcher();
const trades = m.add({
  orderId: 2n,
  instrumentId: 1001,
  side: OrderSide.Sell,
  price: 100n,
  quantity: 5n,
  filled: 0n,
  tif: TimeInForce.Day,
  type: OrderType.Limit,
});
// trades is Trade[] (may be empty if nothing executed)
```

Notes
- `add(order)` returns the list of executed trades for that call and also emits `match` with the same trades.
- For `POST_ONLY`, the order is rejected if it would cross and no trades are returned/emitted; if it does not cross, it posts to the book and returns an empty array.
- `IOC` executes immediately available quantity and does not post remainder.
- `FOK` executes only if the full quantity can be immediately filled; otherwise nothing executes and nothing posts.
- The internal book is private; use `getOrder(orderId)` to inspect a resting order (returns `undefined` if not resting).

BigInt tip: JSON does not support BigInt. If you ingest JSON, pass ids/prices/quantities as strings and convert (e.g., `BigInt("100")`).

## API (minimal)
- `class Matcher extends EventEmitter`
  - `add(order): Trade[]` – process an order, possibly return executed trades and emit `match`.
  - `modify(change)` – modify a resting order. If `priorityFlag` indicates loss of priority, the order is cancelled and re-added (re-queued at the new price).
  - `cancel(orderId: bigint)` – cancel a resting order.
  - `getOrder(orderId: bigint)` – returns the internal resting order (or `undefined`).

### Types
Exported from `matcherjs/dist/types` (or `./src/types` in local dev):
- `OrderSide` (Sell=0, Buy=1)
- `TimeInForce` (Day, IOC, FOK, …)
- `OrderType` (Limit, PostOnly, …)
- Scalars: `OrderId`, `Price`, `Quantity`
- `Trade`

Order shape used by `add`:
```ts
{
  orderId: bigint;
  instrumentId: number;
  side: OrderSide;
  price: bigint;
  quantity: bigint;
  filled: bigint; // usually 0n for new orders
  tif: TimeInForce;
  type: OrderType; // Limit or PostOnly are supported
}
```

## Testing
- Unit tests are written with Vitest under `test/`.
- Run once: `npm test`
- Watch mode: `npm run test:watch`

## Performance Testing
The project includes a performance benchmark to measure matching engine throughput.

Run the benchmark:
```bash
npm run perf -- --duration=10 --max-open=100000 --trade-ratio=0.05 --modify-ratio=0.1 --instruments=1000
```

Parameters:
- `--duration` – test duration in seconds (default: 10)
- `--max-open` – maximum number of open orders at any time (default: 100,000)
- `--trade-ratio` – probability that an add operation will attempt to cross existing orders (0.0-1.0, default: 0.3)
- `--modify-ratio` – proportion of operations that are modifications (0.0-1.0, default: 0.1)
- `--instruments` – number of different instruments to spread orders across (default: 8)
- `--seed` – random seed for reproducible results (default: current timestamp)

Example output:
```
--- Performance Results ---
Actual duration: 2.00s
Operations executed: 200,000 / 200,000 generated
Total events: 199,711
  - Adds: 72,077 (36.1%)
  - Modifies: 63,769 (31.9%)
  - Cancels: 63,865 (32.0%)
Trades generated: 180
Final open orders: 8,523

--- Pure Matcher Throughput ---
Total events/sec: 363,974
Adds/sec: 131,361
Modifies/sec: 116,219
Cancels/sec: 116,394
Trades/sec: 328
Trade-to-add ratio: 0.2%
Modify-to-add ratio: 88.5%
Operations/sec: 364,500
```

## License
MIT. See `LICENSE`.
