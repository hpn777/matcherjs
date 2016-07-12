var util = require('util');
var events = require('events');

var Matcher = function() {
	var self = this;
	var tradeId = 0
	var ordersMap = new Map();
	this.book = new Map();
	var bucket;
	var neg_bucket;
	var opposite;
	var opposite_volume = 0;
	var bookIndex = 0
	var trades
	var transactions
	var orderRemindVolume
	var tradedVolume

	this.add = function (order) {//{oid:idgen.next(), volume: volume, security: security, price: price, side:0/1(sell/buy), tif: 1,2,3(DAY/FOK/IOC), type: 1, 9(LIMIT/POST_ONLY)}
		neg_bucket = get_neg_bucket(order);
		if (neg_bucket) {
			if (order.type === 9) // POST_ONLY_TYPE
				return;

			trades = []
			transactions = []
			orderRemindVolume = order.volume
			tradedVolume

			opposite_volume = 0;
			bookIndex = 0
			var negBucketLength = neg_bucket.length
			while (neg_bucket && bookIndex < negBucketLength) {
				
				opposite = neg_bucket[bookIndex];
				opposite_volume += opposite.volume;

				tradedVolume = Math.min(opposite.volume, orderRemindVolume)
				trades.push({
					tid: tradeId++,
					bOrderId: opposite.side ? opposite.oid : order.oid,
					sOrderId: opposite.side ? order.oid : opposite.oid,
					volume: tradedVolume,
					price: opposite.price
				})

				orderRemindVolume = orderRemindVolume - tradedVolume
				bookIndex++
				
				if (opposite_volume < order.volume) {
					transactions.push(((neg_bucket, opposite) => {
						return() => {
							ordersMap.delete(opposite.oid)
							neg_bucket.shift();
							if (!neg_bucket.length) {
								remove_pricepoint(opposite.security, opposite.side, opposite.price)
							}
						}
					})(neg_bucket, opposite))
					
					if (bookIndex < negBucketLength && opposite.price !== order.price) {
						neg_bucket = get_neg_bucket(order, opposite.price);
						if (neg_bucket) {
							bookIndex = 0
							negBucketLength = neg_bucket.length
						}
					}
				}
				else if (opposite_volume === order.volume) {
					transactions.push(((neg_bucket, opposite) => {
						return() => {
							ordersMap.delete(opposite.oid)
							neg_bucket.shift();
							if (!neg_bucket.length) {
								remove_pricepoint(opposite.security, opposite.side, opposite.price)
							}
						}
					})(neg_bucket, opposite))
					break;
				}
				else {
					break;
				}
			}

			if (order.tif !== 2 && opposite_volume < order.volume) {
				transactions.forEach((x) => { x() })

				order.volume -= opposite_volume
				order.filled = (order.filled | 0) + opposite_volume

				if (order.tif === 1) {//time in force - DAY
					bucket = get_bucket(order);
					bucket.push(order);
					ordersMap.set(order.oid, order)
				}

				if (trades.length)
					this.emit('match', trades);
			} else if (opposite_volume === order.volume) {
				transactions.forEach((x) => { x() })

				if (trades.length)
					this.emit('match', trades);
			} else if (opposite_volume > order.volume) {
				transactions.forEach((x) => { x() })

				opposite.filled = tradedVolume
				opposite.volume = opposite.volume - tradedVolume

				if (trades.length)
					this.emit('match', trades)
			}
		} else if (order.tif === 1) {//time in force - DAY
			bucket = get_bucket(order);
			bucket.push(order);
			ordersMap.set(order.oid, order)
		}
	};

	this.modify = function (order) {
		var oldOrder = ordersMap.get(order.oid)
		if (oldOrder) {
			var bucket = get_bucket(oldOrder);
			var idx = bucket.findIndex(function (o) { return o.oid === order.oid });

			if (idx !== -1) {
				bucket.splice(idx, 1);
				if (!bucket.length)
					remove_pricepoint(oldOrder.security, oldOrder.side, oldOrder.price)
			}

			oldOrder.price = order.price
			oldOrder.volume = order.volume
			this.add(oldOrder)
		}
	}

	this.cancel = function (order) {
		order = ordersMap.get(order.oid)
		if (order) {
			var bucket = get_bucket(order);
			var idx = bucket.findIndex(function (o) { return o.oid === order.oid });
			if (idx != -1) {
				bucket.splice(idx, 1);
				ordersMap.delete(order.oid)
				if (!bucket.length)
					remove_pricepoint(order.security, order.side, order.price)
			}
		}
	};

	function get_bucket(order, side) {
		var pricePoint = [];
		side = side | order.side
		var security = self.book.get(order.security)
		if (security === undefined) {
			security = [[], []]
			self.book.set(order.security, security);
		}

		var securitySide = security[side]
		var priceIndex = securitySide.findIndex((x) => { return x[0] === order.price })
		if (priceIndex === -1) {
			var tempIndex;
			if (side)
				tempIndex = securitySide.findIndex((x) => { return x[0] < order.price })
			else
				tempIndex = securitySide.findIndex((x) => { return x[0] > order.price })
			
			if (tempIndex === -1)
				securitySide.push([order.price, pricePoint])
			else
				securitySide.splice(tempIndex, 0, [order.price, pricePoint])
		}
		else
			pricePoint = securitySide[priceIndex][1]
		
		return pricePoint;
	}

	function remove_pricepoint(security, side, price) {
		var securitySide = self.book.get(security)[side]
		var priceIndex = securitySide.findIndex((x) => { return x[0] === price })
		if (priceIndex !== -1)
			securitySide.splice(priceIndex, 1)
	}

	function get_neg_bucket(order, refPrice) {
		var side = order.side ? 0 : 1
		var security = self.book.get(order.security)
		if (security !== undefined) {
			var priceLevel = order.price;

			var i = 0
			if (side) {
				if (security[side][0] && security[side][0][0] >= priceLevel) {
					if (refPrice) {
						while (security[side][i] && security[side][i][0] > priceLevel) {
							if (security[side][i][0] < refPrice)
								break;
							i++
						}
					}
				}
				else {
					return;
				}
			}
			else {
				if (security[side][0] && security[side][0][0] <= priceLevel) {
					if (refPrice) {
						while (security[side][i] && security[side][i][0] < priceLevel) {
							if (security[side][i][0] > refPrice)
								break;
							i++
						}
					}
				}
				else {
					return;
				}
			}

			var orders = security[side][i]
			if (orders)
				return orders[1]
		}
	}
}

util.inherits(Matcher, events.EventEmitter);

module.exports = Matcher

if (!Array.prototype.findIndex) {
	Array.prototype.findIndex = function (predicate) {
		for (var i = 0; i < this.length; i++) {
			if (predicate(this[i])) {
				return i;
			}
		}
		return -1;
	};
}
