export type ElementId = number

export type OrderId = bigint

export type Quantity = bigint

export type Price = bigint

export enum PriorityFlag {
  Lost = 0x0001,
  Retained = 0x0002,
}

export enum OrderSide {
  Sell = 0,
  Buy = 1,
}

export enum TimeInForce {
  Day = 0x0001,
  GTC = 0x0002,
  IOC = 0x0003,
  FOK = 0x0004,
  VFA = 0x0005,
  GTD = 0x0006,
  VFC = 0x0007,
  GTT = 0x0008,
}

export enum OrderType {
  Limit = 0x0001,
  Market = 0x0002,
  MarketToLimit = 0x0003,
  Iceberg = 0x0004,
  PostOnly = 0x0009,
}

export interface Trade {
  tid: number;
  bOrderId: OrderId;
  sOrderId: OrderId;
  volume: Quantity;
  price: Price;
}
