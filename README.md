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

## License
MIT. See `LICENSE`.
