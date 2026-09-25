import React, { useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import CompanyBlogs from '../Company/CompanyBlogs';

/*
 * Smooth guide accordion — only one guide open at a time.
 *  - Opens / closes with a soft height + fade animation.
 *  - The guide you click stays exactly where it is on screen: when a guide
 *    above it closes, the page scroll is corrected every frame, so nothing
 *    jumps.
 *  - Works on the plain <details>/<summary> markup, so the blog content does
 *    not need any change. Respects "reduce motion" in the OS settings.
 */
function useSmoothAccordion(rootRef, deps) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const DURATION = reduceMotion ? 0 : 320;
    const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
    const running = new WeakMap(); // details -> current height animation
    const wantOpen = new WeakMap(); // details -> open state it is moving to

    const isOpen = (d) => (wantOpen.has(d) ? wantOpen.get(d) : d.open);

    // Height of a <details> showing only its summary (padding + border included).
    const closedHeight = (d) => {
      const cs = getComputedStyle(d);
      const summary = d.querySelector(':scope > summary');
      return (
        summary.offsetHeight +
        parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
        parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
      );
    };

    const animate = (d, open) => {
      const start = d.getBoundingClientRect().height;
      running.get(d)?.cancel();
      wantOpen.set(d, open);

      const content = d.querySelector(':scope > :not(summary)');
      const icon = d.querySelector(':scope > summary > span:last-child');

      d.style.overflow = 'hidden';
      if (open) d.open = true;
      let end;
      if (open) {
        d.style.height = 'auto';
        end = d.getBoundingClientRect().height;
      } else {
        end = closedHeight(d);
      }
      d.style.height = '';

      // "+" icon: turn back at the START of closing (not after it).
      if (icon) icon.style.transform = open ? '' : 'rotate(0deg)';

      const anim = d.animate(
        [{ height: `${start}px` }, { height: `${end}px` }],
        { duration: DURATION, easing: EASING },
      );
      if (content) {
        content.animate(
          open
            ? [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }]
            : [{ opacity: 1 }, { opacity: 0 }],
          { duration: DURATION, easing: EASING },
        );
      }
      running.set(d, anim);
      anim.onfinish = () => {
        if (!open) d.open = false;
        d.style.overflow = '';
        if (icon) icon.style.transform = '';
        running.delete(d);
        wantOpen.delete(d);
      };
    };

    // Keep the clicked summary at the same place on screen while things move.
    // behavior 'instant' overrides the site-wide `scroll-behavior: smooth`, and
    // the browser's own scroll anchoring is paused so it doesn't fight us.
    let anchorTimer;
    const keepInPlace = (el) => {
      const html = document.documentElement;
      html.style.overflowAnchor = 'none';
      clearTimeout(anchorTimer);
      const top0 = el.getBoundingClientRect().top;
      const stopAt = performance.now() + DURATION + 80;
      const fix = () => {
        const diff = el.getBoundingClientRect().top - top0;
        if (Math.abs(diff) > 0.5) window.scrollTo({ top: window.scrollY + diff, behavior: 'instant' });
      };
      const tick = () => {
        fix();
        if (performance.now() < stopAt) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      anchorTimer = setTimeout(() => { fix(); html.style.overflowAnchor = ''; }, DURATION + 120);
      return fix;
    };

    const onClick = (e) => {
      const summary = e.target.closest('summary');
      if (!summary || !root.contains(summary)) return;
      const d = summary.parentElement;
      if (!d || d.tagName !== 'DETAILS') return;
      e.preventDefault();

      const open = !isOpen(d);
      const fix = keepInPlace(summary);
      if (open) {
        root.querySelectorAll('details').forEach((other) => {
          if (other !== d && isOpen(other)) animate(other, false);
        });
      }
      animate(d, open);
      fix();
    };

    root.addEventListener('click', onClick);
    return () => {
      root.removeEventListener('click', onClick);
      clearTimeout(anchorTimer);
      document.documentElement.style.overflowAnchor = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const GUIDE_CONFIG = {
  company: {
    label: 'Company Admin',
    eyebrow: 'Company Guides',
    heading: 'Everything about running your company on Khettify.',
    sub: 'Step-by-step guides for company registration, inventory, products, warehouses and more.',
    back: '/company-about',
    backLabel: 'Back to Company About',
    component: <CompanyBlogs />,
  },
  'company-warehouse': {
    label: 'Company Warehouse',
    eyebrow: 'Warehouse Guides',
    heading: 'Everything about managing your warehouse on Khettify.',
    sub: 'Guides for warehouse operators — receiving stock, transfers, barcodes and operations.',
    back: '/company-about',
    backLabel: 'Back to Company About',
    component: null, // CompanyWarehouseBlogs — coming soon
  },
  seller: {
    label: 'Seller',
    eyebrow: 'Seller Guides',
    heading: 'Everything about selling on Khettify.',
    sub: 'Guides for sellers — onboarding, orders, stock transfers, inventory and more.',
    back: '/seller-about',
    backLabel: 'Back to Seller About',
    component: null, // SellerBlogs — coming soon
  },
  'seller-warehouse': {
    label: 'Seller Warehouse',
    eyebrow: 'Seller Warehouse Guides',
    heading: 'Everything about managing your seller warehouse.',
    sub: 'Guides for seller warehouse operators — receiving, dispatch and stock management.',
    back: '/seller-about',
    backLabel: 'Back to Seller About',
    component: null, // SellerWarehouseBlogs — coming soon
  },
};

export default function GuidesPage() {
  const { type } = useParams();
  const config = GUIDE_CONFIG[type];

  // Smooth, one-at-a-time guides (see useSmoothAccordion above).
  const guidesRef = useRef(null);
  useSmoothAccordion(guidesRef, [type]);

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="text-center">
          <p className="text-2xl font-black text-[#1b0e0e]">Guide not found.</p>
          <Link to="/" className="mt-4 inline-block text-[#ea2a33] font-semibold hover:underline">Go home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl flex items-center gap-4">
          <Link
            to={config.back}
            className="inline-flex items-center gap-1.5 text-sm text-[#6b7280] hover:text-[#ea2a33] transition-colors font-medium"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            {config.backLabel}
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-semibold text-[#1b0e0e]">{config.label} Guides</span>
        </div>
      </div>

      {/* Hero */}
      <div className="bg-white border-b border-gray-100 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <span className="text-xs font-bold uppercase tracking-widest text-[#ea2a33]">{config.eyebrow}</span>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-[#1b0e0e] sm:text-5xl leading-tight max-w-2xl">
            {config.heading}
          </h1>
          <p className="mt-4 text-[#6b7280] text-base max-w-xl">{config.sub}</p>
        </div>
      </div>

      {/* Blog content */}
      {config.component ? (
        <div ref={guidesRef}>{config.component}</div>
      ) : (
        <div className="px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl text-center">
            <span className="material-symbols-outlined text-5xl text-gray-300">edit_note</span>
            <p className="mt-4 text-lg font-bold text-[#1b0e0e]">Guides coming soon</p>
            <p className="mt-2 text-sm text-[#6b7280]">We are working on these guides. Check back soon.</p>
            <Link
              to={config.back}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#ea2a33] text-white font-bold px-6 py-2.5 text-sm hover:bg-[#d11f28] transition-colors"
            >
              {config.backLabel}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}