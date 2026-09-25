// FAQ content for the Company and Seller portals. Pure data (no JSX) so the same
// shared <FaqView /> can render either set, and the copy stays easy to edit in
// one place. Grouped by category; each item is { q, a }.

export const COMPANY_FAQ = [
  {
    category: 'Registration & Onboarding',
    icon: 'how_to_reg',
    items: [
      { q: 'How do I create a company account on Khettify?', a: 'Click "Register as Company" on the home page and fill in your company name, email address, phone number, and password. Once submitted, your company account is created and sent for approval.' },
      { q: 'What documents are required to register a company?', a: 'During onboarding you will be asked for your business name, GST number, PAN, address, and bank details for verification.' },
      { q: 'Is company registration free?', a: 'Yes, creating a company account is free. Some advanced features (like advanced reports) need a Pro/Enterprise plan \u2014 see Billing & Plans.' },
      { q: 'What happens after I complete the registration?', a: 'Your application is sent for review. Once approved, you get access to the Company Dashboard, Inventory, Warehouses, Stock Transfers and every other module.' },
      { q: 'Why was my registration rejected?', a: 'This usually happens because of incomplete information, an invalid GST number, or missing documents. Contact Khettify Support (Administration > Support) for the exact reason.' },
      { q: 'Who do I contact for help during onboarding?', a: 'Use the chat bubble in the bottom-right corner of the screen, or email company.support@khettify.com.' },
    ],
  },
  {
    category: 'Account, Login & Security',
    icon: 'lock',
    items: [
      { q: 'How do I log in to my company account?', a: 'Go to the Company Login page and sign in with your registered email address and password.' },
      { q: 'What should I do if I forget my password?', a: 'Click "Forgot Password" on the login page, enter your registered email, and follow the reset link sent to your inbox.' },
      { q: 'How do I change my password while logged in?', a: 'Click your company name (top right) > "Settings", and use the change-password option there.' },
      { q: 'Can multiple people log in and work on the same company account?', a: 'Yes. Add team members from Administration > "Team & Roles" and assign them the Warehouse Manager role for the warehouse(s) they should handle.' },
    ],
  },
  {
    category: 'Home Page',
    icon: 'home',
    items: [
      { q: 'What do I see when I log in?', a: 'You land on the "Home" page. It shows a quick snapshot \u2014 Revenue (week), Orders, Inventory Value, and an Alerts count \u2014 plus an "Updates" feed and shortcut cards for Dashboard, Inventory, and Upload Product.' },
      { q: 'What kind of updates appear in the Updates feed?', a: 'You will see things like "Lot expiring soon", "Lot expired", and "Supply received" (when a seller confirms receipt of a transfer), each with a timestamp. Click "SHOW ALL" to see the full list.' },
      { q: 'What does the Alerts number on the Home page mean?', a: 'It is the total count of things needing your attention right now \u2014 mainly lots that are expiring soon or already expired.' },
      { q: 'What do the shortcut cards at the bottom of Home do?', a: 'Each card (Dashboard, Inventory, Upload Product, etc.) is a quick link \u2014 click it to jump straight to that module instead of using the sidebar.' },
    ],
  },
  {
    category: 'Dashboard & Sales Reports',
    icon: 'dashboard',
    items: [
      { q: 'What does the Dashboard show?', a: 'It shows Total Products, Active Products, number of Warehouses, and Orders for the selected period, plus a "Sales overview" with Revenue, Units Sold, and Returns shown as a day-by-day chart (Mon\u2013Sun).' },
      { q: 'How do I change the reporting period on the Dashboard?', a: 'Use the "PERIOD" tabs at the top \u2014 Daily, Weekly, Monthly, Quarterly, Yearly, or Custom (pick your own date range).' },
      { q: 'Is the Dashboard updated in real time?', a: 'Yes, figures update as new sales, orders, and inventory changes happen.' },
    ],
  },
  {
    category: 'Upload Product',
    icon: 'upload_file',
    items: [
      { q: 'How do I add a new product to my catalog?', a: 'Steps: 1) Go to "Upload Product". 2) Fill in "Basic Product Information" \u2014 Product Name, Category, and an optional Description. 3) Upload up to 5 product images (JPEG/PNG, max 5MB each). 4) Fill in "Product Packaging Description & Measurement" \u2014 Packaging Type, Unit of Measurement, Product Dimensions, and Shipping Weight. 5) Submit to add it to your Product Catalog.' },
      { q: 'How many images can I upload for one product?', a: 'Up to 5 images, in JPEG or PNG format, each up to 5MB.' },
      { q: 'What is "Packaging Type" and "Unit of Measurement" used for?', a: 'They describe how the product is packed and measured (for example, pieces, kg, or grams) so quantities and labels are calculated correctly later.' },
    ],
  },
  {
    category: 'Product Catalog',
    icon: 'inventory_2',
    items: [
      { q: 'Where can I see all my products?', a: 'Go to "Product Catalog". It lists every product with its image, name, product code, category, status (Active/Inactive), Cost Price, and MRP.' },
      { q: 'How do I add a new product from here?', a: 'Click "+ Add new product" at the top right \u2014 this takes you to the Upload Product form.' },
      { q: 'How do I search or filter products?', a: 'Use the search box (by name or product code) and the Category / Status dropdown filters at the top of the page.' },
      { q: 'How do I edit or delete a product?', a: 'In the Actions column, click the eye icon to view, the pencil icon to edit, or the trash icon to delete a product.' },
      { q: 'Can I update the price of a product later?', a: 'Yes, open the product with the pencil (edit) icon and update the Cost Price or MRP at any time.' },
    ],
  },
  {
    category: 'Inventory & Lots',
    icon: 'inventory',
    items: [
      { q: 'What does the Inventory page show?', a: 'It lists every lot you have created, with summary cards for Total Lots Created, Fully Moved Out, Units Created, and Created Value.' },
      { q: 'How do I create a new lot?', a: 'Steps: 1) Go to "Inventory". 2) Click "Create Lot". 3) Choose the product, the warehouse it goes into, the manufacturing date, expiry date, and quantity. 4) Save \u2014 the lot is created with its own Lot Number for tracking.' },
      { q: 'What columns are shown for each lot?', a: 'Lot No., Product, Product Code, Category, Warehouse, MFG (manufacturing date), Expiry, Qty, Expiry Status (Good / Expired / Awaiting Receipt), and Actions (View, Label).' },
      { q: 'How do I check which lots are expiring soon or already expired?', a: 'Use the "Expiring \u2264 90d" and "Expired" filter buttons above the lot table, or the "All Stock Status" dropdown for more filters.' },
      { q: 'What does "AWAITING RECEIPT" status mean on a lot?', a: 'It means the lot has been sent to a warehouse but the warehouse has not yet scanned and confirmed receipt of it.' },
      { q: 'Can I print a label for a lot from here?', a: 'Yes, click "Label" in the Actions column to jump to Barcodes & Labels for that lot.' },
    ],
  },
  {
    category: 'Warehouses',
    icon: 'warehouse',
    items: [
      { q: 'How do I add a new warehouse?', a: 'Steps: 1) Go to "Warehouses". 2) Click "Add Warehouse". 3) Enter the warehouse name, address, and storage capacity. 4) Save.' },
      { q: 'How do I edit a warehouse\u2019s details?', a: 'Click the pencil icon on the warehouse card to update its name, address, or capacity.' },
      { q: 'What does the occupancy bar on each warehouse card mean?', a: 'It shows how many units are currently stored in that warehouse against its set capacity (for example, "1,479 units \u00b7 74% of 2,000").' },
      { q: 'Why is a lot shown in red on a warehouse card?', a: 'A lot listed in red (with "(Expired)" next to its name) means that lot inside this warehouse has passed its expiry date.' },
      { q: 'Can I see all the lots inside one warehouse?', a: 'Yes, each warehouse card lists its top lots with quantities, and you can click "+ more lots" to see the rest.' },
    ],
  },
  {
    category: 'Stock Transfers & Traceability',
    icon: 'sync_alt',
    items: [
      { q: 'What is the Stock Transfers page for?', a: 'It lets you track every transfer of stock \u2014 to sellers and between your own warehouses \u2014 and trace where any lot has been.' },
      { q: 'What is the difference between "All Transfers" and "Requests"?', a: '"All Transfers" shows every shipment that has been dispatched, with its Shipment Ref, related Seller Request No., Challan, Bilty Number, Bill, and status. "Requests" shows incoming requests (from sellers) that are waiting to be turned into a transfer.' },
      { q: 'How do I check if a shipment reached a warehouse or seller?', a: 'Check the "Status" column \u2014 it shows values like "received" once the other side has scanned and confirmed the shipment.' },
      { q: 'Can I view the Challan, Bilty Number, or Bill for a shipment?', a: 'Yes, click "View" next to Challan, Bilty Number, or Bill in that shipment\u2019s row to open the document.' },
      { q: 'What is the "Box" button next to a shipment?', a: 'It shows how the shipment was packed \u2014 for example "Box (1)" means the shipment was packed into 1 box; click it to see the packing details.' },
      { q: 'What is the Traceability tab used for?', a: 'Go to the "Traceability" tab, enter or scan a lot number, and see its complete movement history \u2014 when it was created, transferred, received, or dispatched to a seller.' },
      { q: 'Can I print a shipping label from Stock Transfers?', a: 'Yes, click "Shipping Label" in a shipment\u2019s row to print or download its barcode label.' },
    ],
  },
  {
    category: 'Barcodes & Labels',
    icon: 'qr_code_2',
    items: [
      { q: 'How do I generate labels for a lot?', a: 'Steps: 1) Go to "Barcodes & Labels". 2) Select the lot from the dropdown. 3) Enter the "Generate Qty" (number of unit labels needed). 4) Click "Generate Units".' },
      { q: 'How do I print already-generated labels?', a: 'Select the lot, choose your label size (for example "65 / page \u00b7 38\u00d721mm"), and click "Print Labels".' },
      { q: 'What is shown on each printed label?', a: 'The product name, lot number, quantity, MRP, manufacturing date, expiry date, and a scannable barcode.' },
      { q: 'What does "Bulk Packaging Box" on a label mean?', a: 'It is a label for an entire box of units within a lot (for example "Box 1 of 2"), showing how many units are inside that box, so the box can be scanned as one unit during transfers.' },
      { q: 'What if it says "All unit labels for this lot have already been generated"?', a: 'It means every unit in that lot already has a label \u2014 you don\u2019t need to generate more; you can still print the existing ones again if needed.' },
    ],
  },
  {
    category: 'Transfer History',
    icon: 'history',
    items: [
      { q: 'What does Transfer History show?', a: 'A record of every warehouse-to-warehouse and warehouse-to-seller transfer, with summary cards for Total Transfers, In Transit, Received/Completed, and Total Transfer Value.' },
      { q: 'How do I find a specific transfer?', a: 'Use the filters at the top \u2014 status, warehouse, a date range, or search by reference/item/lot number.' },
      { q: 'What details are shown for each transfer?', a: 'Ref, Type (Transfer/Sales), From and To warehouse, Item, Lot No., Qty, Status, MRP, Date, and a "View" action for full details.' },
      { q: 'How do I clear my filters?', a: 'Click the "Clear" button below the filter row to reset all filters and see every transfer again.' },
    ],
  },
  {
    category: 'Stock Valuation & Reports',
    icon: 'trending_up',
    items: [
      { q: 'What does the Stock Valuation report show?', a: 'A report of the value of your stock \u2014 by Product, Warehouse, Lot/Batch, Qty, MRP, Amount, and Expiry date.' },
      { q: 'How do I generate a stock valuation report?', a: 'Steps: 1) Go to "Stock Valuation". 2) Pick a "From" and "To" date. 3) Optionally choose a specific warehouse (or leave "All"). 4) Click "Run".' },
      { q: 'Can I download the report?', a: 'Yes, click the "CSV" button next to "Run" to download the report as a spreadsheet.' },
      { q: 'What does "advanced reports require the Pro/Enterprise plan" mean?', a: 'Some deeper report views/filters are only available on the Pro or Enterprise subscription. Upgrade from Administration > "Billing & Plans" to unlock them.' },
    ],
  },
  {
    category: 'Administration Overview',
    icon: 'admin_panel_settings',
    items: [
      { q: 'What is the Administration page for?', a: 'It is your control panel for people and company-wide preferences. It has 9 sections: Sellers, Supply Requests, PC Applications, Customers, Returns, Team & Roles, Settings, Billing & Plans, and Support.' },
      { q: 'How do I get to Administration?', a: 'Click "Administration" in the left sidebar, or click your company name (top right) and choose "Administration" from the dropdown.' },
    ],
  },
  {
    category: 'Sellers',
    icon: 'storefront',
    items: [
      { q: 'What does the Sellers page show?', a: 'Go to Administration > "Sellers" to see the list of sellers/dealers that are added to and supply from your company.' },
      { q: 'How does a seller get added here?', a: 'Sellers are added once they are approved through Supply Requests or PC Applications, or when you add them directly from this page.' },
    ],
  },
  {
    category: 'Supply Requests',
    icon: 'assignment',
    items: [
      { q: 'What is a Supply Request?', a: 'It is a bulk-stock request submitted by one of your sellers/dealers, asking for a certain product and quantity.' },
      { q: 'How do I handle a supply request?', a: 'Steps: 1) Go to Administration > "Supply Requests". 2) Open the request and review the seller, product, and quantity. 3) Click "Approve". 4) Assign the warehouse that should fulfil it. 5) That warehouse then sends (dispatches) the requested stock to the seller.' },
      { q: 'What happens after I assign a warehouse to a request?', a: 'The request appears in that warehouse\u2019s "Seller Requests" tab under Stock Transfers, ready for the warehouse to pack, scan, and dispatch to the seller.' },
      { q: 'Can I reject a supply request?', a: 'Yes, if the request cannot be fulfilled, you can decline it instead of approving.' },
    ],
  },
  {
    category: 'PC Applications',
    icon: 'workspace_premium',
    items: [
      { q: 'What is a PC Application?', a: 'PC stands for Principal Certificate \u2014 an authorization that lets a seller officially represent/resell your products. Sellers apply for this from their side.' },
      { q: 'How do I set up the application form sellers fill out?', a: 'Steps: 1) Go to Administration > "PC Applications". 2) Click "Application form" to open the form builder. 3) Add or edit fields (Field Label, Type, whether it auto-fills from the seller\u2019s profile, and whether it is Required). 4) Click "+ Add field" for more fields, or "Save form" when done.' },
      { q: 'How do I review and approve a PC application?', a: 'Steps: 1) Open the seller\u2019s application from the list. 2) Verify their submitted documents/details. 3) Approve it and send them the agreement. 4) Once the seller signs and returns the agreement, issue their Principal Certificate. 5) Choose the validity period for the PC \u2014 for example 12 months, 24 months, or 36 months.' },
      { q: 'What do the "Active" and "Open" labels next to an application mean?', a: '"Active" shows the current status of the seller\u2019s authorization, and "Open" shows the application is still awaiting your action.' },
      { q: 'Can I choose how long a Principal Certificate is valid for?', a: 'Yes, when you issue the PC you choose the duration \u2014 common options are 12, 24, or 36 months \u2014 based on your agreement with that seller.' },
    ],
  },
  {
    category: 'Customers',
    icon: 'group',
    items: [
      { q: 'What does the Customers page show?', a: 'Go to Administration > "Customers" to see the directory of customers connected to your business and their order/purchase history.' },
    ],
  },
  {
    category: 'Returns',
    icon: 'assignment_return',
    items: [
      { q: 'What does the Returns page show?', a: 'Go to Administration > "Returns" to see products that customers have sent back, so you can review and process each one.' },
      { q: 'Is inventory updated after a return is processed?', a: 'Yes, once a return is accepted the returned quantity is added back to your available inventory.' },
    ],
  },
  {
    category: 'Team & Roles',
    icon: 'manage_accounts',
    items: [
      { q: 'What does the Team & Roles page show?', a: 'Go to Administration > "Team & Roles" to see the Warehouse Managers added under your company, along with their assigned warehouse.' },
      { q: 'How do I disable or remove a Warehouse Manager?', a: 'Open the manager\u2019s row in "Team & Roles" and use the Disable or Remove action \u2014 disabling blocks their login without deleting them, while removing takes them off your team completely.' },
      { q: 'How do I add a new Warehouse Manager?', a: 'From "Team & Roles", add a new team member, assign them the Warehouse Manager role, and pick which warehouse they should manage.' },
    ],
  },
  {
    category: 'Company Settings & Alerts',
    icon: 'settings',
    items: [
      { q: 'What can I configure in Settings?', a: 'Go to Administration > "Settings" to turn specific alerts on or off for your company: Low-stock alerts, Expiry alerts, and Order alerts.' },
      { q: 'What does "Low-stock alerts" do?', a: 'When turned on, you get notified whenever a product\u2019s available stock drops low, so you can restock in time.' },
      { q: 'What does "Expiry alerts" do?', a: 'When turned on, you get notified about lots that are expiring soon or have already expired (these also show up on your Home page Updates feed).' },
      { q: 'What does "Order alerts" do?', a: 'When turned on, you get notified whenever there is activity on an order that needs your attention.' },
      { q: 'Can I turn any of these alerts off?', a: 'Yes, each alert has its own on/off toggle in Settings, so you can turn off the ones you don\u2019t want.' },
    ],
  },
  {
    category: 'Billing & Plans',
    icon: 'payments',
    items: [
      { q: 'Where do I check my current subscription plan?', a: 'Go to Administration > "Billing & Plans" to see your active plan, invoices, and payment history.' },
      { q: 'How do I upgrade or change my plan?', a: 'Open "Billing & Plans" and select the plan you want to move to \u2014 for example, upgrade to Pro/Enterprise to unlock advanced reports in Stock Valuation.' },
      { q: 'Can I download my invoices?', a: 'Yes, all generated invoices are available for download from the Billing & Plans page.' },
    ],
  },
  {
    category: 'Company Profile',
    icon: 'person',
    items: [
      { q: 'Where can I see my company\u2019s profile details?', a: 'Click your company name (top right) > "Profile" to open the Company Profile page.' },
      { q: 'What information is shown on the Company Profile page?', a: '"Business identity" (Business/legal name, Contact person, Email, Phone, Address) and "Compliance & registration" (GSTIN and PAN, each with View and Download options for the certificate/file).' },
      { q: 'How do I update my company profile?', a: 'Click "Edit profile" at the top of the page, update the details, and save.' },
      { q: 'What does "Profile 100% complete" mean?', a: 'It shows how much of your company profile is filled in \u2014 100% means every required field and document has been added.' },
    ],
  },
  {
    category: 'Notifications',
    icon: 'notifications',
    items: [
      { q: 'Where can I see all my alerts and updates?', a: 'Click the bell icon at the top of the page to open Notifications \u2014 it shows the same kind of updates as the Home page feed (lot expiring/expired, supply received, etc.) plus anything else needing your attention.' },
      { q: 'What does the red number on the bell icon mean?', a: 'It shows how many notifications you haven\u2019t read yet.' },
    ],
  },
  {
    category: 'Support & Chatbot',
    icon: 'help_center',
    items: [
      { q: 'How do I contact Khettify support?', a: 'Go to Administration > "Support" for help and contact options, or click the red chat bubble in the bottom-right corner of any screen to start a live chat.' },
      { q: 'What is the chat bubble in the corner of the screen?', a: 'It is Khettify\u2019s built-in chatbot/support chat. Click it any time to ask a question or get quick help without leaving the page you are on.' },
      { q: 'What information should I include when raising a support request?', a: 'Describe the issue, what you expected to happen, and include the relevant lot number, shipment reference, or order number if applicable \u2014 this helps the support team resolve it faster.' },
    ],
  },
];

export const SELLER_FAQ = [
  {
    category: 'Getting Started (Home Page)',
    icon: 'home',
    items: [
      { q: 'What do I see the first time I log in as a seller?', a: 'You land on the "Home" page with a "Get authorized to sell" panel. It explains that sellers resell a company\u2019s products, and that you need a Principal Certificate (PC) from a company before you can get its stock \u2014 with a company search box and an "Apply for PC" button.' },
      { q: 'Do I need a PC to start selling on Khettify?', a: 'You only need a PC if you want to sell a specific company\u2019s products. If you want to sell your own products instead, go to "My Products" \u2014 you can upload, stock, and publish your own products without any PC.' },
      { q: 'Why do some sidebar items show a small lock/certificate icon?', a: 'Modules like Inventory, Inbound Supply, Product Catalog, Stock Transfers, Barcodes & Labels, and Stock Valuation depend on you holding a Principal Certificate from at least one company \u2014 that icon shows they unlock once you have a PC.' },
      { q: 'What changes on my Home page once I get a PC?', a: 'Your Home page starts showing real activity \u2014 an "Updates" feed (new requests, supply on its way, etc.), an Alerts banner when a shipment is ready to receive, and unlocked shortcut cards like Dashboard, Inventory, and Inbound Supply with live numbers.' },
      { q: 'What does "Scan to receive" on the Home page banner mean?', a: 'It appears when a supply shipment from your company has arrived and is ready. Click it to scan the shipment label and receive the stock into your warehouse.' },
    ],
  },
  {
    category: 'Login, Account & Security',
    icon: 'lock',
    items: [
      { q: 'How do I log in to my seller account?', a: 'Go to the Seller Login page and sign in using your registered email address and password.' },
      { q: 'What should I do if I forget my password?', a: 'Click "Forgot Password" on the login page, enter your registered email, and follow the reset link sent to your inbox.' },
      { q: 'How can I change my password?', a: 'Click your name (top right) > "Settings" and update your password from there.' },
    ],
  },
  {
    category: 'Principal Certificate (PC) & Companies',
    icon: 'verified',
    items: [
      { q: 'What is a Principal Certificate (PC)?', a: 'It is the authorization a company gives you so you can officially get and resell its products. Every company issues its own separate PC \u2014 a PC from one company does not authorize you to sell another company\u2019s products.' },
      { q: 'How do I apply for a PC from a company?', a: 'Steps: 1) From the Home page, search for the company under "Get authorized to sell" (or go to Administration > "Companies"). 2) Click "Apply for PC". 3) Fill in the application form and submit.' },
      { q: 'What happens after I apply?', a: 'The company reviews and verifies your submitted documents, then sends you an agreement. You sign the agreement and send it back to the company. Once they receive your signed agreement, they issue your Principal Certificate.' },
      { q: 'What can I do once I have a PC from a company?', a: 'You can request supply (stock) from that company into your warehouse, and its products appear in your Product Catalog.' },
      { q: 'I want to sell products from a second company \u2014 what do I do?', a: 'Repeat the same process for that company: search for it, apply for PC, get your documents verified, sign the agreement they send, and receive your PC from them too.' },
      { q: 'Can I sell a company\u2019s products without a PC from them?', a: 'No, you cannot request or get supply from a company until you hold an active PC from them.' },
      { q: 'Can I sell products without ever applying for a PC?', a: 'Yes \u2014 if you don\u2019t want to sell a company\u2019s branded products, go to "My Products" and upload, stock, and publish your own products. No PC is required for this.' },
    ],
  },
  {
    category: 'Dashboard',
    icon: 'dashboard',
    items: [
      { q: 'What does the Dashboard show?', a: 'Cards for Stock Value, Inventory Value (MRP), Expiring (\u226490d) value, Open Shipments (this period), and Lots in Stock, plus Total Lots, Low Stock Items, Out of Stock, and Pending Supply.' },
      { q: 'How do I change the period on the Dashboard?', a: 'Use the "PERIOD" tabs at the top \u2014 Daily, Weekly, Monthly, Quarterly, Yearly, or Custom.' },
      { q: 'What does the "Stock Valuation overview" section show?', a: 'Pending Supply, In Transit, Transfers, and Total Supply Orders for the period, along with a "Recent Supply Orders" list showing the destination warehouse and status of each.' },
      { q: 'What do the "Supply orders" and "Transfers" counts next to the period tabs mean?', a: 'They show how many supply orders and stock transfers are currently open/in progress.' },
    ],
  },
  {
    category: 'Inventory',
    icon: 'inventory',
    items: [
      { q: 'What does the Inventory page show?', a: 'Your stock on hand across your warehouses \u2014 lots and expiry batches received from your supplying company/companies \u2014 with summary cards for Total Lots, Low/Out of Stock, Units in Stock, and Total Stock Value.' },
      { q: 'How do I check stock that is expiring soon or already expired?', a: 'Use the "Expiring \u2264 90d" and "Expired" filter buttons above the lot table, or "All Stock Status" for more options.' },
      { q: 'Can I search for a specific product or lot?', a: 'Yes, use the search box (by product, lot, batch, brand, or warehouse).' },
      { q: 'Can I print a label for a lot from here?', a: 'Yes, click "Label" in the Actions column to go to Barcodes & Labels for that lot.' },
    ],
  },
  {
    category: 'Inbound Supply (Requesting Stock)',
    icon: 'local_shipping',
    items: [
      { q: 'How do I request stock from a company I have a PC with?', a: 'Steps: 1) Go to "Inbound Supply". 2) Choose the "Supplying company" (only companies you hold an active PC with are listed). 3) Choose the "Destination warehouse" \u2014 one of your own warehouses. 4) Select the product(s) and quantity (use "+ Add product" for more than one). 5) Add any Notes for the company (optional). 6) Click "Send supply request".' },
      { q: 'Where can I track my supply requests?', a: 'Below the request form, "My Supply Orders" lists every request you\u2019ve sent, with Items, Destination warehouse, Status, and the date requested.' },
      { q: 'What does the Status column mean in My Supply Orders?', a: 'It shows where each request stands \u2014 for example "Received" once the stock has reached your warehouse.' },
      { q: 'How do I actually receive the stock once the company dispatches it?', a: 'Scan the shipment label at your warehouse when it arrives \u2014 you\u2019ll see a "Scan to receive" prompt on your Home page, or you can receive it from Stock Transfers.' },
    ],
  },
  {
    category: 'Product Catalog (Company Products)',
    icon: 'inventory_2',
    items: [
      { q: 'What does the Product Catalog show?', a: 'Every product from the company (or companies) you hold a PC with \u2014 view only. It shows each product\u2019s category, product code, MRP, your current stock of it, and its marketplace status.' },
      { q: 'Can I edit these products?', a: 'No, this is view-only since these are the company\u2019s products, not yours \u2014 you can only view details, request supply, and publish/unpublish on the marketplace.' },
      { q: 'How do I get stock for a product shown here?', a: 'Click "Request supply" in that product\u2019s row to jump straight to Inbound Supply with the product pre-selected.' },
      { q: 'How do I list a company product on my storefront?', a: 'Click "Publish on marketplace" in that product\u2019s row once you have stock of it; once published, the row shows "Listed at \u20b9X" with an "Unpublish" option.' },
    ],
  },
  {
    category: 'My Products (Your Own Products)',
    icon: 'inventory_2',
    items: [
      { q: 'What is "My Products" for?', a: 'It lists the products you have uploaded yourself \u2014 no Principal Certificate is needed to use this. It has two tabs: "Products" (your product list) and "Stock" (your lots of those products).' },
      { q: 'How do I add a new product here?', a: 'Click "+ Upload product" and fill in the product form (see "Uploading a Product" category below).' },
      { q: 'How do I add stock for one of my own products?', a: 'Steps: 1) Go to "My Products" > "Stock" tab. 2) Click "+ Add stock". 3) Choose the Product and Variant. 4) Leave Lot Number blank to auto-generate it, or enter your own. 5) Choose the Warehouse. 6) Enter Manufacturing Date, Expiry Date, and Quantity. 7) Optionally set a "Low-stock Alert At" number. 8) Click "Add stock".' },
      { q: 'What does "Low-stock Alert At" do?', a: 'You\u2019ll be alerted once that lot\u2019s quantity drops to this number; setting it to 0 turns the alert off.' },
      { q: 'How do I edit or view one of my products?', a: 'Use the pencil (edit) or eye (view) icon in the Actions column on the "Products" tab.' },
    ],
  },
  {
    category: 'Uploading a Product',
    icon: 'upload_file',
    items: [
      { q: 'What information do I need to upload a new product?', a: 'The form has several sections: Basic Product Information (Name, Category, Brand/Manufacturer, Description, up to 5 images), Product Packaging Description & Measurement (Packaging Type, Unit of Measurement, Product Dimensions, Shipping Weight), Identification & Traceability (Country of Origin, HSN Code), Pricing & Tax (MRP, GST), Product Variants (yes/no), Compliance & Validity (Shelf Life in Days), and Storage & Handling (Storage Instructions, Usage/Application Instructions, Handling & Safety Instructions).' },
      { q: 'How is GST calculated?', a: 'GST (%) is determined automatically from the HSN Code you enter \u2014 you don\u2019t set it manually.' },
      { q: 'What is "Shelf Life (Days)" used for?', a: 'It is the shelf life duration in days counted from the manufacturing date, used to work out each lot\u2019s expiry date.' },
      { q: 'What are "Usage/Application Instructions" for?', a: 'Dosage and method of use for the product \u2014 this is shown to customers on the product page.' },
      { q: 'What does the Product Variants toggle do?', a: 'Turn it on if the same product ships in different options (like size, color, or capacity), then add each variant\u2019s details.' },
      { q: 'What does the "Product Status" toggle at the end mean?', a: '"Active" means the product will appear in your catalog once uploaded; turn it off to keep it inactive/hidden.' },
      { q: 'How do I finish uploading?', a: 'Fill in all required (*) fields and click "Upload Product" at the bottom of the form.' },
    ],
  },
  {
    category: 'Marketplace Listings',
    icon: 'storefront',
    items: [
      { q: 'What does the Marketplace Listings page show?', a: 'Every product you\u2019ve published on the Khettify storefront \u2014 both your own uploaded products and company products you\u2019ve published \u2014 with its price, quantity, status (Published/Unpublished), and the date it was published.' },
      { q: 'How do I publish or unpublish a product?', a: 'Publish it from Product Catalog (company products) or My Products (your own products) using the "Publish on marketplace" / "Unpublish" action; the change reflects here immediately.' },
    ],
  },
  {
    category: 'Warehouses',
    icon: 'warehouse',
    items: [
      { q: 'How do I add a new warehouse?', a: 'Steps: 1) Go to "Warehouses" and click "Add Warehouse". 2) Fill in Warehouse Name, Warehouse Code (optional), Capacity in units, State, City, Address, and Pincode (Google Maps link is optional). 3) Under "Warehouse Manager", enter the manager\u2019s Full Name, Email, Phone Number, and a Password (at least 6 characters). 4) Click "Create".' },
      { q: 'How does the Warehouse Manager account get set up?', a: 'It is created together with the warehouse and assigned to it automatically. The manager signs in on the seller login page using the email and password you set, and they also receive these login details by email.' },
      { q: 'How do I change the manager assigned to a warehouse?', a: 'Open that warehouse for editing (the same "update warehouse" screen used to create it) and update the Warehouse Manager fields there \u2014 the new manager is assigned the same way it was done during creation.' },
      { q: 'What does the occupancy bar on a warehouse card show?', a: 'How many units are currently stored in that warehouse against its set capacity, for example "595 units \u00b7 29.8% of 2,000".' },
      { q: 'How do I see every lot stored in a warehouse?', a: 'Click on the warehouse card to open a popup with its Code, Location, Capacity, In Stock, Occupancy, and the full "Lots in this warehouse" list.' },
    ],
  },
  {
    category: 'Stock Transfers',
    icon: 'sync_alt',
    items: [
      { q: 'What does the "Transfers" tab (under Stock Transfers/Operations) show?', a: 'Every shipment involving your warehouses \u2014 both warehouse-to-warehouse transfers between your own warehouses ("Transfer" / "WAREHOUSE TRANSFER") and shipments going out to customers ("Sales" / "CUSTOMER ORDER") \u2014 with Shipment Ref, From, To, Type, Challan, Status, and Dispatched date.' },
      { q: 'What does the "Requests" tab show?', a: 'Stock requests between your own warehouses ("Request (pull)") \u2014 which warehouse requested from which, the product and quantity, the transfer reference, and its status such as "accepted" or "fulfilled".' },
      { q: 'What does "Accepted by X \u00b7 shipment created" mean in Requests?', a: 'It means the source warehouse approved the pull request and a shipment has been created, ready to be sent to the requesting warehouse.' },
      { q: 'What does "Delivered & received" mean?', a: 'It means the requested stock has already reached the requesting warehouse and been received.' },
      { q: 'Can I view the Traceability of a lot from here?', a: 'Yes, click the "Traceability" tab to look up a lot\u2019s full movement history.' },
      { q: 'Can I print a shipping label or box labels for a shipment?', a: 'Yes, use the "Shipping Label" or "Box Labels" action in that shipment\u2019s row.' },
    ],
  },
  {
    category: 'Barcodes & Labels',
    icon: 'qr_code_2',
    items: [
      { q: 'What does the Barcodes & Labels page do?', a: 'It lets you print and scan the unit labels you received from your supplying company. It shows "Printing X label(s)" for the selected lot.' },
      { q: 'Can I generate new barcodes/labels myself?', a: 'No. Serials are assigned by the supplying company \u2014 you can only print the labels that already exist for stock you hold.' },
      { q: 'What does the "Packaging" note mean, like "You hold 1 bulk packaging box(es), containing 1 inner box(es) and 25 unit label(s)"?', a: 'It tells you how the stock you currently hold for that lot is packed \u2014 how many bulk boxes, how many inner boxes inside them, and the total number of unit labels available to print.' },
      { q: 'How do I print labels?', a: 'Select the lot, choose your label page size (for example "65 / page \u00b7 38\u00d721mm"), and click "Print Labels".' },
    ],
  },
  {
    category: 'POS (Point of Sale)',
    icon: 'point_of_sale',
    items: [
      { q: 'What is POS for?', a: 'It is counter billing for walk-in customers \u2014 stock is deducted the moment you save the bill.' },
      { q: 'How do I create a bill?', a: 'Steps: 1) Go to "POS" and select a warehouse. 2) Search and add products to the bill \u2014 rate, GST, and amount are filled in automatically. 3) Enter the Customer Name and Phone (phone is required for a GST bill). 4) Choose the Payment Mode \u2014 Cash or UPI. 5) For cash, enter "Cash Received" to see the change to return. 6) Click "Save Bill \u00b7 Deduct Stock".' },
      { q: 'What does "FEFO picks the earliest-expiring lot automatically" mean?', a: 'When you add a product to the bill, POS automatically picks stock from the lot that is expiring soonest (First-Expiry-First-Out), so you don\u2019t have to choose the lot yourself.' },
      { q: 'Why do I have to pick a warehouse first?', a: 'The bill deducts stock from that specific warehouse, so you must select it before you can search and add products.' },
    ],
  },
  {
    category: 'Sales (Outbound Orders)',
    icon: 'local_mall',
    items: [
      { q: 'What does the Sales page show?', a: 'Every order you sell from your stock to customers and dealers \u2014 Invoice, Product, SKU, Buyer, Warehouse, Delivery Address, Units, Total, Status, and the date Placed. Shipping deducts stock FEFO (earliest-expiring lot first).' },
      { q: 'What do the order statuses mean?', a: '"Pending" needs your action, "Confirmed" has been accepted, "Shipped" has been dispatched, and "Cancelled" means the order was called off.' },
      { q: 'How do I approve or cancel a pending order?', a: 'Use the "Approve" or "Cancel" buttons in that order\u2019s row \u2014 these actions are only available while the order is still "Pending".' },
      { q: 'What does "CASH ON DELIVERY" or "ONLINE PAYMENT" under the invoice number mean?', a: 'It shows how the customer is paying for that order.' },
    ],
  },
  {
    category: 'Stock Valuation & Reports',
    icon: 'trending_up',
    items: [
      { q: 'What does the Stock Valuation report show?', a: 'The value of your stock across your warehouses \u2014 by Product, Warehouse, Lot/Batch, Qty, MRP, Amount, and Expiry date.' },
      { q: 'How do I generate the report?', a: 'Pick a "From" and "To" date, optionally choose a warehouse (or leave "All"), and click "Run". Click "CSV" to download it.' },
    ],
  },
  {
    category: 'Demand Monitor',
    icon: 'insights',
    items: [
      { q: 'What is Demand Monitor for?', a: 'It shows customers who are interested in your out-of-stock products, across two tabs: "Notify Me Subscriptions" and "Quantity Requests".' },
      { q: 'What is "Notify Me Subscriptions"?', a: 'When a product is out of stock, a customer can click "Notify Me" on it. This tab lists each such product with how many customers are waiting (e.g. "1 Customers") \u2014 click "View Customers" to see who. Once you restock that product, those customers are notified automatically.' },
      { q: 'What is "Quantity Requests"?', a: 'If a customer wants more of a product than you currently have in stock, they can send you a Quantity Request specifying how much they need. It shows the Product, Customer, Qty, Status (Pending/Fulfilled/Rejected), and Date, with a "Respond" action.' },
      { q: 'What does "Urgent" next to a Quantity Request mean?', a: 'The customer has flagged that request as urgent, so it needs quicker attention.' },
      { q: 'How do I respond to a Quantity Request?', a: 'Click "Respond" on that request \u2014 once you add stock for that product, the customer is notified automatically, the same as with Notify Me Subscriptions.' },
      { q: 'How do I filter Quantity Requests?', a: 'Use the All / Pending / Fulfilled / Rejected filter buttons, and sort with the "Most Recent" dropdown.' },
    ],
  },
  {
    category: 'Administration',
    icon: 'admin_panel_settings',
    items: [
      { q: 'What is the Administration page for?', a: 'It is your control panel for managing your team, certifications, plan, and partners. It has 4 sections: Team & Roles, Certifications, Billing & Usage, Customers & Dealers, and Companies.' },
      { q: 'How do I get to Administration?', a: 'Click "Administration" in the left sidebar, or click your name (top right) and choose "Administration" from the dropdown.' },
    ],
  },
  {
    category: 'Team & Roles',
    icon: 'manage_accounts',
    items: [
      { q: 'What does the Team & Roles page show?', a: 'Every member across your seller portal \u2014 which, for a seller, are the Warehouse Managers \u2014 with their Name, Contact, Role, Status, and the Warehouse(s) they manage.' },
      { q: 'How do I add a new team member?', a: 'You don\u2019t add them separately here: Warehouse Managers are created automatically when you add a warehouse \u2014 the manager account is created, assigned to that warehouse, and its login details are emailed, all in one step. Click "Add Warehouse" from this page to do that.' },
      { q: 'How do I disable or remove a Warehouse Manager?', a: 'Use the "Disable" or "Remove" action in their row \u2014 disabling blocks their login without deleting them, while removing takes them off your team completely.' },
    ],
  },
  {
    category: 'Certifications',
    icon: 'workspace_premium',
    items: [
      { q: 'What is the Certifications page for?', a: 'It is where you apply for a Principal Certificate (PC) to become an authorized reseller. Search a company, fill its application form (your profile details auto-fill), and submit \u2014 once the company issues the PC, you can sell its products.' },
      { q: 'What are "Business documents" for?', a: 'Upload documents like GST, PAN Card, GST Certificate, or a Horticulture/Agriculture Licence here \u2014 choose the document type, choose the file, and click "Upload". These are used to auto-fill and support your PC applications.' },
      { q: 'How do I apply for a PC from this page?', a: 'Under "Apply for a Principal Certificate", click "Find a company" \u2014 each company has its own application form.' },
      { q: 'Where can I track my applications?', a: '"My applications" lists every company you\u2019ve applied to, with its status (for example "Active").' },
      { q: 'Where can I see my issued certificates?', a: '"My certificates" lists each Principal Certificate you hold, with its certificate number, the company, its validity date, and Download/status (Active) options.' },
    ],
  },
  {
    category: 'Billing & Usage',
    icon: 'payments',
    items: [
      { q: 'What plans are available?', a: 'Free (\u20b90, 1 warehouse, 50 customers \u2014 My Products, Marketplace listings, Warehouse, Sales, Dashboard, Team & roles, Low-stock alerts), Pro (\u20b9999/mo, unlimited warehouses & customers \u2014 adds Product catalog, Inbound supply, Stock transfers, Outbound sales, Inventory views, Unit labels, Batch & expiry tracking, Reserved stock, Analytics), and Enterprise (contact us \u2014 everything in Pro plus all current & future features).' },
      { q: 'How do I see my current plan?', a: 'Go to Administration > "Billing & Usage" \u2014 your active plan is marked "CURRENT".' },
      { q: 'How do I change my plan?', a: 'Click "Switch to Free" or "Switch to Enterprise" on the plan you want on the Billing & Usage page.' },
      { q: 'Why can\u2019t I use Inventory, Inbound Supply, or Labels on the Free plan?', a: 'Those features need the Pro plan or higher \u2014 upgrade from Billing & Usage to unlock them.' },
    ],
  },
  {
    category: 'Customers & Dealers',
    icon: 'group',
    items: [
      { q: 'What does the Customers & Dealers page show?', a: 'Your buyer book \u2014 end customers and downstream dealers \u2014 with their Code, Name, Type, Phone, and GSTIN.' },
      { q: 'How do I add a new customer or dealer?', a: 'Click "+ New" at the top right and fill in their details.' },
      { q: 'How do I see a customer\u2019s past orders?', a: 'Click "History" in that customer\u2019s row.' },
      { q: 'How do I edit a customer\u2019s details?', a: 'Click "Edit" in that customer\u2019s row.' },
    ],
  },
  {
    category: 'Companies',
    icon: 'apartment',
    items: [
      { q: 'What does the Companies page show?', a: 'Companies that have issued you a Principal Certificate, under "My companies" \u2014 with the PC number and status (e.g. "PC Issued") \u2014 and new companies you can apply to, under "Recommended for you".' },
      { q: 'How do I find a specific company to apply to?', a: 'Use the "Find a company to sell for" search box and search by company name or region.' },
      { q: 'What does "Preferred \u00b7 IMS" next to a company mean?', a: 'It marks companies that use Khettify\u2019s own inventory system (IMS) \u2014 these are shown first under Recommended for you.' },
      { q: 'How do I view my certificate for a company?', a: 'Click "View certificate" next to that company under "My companies".' },
    ],
  },
  {
    category: 'Account Menu (Top Right)',
    icon: 'account_circle',
    items: [
      { q: 'What options do I get when I click my name at the top right?', a: 'A dropdown with three options: "Profile" (view your account details), "Administration" (your control panel), and "Logout".' },
      { q: 'How do I log out?', a: 'Click your name (top right) and choose "Logout" from the dropdown.' },
    ],
  },
  {
    category: 'My Profile',
    icon: 'person',
    items: [
      { q: 'Where can I see my profile details?', a: 'Click your name (top right) > "Profile" to see "Business identity" (Business/legal name, Contact person, Email, Phone, Address/Location) and "Compliance & registration" (documents like GSTIN, PAN, Agriculture Licence, etc.).' },
      { q: 'Can I view or download the documents I\u2019ve uploaded?', a: 'Yes, each document under "Compliance & registration" has "View" and "Download" options.' },
      { q: 'Can I turn my location on or off, or update it?', a: 'Yes, from your Profile you can turn your location visibility on/off or update it.' },
      { q: 'How do I update my profile or add missing documents?', a: 'Click "Edit profile" at the top of the page \u2014 you can fill in any missing document/information and update your other details there, then save.' },
      { q: 'What does "Profile 100% complete" mean?', a: 'It shows how much of your profile is filled in \u2014 100% means every required field and document has been added.' },
    ],
  },
];

export const WAREHOUSE_MANAGER_FAQ = [
  {
    category: 'Home Page',
    icon: 'home',
    items: [
      { q: 'What do I see when I log in?', a: 'You land on the "Home" page, scoped to your own warehouse. It shows Inventory Value, Open Shipments, Lots, and an Alerts count, plus an "Updates" feed and shortcut cards for Dashboard, Inventory, and Product Catalog.' },
      { q: 'What does "Supply ready to pick in Send Stock" mean?', a: 'It means an approved seller supply has been assigned to your warehouse. Go to Stock Transfers > "Transfer to Seller" (also called Send Stock) to pick, pack, and dispatch it.' },
      { q: 'What does "Incoming transfer" mean?', a: 'It means a transfer from another warehouse is on its way to you. Scan its manifest QR/barcode at your warehouse (Stock Transfers > Transfers) to receive it into your stock.' },
      { q: 'What does "Request accepted" mean?', a: 'It means another warehouse accepted a stock request you sent and a shipment has been created on their side, ready to be dispatched to you.' },
      { q: 'What does the Alerts number mean?', a: 'It is the count of things needing your attention right now, such as lots that are expiring soon or already expired in your warehouse.' },
    ],
  },
  {
    category: 'Dashboard',
    icon: 'dashboard',
    items: [
      { q: 'What does the Dashboard show?', a: 'Cards for Stock Value, Expiring (\u226490d) value, Open Shipments, and Sales for the selected period \u2014 all specific to your warehouse.' },
      { q: 'Why do Total Products, Active Products, and Warehouses show company-wide numbers?', a: 'The product catalog and warehouse list are shared across the whole company, so these three cards show the company totals, not just your warehouse.' },
      { q: 'How do I change the period shown on the Dashboard?', a: 'Use the "PERIOD" tabs at the top \u2014 Daily, Weekly, Monthly, Quarterly, Yearly, or Custom.' },
      { q: 'What does the "Operations overview" section show?', a: 'Pending Shipments, In Transit, Open Transfers, and Total Shipments for your warehouse, along with a "Recent Shipments" list showing whether each was to a seller or another warehouse and its current status.' },
    ],
  },
  {
    category: 'Inventory & Receiving Lots',
    icon: 'inventory',
    items: [
      { q: 'What does the Inventory page show?', a: 'Every lot currently in your warehouse, with summary cards for Total Lots, Low/Out of Stock, Units in Stock, and Total Stock Value.' },
      { q: 'How do I receive a lot that the Company Admin has sent directly to my warehouse?', a: 'Steps: 1) Go to "Inventory". 2) Click "Receive Lot". 3) Scan the lot barcode, Bulk Packaging ID, or unit code sent to you. 4) Confirm receipt \u2014 the stock is added to your warehouse only after you confirm.' },
      { q: 'Can I create a brand-new lot myself?', a: 'No, creating a lot from scratch is done by the Company Admin. You bring stock in using "Receive Lot" (for lots sent directly to you) or by receiving a transfer under Stock Transfers.' },
      { q: 'How do I check stock that is expiring soon or already expired?', a: 'Use the "Expiring \u2264 90d" and "Expired" filter buttons above the lot table, or "All Stock Status" for more options.' },
      { q: 'What do the Stock Status and Expiry Status columns mean?', a: 'Stock Status shows whether the lot is "In stock" or low/out of stock. Expiry Status shows "Good" or "Expired" based on the lot\u2019s expiry date.' },
      { q: 'Can I print a label for a lot from here?', a: 'Yes, click "Label" in the Actions column to go straight to Barcodes & Labels for that lot.' },
    ],
  },
  {
    category: 'Product Catalog',
    icon: 'inventory_2',
    items: [
      { q: 'Can I see all company products from my warehouse login?', a: 'Yes, "Product Catalog" lists every product in the company catalog with its code, category, status, cost price, and MRP.' },
      { q: 'Can I add, edit, or delete a product?', a: 'No, this is view-only for a Warehouse Manager \u2014 you only get the "View" (eye) action. Adding, editing, or deleting products is done by the Company Admin.' },
    ],
  },
  {
    category: 'Warehouses',
    icon: 'warehouse',
    items: [
      { q: 'Which warehouse(s) can I see here?', a: 'Only the warehouse(s) assigned to you \u2014 you will not see other warehouses that belong to the company.' },
      { q: 'What does the occupancy bar on my warehouse card show?', a: 'How many units are currently stored in your warehouse against its set capacity, for example "1,671 units \u00b7 83.6% of 2,000".' },
      { q: 'Can I see the lots stored in my warehouse from this page?', a: 'Yes, your warehouse card lists the top lots with quantities, and you can click "+ more lots" to see the rest.' },
    ],
  },
  {
    category: 'Stock Transfers \u2014 Seller Requests',
    icon: 'assignment',
    items: [
      { q: 'What does the "Seller Requests" tab show?', a: 'It shows approved seller request(s) assigned to your warehouse, with the Seller Request No., seller, product, number of products, total quantity, destination, and status.' },
      { q: 'How do I send stock for an approved seller request?', a: 'Steps: 1) Go to Stock Transfers > "Seller Requests". 2) Find the approved request. 3) Click "Dispatch to Seller" \u2014 this takes you to "Transfer to Seller" with the seller, receiving warehouse, and product already filled in. 4) Scan the product/units. 5) Fill in Challan Number, Bill Number, and Bilty Number (attach the copies), plus an optional note. 6) Confirm to dispatch.' },
    ],
  },
  {
    category: 'Stock Transfers \u2014 Transfer to Seller (Send Stock)',
    icon: 'storefront',
    items: [
      { q: 'How do I send stock to a seller without an existing request?', a: 'Steps: 1) Go to Stock Transfers > "Transfer to Seller". 2) In "TO", choose the seller. 3) Choose their "Receiving Warehouse". 4) Under Product Selection, pick the product and quantity (or leave quantity blank to count purely from your scans). 5) Scan each unit/box/lot in the "Scan Here" box. 6) Fill in Challan Number, Bill Number, and Bilty Number (attach copies), plus an optional note. 7) Click "Confirm" to dispatch.' },
      { q: 'What information is auto-filled once I pick a seller?', a: 'The seller\u2019s Company Name, Contact Person, Location, and Principal Certificate number are shown automatically once you select them.' },
      { q: 'Why do I need to scan the product before sending?', a: 'Scanning confirms exactly what quantity is leaving your warehouse. "Scanned Quantity" and "Total Quantity" update live as you scan, so you can be sure you are sending the right amount.' },
      { q: 'What documents do I need to complete a dispatch?', a: 'A Challan Number, a Bill Number, and a Bilty Number, each with an attached PDF or image copy (max size shown next to each field).' },
    ],
  },
  {
    category: 'Stock Transfers \u2014 Transfers (Warehouse to Warehouse)',
    icon: 'sync_alt',
    items: [
      { q: 'What does the "Transfers" tab show?', a: 'Every shipment your warehouse has sent or received \u2014 both to sellers ("Sales") and to/from other warehouses ("Transfer") \u2014 with counts for All, Incoming Transfers, and Outgoing Transfers.' },
      { q: 'How do I send stock to another warehouse without a prior request?', a: 'Steps: 1) Go to Stock Transfers > "Transfers". 2) Click "New Transfer". 3) In the popup, choose the destination warehouse, the product, and the quantity, and enter the Challan Number with the supporting document. 4) Submit \u2014 this creates the shipment and closes the popup. 5) Open the shipment you just created and approve it. 6) Click "Dispatch", scan the product/quantity, and send.' },
      { q: 'How do I receive stock that another warehouse has sent me without a request?', a: 'It will appear in the "Transfers" list as an Incoming transfer. Open it, click "Receive", scan the product/units, and confirm to add the stock to your warehouse.' },
      { q: 'How can I tell if a shipment was for a seller or another warehouse?', a: 'Check the "Type" column \u2014 "Sales" means it went to a seller, "Transfer" means it was warehouse-to-warehouse.' },
      { q: 'Can I print a shipping label for any transfer?', a: 'Yes, click "Shipping Label" in that shipment\u2019s row.' },
    ],
  },
  {
    category: 'Stock Transfers \u2014 Requests (Between Warehouses)',
    icon: 'move_to_inbox',
    items: [
      { q: 'What does the "Requests" sub-tab (under Transfers) show?', a: 'Stock requests between warehouses \u2014 both requests you have sent to other warehouses, and requests other warehouses have sent to you.' },
      { q: 'How do I request stock from another warehouse for myself?', a: 'Steps: 1) Go to Stock Transfers > "Transfers" > "Requests". 2) Click "Request Stock". 3) Choose the source warehouse, product, and quantity you need. 4) Submit the request.' },
      { q: 'What happens after another warehouse accepts my request?', a: 'A shipment is created on their side, ready to dispatch. Once they dispatch it, come back to the "Requests" tab and scan the receiving label to confirm receipt into your stock.' },
      { q: 'A request has come in from another warehouse asking for MY stock \u2014 what do I do?', a: 'Steps: 1) Open it in the "Requests" tab and click "Approve". 2) It then appears in the "Transfers" tab as a shipment. 3) Open it there, click "Dispatch", scan the product/quantity, and send it to the requesting warehouse.' },
      { q: 'What do the "accepted", "fulfilled", and "Delivered & received" labels mean?', a: '"Accepted" means the request was approved and a shipment was created; "fulfilled" / "Delivered & received" means the stock has already reached the requesting warehouse and been received.' },
    ],
  },
  {
    category: 'Traceability',
    icon: 'travel_explore',
    items: [
      { q: 'What is the Traceability tab for?', a: 'Go to Stock Transfers > "Traceability", enter or scan a lot number, and see its full movement history \u2014 when it was received into your warehouse, transferred, or dispatched to a seller.' },
    ],
  },
  {
    category: 'Barcodes & Labels',
    icon: 'qr_code_2',
    items: [
      { q: 'Can I print labels for stock in my warehouse?', a: 'Yes, go to "Barcodes & Labels", select the lot, and click "Print Labels" to print the already-generated barcode labels.' },
      { q: 'Can I generate new labels for a lot?', a: 'No. You will see a note like "Units can only be generated by the Main Company" \u2014 generating new unit labels is done by the Company Admin. You can only print labels that already exist for stock currently in your warehouse.' },
    ],
  },
  {
    category: 'Transfer History',
    icon: 'history',
    items: [
      { q: 'What does Transfer History show?', a: 'Every transfer sent from or received by your warehouse, with summary cards for Total Transfers, Outgoing, Incoming, In Transit, Received/Completed, and Total Transfer Value.' },
      { q: 'How do I filter Transfer History?', a: 'Use the Direction, Status, and Warehouse dropdowns, a date range, or the search box (by reference, item, lot, or warehouse).' },
      { q: 'How do I clear my filters?', a: 'Click "Clear filters" below the filter row.' },
    ],
  },
  {
    category: 'Stock Valuation & Reports',
    icon: 'trending_up',
    items: [
      { q: 'What does the Stock Valuation report show?', a: 'The value of stock in your warehouse \u2014 by Product, Warehouse, Lot/Batch, Qty, MRP, Amount, and Expiry date.' },
      { q: 'How do I generate the report?', a: 'Pick a "From" and "To" date, optionally choose a warehouse (or leave "All"), and click "Run". Click "CSV" to download it.' },
      { q: 'What does "advanced reports require the Pro/Enterprise plan" mean?', a: 'Some deeper report views are only available on the company\u2019s Pro or Enterprise subscription plan. Ask your Company Admin about upgrading if you need them.' },
    ],
  },
  {
    category: 'Administration',
    icon: 'admin_panel_settings',
    items: [
      { q: 'What do I see under Administration?', a: 'A Warehouse Manager sees 4 sections here: Sellers, Supply Requests, PC Applications, and Support. You will not see Customers, Returns, Team & Roles, Settings, or Billing & Plans \u2014 those are managed only by the Company Admin.' },
    ],
  },
  {
    category: 'Sellers',
    icon: 'storefront',
    items: [
      { q: 'What does the Sellers page show?', a: 'Go to Administration > "Sellers" to see the list of sellers/dealers connected to your company.' },
    ],
  },
  {
    category: 'Supply Requests',
    icon: 'assignment',
    items: [
      { q: 'What does the Supply Requests page show?', a: 'Go to Administration > "Supply Requests" to see the bulk-supply requests raised by your company\u2019s sellers.' },
    ],
  },
  {
    category: 'PC Applications',
    icon: 'workspace_premium',
    items: [
      { q: 'What is a PC Application?', a: 'PC stands for Principal Certificate \u2014 an authorization that lets a seller officially represent/resell your company\u2019s products.' },
      { q: 'How do I review a seller\u2019s application?', a: 'Go to "PC Applications", open the seller\u2019s row, and check its status \u2014 shown as "Active" and "Open" until it is fully processed.' },
      { q: 'What is the "Application form" button for?', a: 'It opens the form builder used to configure what sellers must fill in when they apply for a PC.' },
    ],
  },
  {
    category: 'Notifications',
    icon: 'notifications',
    items: [
      { q: 'Where can I see alerts for my warehouse?', a: 'Click the bell icon at the top of the page \u2014 you will see the same kind of updates as the Home page feed (supply ready to pick, incoming transfers, request accepted, stock alerts, etc.).' },
    ],
  },
  {
    category: 'Account Menu (Top Right)',
    icon: 'account_circle',
    items: [
      { q: 'What options do I get when I click my name at the top right?', a: 'Click your name (top right) to open a dropdown with three options: "Profile" (view your account details), "Settings" (update or reset your password), and "Logout".' },
      { q: 'How do I log out of my account?', a: 'Click your name (top right) and choose "Logout" from the dropdown.' },
    ],
  },
  {
    category: 'Manager Profile',
    icon: 'person',
    items: [
      { q: 'Where can I see my profile details?', a: 'Click your name (top right) and choose "Profile" to see your account details.' },
      { q: 'Can I update my profile details?', a: 'You can update the editable fields shown there and save. If something looks locked or incorrect, contact your Company Admin or Support.' },
    ],
  },
  {
    category: 'Warehouse Settings & Password',
    icon: 'lock',
    items: [
      { q: 'How do I update my password while logged in?', a: 'Click your name (top right) > "Settings", then use the update-password option to set a new password.' },
      { q: 'What should I do if I forget my password?', a: 'Click your name (top right) > "Settings" and use the "Forgot Password" option there (or on the login page), enter your registered email, and follow the reset link sent to your inbox.' },
      { q: 'Do I have access to full Company Settings (alerts, billing, etc.)?', a: 'No, those company-wide settings are managed by the Company Admin. Your "Settings" page only covers updating or resetting your own account password.' },
    ],
  },
  {
    category: 'Support & Chatbot',
    icon: 'help_center',
    items: [
      { q: 'How do I get help if I face an issue?', a: 'Go to Administration > "Support" for help and contact options, or click the red chat bubble in the bottom-right corner of any screen to start a live chat.' },
      { q: 'What information should I include when raising a support request?', a: 'Describe the issue, what you expected to happen, and include the relevant lot number or shipment reference \u2014 this helps the support team resolve it faster.' },
    ],
  },
];

export const SELLER_WAREHOUSE_FAQ = [
  {
    category: 'Home Page',
    icon: 'home',
    items: [
      { q: 'What do I see when I log in?', a: 'You land on the Home page showing a snapshot of your warehouse — Inventory Value, Open Shipments, Lots in Stock, and an Alerts count. Below is an Updates feed with supply and transfer notifications, plus shortcut cards for Dashboard, Inventory, and Inbound Supply.' },
      { q: 'What appears in the Updates feed?', a: 'You will see updates like “New Quantity Request” (a customer has requested a product), “Supply on its way” (the company has dispatched supply to you), and other notifications — all with a timestamp. Click “SHOW ALL” to see the full list.' },
      { q: 'What does the Alerts count mean?', a: 'It is the number of things in your warehouse that need immediate attention — such as lots expiring soon or pending actions.' },
    ],
  },
  {
    category: 'Dashboard',
    icon: 'dashboard',
    items: [
      { q: 'What does the Dashboard show?', a: 'Cards for Stock Value (MRP), Expiring (≤90d) value, Open Shipments, and Lots in Stock — all scoped to your warehouse. Below is a Stock Valuation overview showing Pending Supply, In Transit, Transfers, and Total Supply Orders, plus a Recent Supply Orders list.' },
      { q: 'How do I change the reporting period?', a: 'Use the PERIOD tabs at the top — Daily, Weekly, Monthly, Quarterly, Yearly, or Custom (pick your own date range).' },
      { q: 'What do the Low Stock Items and Out of Stock cards show?', a: 'Low Stock Items shows products running low on stock; Out of Stock shows products that have run out completely. These help you know when to raise a new Inbound Supply request.' },
    ],
  },
  {
    category: 'Inventory',
    icon: 'inventory',
    items: [
      { q: 'What does the Inventory page show?', a: 'All lots currently in your warehouse with summary cards for Total Lots, Low/Out of Stock, Units in Stock, and Total Stock Value. The table below shows Lot No., Product, Category, Warehouse, MFG date, Expiry, Qty, and Stock Status.' },
      { q: 'How do I find expiring or expired lots?', a: 'Use the “Expiring ≤90d” or “Expired” filter buttons above the lot table, or use the “All Stock Status” dropdown for more options.' },
      { q: 'Can I create a new lot myself?', a: 'No — creating lots is done by the Company Admin. You can only receive stock that has been sent to you via Inbound Supply.' },
      { q: 'How do I print a label for a lot?', a: 'Click “Label” in the Actions column — it takes you straight to Barcodes & Labels for that lot.' },
    ],
  },
  {
    category: 'Inbound Supply',
    icon: 'local_shipping',
    items: [
      { q: 'What is the Inbound Supply page for?', a: 'Requesting and tracking supply from your company. You select the supplying company, destination warehouse, product, and quantity, then click “Send supply request”. Below that, My Supply Orders shows all your supply orders with their current status.' },
      { q: 'How do I raise a supply request?', a: 'Steps: 1) Go to Inbound Supply. 2) Select the supplying company. 3) Choose the destination warehouse. 4) Pick the product and quantity (use + Add product to add more lines). 5) Add optional notes. 6) Click “Send supply request”.' },
      { q: 'How do I receive supply once it arrives?', a: 'Steps: 1) Go to Inbound Supply. 2) Find the dispatched order in My Supply Orders. 3) Click “Scan to receive”. 4) Scan the product barcode or QR code. 5) Confirm — the stock is added to your warehouse.' },
      { q: 'What does My Supply Orders show?', a: 'The status of every supply order — Received, Dispatched, or Pending — along with the items, destination warehouse, and the date requested.' },
    ],
  },
  {
    category: 'My Products',
    icon: 'shopping_bag',
    items: [
      { q: 'What does the My Products page show?', a: 'All products in your seller account — Product Details, Category, Brand, Product Code, Price, Stock, Status (Active/Inactive), and Marketplace status (Published/Not Published).' },
      { q: 'Can I add or edit products?', a: 'This page is view-only for the warehouse role — you will see “View only — ask your seller admin to add or edit products”. Adding or editing products is done by the Seller Admin.' },
    ],
  },
  {
    category: 'Warehouses',
    icon: 'warehouse',
    items: [
      { q: 'What does the Warehouses page show?', a: 'A card for each warehouse assigned to you — showing the name, location, total units, and a capacity occupancy bar. The card also lists the top lots with their quantities.' },
      { q: 'What does the occupancy bar mean?', a: 'How many units are currently stored against the total warehouse capacity — for example “893 units · 44.7% of 2,000”. This tells you how much space is still available.' },
    ],
  },
  {
    category: 'Stock Transfers — Receive Stock',
    icon: 'move_to_inbox',
    items: [
      { q: 'What does the Receive Stock tab show?', a: 'Two sections: “Incoming Transfers to Receive” (transfers arriving from other warehouses) and “Incoming Supply to Receive” (approved company supply). Both show a “Scan to receive” button when stock arrives.' },
      { q: 'How do I receive company supply?', a: 'Steps: 1) Go to Stock Transfers > Receive Stock. 2) Find the dispatched supply under Incoming Supply to Receive. 3) Click “Scan to receive”. 4) Scan the product barcode or QR code. 5) Confirm — stock is added to your warehouse.' },
      { q: 'How do I receive a transfer from another warehouse?', a: 'It appears under Incoming Transfers to Receive in the Receive Stock tab. Click “Scan to receive”, scan the product, and confirm — stock is added to your warehouse.' },
    ],
  },
  {
    category: 'Stock Transfers — Send Stock',
    icon: 'storefront',
    items: [
      { q: 'What does the Send Stock tab show?', a: 'The “To Process — Customer Orders & Transfers” section lists orders placed by customers that have been approved. Each row shows Order/Ref number, Customer details, Address, City, State, PIN, Product, Quantity, and Status.' },
      { q: 'How do I process and dispatch a customer order?', a: 'Steps: 1) Go to the Send Stock tab. 2) Find the order and click “Process”. 3) Scan the product and pack it in a box. 4) Confirm. 5) A shipping label is generated with the customer’s basic details. 6) Attach the label to the box and dispatch.' },
      { q: 'What information is on the shipping label?', a: 'The customer’s name, address, phone number, and order reference. This label is attached to the parcel so it can be delivered correctly.' },
    ],
  },
  {
    category: 'Stock Transfers — Transfers',
    icon: 'sync_alt',
    items: [
      { q: 'What does the Transfers tab show?', a: 'All transfers from your warehouse — to customers (Sales type) and to other warehouses (Transfer type) — with Shipment Ref., From, To, Type, Challan, Status, Dispatched date, and Actions.' },
      { q: 'How do I send stock to another warehouse without a prior request?', a: 'Steps: 1) Go to the Transfers tab. 2) Click “New Transfer” — a popup opens. 3) Select the destination warehouse. 4) Enter the product and quantity. 5) Add a Challan number and attach the document. 6) Submit — a shipment is created. 7) Open the shipment and click “Dispatch”. 8) Scan the product. 9) Confirm — a shipping label is generated. The receiving warehouse scans it to confirm receipt.' },
      { q: 'How do I dispatch a transfer?', a: 'Find the shipment in the Transfers list, click “Dispatch” or “Shipping Label”, scan the product, and confirm. A shipping label is generated that the receiver scans to acknowledge receipt.' },
      { q: 'What is the difference between Sales and Transfer type?', a: 'Sales means the stock went to a customer. Transfer means the stock was sent to another warehouse.' },
      { q: 'Can I print a shipping label for a transfer?', a: 'Yes — click “Shipping Label” in any shipment row.' },
    ],
  },
  {
    category: 'Stock Transfers — Requests (Warehouse-to-Warehouse)',
    icon: 'assignment',
    items: [
      { q: 'What does the Requests sub-tab show?', a: 'Warehouse-to-warehouse stock requests — both requests you have sent to other warehouses and requests other warehouses have sent to you.' },
      { q: 'How do I request stock from another warehouse?', a: 'Steps: 1) Go to Stock Transfers > Transfers > Requests sub-tab. 2) Click “Request Stock”. 3) Select the source warehouse. 4) Enter the product and quantity. 5) Send — the request goes to that warehouse.' },
      { q: 'How do I receive stock once my request is accepted and dispatched?', a: 'When the other warehouse dispatches the stock, come back to the Requests tab and click “Receive”, scan the product, and confirm — stock is added to your warehouse.' },
      { q: 'Another warehouse has sent me a stock request — what do I do?', a: 'Steps: 1) Find the request in the Requests tab and click “Accept”. 2) A shipment is created in the Transfers tab. 3) Go there, click “Dispatch”, scan the product, and confirm — a shipping label is generated for the receiving warehouse.' },
      { q: 'Stock has arrived without a prior request — how do I receive it?', a: 'It appears under Incoming Transfers to Receive in the Receive Stock tab. Click “Scan to receive”, scan the product, and confirm.' },
    ],
  },
  {
    category: 'Traceability',
    icon: 'travel_explore',
    items: [
      { q: 'What is the Traceability tab for?', a: 'Go to Stock Transfers > Traceability. Scan or type any unit’s lot number or unit serial — you immediately see the full history of that item, from manufacturing through to its current location.' },
      { q: 'When should I use Traceability?', a: 'Whenever you need to trace a specific product or unit — where it came from, where it was sent, and when it was received. Useful for customer complaints or quality checks.' },
    ],
  },
  {
    category: 'Barcodes & Labels',
    icon: 'qr_code_2',
    items: [
      { q: 'What can I do on the Barcodes & Labels page?', a: 'Print unit labels for lots in your warehouse. Select the lot and click “Print Labels”.' },
      { q: 'Can I generate new labels?', a: 'No — generating new unit labels is done by the Company Admin. You can only print labels that have already been generated for stock in your warehouse.' },
    ],
  },
  {
    category: 'Sales',
    icon: 'point_of_sale',
    items: [
      { q: 'What does the Sales page show?', a: 'All customer orders from your warehouse — Invoice number, Product, SKU, Buyer name, Warehouse, Delivery Address, Units, Total, Status (Shipped / Confirmed / Planned), and Placed date.' },
      { q: 'What do the order statuses mean?', a: '“Confirmed” — the order has been placed. “Planned” — ready to be processed. “Shipped” — dispatched and on its way to the customer.' },
    ],
  },
  {
    category: 'Stock Valuation',
    icon: 'trending_up',
    items: [
      { q: 'What does Stock Valuation show?', a: 'The value of stock in your warehouse — by Product, Warehouse, Lot/Batch, Qty, MRP, Amount, and Expiry date.' },
      { q: 'How do I generate the report?', a: 'Pick a From and To date, optionally filter by warehouse, and click “Run”. Click “CSV” to download the report.' },
    ],
  },
  {
    category: 'Administration',
    icon: 'admin_panel_settings',
    items: [
      { q: 'What does a Seller Warehouse Manager see under Administration?', a: 'You see the Customers & Dealers section — a list of your end customers and dealers. Team & Roles, Billing, Companies, and Certifications are Seller Admin–only features and are not visible here.' },
    ],
  },
  {
    category: 'Account Menu — Profile, Settings & Logout',
    icon: 'account_circle',
    items: [
      { q: 'What options appear when I click my name in the top right?', a: 'Three options: “Profile” (view your account details), “Settings” (change or reset your password), and “Logout”.' },
      { q: 'How do I change my password?', a: 'Click your name (top right) > Settings > Change Password, and set a new password.' },
      { q: 'What if I forget my password?', a: 'On the login page or under Settings, click “Forgot Password”, enter your registered email, and follow the reset link sent to your inbox.' },
      { q: 'How do I log out?', a: 'Click your name in the top right and choose “Logout”.' },
    ],
  },
  {
    category: 'Support',
    icon: 'help_center',
    items: [
      { q: 'Where can I get help if I face an issue?', a: 'Click the red chat bubble in the bottom-right corner of any screen for live chat, or contact your Seller Admin. For email support, go to Administration > Support.' },
    ],
  },
];