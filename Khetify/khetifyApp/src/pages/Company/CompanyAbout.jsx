import React, { useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';

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

const FAQ_ITEMS = [
    { q: "What documents are mandatory?", a: "GSTIN with certificate, Udyam or CIN with certificate, and PAN card with copy are all required for verification. All files must be in PNG or PDF format and clearly legible." },
    { q: "How long does approval take?", a: "Typically 24 to 48 hours after submission, depending on document verification by the Khetify team. You will receive an email notification once the process is complete." },
    { q: "Can I edit my details after submission?", a: "Minor corrections may be possible by contacting Khetify support. For major changes, you may need to resubmit your application." },
    { q: "What happens if my application is rejected?", a: "You will receive an email clearly explaining the reason for rejection. You can correct the issue and resubmit with updated documents at any time." },
    { q: "Is registration free?", a: "Yes, creating a company account on Khetify is completely free. There are no setup fees or registration charges." },
    { q: "What can I do after my company is approved?", a: "Once approved, you can upload your product catalogue, add warehouses, manage inventory with lot-level traceability, issue Principal Certificates to sellers, process supply requests, manage your team, and view sales reports." },
];

function FaqAccordion() {
    const [open, setOpen] = React.useState(0);
    return (
        <div className="flex flex-col lg:flex-row gap-12 lg:gap-20">
            {/* Left — heading */}
            <div className="lg:w-72 shrink-0">
                <p className="text-xs font-bold uppercase tracking-widest text-[#ea2a33] mb-4">Questions</p>
                <h3 className="text-4xl font-black text-[#1b0e0e] leading-tight mb-4">
                    Before you<br />commit.
                </h3>
                <p className="text-[#6b7280] text-sm leading-relaxed">
                    Still deciding? Here's what companies usually ask before registering on Khetify.
                </p>
            </div>
            {/* Right — accordion */}
            <div className="flex-1 divide-y divide-gray-200">
                {FAQ_ITEMS.map((item, i) => (
                    <div key={i} className="py-5">
                        <button
                            className="flex w-full items-start justify-between gap-4 text-left"
                            onClick={() => setOpen(open === i ? -1 : i)}
                        >
                            <span className={`text-base font-medium leading-snug transition-colors ${open === i ? 'text-[#1b0e0e]' : 'text-[#374151]'}`}>
                                {item.q}
                            </span>
                            <span className={`shrink-0 mt-0.5 text-xl font-light transition-colors ${open === i ? 'text-[#ea2a33]' : 'text-[#ea2a33]'}`}>
                                {open === i ? '−' : '+'}
                            </span>
                        </button>
                        {open === i && (
                            <p className="mt-4 text-sm text-[#6b7280] leading-relaxed pr-8">
                                {item.a}
                            </p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

const CompanyAbout = () => {
    const navigate = useNavigate();
    // Smooth, one-at-a-time guides (see useSmoothAccordion above).
    const guidesRef = useRef(null);
    useSmoothAccordion(guidesRef, []);

    useEffect(() => {
        // Page load hote hi scroll top par bhej deta hai
        window.scrollTo(0, 0);
        
        // Font aur Icon styles ko head mein add karne ke liye
        const link = document.createElement("link");
        link.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1";
        link.rel = "stylesheet";
        document.head.appendChild(link);
    }, []);

    return (
        <div className="bg-white text-[#1b0e0e] overflow-x-hidden w-full antialiased font-sans selection:bg-[#ea2a33]/10">
            {/* Custom Styles for Hero and Icons */}
            <style>
                {`
                .hero-bg-overlay {
                    background: linear-gradient(rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.55)), url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?ixlib=rb-4.0.3&auto=format&fit=crop&w=2400&q=80');
                    background-size: cover;
                    background-position: center;
                    background-attachment: fixed;
                }
                .material-symbols-outlined {
                    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
                }
                `}
            </style>

            {/* Header */}
            <header className="sticky top-0 z-50 w-full border-b border-gray-100 bg-white/90 backdrop-blur-md">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold tracking-tight text-[#ea2a33]">Khettify</span>
                    </div>
                    <nav className="hidden md:flex items-center gap-8 h-full">
                        <a className="text-sm font-medium text-[#1b0e0e] border-b-2 border-[#ea2a33] pb-1 transition-colors" href="#hero">Platform</a>
                        <a className="text-sm font-medium text-[#1b0e0e] hover:text-[#ea2a33] transition-colors" href="#why-modernize">Solutions</a>
                        <a className="text-sm font-medium text-[#1b0e0e] hover:text-[#ea2a33] transition-colors" href="#footer">Support</a>
                    </nav>
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={() => navigate('/login')}
                            className="hidden md:flex h-9 items-center justify-center rounded-lg border border-gray-200 px-4 text-sm font-bold text-[#1b0e0e] transition-all hover:bg-[#ea2a33] hover:text-white hover:border-[#ea2a33]"
                        >
                            Register/Login
                        </button>
                        <button className="md:hidden p-2 text-[#1b0e0e]">
                            <span className="material-symbols-outlined">menu</span>
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex flex-col w-full">
                {/* Hero Section */}
                <section className="relative w-full px-4 py-20 sm:px-6 lg:px-8 lg:py-48 hero-bg-overlay" id="hero">
                    <div className="mx-auto flex max-w-4xl flex-col items-center text-center relative z-10">
                        <h1 className="text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl drop-shadow-lg">
                            The Digital Core of Your<br className="hidden sm:inline"/>
                            <span className="text-[#ea2a33]"> Agricultural Distribution</span>
                        </h1>
                        <p className="mt-6 max-w-2xl text-lg text-gray-100 font-medium drop-shadow-md">
                            Integrated IMS, CRM, and scaling control designed specifically for modern agricultural businesses. Streamline your supply chain from seed to sale.
                        </p>
                        <div className="mt-10 flex justify-center">
                            <button 
                                onClick={() => navigate('/register')}
                                className="inline-flex h-12 items-center justify-center rounded-lg bg-[#ea2a33] px-10 text-base font-bold text-white shadow-xl shadow-[#ea2a33]/20 transition-all hover:bg-[#b91c23] hover:shadow-[#ea2a33]/30 focus:outline-none focus:ring-2 focus:ring-[#ea2a33]"
                            >
                                Register as Company
                            </button>
                        </div>
                    </div>
                </section>

               {/* Experience Bar */}
<section className="w-full border-y border-gray-100 bg-[#f8f9fa] px-4 py-8">
  <div className="mx-auto max-w-7xl">
    {/* Heading with correct Red color and spacing */}
    <p className="text-center text-sm font-bold uppercase tracking-wider text-[#ea2a33] mb-6">
      Rooted in Experience — Jain Beej Bhandar Agro Private
    </p>

    {/* Different Icons for each brand */}
    <div className="flex flex-wrap items-center justify-center gap-8 opacity-60 grayscale transition-all hover:grayscale-0 sm:gap-16">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-3xl text-stone-700">verified_user</span>
        <span className="font-bold text-lg text-stone-800">TrustedPartner</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-3xl text-stone-700">shield</span>
        <span className="font-bold text-lg text-stone-800">SecureAgri</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-3xl text-stone-700">agriculture</span>
        <span className="font-bold text-lg text-stone-800">FarmTech</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-3xl text-stone-700">eco</span>
        <span className="font-bold text-lg text-stone-800">GreenGrow</span>
      </div>
    </div>
  </div>
</section>

                {/* Why Khettify Section */}
                <section className="w-full px-4 py-20 sm:px-6 lg:px-8 bg-white">
                    <div className="mx-auto max-w-7xl">
                        <div className="mb-12 md:text-center max-w-3xl mx-auto">
                            <h2 className="text-3xl font-black tracking-tight text-[#1b0e0e] sm:text-4xl">Why Khettify?</h2>
                            <p className="mt-4 text-lg text-[#6b7280]">Empowering your agricultural business with enterprise-grade tools built for scale.</p>
                        </div>
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                            {[
                                { title: 'Centralized Control', icon: 'hub', desc: 'Complete oversight of your entire distribution channel from a single dashboard.' },
                                { title: 'Verified Network', icon: 'verified', desc: 'Access a pre-vetted network of reliable partners and distributors.' },
                                { title: 'Pricing Visibility', icon: 'visibility', desc: 'Clear, real-time views on market pricing dynamics to optimize margins.' },
                                { title: 'Market Intelligence', icon: 'analytics', desc: 'Data-driven decisions for growth backed by comprehensive analytics.' }
                            ].map((item, idx) => (
                                <div key={idx} className="group relative overflow-hidden rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition-all hover:border-[#ea2a33]/20 hover:shadow-md">
                                    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[#ea2a33]/10 text-[#ea2a33] group-hover:bg-[#ea2a33] group-hover:text-white transition-colors">
                                        <span className="material-symbols-outlined">{item.icon}</span>
                                    </div>
                                    <h3 className="mb-2 text-lg font-bold text-[#1b0e0e]">{item.title}</h3>
                                    <p className="text-sm leading-relaxed text-[#6b7280]">{item.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* How It Works */}
                <section className="w-full bg-[#f8f9fa] px-4 py-20 sm:px-6 lg:px-8">
                    <div className="mx-auto max-w-7xl">
                        <div className="mb-16 md:text-center">
                            <h2 className="text-3xl font-black tracking-tight text-[#1b0e0e] sm:text-4xl">How Khettify Works</h2>
                        </div>
                        <div className="relative">
                            <div className="absolute top-1/2 left-0 hidden h-0.5 w-full -translate-y-1/2 bg-gray-200 lg:block"></div>
                            <div className="grid gap-8 lg:grid-cols-4 relative z-10">
                                {[
                                    { step: 1, title: 'Product Upload', desc: 'Digitize your inventory instantly with bulk upload tools.' },
                                    { step: 2, title: 'Network Distribution', desc: 'Connect with thousands of verified retailers across regions.' },
                                    { step: 3, title: 'Order Management', desc: 'Automated processing, invoicing, and logistics tracking.' },
                                    { step: 4, title: 'Performance Monitoring', desc: 'Track sales, returns, and payments in real-time.' }
                                ].map((item) => (
                                    <div key={item.step} className="group flex flex-col items-center text-center lg:items-start lg:text-left bg-[#f8f9fa] lg:bg-transparent p-4 lg:p-0">
                                        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-[#ea2a33] text-xl font-bold text-white shadow-md">
                                            {item.step}
                                        </div>
                                        <h3 className="mb-2 text-xl font-bold text-[#1b0e0e]">{item.title}</h3>
                                        <p className="text-sm text-[#6b7280]">{item.desc}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>
{/* PLATFORM SYSTEMS SECTION */}
<section className="w-full px-4 py-24 sm:px-6 lg:px-8 bg-white border-b border-stone-100" id="platform-systems">
    <div className="mx-auto max-w-7xl">
        {/* Main Header */}
        <div className="mb-16">
            <h2 className="text-4xl font-black text-stone-900 mb-4 tracking-tight">Platform Systems</h2>
            <p className="text-lg text-stone-500 font-medium">Comprehensive modules for end-to-end business management.</p>
        </div>
        
        {/* 1. Core Operational Modules */}
        <div className="mb-16">
            <div className="flex items-center gap-3 mb-10">
                <div className="w-12 h-1 bg-[#EA2831] rounded-full"></div>
                <h3 className="text-xl font-bold text-stone-900 tracking-tight">Core Operational Modules</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-20">
                {/* IMS Card */}
                <div className="bg-stone-50/50 p-10 rounded-[2.5rem] border border-stone-100 transition-all hover:shadow-2xl group">
                    <div className="bg-white w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm mb-6 group-hover:bg-[#EA2831] transition-colors">
                        <span className="material-symbols-outlined text-[#EA2831] text-3xl group-hover:text-white">inventory_2</span>
                    </div>
                    <h3 className="text-xl font-extrabold text-stone-900 mb-4 tracking-tight">Intelligent Inventory Management (IMS)</h3>
                    <p className="text-stone-500 text-sm leading-relaxed mb-8 font-medium">
                        Real-time stock tracking across multiple warehouses with automated reordering and expiry management.
                    </p>
                    <div className="space-y-3 font-bold text-xs text-stone-700">
                        <div className="flex items-center gap-3"><span className="material-symbols-outlined text-[#EA2831] text-lg">check_circle</span>Multi-warehouse syncing</div>
                        <div className="flex items-center gap-3"><span className="material-symbols-outlined text-[#EA2831] text-lg">check_circle</span>Batch & Expiry control</div>
                    </div>
                </div>

                {/* CRM Card */}
                <div className="bg-stone-50/50 p-10 rounded-[2.5rem] border border-stone-100 transition-all hover:shadow-2xl group">
                    <div className="bg-white w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm mb-6 group-hover:bg-[#EA2831] transition-colors">
                        <span className="material-symbols-outlined text-[#EA2831] text-3xl group-hover:text-white">groups</span>
                    </div>
                    <h3 className="text-xl font-extrabold text-stone-900 mb-4 tracking-tight">CRM & Seller Oversight</h3>
                    <p className="text-stone-500 text-sm leading-relaxed mb-8 font-medium">
                        Manage dealer relationships, credit limits, and performance histories in one unified profile view for streamlined collaboration.
                    </p>
                    <div className="space-y-3 font-bold text-xs text-stone-700">
                        <div className="flex items-center gap-3"><span className="material-symbols-outlined text-[#EA2831] text-lg">check_circle</span>Credit Limit Controls</div>
                        <div className="flex items-center gap-3"><span className="material-symbols-outlined text-[#EA2831] text-lg">check_circle</span>Performance Ratings</div>
                    </div>
                </div>
            </div>
        </div>

        {/* 2. Essential Support Systems */}
        <div className="mb-20">
            <div className="flex items-center gap-3 mb-10">
                <div className="w-12 h-1 bg-[#EA2831] rounded-full"></div>
                <h3 className="text-xl font-bold text-stone-900 tracking-tight">Essential Support Systems</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-stone-50/50 p-8 rounded-3xl border border-stone-100 flex items-start gap-6 hover:border-red-100 transition-all">
                    <div className="bg-red-50 text-[#EA2831] min-w-[3.5rem] h-14 rounded-2xl flex items-center justify-center">
                        <span className="material-symbols-outlined text-2xl font-bold">gavel</span>
                    </div>
                    <div>
                        <h4 className="text-xl font-bold text-stone-900 mb-2 tracking-tight">Regulatory Compliance</h4>
                        <p className="text-sm text-stone-500 leading-relaxed font-medium">
                            Automated tools for GST invoicing, digital license management, and audit trails for full regulatory transparency.
                        </p>
                    </div>
                </div>

                <div className="bg-stone-50/50 p-8 rounded-3xl border border-stone-100 flex items-start gap-6 hover:border-red-100 transition-all">
                    <div className="bg-red-50 text-[#EA2831] min-w-[3.5rem] h-14 rounded-2xl flex items-center justify-center">
                        <span className="material-symbols-outlined text-2xl font-bold">lock</span>
                    </div>
                    <div>
                        <h4 className="text-xl font-bold text-stone-900 mb-2 tracking-tight">Data Security</h4>
                        <p className="text-sm text-stone-500 leading-relaxed font-medium">
                            Enterprise-grade encryption and granular role-based access control to protect your sensitive trade secrets.
                        </p>
                    </div>
                </div>
            </div>
        </div>

        {/* 3. Platform Scope & Responsibilities */}
        <div className="pt-10 border-t border-stone-100">
            <h2 className="text-3xl font-black text-stone-900 mb-10 tracking-tight">Platform Scope & Responsibilities</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-8 rounded-2xl border border-stone-200 shadow-sm flex items-start gap-5 hover:shadow-md transition-shadow">
                    <span className="material-symbols-outlined text-[#EA2831] text-2xl mt-1">cloud</span>
                    <p className="text-sm font-bold text-stone-700 leading-relaxed">
                        Khettify provides platform infrastructure, pricing visibility, and network access
                    </p>
                </div>
                <div className="bg-white p-8 rounded-2xl border border-stone-200 shadow-sm flex items-start gap-5 hover:shadow-md transition-shadow">
                    <span className="material-symbols-outlined text-[#EA2831] text-2xl mt-1">handshake</span>
                    <p className="text-sm font-bold text-stone-700 leading-relaxed">
                        Companies and sellers manage their own logistics and payments independently
                    </p>
                </div>
                <div className="bg-white p-8 rounded-2xl border border-stone-200 shadow-sm flex items-start gap-5 hover:shadow-md transition-shadow">
                    <span className="material-symbols-outlined text-[#EA2831] text-2xl mt-1">block</span>
                    <p className="text-sm font-bold text-stone-700 leading-relaxed">
                        No platform involvement in delivery or payment execution
                    </p>
                </div>
            </div>
        </div>
    </div>
</section>
                {/* Why Modernize Table */}
                <section className="w-full px-4 py-20 sm:px-6 lg:px-8 bg-[#f8f9fa] border-t border-gray-100" id="why-modernize">
                    <div className="mx-auto max-w-5xl">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl font-black tracking-tight text-[#1b0e0e] sm:text-4xl">Why Modernize?</h2>
                        </div>
                        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
                            <table className="w-full min-w-[600px] text-left border-collapse resp-table">
                                <thead>
                                    <tr className="border-b border-gray-100 bg-gray-50/50">
                                        <th className="p-6 text-sm font-medium text-[#6b7280] w-1/3">Feature</th>
                                        <th className="p-6 text-lg font-bold text-gray-400 w-1/3">Traditional Methods</th>
                                        <th className="p-6 text-lg font-bold text-[#ea2a33] w-1/3 bg-[#ea2a33]/5">Khettify Platform</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 text-sm font-medium">
                                    {[
                                        { label: 'Process Transparency', trad: 'Opaque & Delayed', khet: 'Real-time Visibility' },
                                        { label: 'Scalability', trad: 'Manual Bottlenecks', khet: 'Unlimited Digital Scale' },
                                        { label: 'Payment Security', trad: 'High Risk', khet: 'Escrow & Verified' },
                                        { label: 'Data Insights', trad: 'None / Guesswork', khet: 'AI-Driven Analytics' }
                                    ].map((row, i) => (
                                        <tr key={i}>
                                            <td data-label="Feature" className="p-6 text-[#1b0e0e]">{row.label}</td>
                                            <td data-label="Traditional Methods" className="p-6 text-[#6b7280]">
                                                <span className="material-symbols-outlined text-red-400 text-sm align-middle mr-2">close</span> {row.trad}
                                            </td>
                                            <td data-label="Khettify Platform" className="p-6 bg-[#ea2a33]/5 text-[#1b0e0e]">
                                                <span className="material-symbols-outlined text-green-500 text-sm align-middle mr-2 font-bold">check</span> {row.khet}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                {/* Company Guides — first 7 + View all button */}
                <section className="w-full px-4 py-20 sm:px-6 lg:px-8 bg-[#f8f9fa] border-t border-gray-100" id="guides">
                    <div className="mx-auto max-w-6xl">
                        <div className="flex flex-col lg:flex-row gap-12 lg:gap-20">

                            {/* Left */}
                            <div className="lg:w-72 shrink-0">
                                <span className="text-xs font-bold uppercase tracking-widest text-[#ea2a33]">Guides</span>
                                <h2 className="mt-3 text-4xl font-black tracking-tight text-[#1b0e0e] leading-tight">Get started with Khettify.</h2>
                                <p className="mt-4 text-[#6b7280] text-sm leading-relaxed">From creating your account to understanding your dashboard — everything you need to hit the ground running.</p>
                            </div>

                            {/* Right — first 7 accordions */}
                            <div ref={guidesRef} className="flex-1 divide-y divide-gray-200">
                                {[
                                    { id: "register", title: "Create your Khettify account", open: true, steps: [
                                        { num: "01", title: "Create your account", body: "Visit khettify.com and click Register as Company. Fill in your Full Name, Email Address, Phone Number and Password. Tick the Terms & Privacy Policy checkbox and click Create Account. Khettify will send a 6-digit verification code to your email." },
                                        { num: "02", title: "Verify your email", body: "Enter the 6-digit OTP sent to your email and click Verify & continue. If you didn't receive the code, wait for the timer and click Resend code. Once verified, your account is created and you are logged in automatically." },
                                        { num: "03", title: "Start company setup", body: "You will land on the Company Setup page. Click Start setup to begin the 5-step onboarding that verifies your organisation and activates full platform access." },
                                        { num: "04", title: "Fill in company information", body: "Enter your Company Legal Name, select your Business Type (Private Limited, Partnership, LLP etc.), choose your Primary Product Categories, and enter your Year of Establishment." },
                                        { num: "05", title: "Add business and contact details", body: "Enter your Registered Business Address, Operating Regions, Authorized Person Name, Official Business Email, and Official Business Phone Number." },
                                        { num: "06", title: "Upload verification documents", body: "Upload your GSTIN with GST Certificate, Udyam or CIN number with certificate, and PAN Card with copy. All documents must be PNG or PDF and clearly legible." },
                                        { num: "07", title: "Review and submit", body: "Khettify shows a complete summary of all your details. Review carefully and click Submit for review. You can edit before submission." },
                                        { num: "08", title: "Admin approval — then go live", body: "After submission your status shows Under Review. The Khettify team approves your account within 24 to 48 hours. After approval your full dashboard unlocks." },
                                    ]},
                                    { id: "login", title: "How to login", open: false, steps: [
                                        { num: "01", title: "Go to the login page", body: "Visit khettify.com and click Login. You will see the Login to your account screen with Email or Phone and Password fields." },
                                        { num: "02", title: "Enter your email or phone number", body: "Enter the email address you used when registering, or your 10-digit phone number. Both work for login." },
                                        { num: "03", title: "Enter your password and login", body: "Enter your password in the Password field. Click the eye icon to show or hide it. Once both fields are filled, click the Login button to access your dashboard." },
                                    ]},
                                    { id: "forgot", title: "Forgot your password?", open: false, steps: [
                                        { num: "01", title: "Click Forgot password?", body: "On the login page, click the Forgot password? link below the password field." },
                                        { num: "02", title: "Enter your registered email", body: "Enter the email address you used when creating your Khettify account. Khettify will send a password reset link to that email." },
                                        { num: "03", title: "Click the reset link in your email", body: "Open the email from Khettify and click the reset link. Check your spam folder if you don't see it within a few minutes." },
                                        { num: "04", title: "Set your new password", body: "Enter and confirm your new password. Make sure it is at least 6 characters. Click Save to update." },
                                        { num: "05", title: "Login with your new password", body: "Go back to the login page, enter your email or phone and your new password, then click Login to access your dashboard." },
                                    ]},
                                    { id: "home", title: "Your Home page", open: false, steps: [
                                        { num: "01", title: "Revenue, Orders, Inventory & Alerts", body: "As soon as you log in, you will see four numbers at the top — your revenue this week, total orders, current inventory value, and alerts. Alerts are shown in red. Do not ignore them — they point to things that need your action right away." },
                                        { num: "02", title: "Updates — see what is happening on your platform", body: "Below the numbers is a live feed of recent activity. When a seller confirms a supply receipt, when a new supply request comes in, when a warehouse transfer is done — everything shows here with a timestamp. Click Show All to see the full history." },
                                        { num: "03", title: "Module cards — jump to any section quickly", body: "At the bottom of the Home page you will find cards for every module — Inventory, Product Catalog, Warehouses, Stock Transfers, Barcodes & Labels, Transfer History, Stock Valuation, PC Applications, Administration and more. Each card shows a quick number so you already know the current status before you click in." },
                                    ]},
                                    { id: "dashboard", title: "The Dashboard — detailed analytics", open: false, steps: [
                                        { num: "01", title: "Period filter — choose your time range", body: "At the top of the Dashboard you can choose Daily, Weekly, Monthly, Quarterly, Yearly or a Custom date range. All numbers on the page update based on what you select. Weekly is the default." },
                                        { num: "02", title: "Stock Value, Expiring, Shipments and Sales", body: "You will see four key numbers — your total inventory value, the value of stock expiring within 90 days (take this seriously to avoid wastage), how many shipments are currently in transit, and your sales for the selected period." },
                                        { num: "03", title: "Products, Warehouses and Orders", body: "Below the metric cards you can see your total products, how many are active and visible to sellers, how many warehouses you operate, and your order count for the selected period — all in one place." },
                                        { num: "04", title: "Sales Overview — Revenue, Units Sold and Returns", body: "At the bottom, the Sales Overview shows your revenue, how many units were sold, and how many returns came in. If you see no data, switch to a wider period like Monthly or Yearly to get the full picture." },
                                    ]},
                                    { id: "inventory", title: "Inventory — your stock lots", open: false, steps: [
                                        { num: "01", title: "Lots — the building block of your inventory", body: "On Khettify, your stock is organised into lots. Each lot represents a specific batch of a product with its own lot number, manufacturing date, expiry date, quantity, and warehouse." },
                                        { num: "02", title: "The four summary numbers", body: "At the top you will see Total Lots Created, Fully Moved Out, Units Created, and Created Value — giving you an instant picture of your overall inventory." },
                                        { num: "03", title: "Filters — find exactly what you need", body: "Filter by All Lots, Expiring ≤90d (stock expiring within 90 days), or Expired. Use the All Stock Status dropdown to filter by specific conditions." },
                                        { num: "04", title: "What each lot row tells you", body: "Every lot shows its Lot Number, Product, Category, Warehouse, Manufacturing date, Expiry date, Quantity, and Expiry Status. Good is shown in green and changes colour as it nears expiry." },
                                        { num: "05", title: "View and Label buttons", body: "View opens the full details of that lot. Label lets you print or download barcode labels for that lot, used for scanning during dispatch and warehouse operations." },
                                    ]},
                                    { id: "create-lot", title: "Create Lot — add new stock to your inventory", open: false, steps: [
                                        { num: "01", title: "How to open Create Lot", body: "On the Inventory page, click the Create Lot button on the top right. A form will open where you can fill in all the details for your new lot." },
                                        { num: "02", title: "Option 1 — Khettify-generated lot number", body: "Select this option and Khettify will automatically assign a unique lot number when you save — built from your company code, product code, dates and SKU range." },
                                        { num: "03", title: "Without bulk packaging", body: "Select your Product. Leave Do You Need Bulk Packaging Ids unchecked. Fill in Manufacturing Date, Expiry Date, Quantity and Warehouse. Click Create Lot." },
                                        { num: "04", title: "With bulk packaging", body: "Tick Do You Need Bulk Packaging Ids — two extra fields appear: Number of Boxes and Units Per Box. Fill these along with the other fields. Tick Inside Bulk Packaging to switch to three fields: Main Boxes, Boxes Per Main Boxes, and Units Per Box." },
                                        { num: "05", title: "Option 2 — Enter lot number manually", body: "Select Enter Manually and tick which parts to include in the lot number — Company Code, Product Code, Year, Month, Date, Batch Number, Bulk Packaging, Inner Box, SKU. The lot number preview builds at the bottom as you go. You can reorder parts using the left and right controls." },
                                    ]},
                                ].map((accordion) => (
                                    <details key={accordion.id} open={accordion.open} className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                        <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                            <span className={`text-base font-semibold transition-colors text-[#1b0e0e] group-open:text-[#ea2a33]`}>{accordion.title}</span>
                                            <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                        </summary>
                                        <div className="mt-6 space-y-6">
                                            {accordion.steps.map((s) => (
                                                <div key={s.num} className="flex gap-4">
                                                    <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                    <div>
                                                        <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                        <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                    </div>
                                                </div>
                                            ))}
                                            {accordion.id === 'register' && (
                                                <Link to="/register" className="inline-flex items-center gap-2 rounded-full bg-[#ea2a33] text-white font-bold px-6 py-2.5 text-sm hover:bg-[#d11f28] transition-colors mt-2">
                                                    Register as a Company
                                                    <span className="material-symbols-outlined text-base">arrow_forward</span>
                                                </Link>
                                            )}
                                        </div>
                                    </details>
                                ))}

                                {/* View all button */}
                                <div className="py-6 text-center">
                                    <Link
                                        to="/guides/company"
                                        className="inline-flex items-center gap-2 rounded-full border-2 border-[#ea2a33] text-[#ea2a33] font-bold px-8 py-3 text-sm hover:bg-[#ea2a33] hover:text-white transition-colors"
                                    >
                                        View all Company Guides
                                        <span className="material-symbols-outlined text-base">arrow_forward</span>
                                    </Link>
                                    <p className="mt-3 text-xs text-[#6b7280]">Upload Product, Warehouses, Stock Transfers, Barcodes & Labels and more →</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* CTA Section */}
                <section className="w-full px-4 py-24 bg-white">
                    <div className="mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-red-400 via-[#f1444d] to-[#ea2a33] p-6 sm:p-12 lg:p-20">
                        <div className="w-full max-w-4xl mx-auto bg-white rounded-[2.5rem] p-10 sm:p-14 lg:p-20 text-center shadow-3xl">
                            <h2 className="mb-6 text-3xl font-medium tracking-tight text-[#1b0e0e] sm:text-4xl">Onboard your brand today</h2>
                            <p className="mb-12 text-lg text-[#6b7280] max-w-2xl mx-auto">Join the digital revolution in agricultural distribution. Our team will help you set up your digital storefront in less than 24 hours.</p>
                            <button 
                                onClick={() => navigate('/register')}
                                className="min-w-[240px] rounded-xl bg-white border-4 border-[#ea2a33] px-10 py-5 text-xl font-bold text-[#ea2a33] shadow-2xl transition-all hover:bg-[#ea2a33] hover:text-white"
                            >
                                Get Started
                            </button>
                        </div>
                    </div>
                </section>

                {/* Footer */}
                <footer className="w-full bg-[#f8f9fa] px-4 py-12 border-t border-gray-200" id="footer">
                    <div className="mx-auto max-w-7xl">
                        <div className="grid grid-cols-1 gap-12 md:grid-cols-4 lg:gap-16">
                            <div className="col-span-1">
                                <span className="text-2xl font-bold text-[#ea2a33]">Khettify</span>
                                <p className="mt-4 text-sm text-[#6b7280]">Empowering agriculture through technology. Building the future of farm-to-business commerce.</p>
                            </div>
                            <div>
                                <h4 className="mb-4 text-sm font-bold uppercase text-[#1b0e0e]">Platform</h4>
                                <ul className="space-y-2 text-sm text-[#6b7280]">
                                    <li><a className="hover:text-[#ea2a33]" href="#">Seller</a></li>
                                    <li><a className="hover:text-[#ea2a33]" href="#">Customer</a></li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="mb-4 text-sm font-bold uppercase text-[#1b0e0e]">Company</h4>
                                <ul className="space-y-2 text-sm text-[#6b7280]">
                                    <li><a className="hover:text-[#ea2a33]" href="#">About Us</a></li>
                                    <li><a className="hover:text-[#ea2a33]" href="#">Careers</a></li>
                                    <li><a className="hover:text-[#ea2a33]" href="#">Contact</a></li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="mb-4 text-sm font-bold uppercase text-[#1b0e0e]">Legal</h4>
                                <ul className="space-y-2 text-sm text-[#6b7280]">
                                    <li><a className="hover:text-[#ea2a33]" href="#">Privacy Policy</a></li>
                                    <li><a className="hover:text-[#ea2a33]" href="#">Terms of Service</a></li>
                                    <li><a className="hover:text-[#ea2a33]" href="#">Cookie Policy</a></li>
                                </ul>
                            </div>
                        </div>
                        <div className="mt-12 border-t border-gray-200 pt-8 text-center md:text-left">
                            <p className="text-sm text-[#6b7280]">© 2026 Jain Beej Bhandar Agro Pvt Ltd. All rights reserved.</p>
                        </div>
                    </div>
                </footer>
            </main>
        </div>
    );
};

export default CompanyAbout;