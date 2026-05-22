'use client';
// src/components/PricingBlock.tsx
// Value-Stacking checkout layout:
//   - Struck-through original price beside active discount badge
//   - Urgency indicators: savings amount + discount percentage
//   - CLS-safe: all skeleton slots match final element dimensions exactly
//   - Coupon field wired via useCoupon
//   - Order creation wired via useCreateOrder
//   - Zero backend logic leaks into this file

import { useState, useId }                   from 'react';
import { useQum }                             from '@/components/Providers';
import {
  useProducts,
  useCoupon,
  useCreateOrder,
  type PricingProduct,
}                                             from '@/hooks/useCheckout';

interface PricingBlockProps {
  tenantId: string;
}

// ═════════════════════════════════════════════════════════
//  ROOT
// ═════════════════════════════════════════════════════════
export function PricingBlock({ tenantId }: PricingBlockProps) {
  const { data: products, isLoading, error } = useProducts(tenantId);
  const [selected, setSelected]              = useState<PricingProduct | null>(null);
  const [step, setStep]                      = useState<'grid' | 'form'>('grid');

  function handleSelect(p: PricingProduct) {
    if (p.owned) return; // already owned — open reader instead
    setSelected(p);
    setStep('form');
  }

  if (error) return <ErrorBanner message={(error as Error).message} />;

  return (
    // CLS: min-h locks vertical space so layout doesn't shift when data loads
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="relative py-20 px-5 bg-dark overflow-hidden min-h-[600px]"
    >
      {/* Background glow — pure CSS, no layout impact */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0
          bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(37,99,235,.12),transparent)]"
      />

      <div className="relative max-w-6xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-12">
          <span className="inline-block text-blue-400 text-xs font-bold tracking-widest uppercase mb-3">
            ✦ الباقات
          </span>
          <h2
            id="pricing-heading"
            className="font-tajawal text-3xl md:text-4xl font-black text-white mb-3"
          >
            اشتر مرة واقرأ للأبد
          </h2>
          <p className="text-muted text-sm max-w-md mx-auto leading-relaxed">
            ادفع مرة واحدة — كتبك تنتظرك في مكتبتك على أي جهاز وأي وقت
          </p>
        </div>

        {step === 'grid' ? (
          <ProductGrid
            products={products ?? null}
            isLoading={isLoading}
            onSelect={handleSelect}
          />
        ) : (
          <CheckoutPanel
            tenantId={tenantId}
            product={selected!}
            onBack={() => setStep('grid')}
          />
        )}
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════
//  PRODUCT GRID
// ═════════════════════════════════════════════════════════
function ProductGrid({
  products,
  isLoading,
  onSelect,
}: {
  products:  PricingProduct[] | null;
  isLoading: boolean;
  onSelect:  (p: PricingProduct) => void;
}) {
  // CLS: show skeleton with identical dimensions to real cards
  const items = isLoading
    ? Array.from({ length: 4 }, (_, i) => i)
    : products ?? [];

  return (
    <div
      role="list"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
    >
      {items.map((item, i) =>
        isLoading ? (
          <CardSkeleton key={i} />
        ) : (
          <ProductCard
            key={(item as PricingProduct).id}
            product={item as PricingProduct}
            onSelect={onSelect}
          />
        ),
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════
//  PRODUCT CARD — Value Stacking layout
// ═════════════════════════════════════════════════════════
function ProductCard({
  product: p,
  onSelect,
}: {
  product:  PricingProduct;
  onSelect: (p: PricingProduct) => void;
}) {
  return (
    <article
      role="listitem"
      aria-label={p.title}
      className={[
        'relative flex flex-col rounded-2xl border transition-all duration-300 group',
        'hover:-translate-y-1 hover:shadow-[0_20px_50px_rgba(0,0,0,.5)]',
        p.isPopular
          ? 'border-blue-500 shadow-[0_0_0_1px_#3B82F6,0_20px_50px_rgba(37,99,235,.12)] bg-dark3'
          : 'border-white/8 bg-dark3',
        p.owned
          ? 'border-green-500/40 bg-dark3'
          : '',
      ].join(' ')}
    >
      {/* Popular badge — absolute, no layout impact */}
      {p.isPopular && (
        <div
          aria-label="الأكثر طلباً"
          className="absolute -top-3.5 left-1/2 -translate-x-1/2
            whitespace-nowrap bg-gradient-to-r from-blue-600 to-blue-400
            text-white text-xs font-black px-4 py-1 rounded-full
            shadow-[0_4px_16px_rgba(37,99,235,.4)] z-10"
        >
          ⭐ الأكثر طلباً
        </div>
      )}

      {/* Owned badge */}
      {p.owned && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2
          whitespace-nowrap bg-green-600/80 border border-green-500/40
          text-white text-xs font-bold px-4 py-1 rounded-full z-10">
          ✓ في مكتبتك
        </div>
      )}

      <div className="flex flex-col flex-1 p-5 pt-7">
        {/* Emoji + Tag */}
        <div className="flex items-center justify-between mb-4">
          {/* CLS: fixed w/h so emoji swap doesn't shift layout */}
          <span className="text-3xl w-10 h-10 flex items-center justify-center leading-none">
            {p.emoji}
          </span>
          {p.badge && (
            <span className="text-[10px] font-bold bg-blue-500/15 border border-blue-500/30
              text-blue-300 px-2.5 py-0.5 rounded-full">
              {p.badge}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-white font-bold text-base mb-1 leading-snug">
          {p.title}
        </h3>
        <p className="text-muted text-xs leading-relaxed mb-5">
          {p.tag}
        </p>

        {/* ── VALUE STACK — price display ── */}
        <div className="mb-5 space-y-1">
          {/* Original price — struck through */}
          {p.originalPrice !== null && (
            <div className="flex items-center gap-2 h-5"> {/* CLS: fixed h */}
              <span
                aria-label={`السعر الأصلي ${p.originalPrice} ريال`}
                className="text-muted text-sm line-through decoration-red-400/70"
              >
                {p.originalPrice} ر.س
              </span>
              {/* Discount badge */}
              {p.discountPct !== null && (
                <span
                  aria-label={`خصم ${p.discountPct} بالمئة`}
                  className="inline-flex items-center gap-0.5 bg-red-500/15
                    border border-red-500/30 text-red-400 text-[10px]
                    font-black px-2 py-0.5 rounded-full animate-pulse"
                >
                  ↓ {p.discountPct}%
                </span>
              )}
            </div>
          )}

          {/* Active price */}
          <div className="flex items-baseline gap-1.5">
            <span
              aria-label={`السعر الحالي ${p.price} ريال`}
              className={[
                'font-tajawal font-black leading-none',
                p.isPopular ? 'text-4xl text-blue-300' : 'text-3xl text-white',
              ].join(' ')}
            >
              {p.price}
            </span>
            <span className="text-muted text-sm font-medium">ر.س</span>
          </div>

          {/* Savings callout — only when discount exists */}
          {p.originalPrice !== null && p.originalPrice > p.price && (
            <p
              aria-live="polite"
              className="text-green-400 text-xs font-bold flex items-center gap-1"
            >
              <span aria-hidden>💰</span>
              وفّر {p.originalPrice - p.price} ر.س
            </p>
          )}
        </div>

        {/* Features list — flex-1 pushes CTA to bottom */}
        {p.features.length > 0 && (
          <ul className="flex-1 space-y-2 mb-5" aria-label="مميزات الباقة">
            {p.features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                <span aria-hidden className="text-green-500 font-black mt-0.5 flex-shrink-0">✓</span>
                {f}
              </li>
            ))}
          </ul>
        )}

        {/* CTA */}
        <button
          onClick={() => onSelect(p)}
          disabled={p.owned}
          aria-label={p.owned ? 'تم الشراء مسبقاً' : `شراء ${p.title}`}
          className={[
            'w-full py-3 rounded-xl font-bold text-sm transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
            p.owned
              ? 'bg-green-600/20 border border-green-500/30 text-green-400 cursor-default'
              : p.isPopular
              ? 'bg-gradient-to-r from-blue-600 to-blue-400 text-white shadow-[0_4px_16px_rgba(37,99,235,.35)] hover:shadow-[0_8px_28px_rgba(37,99,235,.5)] hover:-translate-y-0.5 active:translate-y-0'
              : 'border-1.5 border-blue-500/30 text-blue-300 hover:bg-blue-500/10 active:bg-blue-500/20',
          ].join(' ')}
        >
          {p.owned ? '✓ في مكتبتك' : p.isPopular ? '🚀 اشتر الآن' : '🛒 اشتر الآن'}
        </button>
      </div>
    </article>
  );
}

// ═════════════════════════════════════════════════════════
//  SKELETON — exact dimensions as ProductCard (CLS = 0)
// ═════════════════════════════════════════════════════════
function CardSkeleton() {
  return (
    <div
      aria-hidden
      role="presentation"
      className="rounded-2xl border border-white/8 bg-dark3 p-5 pt-7 animate-pulse"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl bg-white/8" />
        <div className="w-14 h-5 rounded-full bg-white/8" />
      </div>
      <div className="h-5 w-3/4 rounded bg-white/8 mb-2" />
      <div className="h-3 w-1/2 rounded bg-white/8 mb-5" />
      {/* Price stack */}
      <div className="space-y-1.5 mb-5">
        <div className="h-5 w-20 rounded bg-white/8" />  {/* struck price */}
        <div className="h-10 w-28 rounded bg-white/8" /> {/* active price */}
        <div className="h-3 w-24 rounded bg-white/8" />  {/* savings */}
      </div>
      {/* Features */}
      {[1,2,3].map(i => <div key={i} className="h-3 rounded bg-white/8 mb-2" />)}
      <div className="h-11 w-full rounded-xl bg-white/8 mt-5" />
    </div>
  );
}

// ═════════════════════════════════════════════════════════
//  CHECKOUT PANEL
// ═════════════════════════════════════════════════════════
function CheckoutPanel({
  tenantId,
  product,
  onBack,
}: {
  tenantId: string;
  product:  PricingProduct;
  onBack:   () => void;
}) {
  const formId = useId();
  const { user, toast }    = useQum();
  const couponCtrl         = useCoupon(tenantId, product.price);
  const createOrder        = useCreateOrder(tenantId);

  const [form, setForm] = useState({
    name:   user?.name  ?? '',
    email:  user?.email ?? '',
    phone:  '',
    method: 'visa' as 'visa' | 'mastercard',
    coupon: '',
  });

  const finalPrice = couponCtrl.applied?.finalPrice ?? product.price;
  const discount   = couponCtrl.applied?.discount   ?? 0;

  function setField<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email) { toast('⚠️ أدخل الاسم والبريد الإلكتروني', 'err'); return; }

    const result = await createOrder.mutateAsync({
      productIds: [product.id],
      name:       form.name,
      email:      form.email,
      phone:      form.phone || undefined,
      couponCode: couponCtrl.applied?.code || undefined,
      method:     form.method,
    }).catch((err: Error) => { toast('❌ ' + err.message, 'err'); return null; });

    if (result) window.open(result.checkoutUrl, '_blank');
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-blue-400 text-sm font-semibold mb-6
          hover:text-blue-300 transition-colors"
      >
        ← رجوع للباقات
      </button>

      <div className="grid md:grid-cols-[1.2fr_1fr] gap-5">

        {/* LEFT: Order summary */}
        <div className="space-y-4">
          {/* Selected product */}
          <div className="rounded-2xl border border-blue-500/25 bg-dark3 p-5">
            <p className="text-xs text-muted font-semibold uppercase tracking-widest mb-3">
              ملخص الطلب
            </p>
            <div className="flex items-start gap-3 mb-4">
              <span className="text-3xl w-10 flex-shrink-0">{product.emoji}</span>
              <div>
                <p className="text-white font-bold text-sm leading-snug">{product.title}</p>
                <p className="text-muted text-xs mt-0.5">{product.tag}</p>
              </div>
            </div>

            {/* Value stack summary */}
            <div className="border-t border-white/8 pt-4 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted">السعر الأصلي</span>
                <span className={product.originalPrice ? 'line-through text-muted text-xs' : 'text-white'}>
                  {product.originalPrice ?? product.price} ر.س
                </span>
              </div>

              {discount > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-green-400 flex items-center gap-1">
                    <span>🎟️</span> خصم الكوبون
                  </span>
                  <span className="text-green-400 font-bold">-{discount} ر.س</span>
                </div>
              )}

              {product.originalPrice && !discount && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-green-400 flex items-center gap-1">
                    <span>💰</span> توفير
                  </span>
                  <span className="text-green-400 font-bold">
                    -{product.originalPrice - product.price} ر.س
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center pt-2 border-t border-white/8">
                <span className="text-white font-bold text-sm">المجموع النهائي</span>
                <span className="text-blue-300 font-black text-xl font-tajawal">
                  {finalPrice} ر.س
                </span>
              </div>
            </div>
          </div>

          {/* Coupon field */}
          <div className="rounded-xl border border-white/8 bg-dark3 p-4">
            <p className="text-xs text-muted font-semibold mb-2">🎟️ كوبون الخصم</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.coupon}
                onChange={e => setField('coupon', e.target.value.toUpperCase())}
                placeholder="أدخل الكود"
                maxLength={20}
                aria-label="كود الخصم"
                className="flex-1 bg-dark2 border border-white/10 rounded-lg px-3 py-2
                  text-sm text-white placeholder:text-muted/60 outline-none
                  focus:border-blue-500/50 transition-colors font-mono tracking-wider"
              />
              <button
                type="button"
                onClick={() => couponCtrl.apply(form.coupon)}
                disabled={form.coupon.length < 3 || couponCtrl.isLoading}
                className="px-4 py-2 rounded-lg bg-blue-600/20 border border-blue-500/30
                  text-blue-300 text-sm font-bold disabled:opacity-50 transition-all
                  hover:bg-blue-600/30 active:scale-95"
              >
                {couponCtrl.isLoading ? '⏳' : 'تطبيق'}
              </button>
            </div>
            {couponCtrl.applied && (
              <p className="mt-2 text-green-400 text-xs font-semibold flex items-center gap-1">
                ✓ {couponCtrl.applied.message}
              </p>
            )}
          </div>

          {/* Payment method */}
          <div className="rounded-xl border border-white/8 bg-dark3 p-4">
            <p className="text-xs text-muted font-semibold mb-3">💳 طريقة الدفع</p>
            <div className="flex gap-2">
              {([
                { id: 'visa',       label: 'فيزا',        logo: <VisaLogo /> },
                { id: 'mastercard', label: 'ماستركارد',   logo: <MastercardLogo /> },
              ] as const).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setField('method', opt.id)}
                  aria-pressed={form.method === opt.id}
                  className={[
                    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg',
                    'border text-sm font-bold transition-all',
                    form.method === opt.id
                      ? 'border-blue-500 bg-blue-600/15 text-blue-300'
                      : 'border-white/10 text-muted hover:border-white/20',
                  ].join(' ')}
                >
                  {opt.logo}
                  <span className="text-xs">{opt.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-muted text-[10px] flex items-center gap-1">
              🔒 دفع آمن ومشفر عبر Stripe — بياناتك محمية 100%
            </p>
          </div>
        </div>

        {/* RIGHT: Customer form */}
        <form
          id={formId}
          onSubmit={handleSubmit}
          noValidate
          className="rounded-2xl border border-white/8 bg-dark3 p-5 flex flex-col gap-4"
        >
          <p className="text-xs text-muted font-semibold uppercase tracking-widest">
            👤 بيانات الحساب
          </p>

          <Field label="الاسم الكامل ★" htmlFor={`${formId}-name`}>
            <input
              id={`${formId}-name`}
              type="text"
              required
              autoComplete="name"
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder="أدخل اسمك"
              className={inputCls}
            />
          </Field>

          <Field label="البريد الإلكتروني ★" htmlFor={`${formId}-email`}>
            <input
              id={`${formId}-email`}
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={e => setField('email', e.target.value)}
              placeholder="example@email.com"
              className={inputCls}
              dir="ltr"
            />
          </Field>

          <Field label="رقم الجوال" htmlFor={`${formId}-phone`}>
            <input
              id={`${formId}-phone`}
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={e => setField('phone', e.target.value)}
              placeholder="+966 5XX XXX XXX"
              className={inputCls}
              dir="ltr"
            />
          </Field>

          {/* Guarantee note */}
          <div className="rounded-lg bg-green-600/8 border border-green-500/20 p-3 mt-auto">
            <p className="text-green-400 text-xs leading-relaxed">
              🛡️ ضمان استرداد كامل خلال 7 أيام — بدون أسئلة
            </p>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={createOrder.isPending}
            form={formId}
            className={[
              'w-full py-3.5 rounded-xl font-black text-sm text-white',
              'bg-gradient-to-r from-blue-600 to-blue-400',
              'shadow-[0_4px_16px_rgba(37,99,235,.35)]',
              'hover:shadow-[0_8px_28px_rgba(37,99,235,.5)]',
              'hover:-translate-y-0.5 active:translate-y-0',
              'transition-all duration-200',
              'disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
            ].join(' ')}
          >
            {createOrder.isPending
              ? '⏳ جاري المعالجة...'
              : `✅ إتمام الدفع — ${finalPrice} ر.س`}
          </button>
        </form>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════
function Field({
  label, htmlFor, children,
}: {
  label: string; htmlFor: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-muted text-xs font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls = [
  'w-full bg-dark2 border border-white/10 rounded-lg px-3 py-2.5',
  'text-sm text-white placeholder:text-muted/60',
  'outline-none focus:border-blue-500/50 transition-colors',
  'disabled:opacity-50',
].join(' ');

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="max-w-md mx-auto mt-8 p-4 rounded-xl bg-red-500/10
        border border-red-500/25 text-red-400 text-sm text-center"
    >
      ❌ {message}
    </div>
  );
}

// Inline SVG logos — no external image requests (no CLS risk)
function VisaLogo() {
  return (
    <svg viewBox="0 0 80 26" width={44} height={16} aria-hidden>
      <text x="0" y="22" fontFamily="Arial" fontSize="22" fontWeight="900"
        fill="#1A1F71" letterSpacing="-1">VISA</text>
    </svg>
  );
}

function MastercardLogo() {
  return (
    <svg viewBox="0 0 52 34" width={38} height={24} aria-hidden>
      <circle cx="18" cy="17" r="15" fill="#EB001B" />
      <circle cx="34" cy="17" r="15" fill="#F79E1B" />
      <path d="M26 5.6a15 15 0 0 1 0 22.8A15 15 0 0 1 26 5.6z" fill="#FF5F00" />
    </svg>
  );
}
