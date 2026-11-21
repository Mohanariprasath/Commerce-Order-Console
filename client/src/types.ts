export type Status = 'Placed' | 'Packed' | 'Shipped' | 'Cancelled';

export interface Product {
  id: number;
  sku: string;
  name: string;
  priceCents: number;
  stock: number;
  brand?: string;
  category?: string;
  description?: string;
  rating?: number;
}
export interface OrderSummary {
  ref: string;
  status: Status;
  subtotalCents?: number;
  taxCents?: number;
  totalCents: number;
  customerName?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  allowedTransitions: Status[];
}
export interface OrderItem { productId: number; sku: string; name: string; unitPriceCents: number; quantity: number }
export interface OrderDetail extends OrderSummary { items: OrderItem[] }
export interface StockProblem { productId: number; message: string }
export interface CreateOrderPayload {
  items: { productId: number; quantity: number }[];
  customerName?: string;
  notes?: string;
}
