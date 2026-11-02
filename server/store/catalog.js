// Catalogue and mock orders for the fictional demo store. Stock is mutable in memory.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

export class Catalog {
  constructor(path = resolve(ROOT, 'data/catalog.json')) {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    this.store = data.store;
    this.products = data.products.map((p) => ({ ...p }));
    this.orders = data.orders;
    this.byId = new Map(this.products.map((p) => [p.id, p]));
    this.exchangeSeq = 1000;
  }

  product(id) {
    return this.byId.get(id) ?? null;
  }

  order(id) {
    return this.orders.find((o) => o.id === id) ?? null;
  }

  line(orderId, lineId) {
    const order = this.order(orderId);
    const line = order?.lines.find((l) => l.lineId === lineId) ?? order?.lines[0];
    if (!order || !line) return null;
    return { order, line, product: this.product(line.productId) };
  }

  ordersView() {
    return this.orders.map((o) => ({
      ...o,
      lines: o.lines.map((l) => ({ ...l, product: publicProduct(this.product(l.productId)) })),
    }));
  }

  reserve(productId) {
    const p = this.product(productId);
    if (!p || p.stock <= 0) return false;
    p.stock -= 1;
    return true;
  }

  nextExchangeId() {
    this.exchangeSeq += 1;
    return `HH-X${this.exchangeSeq}`;
  }
}

export function publicProduct(p) {
  if (!p) return null;
  const { id, sku, category, productLine, shadeName, shadeCode, hex, undertone, temperature, family, finish, price, stock, image, garmentImage } = p;
  return { id, sku, category, productLine, shadeName, shadeCode, hex, undertone, temperature, family, finish, price, inStock: stock > 0, image, garmentImage };
}
