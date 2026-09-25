import React from 'react';

export default function CompanyBlogs() {
  return (
    <>
                {/* All Guides — single section */}
                <section className="w-full px-4 py-20 sm:px-6 lg:px-8 bg-[#f8f9fa] border-t border-gray-100" id="guides">
                    <div className="mx-auto max-w-6xl">
                        <div className="flex flex-col lg:flex-row gap-12 lg:gap-20">

                            {/* Left — one heading for all */}
                            <div className="lg:w-72 shrink-0">
                                <span className="text-xs font-bold uppercase tracking-widest text-[#ea2a33]">Guides</span>
                                <h2 className="mt-3 text-4xl font-black tracking-tight text-[#1b0e0e] leading-tight">Get started with Khettify.</h2>
                                <p className="mt-4 text-[#6b7280] text-sm leading-relaxed">From creating your account to understanding your dashboard — everything you need to hit the ground running.</p>
                            </div>

                            {/* Right — all accordions together */}
                            <div className="flex-1 divide-y divide-gray-200">

                                {/* 1 — Create Account */}
                                <details open className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#ea2a33]">Create your Khettify account</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "Create your account", body: "Visit khettify.com and click Register as Company. Fill in your Full Name, Email Address, Phone Number and Password. Tick the Terms & Privacy Policy checkbox and click Create Account. Khettify will send a 6-digit verification code to your email." },
                                            { num: "02", title: "Verify your email", body: "Enter the 6-digit OTP sent to your email and click Verify & continue. If you didn't receive the code, wait for the timer and click Resend code. Once verified, your account is created and you are logged in automatically." },
                                            { num: "03", title: "Start company setup", body: "You will land on the Company Setup page. Click Start setup to begin the 5-step onboarding that verifies your organisation and activates full platform access." },
                                            { num: "04", title: "Fill in company information", body: "Enter your Company Legal Name, select your Business Type (Private Limited, Partnership, LLP etc.), choose your Primary Product Categories, and enter your Year of Establishment." },
                                            { num: "05", title: "Add business and contact details", body: "Enter your Registered Business Address, Operating Regions, Authorized Person Name, Official Business Email, and Official Business Phone Number." },
                                            { num: "06", title: "Upload verification documents", body: "Upload your GSTIN with GST Certificate, Udyam or CIN number with certificate, and PAN Card with copy. All documents must be PNG or PDF and clearly legible." },
                                            { num: "07", title: "Review and submit", body: "Khettify shows a complete summary of all your details. Review carefully and click Submit for review. You can edit before submission." },
                                            { num: "08", title: "Admin approval — then go live", body: "After submission your status shows Under Review. The Khettify team approves your account within 24 to 48 hours. After approval your full dashboard unlocks — catalogue, warehouses, inventory, team, seller certificates and reports." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                        <a href="/register" className="inline-flex items-center gap-2 rounded-full bg-[#ea2a33] text-white font-bold px-6 py-2.5 text-sm hover:bg-[#d11f28] transition-colors mt-2">
                                            Register as a Company
                                            <span className="material-symbols-outlined text-base">arrow_forward</span>
                                        </a>
                                    </div>
                                </details>

                                {/* 2 — How to Login */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">How to login</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "Go to the login page", body: "Visit khettify.com and click Login. You will see the Login to your account screen with Email or Phone and Password fields." },
                                            { num: "02", title: "Enter your email or phone number", body: "Enter the email address you used when registering, or your 10-digit phone number. Both work for login." },
                                            { num: "03", title: "Enter your password and login", body: "Enter your password in the Password field. Click the eye icon to show or hide it. Once both fields are filled, click the Login button to access your dashboard." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                        <a href="/login" className="inline-flex items-center gap-2 rounded-full bg-[#ea2a33] text-white font-bold px-6 py-2.5 text-sm hover:bg-[#d11f28] transition-colors mt-2">
                                            Login to Khettify
                                            <span className="material-symbols-outlined text-base">arrow_forward</span>
                                        </a>
                                    </div>
                                </details>

                                {/* 3 — Forgot Password */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Forgot your password?</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "Click Forgot password?", body: "On the login page, click the Forgot password? link below the password field." },
                                            { num: "02", title: "Enter your registered email", body: "Enter the email address you used when creating your Khettify account. Khettify will send a password reset link to that email." },
                                            { num: "03", title: "Click the reset link in your email", body: "Open the email from Khettify and click the reset link. Check your spam folder if you don't see it within a few minutes." },
                                            { num: "04", title: "Set your new password", body: "Enter and confirm your new password. Make sure it is at least 6 characters. Click Save to update." },
                                            { num: "05", title: "Login with your new password", body: "Go back to the login page, enter your email or phone and your new password, then click Login to access your dashboard." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                        <a href="/forgot-password" className="inline-flex items-center gap-2 rounded-full bg-[#ea2a33] text-white font-bold px-6 py-2.5 text-sm hover:bg-[#d11f28] transition-colors mt-2">
                                            Reset Password
                                            <span className="material-symbols-outlined text-base">arrow_forward</span>
                                        </a>
                                    </div>
                                </details>

                                {/* 4 — Home Page */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Your Home page</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "Revenue, Orders, Inventory & Alerts", body: "As soon as you log in, you will see four numbers at the top — your revenue this week, total orders, current inventory value, and alerts. Alerts are shown in red. Do not ignore them — they point to things that need your action right away." },
                                            { num: "02", title: "Updates — see what is happening on your platform", body: "Below the numbers is a live feed of recent activity. When a seller confirms a supply receipt, when a new supply request comes in, when a warehouse transfer is done — everything shows here with a timestamp. Click Show All to see the full history." },
                                            { num: "03", title: "Module cards — jump to any section quickly", body: "At the bottom of the Home page you will find cards for every module — Inventory, Product Catalog, Warehouses, Stock Transfers, Barcodes & Labels, Transfer History, Stock Valuation, PC Applications, Administration and more. Each card shows a quick number so you already know the current status before you click in." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 5 — Dashboard */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">The Dashboard — detailed analytics</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "Period filter — choose your time range", body: "At the top of the Dashboard you can choose Daily, Weekly, Monthly, Quarterly, Yearly or a Custom date range. All numbers on the page update based on what you select. Weekly is the default." },
                                            { num: "02", title: "Stock Value, Expiring, Shipments and Sales", body: "You will see four key numbers — your total inventory value, the value of stock expiring within 90 days (take this seriously to avoid wastage), how many shipments are currently in transit, and your sales for the selected period." },
                                            { num: "03", title: "Products, Warehouses and Orders", body: "Below the metric cards you can see your total products, how many are active and visible to sellers, how many warehouses you operate, and your order count for the selected period — all in one place." },
                                            { num: "04", title: "Sales Overview — Revenue, Units Sold and Returns", body: "At the bottom, the Sales Overview shows your revenue, how many units were sold, and how many returns came in. If you see no data, switch to a wider period like Monthly or Yearly to get the full picture." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>


                                {/* 6 — Inventory */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Inventory — your stock lots</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "Lots — the building block of your inventory", body: "On Khettify, your stock is organised into lots. Each lot represents a specific batch of a product — it has its own lot number, manufacturing date, expiry date, quantity, and the warehouse it belongs to. This makes it easy to track exactly which batch of stock is where and when it expires." },
                                            { num: "02", title: "The four summary numbers", body: "At the top of the Inventory page you will see Total Lots Created (all lots ever made), Fully Moved Out (lots where all stock has been dispatched), Units Created (total number of individual units across all lots), and Created Value (the total rupee value of all stock created)." },
                                            { num: "03", title: "Filters — find exactly what you need", body: "You can filter your lots using three quick buttons — All Lots shows everything, Expiring ≤90d highlights stock that will expire within 90 days so you can act on it before it is too late, and Expired shows lots that have already crossed their expiry date. You can also use the All Stock Status dropdown to filter by specific stock conditions." },
                                            { num: "04", title: "What each lot row tells you", body: "Every lot in the list shows its Lot Number, Product name and code, Category, which Warehouse it is stored in, Manufacturing date, Expiry date, current Quantity, and Expiry Status. The expiry status shows Good in green when the stock is well within date, and changes colour as it approaches or passes expiry." },
                                            { num: "05", title: "View and Label buttons", body: "Each lot has two action buttons. View opens the full details of that lot — its complete history, movement records and unit-level information. Label lets you print or download barcode labels for that lot, which are used for scanning during dispatch and warehouse operations." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 7 — Create Lot */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Create Lot — add new stock to your inventory</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "How to open Create Lot", body: "On the Inventory page, click the Create Lot button on the top right. A form will open where you can fill in all the details for your new lot." },
                                            { num: "02", title: "Option 1 — Khettify-generated lot number", body: "Select this option and Khettify will automatically assign a unique lot number when you save. The number is built from your company code, product code, box range, inner box range, year, month, date, SKU range and serial — for example KH-BHO-PRE607-BP01-BP02-BPinner01-BPinner20-2026-07-01-SKU01-SKU600-0002. You do not need to remember or type anything — the system handles it." },
                                            { num: "03", title: "Option 1 — Without bulk packaging", body: "Select your Product from the dropdown. If you do not need bulk packaging, leave the Do You Need Bulk Packaging Ids checkbox unchecked. Then fill in the Manufacturing Date, Expiry Date, Quantity, and select your Warehouse. Click Create Lot and your lot is ready." },
                                            { num: "04", title: "Option 1 — With bulk packaging (simple)", body: "If you tick Do You Need Bulk Packaging Ids, two extra fields appear — Number of Boxes and Units Per Box. Fill these in along with Manufacturing Date, Expiry Date, Quantity and Warehouse, then click Create Lot." },
                                            { num: "05", title: "Option 1 — With bulk packaging (inside bulk)", body: "If you then tick Inside Bulk Packaging, the two fields change into three — Main Boxes (total outer boxes in this lot), Boxes Per Main Boxes (how many inner boxes are inside one main box), and Units Per Box (how many units are inside one inner box). Fill all three along with the other fields and click Create Lot." },
                                            { num: "06", title: "Option 2 — Enter lot number manually", body: "If your company already uses its own lot numbering system, select Enter Manually. You will see checkboxes for each part of the lot number — Company Code, Product Code, Year, Month, Date, Batch Number, Bulk Packaging (Main Box), Inner Box, SKU, and Other. Tick the parts you want to include and the lot number preview builds at the bottom as you go." },
                                            { num: "07", title: "Rearranging the lot number parts", body: "Once you have selected the parts you want, you can reorder them. Click on any part shown in the preview at the bottom and use the left and right controls to move it to the correct position. This lets you match the exact format your company already uses." },
                                            { num: "08", title: "Complete and save", body: "After setting your lot number format, fill in the Manufacturing Date, Expiry Date, Quantity, Warehouse, and packaging details as needed. You can also set a Low-Stock Alert At value (optional) so Khettify notifies you when stock falls below that number. Click Create Lot to save." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 8 — Upload Product */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Upload Product — add products to your catalogue</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "Basic Product Information", body: "Go to Upload Product from the left menu. Start by entering the Product Name and selecting a Category. Add a Product Description to help sellers and buyers understand what the product is and what it does. You can also upload up to 5 product images in JPEG or PNG format (max 5MB each) — drag and drop or click browse to select them." },
                                            { num: "02", title: "Product Packaging Description & Measurement", body: "Select the Packaging Type (e.g. bag, bottle, box) and Unit of Measurement. Enter the Product Dimensions — Length, Width and Height in cm. Add the Shipping Weight (Gross) in kg. These details help calculate logistics and are shown to buyers." },
                                            { num: "03", title: "Identification & Traceability", body: "Enter the Country of Origin (India is pre-filled). Type your HSN Code — you can search by typing digits. Once the HSN Code is entered, the GST percentage will be filled in automatically. Enter your Manufacturer License Number (8 to 25 characters, letters and numbers only, with - or /). If this product is manufactured by another company, tick the Is this product from another company? checkbox." },
                                            { num: "04", title: "Pricing & Tax", body: "Enter the MRP (Maximum Retail Price) in rupees. The Cost Price is for internal use only and will not be visible to buyers — enter the price at which you supply the product. The GST percentage is determined automatically from the HSN Code you entered above." },
                                            { num: "05", title: "Product Variants", body: "If your product comes in different options such as size, colour or capacity, select Yes for Does this product have variants? If it is a single standard product with no variations, leave it as No." },
                                            { num: "06", title: "Supply & Logistics", body: "Enter the Minimum Order Quantity (MOQ) — the minimum number of units a seller must order at one time. Add your Monthly Production Capacity in units. Select the Bulk Packaging Type (e.g. carton, pallet) and enter the Capacity Bulk Package — how many units fit in one bulk package (e.g. 1 carton contains 50 units)." },
                                            { num: "07", title: "Compliance & Validity", body: "Enter the Shelf Life in days from the date of manufacturing (e.g. 730 for 2 years). This is used to calculate expiry dates when lots are created and to trigger expiry alerts in your inventory." },
                                            { num: "08", title: "Storage & Handling", body: "Select the Storage Instructions — the required storage condition for this product (e.g. cool and dry place, refrigerate). Add Usage / Application Instructions such as dosage and method of use — this is shown to customers on the product page. You can also add Handling & Safety Instructions (e.g. use gloves, keep away from children)." },
                                            { num: "09", title: "Save as Draft or Upload Product", body: "Once all sections are filled, you have two options. Save as Draft saves the product without making it live — you can come back and complete it later. Upload Product publishes it to your catalogue and makes it available to sellers. You can always edit a product after uploading from the Product Catalog page." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 9 — Product Catalog */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Product Catalog — manage all your products</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "What is the Product Catalog?", body: "The Product Catalog is where all your uploaded products live. It shows every product in your catalogue along with its product code, category, current status, cost price and MRP. The total count of products in your catalogue is shown at the top." },
                                            { num: "02", title: "Search and filter your products", body: "Use the search bar to find a product by name or product code. You can also filter by Category to see only products in a specific category, or filter by Status to see only Active, Draft or Inactive products." },
                                            { num: "03", title: "Product status — Active, Draft, Inactive", body: "Active means the product is live and visible to sellers. Draft means you saved it but have not published it yet — you can complete and upload it anytime. Inactive means the product has been taken off the catalogue and is no longer visible to sellers." },
                                            { num: "04", title: "View, Edit and Delete", body: "Each product row has three action buttons. The eye icon lets you view the full product details as sellers see it. The pencil icon opens the product for editing — you can update any information and save the changes. The bin icon deletes the product permanently from your catalogue." },
                                            { num: "05", title: "Add a new product", body: "Click the Add new product button on the top right to go directly to the Upload Product form and add a new product to your catalogue." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 10 — Warehouses */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Warehouses — manage your storage locations</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "What is the Warehouses page?", body: "The Warehouses page shows all the storage locations your company operates. Each warehouse appears as a card showing its name, address, how many units are currently in stock, total capacity, and an occupancy bar showing how full it is. The total number of warehouses is shown at the top." },
                                            { num: "02", title: "Warehouse card — what it shows", body: "Each warehouse card shows the warehouse name and address, current units in stock out of total capacity (e.g. 1,500 units — 75% of 2,000), and a list of the lots currently stored there with their lot numbers and quantities. Expired lots are highlighted in red so you can spot them immediately. If there are more lots than shown, a '+X more lots' link appears at the bottom." },
                                            { num: "03", title: "View warehouse details", body: "Click on any warehouse card to open its full details. You will see the warehouse code, full address, total capacity, units currently in stock, map location (if set), and a complete list of all lots in that warehouse — each showing the product name, lot number, expiry date and quantity." },
                                            { num: "04", title: "Add a new warehouse", body: "Click the Add Warehouse button on the top right. Fill in the warehouse Name, Code (auto-suggested), Capacity in units, State, City, full Address, and 6-digit Pincode. You can also paste a Google Maps share link (optional) to set the map location." },
                                            { num: "05", title: "Assign a Warehouse Manager", body: "While creating a warehouse, you must assign a Warehouse Manager at the same time. Fill in the manager's Full Name, Email, Phone Number and Password in the Warehouse Manager section at the bottom of the form. This creates a separate login account for the manager. Once you click Create, the manager will receive an email with their login details so they can sign in and start operating the warehouse." },
                                            { num: "06", title: "Edit a warehouse", body: "Click the pencil icon on any warehouse card to edit it. You can update the name, code, capacity, address, pincode and map link. You can also update the Warehouse Manager's name, email, phone number, or set a new password. Leave the password blank if you do not want to change it. Click Save Changes when done." },
                                            { num: "07", title: "Occupancy and capacity", body: "The orange occupancy bar on each card fills up as more stock is assigned to that warehouse. When a warehouse is empty, it shows 0% and displays Empty. Keep an eye on high-occupancy warehouses — if a warehouse is near full, consider transferring stock to another location or increasing its capacity." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 11 — Stock Transfers */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Stock Transfers — track and manage your shipments</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "What is Stock Transfers?", body: "Stock Transfers is where you track every movement of stock — whether it is a warehouse-to-warehouse transfer or a seller supply. It has two main tabs: Transfers (all shipments) and Traceability (track individual units, lots or invoices)." },
                                            { num: "02", title: "All Transfers tab", body: "The All Transfers tab shows every shipment ever created. Each row shows the Shipment Reference number, Seller Request number (if it is a seller supply), Product Name, Type (Transfer or Sales), Challan, Bilty Number, Bill, Status, and the date it was dispatched. You can search by shipment reference using the search bar on the right." },
                                            { num: "03", title: "Transfer types and status", body: "There are two types of shipments — Transfer (warehouse to warehouse movement) and Sales (seller supply orders). Status shows the current state — received means the stock has been confirmed received at the destination, in_transit means it is on the way and not yet received. Each shipment also has a Box and Shipping Label button to manage packaging and labels." },
                                            { num: "04", title: "Requests tab — warehouse stock requests", body: "The Requests tab shows stock transfer requests raised by warehouse operators. Each row shows the Product, Quantity requested, Source warehouse (From), Requesting warehouse (For), Transfer Reference, Status, and when it was requested. Status accepted means the request has been approved and a shipment has been created. Status fulfilled means the stock has been delivered and received. You can also raise a new request using the Request Stock button." },
                                            { num: "05", title: "Traceability tab — trace any unit, lot or invoice", body: "The Traceability tab lets you track the complete journey of any item. Type a unit serial number, lot number, or invoice number in the search bar and click Search. Khettify will show you exactly where that unit or lot came from, where it went, and who received it — giving you full end-to-end traceability across your supply chain. The Auto mode detects what you typed automatically, or you can manually select Serial, Lot or Invoice from the dropdown." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 12 — Barcodes & Labels */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Barcodes & Labels — generate and print unit labels</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "What is Barcodes & Labels?", body: "Barcodes & Labels lets you generate and print individual unit labels for any lot. Each unit gets its own barcode label showing the product name, packaging type, lot number, quantity, MRP, manufacturing date, expiry date and a scannable barcode. These labels are used during dispatch and warehouse scanning." },
                                            { num: "02", title: "Select a lot", body: "Use the Lot dropdown at the top to select the lot you want to generate labels for. The lot number and available quantity are shown in the dropdown. Once selected, you will see how many unit labels have already been generated for that lot." },
                                            { num: "03", title: "Generate unit labels", body: "Enter the number of labels you want to generate in the Generate Qty field and click Generate Units. If all units for the lot have already been labelled, the system will show a message saying all unit labels have already been generated and the Generate Units button will be disabled." },
                                            { num: "04", title: "What each label shows", body: "Each printed label shows the product name, packaging type (e.g. Sachet), lot number, quantity, MRP, manufacturing date, expiry date, and a barcode at the bottom. The barcode encodes the lot number and can be scanned during warehouse operations and dispatch." },
                                            { num: "05", title: "Print labels", body: "Once labels are generated, a print preview appears showing all the labels laid out on the page. You can choose how many labels to print per page using the layout selector (e.g. 65 per page, 38×21mm). Click Print Labels to send them to your printer." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 13 — Transfer History */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Transfer History — see every warehouse transfer</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "What is Transfer History?", body: "Transfer History shows every stock movement between your own warehouses in one place. Only actual shipments (references starting with SH-) are listed here. Stock requests raised by warehouses are not repeated on this page — you can still find them in Stock Transfers under the Requests tab." },
                                            { num: "02", title: "The four summary numbers", body: "At the top you see Total Transfers (every warehouse-to-warehouse transfer), In Transit (dispatched but not yet received), Received / Completed (stock confirmed at the destination warehouse), and Total Transfer Value (the total MRP value of all stock moved)." },
                                            { num: "03", title: "Filters — find a transfer quickly", body: "Filter by Status (In Transit or Received), by Warehouse, and by a From and To date range. You can also search by transfer reference, item name or lot number. Filters apply as soon as you change them — there is no Apply button. If the From date is later than the To date, Khettify shows a warning. Click Clear to reset all filters." },
                                            { num: "04", title: "What each row tells you", body: "Each row shows the Ref (transfer reference), Type, From warehouse, To warehouse, Item, Lot No., Qty, Status, MRP, Date and Actions. The table shows 10 transfers per page — use Previous and Next at the bottom to move between pages." },
                                            { num: "05", title: "View transfer details", body: "Click View on any row to open the full transfer. The Transfer Summary shows the reference number, transfer type (Warehouse → Warehouse), From and To warehouse, status, transfer date, dispatch date, receive date, who approved it, who received it, total quantity and total value." },
                                            { num: "06", title: "Shipment status timeline", body: "The timeline shows every stage the transfer has passed — Planned, Approved, In Transit, Verifying and Received — with the date and time of each step. Stages not yet reached are shown as Not reached." },
                                            { num: "07", title: "Product and packaging details", body: "Product Details lists each product moved with its code, category, lot number, batch number, MRP, manufacturing date, expiry date, quantity transferred and quantity received. Packaging Details shows whether the stock was moved using Bulk Packaging IDs, individual units, or as a lot quantity. A barcode of the transfer reference is shown for scanning." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 14 — Stock Valuation */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Stock Valuation — know the value of your stock</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "What is Stock Valuation?", body: "Stock Valuation shows your Stock on Hand — every lot in every warehouse, how many units are available, and what that stock is worth. The report loads automatically when you open the page. No report selection is needed." },
                                            { num: "02", title: "Filter by date and warehouse", body: "Use the From and To date fields to narrow the report to a period, then click Run. Use the Warehouse dropdown to see stock for one warehouse or choose All for every warehouse. Choosing a warehouse refreshes the report straight away." },
                                            { num: "03", title: "What each column shows", body: "Each row shows the Product, Warehouse, Lot/Batch, Qty (units available), MRP (price per unit), Amount (quantity × price — the value of that stock) and Expiry date. The table shows 10 rows per page, and the total row count is shown above the table." },
                                            { num: "04", title: "Download the report as CSV", body: "Click the CSV button to download the full report with your current filters. The download includes every row, not just the page you are viewing, and opens directly in Excel or Google Sheets." },
                                            { num: "05", title: "View product details", body: "Click View on any row to open its full details. Product Summary shows the product name, code, category, lot number, batch number, warehouse, quantity, MRP, total amount, manufacturing date and expiry date. Inventory Information shows the current warehouse, available quantity, receiving status and low stock alert level. Stock Summary shows the total stock value and warehouse location." },
                                            { num: "06", title: "Plan availability", body: "Stock Valuation is part of the paid plans. On the Free plan the menu item shows a lock — clicking it opens Billing & Plans so you can upgrade." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 15 — PC Applications */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">PC Applications — authorize sellers with a Principal Certificate</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "What is a Principal Certificate?", body: "A Principal Certificate (PC) is your official authorization for a seller to sell your products. Sellers apply to your company from their Seller portal, and every application arrives on the PC Applications page. A seller can only list and sell your products after you issue them an active PC." },
                                            { num: "02", title: "The applications list", body: "Each row shows the seller's business name, their product categories, the date they applied and the current status. Use the filter dropdown at the top right to show All, Pending action (applications waiting for you), Active or Rejected. Click any row to open the application." },
                                            { num: "03", title: "Application statuses", body: "Applied — a new application. Under Review — you are checking it. Need Docs — you asked the seller for more documents. Awaiting Signature — approved, waiting for the seller to sign the agreement. Ready to Issue — the seller has signed. Active — the certificate is issued. Rejected — the application was declined." },
                                            { num: "04", title: "Review the application", body: "The application window shows the seller's business details, their answers to your application form, all attached documents and a timeline of every action. Click Verify or Reject on each document after checking it." },
                                            { num: "05", title: "Take action", body: "Click Mark under review when you start checking. Click Request docs and type the documents you need (comma-separated) — the seller is asked to upload them. Click Reject and enter a reason to decline. Click Approve when everything is correct — Khettify generates an agreement automatically." },
                                            { num: "06", title: "Send and sign the agreement", body: "After approval the status becomes Awaiting Signature. You can attach your own agreement PDF and click Attach & send, or let the seller sign the generated draft. Once the seller signs, the status changes to Ready to Issue and you can view the signed agreement." },
                                            { num: "07", title: "Issue the certificate", body: "Click Issue Principal Certificate and set how long it stays valid — between 1 and 120 months, with quick options of 12, 24, 36 or 60 months. The certificate becomes Active immediately and can be downloaded. The seller now appears on your Sellers page." },
                                            { num: "08", title: "Revoke or reinstate a certificate", body: "If you need to stop a seller, open their application and click Revoke — you can add an optional reason. To allow them again, click Reinstate. The certificate becomes Active again if it is still within its validity period." },
                                            { num: "09", title: "Customise your application form", body: "Click Application form at the top to decide what sellers must fill in. Add fields with a label, key and type (text, number, date, select or file), and mark them Required if needed. Use Auto-fill from profile to fill a field from the seller's profile — business name, contact person, email, phone, address, GSTIN, PAN or their GST and PAN files — so sellers never re-type them. Reorder or delete fields from the ⋮ menu, then click Save form." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 16 — Administration */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Administration — your company control centre</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "What is Administration?", body: "Administration is a card hub that groups all your setup screens in one place, so they stay out of the way of daily work but are easy to find. Open it from the sidebar, or from the profile menu at the top right of any page." },
                                            { num: "02", title: "Cards available", body: "You will see cards for Sellers, Supply Requests, PC Applications, Customers, Returns, Team & Roles, Settings, Billing & Plans and Support. Each card shows a short description — click any card to open that section. Cards for sections your role cannot access are hidden automatically." },
                                            { num: "03", title: "Plan availability", body: "Administration is part of the paid plans. On the Free plan the menu item shows a lock, and clicking it opens Billing & Plans. Profile and Logout are always available from the profile menu." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 17 — Sellers */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Sellers — your authorized resellers</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "What is the Sellers page?", body: "The Sellers page lists every dealer and distributor you have authorized — the sellers you have issued a Principal Certificate to. Issuing a PC is the approval, so there is no separate approval step on this page." },
                                            { num: "02", title: "What each row shows", body: "Each row shows the Business (business name and owner name), Contact (email and phone), Location (city and state), Certificate (the PC number) and Issued (the date the certificate was issued)." },
                                            { num: "03", title: "How to add a new seller", body: "Sellers cannot be added directly. A seller applies for your Principal Certificate from their Seller portal. Click Review PC applications at the top right to review new applicants, approve them and issue the certificate — they will then appear here automatically." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 18 — Supply Requests */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Supply Requests — approve stock requests from your sellers</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "What is a supply request?", body: "A supply request is a bulk stock request from one of your authorized sellers. Approving a request only authorizes it and assigns a source warehouse — no stock moves at approval. The warehouse then picks, packs and dispatches the stock from Send Stock." },
                                            { num: "02", title: "The requests list", body: "Each row shows the Request Serial No., Seller, Quantity, Destination, Source (Warehouse), Parent Lot No., Status, a View button and Actions. New requests show Approve and Reject buttons." },
                                            { num: "03", title: "Approve and assign a warehouse", body: "Click Approve to open Assign a source warehouse. Khettify checks stock availability in each of your warehouses and marks warehouses without enough stock as Insufficient. Select the warehouse the stock should come from and click Approve & assign. To decline, click Reject and confirm." },
                                            { num: "04", title: "Track the request status", body: "After approval the status shows exactly where the request is — Assigned (pick in Send Stock), Picking in Send Stock, Packed (print label & dispatch), In transit (awaiting seller scan), and finally Received & verified. If the seller reports a mismatch while scanning, it shows Received with discrepancies." },
                                            { num: "05", title: "View request details", body: "Click View to open the full request. Request Summary shows the seller, source warehouse, destination, product, requested, approved, picked, dispatched and received quantities, request date, shipment reference and current status. Parent Lots shows the lots allocated with lot number, batch, quantity, MRP, category, manufacturing and expiry dates. You can also see the packaging summary, search unit serial numbers and follow the complete timeline." },
                                            { num: "06", title: "Plan availability", body: "The supply workflow is a premium feature. On the Free plan this page shows a message asking you to upgrade your plan to manage seller supply requests." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 19 — Customers */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Customers — your customer directory and direct sales</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "What is the Customers page?", body: "Customers is your directory of buyers you sell to directly. Each row shows the customer Code, Name, Type, Phone and GSTIN. Use the search bar to find a customer by name, phone number or code." },
                                            { num: "02", title: "Add a new customer", body: "Click New Customer and fill in the Name, Type (Retail or Business), Phone (10 digits), Email, GSTIN, GST State code (2 digits), Address, City, State and Pincode (6 digits). All fields are required — any mistake is highlighted. Click Create to save. Use Edit on any row to update the details later." },
                                            { num: "03", title: "View purchase history", body: "Click History on any customer to see all the orders created for them." },
                                            { num: "04", title: "Create a new sale", body: "Click New Sale, add the products and quantities, and create the order. Khettify reserves the stock on a FEFO basis (first expiry, first out) and assigns a GST invoice number. The stock is deducted when the order is dispatched." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 20 — Team & Roles */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Team & Roles — manage your team members</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "What is Team & Roles?", body: "Team & Roles lists everyone who has access to your company account. Each row shows the member's Name, Email, Phone, Role, assigned Warehouse and Status. The total number of members is shown at the top." },
                                            { num: "02", title: "How warehouse managers are created", body: "Warehouse Managers are created when you add a warehouse — the manager account is created and assigned to that warehouse in one step. Click Add Warehouse on this page to go straight to the Warehouses page and create one." },
                                            { num: "03", title: "Roles", body: "Company Admin has full access to the company account. Operations Manager handles stock operations such as receiving, transfers and dispatch. Sales Manager handles orders and customers. Each person only sees the modules their role allows." },
                                            { num: "04", title: "Enable, disable or remove a member", body: "Click Disable to stop a member from logging in temporarily, and Enable to give them access again. Click Remove and confirm to delete a member permanently." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 21 — Settings */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Settings — subscription and alert preferences</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "Your subscription", body: "The Subscription card shows your current plan. Click Manage Plan to open Billing & Plans and upgrade or change your plan." },
                                            { num: "02", title: "Alert preferences", body: "Turn alerts on or off using the toggles — Low-stock alerts (when a lot drops below its reorder level), Expiry alerts (lots expiring within 90 days) and Order alerts (new and updated seller orders). These preferences are saved on the device you are using, so set them again on each device." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 22 — Billing & Plans */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Billing & Plans — choose the right plan</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "The three plans", body: "Khettify offers three plans — Free, Pro and Enterprise. Each plan card shows its monthly price, what is included, and which plan you are currently on." },
                                            { num: "02", title: "Free plan", body: "The Free plan includes a basic product catalog, order stock deduction, low-stock alerts, and up to 50 products." },
                                            { num: "03", title: "Pro plan", body: "Pro includes everything in Free plus full inventory management, multi-warehouse with reserved stock, supply orders, batch and expiry tracking, advanced stock valuation, and up to 5,000 products." },
                                            { num: "04", title: "Enterprise plan", body: "Enterprise includes everything in Pro plus unlimited products and warehouses, AI forecasting, API access and priority support." },
                                            { num: "05", title: "Upgrade your plan", body: "Click the Subscribe button on the plan you want. Once the plan is active, all locked modules unlock straight away and you are taken to Inventory. If you open Billing by clicking a locked menu item, the page tells you which feature you are unlocking." },
                                            { num: "06", title: "Billing history", body: "The Billing history table at the bottom lists all your plan changes with the Invoice number, Plan, Date, Status and Amount." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 23 — Support */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Support — raise a request or chat with us</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "Open the Support Center", body: "Open Support from Administration. The Support Center lets you raise formal requests, see the status of all your past requests, and find Khettify's contact details." },
                                            { num: "02", title: "Raise a support request", body: "Click Raise a Request. Select a category (Product Upload, Inventory & Stock, Orders, Warehouses & Operations, Sellers / Dealers, Returns, Billing & Subscription, Account & Settings or Other), enter a short Subject and describe your issue in detail. Click Submit Request." },
                                            { num: "03", title: "Track your requests", body: "Your Requests shows every request with its Request ID, Category, Subject, Description, Status and Created Date. Status moves from Open to In Review to Resolved or Closed." },
                                            { num: "04", title: "Contact details", body: "You can also email support@khetify.com. The support team works Monday to Saturday, 9:00 AM to 6:00 PM, and typically responds within 4 hours." },
                                            { num: "05", title: "Live chat", body: "Click the red chat button at the bottom right of any page to open Khetify Support chat. The AI Assistant answers first. If you need a person, click Talk to Admin — the status shows Waiting for Admin, then Connected with Agent once someone joins. A chat closes after a period of inactivity; click Start New Chat to begin again." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 24 — FAQ */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">FAQ — find answers quickly</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "Open the FAQ", body: "Click FAQ at the bottom of the sidebar. It is always available on every plan." },
                                            { num: "02", title: "Search and filter", body: "Type in the Search questions box to find an answer instantly, or choose a category from the dropdown to see only questions about that topic." },
                                            { num: "03", title: "Rate an answer", body: "Below each answer, click thumbs up or thumbs down to tell us whether it helped. Your feedback helps us improve the answers." },
                                            { num: "04", title: "Need more help?", body: "If you cannot find your answer, use the Need More Help section to Raise a Ticket, Email Us or Call Us." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 25 — Notifications */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Notifications — stay on top of alerts</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "The notification bell", body: "The bell icon at the top of every page shows how many unread notifications you have. Click it for a quick list of the latest notifications, click Mark all read to clear the count, or click View all to open the full Notifications page." },
                                            { num: "02", title: "Filter notifications", body: "On the Notifications page, use the filter buttons to show All, Expiry, Low Stock, Orders, Shipments or Supply notifications. The number of unread notifications is shown at the top." },
                                            { num: "03", title: "Mark as read", body: "Click any unread notification to mark it as read, or click Mark all read to mark everything at once." },
                                            { num: "04", title: "Scan alerts", body: "Click Scan alerts to check your stock right now for new low-stock and expiry alerts instead of waiting for the next automatic check." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* 26 — Profile */}
                                <details className="group py-6 list-none [&::-webkit-details-marker]:hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer select-none list-none">
                                        <span className="text-base font-semibold text-[#1b0e0e] group-open:text-[#ea2a33] transition-colors">Your Company Profile</span>
                                        <span className="shrink-0 text-[#ea2a33] text-2xl font-light leading-none group-open:rotate-45 transition-transform duration-200">+</span>
                                    </summary>
                                    <div className="mt-6 space-y-6">
                                        {[
                                            { num: "01", title: "Open your profile", body: "Click your company name at the top right of any page and select Profile. The same menu also has Administration, Settings and Logout." },
                                            { num: "02", title: "What your profile shows", body: "Company Profile shows your company details, contact information and all your registration documents — GSTIN, PAN, Udyam and other licences such as TAN, Gumasta / Shop Act, Agriculture and Horticulture licences. You can view or download each document." },
                                            { num: "03", title: "Edit your profile", body: "Click Edit profile to update your details or replace a document using the file picker. Click Save Changes to save, or Cancel to discard your edits." },
                                            { num: "04", title: "Verify your phone number", body: "If your phone number is not yet verified, click Verify. Khettify sends a 6-digit code by SMS — enter it to verify your number. If the code does not arrive, click Resend code." },
                                        ].map((s, i) => (
                                            <div key={i} className="flex gap-4">
                                                <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[#ea2a33]/10 text-[#ea2a33] font-black text-xs mt-0.5">{s.num}</span>
                                                <div>
                                                    <p className="text-sm font-bold text-[#1b0e0e]">{s.title}</p>
                                                    <p className="mt-1 text-sm text-[#6b7280] leading-relaxed">{s.body}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>

                            </div>
                        </div>
                    </div>
                </section>
    </>
  );
}