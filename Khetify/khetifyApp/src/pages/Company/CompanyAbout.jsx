import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const CompanyAbout = () => {
    const navigate = useNavigate();

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
                            <p className="text-sm text-[#6b7280]">© 2026 Khettify Technologies Pvt Ltd. All rights reserved.</p>
                        </div>
                    </div>
                </footer>
            </main>
        </div>
    );
};

export default CompanyAbout;