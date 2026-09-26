import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import VariantMeasurements from '../admin/VariantMeasurements.jsx';

const UNIT_OPTIONS = [
  { value: 'Kilograms',   label: 'Kilograms (kg)',    short: 'kg',  kind: 'weight', step: '0.01' },
  { value: 'Grams',       label: 'Grams (g)',         short: 'g',   kind: 'weight', step: '1'    },
  { value: 'Metric Ton',  label: 'Metric Ton (MT)',   short: 'MT',  kind: 'weight', step: '0.01' },
  { value: 'Liters',      label: 'Liters (L)',        short: 'L',   kind: 'volume', step: '0.01' },
  { value: 'Milliliters', label: 'Milliliters (ml)',  short: 'ml',  kind: 'volume', step: '1'    },
  { value: 'Pieces',      label: 'Pieces (Pcs)',      short: 'Pcs', kind: 'count',  step: '1'    },
  { value: 'Packets',     label: 'Packets (Pkt)',     short: 'Pkt', kind: 'count',  step: '1'    },
];

const ThemedSelect = ({ id, value, options, onChange, placeholder, className = '', compact = false }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Accepts either ['a','b'] or [{value,label}]
  const norm = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const currentLabel = norm.find((o) => o.value === value)?.label || placeholder || 'Select…';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${className} flex items-center justify-between gap-2 text-left transition-colors ${
          open ? 'border-[#EA2831] ring-2 ring-[#EA2831]/20' : ''
        } ${value ? 'text-stone-800' : 'text-stone-400'}`}
      >
        <span className={`truncate ${compact ? '' : ''}`}>{currentLabel}</span>
        <ChevronDown className={`size-4 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1.5 w-full min-w-[140px] rounded-xl border border-stone-200 bg-white py-1.5 shadow-lg shadow-stone-900/10 max-h-64 overflow-y-auto"
        >
          {norm.map((opt) => {
            const selected = opt.value === value;
            return (
              <li key={opt.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={`flex w-full items-center px-3.5 py-2 text-left text-sm font-medium transition-colors ${
                    selected ? 'text-[#EA2831] bg-[#EA2831]/5 font-bold' : 'text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};






// Match Company Upload's measurement controls without changing its product fields.
export default function CompanyVariantMeasurements(props) {
  return <VariantMeasurements {...props} units={UNIT_OPTIONS} ThemedSelect={ThemedSelect}
    inputClass="w-full border border-stone-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#EA2831]/20 focus:border-[#EA2831] outline-none transition-all placeholder:text-stone-300 bg-white font-sora"
    labelClass="block text-sm font-semibold text-stone-700 mb-1.5" hintClass="text-xs text-stone-400 mt-1" />;
}
