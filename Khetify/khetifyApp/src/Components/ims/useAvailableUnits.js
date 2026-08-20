import { useCallback, useState } from 'react';
import { getLotAvailableUnits } from '../../lib/imsApi';

/**
 * State for the shared Analytics "View Available Units" popup — see
 * Components/ims/AvailableUnits.jsx for the button and the modal it drives.
 *
 * Owns the open flag and ONE lazy fetch. Fetching on first open rather than on
 * mount keeps a View page's initial load unchanged: a user who never asks which
 * units make up the quantity never pays for the query. A page may render as many
 * buttons as it has quantity figures — they all share this one request.
 *
 * `fetcher` is how the SAME control serves every Analytics module: the company
 * and company-warehouse pages leave it at the default (`/lots/:id/…`), and the
 * seller pages pass their own owner-scoped endpoint. Both return the identical
 * shape, so the modal below never learns which module it is in.
 *
 * Lives in its own file because it is a hook, not a component (the
 * react-refresh/only-export-components rule).
 */
export const useAvailableUnits = (lotId, fetcher = getLotAvailableUnits) => {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState({ loading: false, error: '', data: null });

  const open = useCallback(() => {
    setIsOpen(true);
    setState((s) => {
      if (s.data || s.loading) return s; // already have it, or already asking
      fetcher(lotId)
        .then((r) => setState({ loading: false, error: '', data: r?.data || null }))
        .catch((e) => setState({
          loading: false,
          error: e?.response?.data?.message || 'Could not load the available Unit IDs.',
          data: null,
        }));
      return { loading: true, error: '', data: null };
    });
  }, [lotId, fetcher]);

  const close = useCallback(() => setIsOpen(false), []);
  return { isOpen, state, open, close };
};

export default useAvailableUnits;
