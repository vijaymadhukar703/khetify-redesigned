import React, { useState } from 'react';


const CompanyReturns = () => {
  // 1. Accordion state handle karne ke liye
  const [openProduct, setOpenProduct] = useState('NPK Soluble Powder 19:19:19');

  const productsData = [
    {
      name: 'NPK Soluble Powder 19:19:19',
      category: 'Fertilizers',
      totalIssues: 2,
      totalReturns: 5,
      vendors: [
        {
          name: 'Apex Fertilizers Ltd.',
          lastReported: 'Oct 26, 2023',
          reports: [
            { type: 'Return', reason: 'Damaged packaging on arrival', qty: '50 units', status: 'Pending', date: 'Oct 26, 2023' },
            { type: 'Issue', reason: 'Product caking in bag', qty: '-', status: 'In Review', date: 'Oct 24, 2023' }
          ]
        },
        {
          name: 'Green Valley Agro',
          lastReported: 'Oct 12, 2023',
          reports: [
            { type: 'Return', reason: 'Expired batch received', qty: '40 bags', status: 'Rejected', date: 'Oct 12, 2023' }
          ]
        }
      ]
    },
    { name: 'Hybrid Tomato Seeds', category: 'Seeds', totalIssues: 1, totalReturns: 0, vendors: [] },
    { name: 'Drip Irrigation Pipes 16mm', category: 'Irrigation', totalIssues: 0, totalReturns: 12, vendors: [] },
    { name: 'Pesticide Sprayer 5L', category: 'Equipment', totalIssues: 3, totalReturns: 8, vendors: [] }
  ];

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Pending': return 'bg-amber-50 text-amber-700 border-amber-100';
      case 'In Review': return 'bg-blue-50 text-blue-700 border-blue-100';
      case 'Rejected': return 'bg-red-50 text-red-700 border-red-100';
      default: return 'bg-stone-50 text-stone-600 border-stone-100';
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-10 bg-white font-sora">
      <div className="max-w-7xl mx-auto space-y-6">
      

        {/* Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-stone-900 tracking-tight">Returns & Issues</h2>
          <p className="text-stone-500 text-sm mt-1 font-medium">Monitor product-level quality patterns and seller-reported issues.</p>
        </div>

        {/* Search & Filter */}
        <div className="flex gap-4 mb-8">
          <div className="relative flex-1 max-w-md">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">search</span>
            <input type="text" placeholder="Search by Product Name" className="w-full pl-10 border-stone-200 rounded-lg py-2 text-sm focus:ring-[#EA2831]" />
          </div>
          <select className="border-stone-200 rounded-lg text-sm px-4 py-2 bg-white min-w-[180px]">
            <option>All Categories</option>
            <option>Fertilizers</option>
            <option>Seeds</option>
          </select>
        </div>

        {/* Hierarchical List */}
        <div className="flex flex-col gap-4">
          {productsData.map((product) => (
            <div key={product.name} className={`border border-stone-200 rounded-lg overflow-hidden transition-all ${openProduct === product.name ? 'shadow-md ring-1 ring-stone-900/5' : 'hover:border-stone-300'}`}>
              
              {/* Product Row (Parent) */}
              <div 
                className="flex items-center justify-between p-5 bg-white cursor-pointer"
                onClick={() => setOpenProduct(openProduct === product.name ? null : product.name)}
              >
                <div className="flex items-center gap-5">
                  <span className="material-symbols-outlined text-stone-400 bg-stone-50 p-1 rounded">
                    {openProduct === product.name ? 'expand_less' : 'expand_more'}
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-stone-900">{product.name}</h3>
                    <span className="text-xs font-bold text-stone-400 uppercase tracking-wide">{product.category}</span>
                  </div>
                </div>
                <div className="flex items-center gap-10 pr-4">
                  <div className="flex flex-col items-end">
                    <span className="text-2xl font-bold text-stone-900 leading-none">{product.totalIssues}</span>
                    <span className="text-xs font-medium text-stone-500 mt-1">Total Issues</span>
                  </div>
                  <div className="flex flex-col items-end border-l border-stone-100 pl-10">
                    <span className={`text-2xl font-bold leading-none ${product.totalReturns > 0 ? 'text-stone-900' : 'text-stone-400'}`}>
                      {product.totalReturns}
                    </span>
                    <span className="text-xs font-medium text-stone-500 mt-1">Total Returns</span>
                  </div>
                </div>
              </div>

              {/* Vendor Detail View (Child) */}
              {openProduct === product.name && product.vendors.length > 0 && (
                <div className="bg-stone-50 px-6 py-6 border-t border-stone-200 animate-fade-in">
                  {product.vendors.map((vendor, vIndex) => (
                    <div key={vIndex} className="mb-8 last:mb-0">
                      <h4 className="text-sm font-bold text-stone-900 mb-4 pb-2 border-b border-stone-200 flex items-center justify-between">
                        <span>Seller: {vendor.name}</span>
                        <span className="text-xs font-normal text-stone-500">Last reported: {vendor.lastReported}</span>
                      </h4>
                      <div className="bg-white border border-stone-200 rounded-md overflow-hidden">
                        <table className="min-w-full divide-y divide-stone-100 resp-table">
                          <thead className="bg-stone-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-bold text-stone-500 uppercase tracking-wider">Type</th>
                              <th className="px-6 py-3 text-left text-xs font-bold text-stone-500 uppercase tracking-wider">Reason</th>
                              <th className="px-6 py-3 text-right text-xs font-bold text-stone-500 uppercase tracking-wider">Quantity</th>
                              <th className="px-6 py-3 text-left text-xs font-bold text-stone-500 uppercase tracking-wider">Status</th>
                              <th className="px-6 py-3 text-right text-xs font-bold text-stone-500 uppercase tracking-wider">Reported Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100">
                            {vendor.reports.map((report, rIndex) => (
                              <tr key={rIndex} className="hover:bg-stone-50 transition-colors">
                                <td data-label="Type" className="px-6 py-3 whitespace-nowrap text-sm font-semibold text-stone-900">{report.type}</td>
                                <td data-label="Reason" className="px-6 py-3 whitespace-nowrap text-sm text-stone-600">{report.reason}</td>
                                <td data-label="Quantity" className="px-6 py-3 whitespace-nowrap text-sm text-stone-700 text-right font-medium">{report.qty}</td>
                                <td data-label="Status" className="px-6 py-3 whitespace-nowrap">
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${getStatusBadge(report.status)}`}>
                                    {report.status}
                                  </span>
                                </td>
                                <td data-label="Reported Date" className="px-6 py-3 whitespace-nowrap text-sm text-stone-500 text-right">{report.date}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Load More */}
        <div className="text-center mt-8 mb-12">
          <button className="text-sm font-bold text-[#EA2831] hover:text-[#c91e26] transition-colors flex items-center justify-center gap-1 mx-auto px-6 py-2 border border-[#EA2831] rounded-md hover:bg-red-50">
            Load more products
            <span className="material-symbols-outlined text-[16px]">expand_more</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompanyReturns;