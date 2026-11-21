/** Motion tokens (see design-system/order-console/pages/console.md) */
export const ease = [0.22, 1, 0.36, 1] as const;
export const easeIn = [0.4, 0, 1, 1] as const;
export const dur = { fast: 0.15, base: 0.22, slow: 0.35 };
export const spring = { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 } as const;

export const enter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.base, ease } },
  exit: { opacity: 0, y: -4, transition: { duration: dur.fast, ease: easeIn } },
};

export const stagger = (i: number, step = 0.04) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.base, ease, delay: Math.min(i, 10) * step } },
});
