import React from 'react';
import { useNavigate } from 'react-router-dom';

const About = () => {
    const navigate = useNavigate();
    return (
        <div className="bg-background-light dark:bg-background-dark text-text-main antialiased overflow-x-hidden">
            {/* Header */}
            <header className="sticky top-0 z-50 w-full bg-white/90 backdrop-blur-md border-b border-[#f2e9e9]">
                <div className="px-4 md:px-10 py-4 flex items-center justify-between max-w-7xl mx-auto w-full">
                    <div className="flex items-center gap-2">
                        <h2 className="text-primary text-2xl font-bold tracking-tight font-heading">Khetify</h2>
                    </div>
                   {/* Header section mein yeh changes karein: */}
{/* Is section ko update karein: */}
<div className="hidden md:flex flex-1 justify-end items-center gap-8">
  <nav className="flex items-center gap-8">
    <a className="text-[#1a0f0f] text-sm font-semibold hover:text-primary transition-colors" href="/">
      Home
    </a>
    <a className="text-[#1a0f0f] text-sm font-medium hover:text-primary transition-colors" href="/about">
      About
    </a>
    <a className="text-[#1a0f0f] text-sm font-medium hover:text-primary transition-colors" href="#">
      Contact
    </a>
  </nav>
</div>
                    <button className="md:hidden text-[#1a0f0f]">
                        <span className="material-symbols-outlined">menu</span>
                    </button>
                </div>
            </header>

            <main className="flex-grow flex flex-col">
                {/* Hero Section */}
                <section className="relative w-full py-16 md:py-24 px-4 md:px-10 bg-background-light overflow-hidden">
                    <div className="max-w-7xl mx-auto w-full">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                            <div className="flex flex-col gap-6 max-w-2xl relative z-20">
                                <h1 className="text-text-main text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.15] tracking-tight font-heading">
                                    India's Leading Digital Agricultural Marketplace
                                </h1>
                                <p className="text-text-muted text-lg md:text-xl font-normal leading-relaxed max-w-lg">
                                    Connecting companies, sellers, and customers in a seamless, verified ecosystem. Goodbye opacity, hello transparency.
                                </p>
                                <div className="flex flex-wrap gap-4 mt-2">
                                  <button 
    onClick={() => document.getElementById('roles-section').scrollIntoView({ behavior: 'smooth' })}
    className="flex items-center justify-center rounded-lg h-12 px-8 bg-primary hover:bg-primary-hover text-white text-base font-bold shadow-lg shadow-primary/20 transition-all"
>
    Explore Platform
</button>
                                </div>
                                <div className="flex items-center gap-4 mt-6 text-sm text-text-muted">
                                    <div className="flex -space-x-2">
                                        <div className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center overflow-hidden">
                                            <img alt="User avatar" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAWHdbLgXae7dUazF6QgP-481FuUeFY_D-HZk8VlOqHn7M7wczGekO6sBocmHygnOJOEl637KItEFabeFhG50_M6rOMJ9kEhDJfy-xOpJX_wX7j-7f5EElt9ywoS6l4fbjTrmjXJOFVuUGjypL_eXxYcChSPfekz5YKZjfSVqYYywhrY-zLUQRj2rx1CM6CSYuo6VnJa0onP0-JdiZ9wlJRoaDVYSJcNmlNAdv0yqe9FEIiL2zY9fh_cfUiskIfSf_Q-16kFywW0aK2" />
                                        </div>
                                        <div className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center overflow-hidden">
                                            <img alt="User avatar" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC0I81QWHRd1bkAFsvSjl31xFFjyiWAyNvtQ6U-IzAz1oUaT6lM4RnCRp467gEH_fmC8QTn7VFFu-V1n6QHYy99Yjb6adRqXvfGk2gNw5w0AdVvJlvPoDUJAzufYz6aWKxD5s7VYNw9fEI0WYSiftPYLHRagq1uvyk_TyyedY3zU-Vl4tdZQY7ZyOh6N9LB17rgN7kbaDEUlMZsRgLFjCnNseaD4F2MG4UjADHBG0cMsTRCPd3gSM4jukTEt77nklZlj3eZD1Bct8jt" />
                                        </div>
                                        <div className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center overflow-hidden">
                                            <img alt="User avatar" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDLvZexou02jJBR6-xgiJ186SFf7XlW6MLdi95WmqLejMGAfCjEEriESDMid8z0PuSwe9X0YCFaeFDLt0JKneOM_NJyhNykRV4OhPHUbd4do6I5NUxikCS9YIfU5jdilE1A3QIjtFZqOqS_hEuJJfOVmQk0gWnhbkx1VUfiJy1fsosLslxS7mMT8mrvyEQVZMwE0CfSaOQQl1_aSV1YsRNeapaiCBOr2wc2lKrW9-yB28Wsp9AlLFAw93FRFcyBjli8wfpelQd49jHM" />
                                        </div>
                                    </div>
                                    <span className="font-medium">Trusted by 10,000+ Farmers</span>
                                </div>
                            </div>
                            <div className="w-full h-full min-h-[450px] rounded-2xl shadow-soft flex flex-col justify-center items-center relative overflow-hidden border border-gray-100">
                                <img alt="Rich texture of healthy green crops" className="absolute inset-0 w-full h-full object-cover brightness-100" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCJhCfRg2XDTGmDBbJarMvBdWY1k6DasfgNivLF0dGB4u6j-6QCxYIBAw8gvBo2Za0ePKlyxWtCIxyfiay4zFq4tieq4CudHpkpTbzMC64RSl6OB6QJxxBTEidPlbQzrDAaPbY38WxPIBUEkZdxyTUeA_MfuYLe84iRVDmMBAIpxjEv9HhJzlSf0P2awNeULEWS-SiKGzx_fTW5D3FvSWep6QcQ1siQo6xUzmcFAgHqYHNCeMU0NH7Itpde3AMFZvVLX2Tc5E-IDgn3" />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent"></div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Our Purpose Section */}
                <section className="w-full py-16 px-4 md:px-10 bg-white">
                    <div className="max-w-7xl mx-auto w-full">
                        <div className="flex flex-col gap-4 mb-12 text-center">
                            <h2 className="text-text-main text-4xl md:text-5xl font-bold font-heading">
                                Our Purpose
                            </h2>
                            <div className="flex flex-col gap-1">
                                <p className="text-[#5a606a] text-lg max-w-3xl mx-auto">
                                    Khetify is built to bring clarity and structure to agricultural buying and selling.
                                </p>
                                <p className="text-[#5a606a] text-lg max-w-3xl mx-auto">
                                    It creates a single digital space where products and participants are clearly represented.
                                </p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="flex flex-col gap-4 p-6 rounded-2xl bg-background-light border border-gray-100 hover:border-primary/20 transition-all duration-300">
                                <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20">
                                    <span className="material-symbols-outlined text-3xl">verified_user</span>
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-text-main mb-2 font-heading">Authentic Products</h3>
                                    <p className="text-text-muted leading-relaxed">
                                        Direct sourcing from manufacturers ensures every seed and supply is 100% genuine. No more counterfeits.
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-col gap-4 p-6 rounded-2xl bg-background-light border border-gray-100 hover:border-primary/20 transition-all duration-300">
                                <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20">
                                    <span className="material-symbols-outlined text-3xl">payments</span>
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-text-main mb-2 font-heading">Transparent Pricing</h3>
                                    <p className="text-text-muted leading-relaxed">
                                        Clear, upfront pricing with zero hidden costs. Compare rates instantly and make informed decisions.
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-col gap-4 p-6 rounded-2xl bg-background-light border border-gray-100 hover:border-primary/20 transition-all duration-300">
                                <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20">
                                    <span className="material-symbols-outlined text-3xl">hub</span>
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-text-main mb-2 font-heading">Verified Ecosystem</h3>
                                    <p className="text-text-muted leading-relaxed">
                                        Every participant—company, seller, or customer—is verified, creating a secure network of trust.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* How Khetify Works */}
                <section className="w-full py-16 px-4 md:px-10 bg-background-light border-y border-[#f0e4e4]">
                    <div className="max-w-7xl mx-auto w-full">
                        <div className="text-center mb-12">
                            <span className="text-primary font-bold tracking-wider uppercase text-sm">Workflow</span>
                            <h2 className="text-text-main text-3xl md:text-4xl font-bold font-heading mt-2">How Khetify Works</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-white p-8 rounded-xl shadow-soft border border-gray-100 flex flex-col items-center text-center relative group">
                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <span className="text-6xl font-black text-primary font-heading">1</span>
                                </div>
                                <div className="w-16 h-16 rounded-full bg-secondary mb-6 flex items-center justify-center text-primary">
                                    <span className="material-symbols-outlined text-3xl">cloud_upload</span>
                                </div>
                                <h3 className="text-xl font-bold text-text-main mb-2 font-heading">Company Uploads</h3>
                                <p className="text-text-muted">Upload certified products with complete details, ensuring quality, traceability, and trust across the ecosystem.</p>
                            </div>
                            <div className="bg-white p-8 rounded-xl shadow-soft border border-gray-100 flex flex-col items-center text-center relative group">
                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <span className="text-6xl font-black text-primary font-heading">2</span>
                                </div>
                                <div className="w-16 h-16 rounded-full bg-secondary mb-6 flex items-center justify-center text-primary">
                                    <span className="material-symbols-outlined text-3xl">store</span>
                                </div>
                                <h3 className="text-xl font-bold text-text-main mb-2 font-heading">Seller Sell</h3>
                                <p className="text-text-muted">Verified local Seller stock up and manage their digital storefronts, reaching more local farmers.</p>
                            </div>
                            <div className="bg-white p-8 rounded-xl shadow-soft border border-gray-100 flex flex-col items-center text-center relative group">
                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <span className="text-6xl font-black text-primary font-heading">3</span>
                                </div>
                                <div className="w-16 h-16 rounded-full bg-secondary mb-6 flex items-center justify-center text-primary">
                                    <span className="material-symbols-outlined text-3xl">shopping_cart</span>
                                </div>
                                <h3 className="text-xl font-bold text-text-main mb-2 font-heading">Customer Purchase</h3>
                                <p className="text-text-muted">Farmers browse verified goods, compare prices, and purchase with confidence from trusted vendors.</p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Why Khetify Exists */}
                <section className="w-full py-20 px-4 md:px-10 bg-white">
                    <div className="max-w-7xl mx-auto w-full">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                            <div className="order-2 lg:order-1 relative">
                                <div className="w-full aspect-square md:aspect-video lg:aspect-square bg-white rounded-2xl overflow-hidden relative border border-gray-100 shadow-soft">
                                    <img alt="Modern minimalist illustration of a digital agricultural ecosystem" className="absolute inset-0 w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAlOgTLhOxtJfdiMGrEeyjZl_w5NsWHjoB8hL2Ccgh1xk3EtHpviHJER6v-48uGIEfHNFfNX-Lcpj-B0szejepIc5W7R4ZVFAKeW1ICGOiJlZYv8s8HMMW9qBKsc2k6wWlHOmZxstDdZfgu_J_K3mcj29koME332gI6d88WTFEUcAORthi9idjpqq0v5BW-vaHw4tVIeV2hWDNWn_JGVdX1DOtK8YCzWekPjLMubjpmHn3dom8H2tptI1AWU4AdUdNGbexA-DiXKemv" />
                                </div>
                            </div>
                            <div className="order-1 lg:order-2 flex flex-col gap-6">
                                <h2 className="text-text-main text-3xl md:text-5xl font-bold font-heading">Why Khetify Exists</h2>
                                <p className="text-lg text-text-muted">
                                    We bridge the gap between opacity and transparency. The traditional market is flooded with inefficiencies that hurt everyone.
                                </p>
                                <div className="flex flex-col gap-4 mt-4">
                                    <div className="flex items-start gap-4">
                                        <div className="mt-1 min-w-[24px] text-red-400">
                                            <span className="material-symbols-outlined">cancel</span>
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-gray-500 line-through">Counterfeit products &amp; dilution</h4>
                                            <p className="text-sm text-gray-400">Customers often unknowingly buy fake inputs.</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-4 mb-4">
                                        <div className="mt-1 min-w-[24px] text-primary">
                                            <span className="material-symbols-outlined">check_circle</span>
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-text-main">100% Verified Origins</h4>
                                            <p className="text-sm text-text-muted">Digital tracing ensures product authenticity.</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-4">
                                        <div className="mt-1 min-w-[24px] text-red-400">
                                            <span className="material-symbols-outlined">cancel</span>
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-gray-500 line-through">Hidden margins &amp; price gouging</h4>
                                            <p className="text-sm text-gray-400">Middlemen inflate prices arbitrarily.</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-4">
                                        <div className="mt-1 min-w-[24px] text-primary">
                                            <span className="material-symbols-outlined">check_circle</span>
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-text-main">Standardized, Transparent Pricing</h4>
                                            <p className="text-sm text-text-muted">Fair market rates visible to everyone.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
{/* Choose Your Role Section */}
{/* About.jsx mein is line ko aise update karein */}
<section id="roles-section" className="w-full py-16 px-4 md:px-10 bg-background-light">
    <div className="max-w-7xl mx-auto w-full">
        <div className="text-center mb-12">
            <h2 className="text-text-main text-3xl md:text-4xl font-bold font-heading">Choose Your Role</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* For Companies Card */}
            <div className="flex flex-col gap-4 p-6 rounded-2xl bg-white border border-gray-100 transition-all duration-300 shadow-soft">
                <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20">
                    <span className="material-symbols-outlined text-3xl">domain</span>
                </div>
                <div className="flex flex-col gap-4">
                    <h3 className="text-xl font-bold text-text-main font-heading">Companies</h3>
                    <div className="flex flex-col gap-2 text-text-muted">
                        <div className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-primary text-xl leading-none pt-1">check_circle</span>
                            <span className="text-sm">Ensure product authenticity</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-primary text-xl leading-none pt-1">check_circle</span>
                            <span className="text-sm">Expand verified distribution</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-primary text-xl leading-none pt-1">check_circle</span>
                            <span className="text-sm">Access market performance insights</span>
                        </div>
                    </div>
                    {/* Ise replace karein */}
<button 
    onClick={() => navigate('/company-about')}
    className="mt-4 w-full py-3 rounded-lg border border-primary text-primary font-bold hover:bg-primary hover:text-white transition-all text-sm"
>
    Explore Company Platform
</button>
                </div>
            </div>

            {/* For Vendors Card */}
            <div className="flex flex-col gap-4 p-6 rounded-2xl bg-white border border-gray-100 transition-all duration-300 shadow-soft">
                <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20">
                    <span className="material-symbols-outlined text-3xl">storefront</span>
                </div>
                <div className="flex flex-col gap-4">
                    <h3 className="text-xl font-bold text-text-main font-heading">Sellers</h3>
                    <div className="flex flex-col gap-2 text-text-muted">
                        <div className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-primary text-xl leading-none pt-1">check_circle</span>
                            <span className="text-sm">Digitally manage inventory</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-primary text-xl leading-none pt-1">check_circle</span>
                            <span className="text-sm">Compete transparently on pricing</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-primary text-xl leading-none pt-1">check_circle</span>
                            <span className="text-sm">Reach verified customers</span>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate('/seller-about')}
                        className="mt-4 w-full py-3 rounded-lg border border-primary text-primary font-bold hover:bg-primary hover:text-white transition-all text-sm"
                    >
                        Explore Seller Platform
                    </button>
                </div>
            </div>

            {/* For Farmers Card */}
            <div className="flex flex-col gap-4 p-6 rounded-2xl bg-white border border-gray-100 transition-all duration-300 shadow-soft">
                <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20">
                    <span className="material-symbols-outlined text-3xl">agriculture</span>
                </div>
                <div className="flex flex-col gap-4">
                    <h3 className="text-xl font-bold text-text-main font-heading">Customers</h3>
                    <div className="flex flex-col gap-2 text-text-muted">
                        <div className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-primary text-xl leading-none pt-1">check_circle</span>
                            <span className="text-sm">Buy verified agricultural products</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-primary text-xl leading-none pt-1">check_circle</span>
                            <span className="text-sm">Compare prices easily</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-primary text-xl leading-none pt-1">check_circle</span>
                            <span className="text-sm">Avoid middlemen risks</span>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate('/customer-shop')}
                        className="mt-4 w-full py-3 rounded-lg border border-primary text-primary font-bold hover:bg-primary hover:text-white transition-all text-sm">
                        Explore Customer Platform
                    </button>
                </div>
            </div>
        </div>
    </div>
</section>
                {/* Trust Badges */}
                <section className="w-full py-10 bg-[#EA2831] text-white">
                    <div className="max-w-7xl mx-auto px-4 md:px-10">
                        <div className="flex flex-wrap justify-center md:justify-between items-center gap-8 text-center md:text-left">
                            <div className="flex items-center gap-3">
                                <span className="material-symbols-outlined text-4xl text-white">admin_panel_settings</span>
                                <div className="flex flex-col">
                                    <span className="font-bold font-heading text-lg">Admin Approved</span>
                                    <span className="text-xs text-white/80">Rigorous vetting process</span>
                                </div>
                            </div>
                            <div className="h-8 w-[1px] bg-white/30 hidden md:block"></div>
                            <div className="flex items-center gap-3">
                                <span className="material-symbols-outlined text-4xl text-white">lock</span>
                                <div className="flex flex-col">
                                    <span className="font-bold font-heading text-lg">Secure Transactions</span>
                                    <span className="text-xs text-white/80">Encrypted payment gateways</span>
                                </div>
                            </div>
                            <div className="h-8 w-[1px] bg-white/30 hidden md:block"></div>
                            <div className="flex items-center gap-3">
                                <span className="material-symbols-outlined text-4xl text-white">star</span>
                                <div className="flex flex-col">
                                    <span className="font-bold font-heading text-lg">Top Rated Vendors</span>
                                    <span className="text-xs text-white/80">Community driven ratings</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

              {/* Founder Section */}
{/* Founder Section */}
<section className="w-full py-20 px-4 md:px-10 bg-background-light">
    <div className="max-w-5xl mx-auto w-full">
        <div className="flex flex-col md:flex-row items-center gap-12">
            <div className="flex-shrink-0 relative">
                <div className="w-64 h-64 md:w-80 md:h-80 rounded-full overflow-hidden border-8 border-white shadow-xl">
                    <img 
                        alt="Vansh Jain - Co-Founder Khetify" 
                        className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-500" 
                        src="/Vansh sir image.png" 
                    />
                </div>
                <div className="absolute bottom-4 right-4 bg-white px-4 py-2 rounded-lg shadow-md">
                    <p className="text-xs font-bold text-primary uppercase tracking-wide">Origin</p>
                    <p className="text-sm font-bold text-text-main">Jain Beej Bhandar</p>
                </div>
            </div>
            <div className="flex flex-col gap-6 text-center md:text-left">
                <h2 className="text-3xl md:text-4xl font-bold font-heading text-text-main">Rooted in Experience</h2>
                <p className="text-lg text-text-muted leading-relaxed">
                    "Khetify wasn't built in a boardroom. It was born from decades of experience at <span className="text-text-main font-semibold">Jain Beej Bhandar Agro Private Limited</span>, seeing firsthand the struggles customers faced with quality and pricing. We digitized our trust to scale it for the entire nation."
                </p>
                <div>
                    <h4 className="text-xl font-bold font-heading text-primary">Vansh Jain</h4>
                    <span className="text-sm text-text-muted">Founder, Khetify</span>
                </div>
            </div>
        </div>
    </div>
</section>
                {/* Quote Section */}
                <section className="w-full py-24 px-4 md:px-10 bg-secondary flex justify-center items-center">
                    <div className="max-w-4xl mx-auto text-center">
                        <span className="material-symbols-outlined text-6xl text-primary/20 mb-6">format_quote</span>
                        <h2 className="text-2xl md:text-4xl font-bold font-heading text-primary leading-tight">
                            "To empower every Indian customers with the dignity of choice, the assurance of quality, and the power of fair pricing."
                        </h2>
                    </div>
                </section>
            </main>

            {/* Footer */}
            <footer className="w-full bg-[#FAF8F8] border-t border-gray-200 pt-16 pb-8 px-4 md:px-10">
                <div className="max-w-7xl mx-auto w-full">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
                        <div className="flex flex-col gap-4">
                            <h2 className="text-2xl font-bold text-primary font-heading">Khetify</h2>
                            <p className="text-sm text-text-muted leading-relaxed">
                                India's first transparent agricultural ecosystem. Connecting the roots of the nation to the digital future.
                            </p>
                            <div className="flex gap-4 mt-2">
                                <a className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center text-text-main hover:bg-primary hover:text-white transition-colors" href="#">
                                    <span className="material-symbols-outlined text-sm">alternate_email</span>
                                </a>
                                <a className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center text-text-main hover:bg-primary hover:text-white transition-colors" href="#">
                                    <span className="material-symbols-outlined text-sm">call</span>
                                </a>
                            </div>
                        </div>
                        <div className="flex flex-col gap-4">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-text-main">Platform</h3>
                            <div className="flex flex-col gap-2">
                                <a className="text-sm text-text-muted hover:text-primary transition-colors" href="#">About Us</a>
                                <a className="text-sm text-text-muted hover:text-primary transition-colors" href="#">Company</a>
                                <a className="text-sm text-text-muted hover:text-primary transition-colors" href="#">Seller</a>
                                <a className="text-sm text-text-muted hover:text-primary transition-colors" href="#">Customer</a>
                            </div>
                        </div>
                        <div className="flex flex-col gap-4">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-text-main">Support</h3>
                            <div className="flex flex-col gap-2">
                                <a className="text-sm text-text-muted hover:text-primary transition-colors" href="#">Help Center</a>
                                <a className="text-sm text-text-muted hover:text-primary transition-colors" href="#">Safety Guidelines</a>
                                <a className="text-sm text-text-muted hover:text-primary transition-colors" href="#">Report an Issue</a>
                                <a className="text-sm text-text-muted hover:text-primary transition-colors" href="#">Contact</a>
                            </div>
                        </div>
                        <div className="flex flex-col gap-4">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-text-main">Legal</h3>
                            <div className="flex flex-col gap-2">
                                <a className="text-sm text-text-muted hover:text-primary transition-colors" href="#">Privacy Policy</a>
                                <a className="text-sm text-text-muted hover:text-primary transition-colors" href="#">Terms of Service</a>
                                <a className="text-sm text-text-muted hover:text-primary transition-colors" href="#">Cookie Policy</a>
                            </div>
                        </div>
                    </div>
                    <div className="border-t border-gray-200 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
                        <p className="text-sm text-text-muted text-center md:text-left">© 2026 Khetify Technologies Pvt Ltd. All rights reserved.</p>
                        <div className="flex items-center gap-2 text-sm text-text-muted">
                            <span className="w-2 h-2 rounded-full bg-green-500"></span>
                            System Operational
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default About;