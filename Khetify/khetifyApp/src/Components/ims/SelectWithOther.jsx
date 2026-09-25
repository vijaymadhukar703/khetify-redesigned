import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

const OTHER = '__other__';

/**
 * A native <select> with a built-in "Other…" escape hatch. When the user picks
 * Other, a text input appears and whatever they type becomes the field value.
 *
 * Fully controlled by `value`; `onChange` receives the resolved STRING value
 * (the picked option's value, or the free-text the user typed). It also handles
 * pre-existing custom values gracefully: if `value` isn't one of the known
 * options (e.g. a saved record with a custom category), the field opens in
 * Other-mode with that value pre-filled.
 *
 * Props:
 *   value        current string value (controlled)
 *   onChange     (value: string) => void
 *   options      array of strings OR { value, label } objects
 *   placeholder  optional empty-option label (omit to not render one)
 *   className    applied to both the select and the text input
 *   otherLabel   label for the Other option (default "Other…")
 *   otherPlaceholder  placeholder for the free-text input
 *   id, name, required, disabled  forwarded to the <select>
 */
export default function SelectWithOther({
  value = '',
  onChange,
  options = [],
  placeholder,
  className = '',
  otherLabel = 'Other…',
  otherPlaceholder = 'Type your own',
  id,
  name,
  required,
  disabled,
}) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const known = opts.some((o) => String(o.value) === String(value));
  // Other is active when explicitly chosen, or when the current value is a
  // non-empty custom string not present in the option list.
  const [forcedOther, setForcedOther] = useState(false);
  const isOther = forcedOther || (!!value && !known);

  const [open, setOpen] = useState(false);
const ref = useRef(null);

useEffect(() => {
  const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
  document.addEventListener('mousedown', handler);
  return () => document.removeEventListener('mousedown', handler);
}, []);

const pick = (v) => {
  if (v === OTHER) {
    setForcedOther(true);
    onChange('');
  } else {
    setForcedOther(false);
    onChange(v);
  }
  setOpen(false);
};

const currentLabel = isOther
  ? otherLabel
  : (opts.find((o) => String(o.value) === String(value))?.label || placeholder || 'Select…');




  return (
    <>
      <div className="relative" ref={ref}>
  <button
    type="button"
    id={id}
    name={name}
    disabled={disabled}
    onClick={() => !disabled && setOpen((o) => !o)}
    aria-haspopup="listbox"
    aria-expanded={open}
    className={`${className} flex items-center justify-between gap-2 text-left transition-colors ${
      open ? 'border-[#EA2831] ring-2 ring-[#EA2831]/20' : ''
    } ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${(value || isOther) ? 'text-stone-800' : 'text-stone-400'}`}
  >
    <span className="truncate">{currentLabel}</span>
    <ChevronDown className={`size-4 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
  </button>

  {open && (
    <ul
      role="listbox"
      className="absolute z-30 mt-1.5 w-full min-w-[160px] rounded-xl border border-stone-200 bg-white py-1.5 shadow-lg shadow-stone-900/10 max-h-64 overflow-y-auto"
    >
      {placeholder !== undefined && (
        <li role="option" aria-selected={!value && !isOther}>
          <button
            type="button"
            onClick={() => pick('')}
            className={`flex w-full items-center px-3.5 py-2 text-left text-sm font-medium transition-colors ${
              !value && !isOther ? 'text-[#EA2831] bg-[#EA2831]/5 font-bold' : 'text-stone-400 hover:bg-stone-50'
            }`}
          >
            {placeholder}
          </button>
        </li>
      )}
      {opts.map((o) => {
        const selected = !isOther && String(o.value) === String(value);
        return (
          <li key={o.value} role="option" aria-selected={selected}>
            <button
              type="button"
              onClick={() => pick(o.value)}
              className={`flex w-full items-center px-3.5 py-2 text-left text-sm font-medium transition-colors ${
                selected ? 'text-[#EA2831] bg-[#EA2831]/5 font-bold' : 'text-stone-600 hover:bg-stone-50'
              }`}
            >
              {o.label}
            </button>
          </li>
        );
      })}
      <li role="option" aria-selected={isOther}>
        <button
          type="button"
          onClick={() => pick(OTHER)}
          className={`flex w-full items-center px-3.5 py-2 text-left text-sm font-medium border-t border-stone-100 transition-colors ${
            isOther ? 'text-[#EA2831] bg-[#EA2831]/5 font-bold' : 'text-stone-600 hover:bg-stone-50'
          }`}
        >
          {otherLabel}
        </button>
      </li>
    </ul>
  )}
</div>
      {isOther && (
        <input
          className={`${className} mt-2`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={otherPlaceholder}
          required={required}
          disabled={disabled}
          autoFocus
        />
      )}
    </>
  );
}
