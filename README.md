# matcherjs

Fully functional Matching Engine. 

Performance: ~300k ops. 

## Features included: 
-	Order types: LIMIT, POST_ONLY
-	Time in force: DAY, IOC, FOC

## Planned features:
-	Order types: Iceberg, Conditional

Tests not included… yet.

## Example: 
```javascript
var Matcher = require('./Matcher');
var matcher = new Matcher()

matcher.on('match', (trades) => {
	console.log('trade', trades)
})

matcher.add({ oid: 1, volume: 1000, security: 2003, price: 205, side: 0, tif: 1 })
matcher.add({ oid: 4, volume: 100, security: 2003, price: 200, side: 0, tif: 1 })
matcher.add({ oid: 8, volume: 20, security: 2003, price: 201, side: 0, tif: 1 })
matcher.add({ oid: 9, volume: 10, security: 2003, price: 201, side: 0, tif: 1 })
matcher.add({ oid: 10, volume: 10, security: 2003, price: 201, side: 0, tif: 1 })
matcher.add({ oid: 11, volume: 10, security: 2003, price: 202, side: 0, tif: 1 })
matcher.add({ oid: 2, volume: 10, security: 2003, price: 199, side: 1, tif: 1 })
matcher.add({ oid: 3, volume: 10, security: 2003, price: 205, side: 1, tif: 1 })
matcher.add({ oid: 5, volume: 10, security: 2003, price: 202, side: 1, tif: 1 })
matcher.add({ oid: 6, volume: 10, security: 2003, price: 202, side: 1, tif: 1 })
matcher.modify({ oid: 2, volume: 20, security: 2003, price: 200, side: 1 })
matcher.add({ oid: 7, volume: 200, security: 2003, price: 200, side: 1, tif: 1 })
```
