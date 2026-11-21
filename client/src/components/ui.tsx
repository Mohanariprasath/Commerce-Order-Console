import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import {
  ClipboardText, Package, Truck, XCircle, Mouse, Keyboard, Monitor, Usb, Headphones, Webcam,
  HardDrive, SpeakerHigh, SlidersHorizontal, BatteryCharging, BookOpen,
  type Icon,
} from '@phosphor-icons/react';
import type { Status } from '../types';
import { ease } from '../motion';

const fmtInt = (n: number) => String(Math.round(n));

export function AnimatedNumber({ value, format = fmtInt }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const current = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) { el.textContent = format(value); current.current = value; return; }
    const c = animate(current.current, value, {
      duration: 0.6, ease,
      onUpdate: (v) => { current.current = v; el.textContent = format(v); },
    });
    return () => c.stop();
  }, [value, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref} className="tabular">{format(value)}</span>;
}

export const STATUS_META: Record<Status, { icon: Icon; label: string }> = {
  Placed: { icon: ClipboardText, label: 'Placed' },
  Packed: { icon: Package, label: 'Packed' },
  Shipped: { icon: Truck, label: 'Shipped' },
  Cancelled: { icon: XCircle, label: 'Cancelled' },
};

export function StatusBadge({ status }: { status: Status }) {
  const { icon: I, label } = STATUS_META[status];
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      <I size={14} weight="bold" aria-hidden />
      {label}
    </span>
  );
}

const PRODUCT_ICONS: Record<string, Icon> = {
  WID: Mouse,
  KEY: Keyboard,
  MON: Monitor,
  USB: Usb,
  HDP: Headphones,
  CAM: Webcam,
  SSD: HardDrive,
  EAR: Headphones,
  SPK: SpeakerHigh,
  CRD: SlidersHorizontal,
  PWR: BatteryCharging,
  KDL: BookOpen,
};
export function ProductIcon({ sku, size = 22 }: { sku: string; size?: number }) {
  const I = PRODUCT_ICONS[sku.split('-')[0]] ?? Package;
  return <I size={size} weight="duotone" aria-hidden />;
}

export function stockTone(stock: number): 'out' | 'low' | 'ok' {
  return stock === 0 ? 'out' : stock <= 5 ? 'low' : 'ok';
}

export function StockPill({ stock }: { stock: number }) {
  const tone = stockTone(stock);
  const text = tone === 'out' ? 'Out of stock' : tone === 'low' ? `Low · ${stock} left` : `${stock} in stock`;
  return <span className={`stock-pill stock-${tone}`}><i aria-hidden />{text}</span>;
}

export function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#lg)" />
      <path d="M9 12l7-4 7 4v8l-7 4-7-4z" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 12l7 4 7-4M16 16v8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
