import SelectWithOther from '../../Components/ims/SelectWithOther';
import { measurementError } from './variantMeasurements.js';
const DIMENSION_UNITS = ['mm', 'cm', 'm', 'inch', 'ft'];
const WEIGHT_UNITS = ['g', 'kg', 'MT'];
const emptyMeasurements = () => ({ packagingType: '', unit: '', unitValue: '', length: '', width: '', height: '', dimensionUnit: 'cm', weight: '', weightUnit: 'kg' });

// Use the admin form's controls and classes without changing the product-level section.
export default function VariantMeasurements(props) {
  const { value, onChange, units, idPrefix, ThemedSelect, inputClass, labelClass, hintClass } = props;
  const data = value || emptyMeasurements();
  const unitMeta = units.find(item => item.value === data.unit);
  const unitValueLabel = unitMeta ? { weight: 'Net Weight', volume: 'Net Volume', count: 'Quantity per Pack' }[unitMeta.kind] : '';
  const patch = changes => onChange({ ...data, ...changes });
  return (<div className="pt-4">
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase">Product Packaging Description &amp; Measurement</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className={labelClass}>Packaging Type <span className="text-[#EA2831]">*</span></label>
                <SelectWithOther
                  id={idPrefix + "-packagingType"} className={inputClass} value={data.packagingType}
                  onChange={v => patch({ packagingType: v })}
                  placeholder="Select Packaging" otherPlaceholder="Enter packaging type"
                  options={['HDPE Bag', 'Jute Bag', 'Bottle', 'Drum', 'Carton Box', 'Pouch', 'Sachet', 'Tin/Can', 'Bulk Container']}
                />
              </div>

              <div>
                <label className={labelClass}>Unit of Measurement <span className="text-[#EA2831]">*</span></label>
                <ThemedSelect
                  id={idPrefix + "-unit"} className={inputClass} value={data.unit}
                  onChange={v => {
                    const next = units.find(item => item.value === v);
                    patch({ unit: v, unitValue: unitMeta?.kind === next?.kind ? data.unitValue : '' });
                  }}
                  placeholder="Select Unit"
                  options={[{ value: '', label: 'Select Unit' }, ...units.map(o => ({ value: o.value, label: o.label }))]}
                />
              </div>

              {/* Dynamic value field — appears only once a unit is chosen, and
                  re-labels itself based on what that unit measures. */}
              {unitMeta && (
                <div className="animate__animated animate__fadeIn">
                  <label className={labelClass}>
                    {unitValueLabel} <span className="text-[#EA2831]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id={idPrefix + "-unitValue"}
                      type="number"
                      min="0"
                      step={unitMeta.step}
                      className={`${inputClass} pr-16`}
                      value={data.unitValue}
                      onChange={e => patch({ [e.target.id.slice(idPrefix.length + 1)]: e.target.value })}
                      placeholder={unitMeta.kind === 'count' ? 'e.g., 10' : 'e.g., 50'}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-stone-400 pointer-events-none max-w-[52px] truncate">
                      {unitMeta.short}
                    </span>
                  </div>
                  <p className={hintClass}>
                    {data.unitValue
                      ? `Sells as: ${data.unitValue} ${unitMeta.short}${data.packagingType ? ` · ${data.packagingType}` : ''}`
                      : `Value in ${data.unit}.`}
                  </p>
                </div>
              )}

              <div className="md:col-span-2 md:row-start-2">
                <label className={labelClass}>Product Dimensions <span className="text-[#EA2831]">*</span></label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <input id={idPrefix + "-length"} type="number" min="0" step="0.01" className={inputClass} value={data.length} onChange={e => patch({ [e.target.id.slice(idPrefix.length + 1)]: e.target.value })} placeholder="Length" />
                  <input id={idPrefix + "-width"} type="number" min="0" step="0.01" className={inputClass} value={data.width} onChange={e => patch({ [e.target.id.slice(idPrefix.length + 1)]: e.target.value })} placeholder="Width" />
                  <input id={idPrefix + "-height"} type="number" min="0" step="0.01" className={inputClass} value={data.height} onChange={e => patch({ [e.target.id.slice(idPrefix.length + 1)]: e.target.value })} placeholder="Height" />
                  <ThemedSelect
                    id={idPrefix + "-dimensionUnit"}
                    className={inputClass}
                    value={data.dimensionUnit}
                    onChange={v => patch({ dimensionUnit: v })}
                    options={DIMENSION_UNITS}
                  />
                </div>
              </div>

              <div className="md:row-start-2 md:col-start-3">
                <label className={labelClass}>Shipping Weight (Gross) <span className="text-[#EA2831]">*</span></label>
                <div className="flex gap-2">
                  <input id={idPrefix + "-weight"} type="number" min="0" step="0.01" className={inputClass} value={data.weight} onChange={e => patch({ [e.target.id.slice(idPrefix.length + 1)]: e.target.value })} placeholder="e.g., 51" />
                  <ThemedSelect
                    id={idPrefix + "-weightUnit"}
                    className={`${inputClass} max-w-[100px]`}
                    value={data.weightUnit}
                    onChange={v => patch({ weightUnit: v })}
                    options={WEIGHT_UNITS}
                  />
                </div>
              </div>
            </div>
          {measurementError(value) && <p role="alert" className="mt-3 text-sm text-red-600">{measurementError(value)}</p>}
            {value && <button type="button" className="mt-3 text-sm text-[#EA2831] underline" onClick={() => onChange(undefined)}>Clear variant measurements</button>}
          </div>);
}
