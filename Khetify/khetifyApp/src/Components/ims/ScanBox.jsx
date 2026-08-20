import React, { useEffect, useRef, useState } from 'react';
import CameraScanner, { cameraScanSupported } from './CameraScanner';

/**
 * Universal scan input. USB barcode scanners act as keyboard wedges — they type
 * the code very fast and emit Enter. This component:
 *   - keeps focus so a scan is always captured
 *   - debounces manual typing vs. a scanner burst (a real scan arrives in one go)
 *   - fires onScan(code) on Enter (or on a fast burst terminator)
 *   - offers DEVICE-CAMERA scanning (BarcodeDetector) where the browser
 *     supports it — a camera button opens a live preview overlay and feeds the
 *     decoded code through the same onScan path. Pass camera={false} to hide.
 *
 *   <ScanBox onScan={(code) => resolve(code)} placeholder="Scan a unit / bin / lot" />
 */
const ScanBox = ({ onScan, onValueChange, placeholder = 'Scan or type a code, then Enter', autoFocus = true, disabled = false, camera = true }) => {
  const [value, setValue] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const ref = useRef(null);
  const lastKey = useRef(0);

  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, [autoFocus]);

  // Disabling an input BLURS it, so a caller that disables the box while it
  // resolves a scan (`disabled={busy}`) would leave the operator having to click
  // back in for every single item. Re-arm as soon as it is enabled again, so a
  // continuous scan run never needs the mouse.
  useEffect(() => {
    if (!disabled && autoFocus && !showCamera) ref.current?.focus();
  }, [disabled, autoFocus, showCamera]);

  const submit = (code) => {
    const c = String(code || '').trim();
    if (!c) return;
    onScan?.(c);
    setValue('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit(value);
    }
    lastKey.current = e.timeStamp;
  };

  return (
    <div className="flex items-center gap-2">
      <span className="material-symbols-outlined text-stone-400">barcode_scanner</span>
      <input
        ref={ref}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          // Text input: accepts ANY characters (letters, digits, '.', '-', '_'),
          // so an alphanumeric label code like "6a46...892de.1071f9..." pastes
          // and types verbatim. onValueChange lifts the live value so a PASTE
          // (no Enter) still arms the caller — while onScan still fires on Enter
          // / a completed scan, keeping wedge-scanner behaviour unchanged.
          setValue(e.target.value);
          onValueChange?.(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          // Keep the scan field armed for keyboard-wedge scanners, but DON'T
          // steal focus when the user intentionally moves to another control
          // (input/select/button/etc.) — otherwise they can't type elsewhere.
          if (!autoFocus || showCamera) return;
          const to = e.relatedTarget;
          if (to && to.matches?.('input, textarea, select, button, a, [contenteditable="true"]')) return;
          ref.current?.focus();
        }}
        placeholder={placeholder}
        className="flex-1 border border-stone-200 rounded-lg px-3 py-2 text-sm font-mono focus:border-[#EA2831] focus:ring-1 focus:ring-[#EA2831] outline-none"
        autoComplete="off"
      />
      {camera && cameraScanSupported() && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShowCamera(true)}
          title="Scan with device camera"
          className="p-2 rounded-lg border border-stone-200 text-stone-500 hover:text-[#EA2831] hover:border-[#EA2831] transition-colors"
        >
          <span className="material-symbols-outlined text-xl">photo_camera</span>
        </button>
      )}
      {showCamera && (
        <CameraScanner
          onClose={() => setShowCamera(false)}
          onDetected={(code) => { setShowCamera(false); submit(code); }}
        />
      )}
    </div>
  );
};

export default ScanBox;