import { useEffect, useState, useCallback } from 'react';
import {
  getNotifications, markNotificationRead, markAllNotificationsRead, scanAlerts,
} from '../lib/imsApi';
import { getSocket } from '../lib/socket';

/**
 * Shared notification state: the list + unread count, kept live via the
 * "notification:new" socket event. Both the header bell and the full feed
 * page use this so their numbers always agree.
 */
export function useNotifications() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    getNotifications()
      .then((r) => { if (r?.success) { setItems(r.data); setUnread(r.unread); } })
      .catch(() => {});
  }, []);

  const markRead = useCallback(async (id) => {
    await markNotificationRead(id).catch(() => {});
    refresh();
  }, [refresh]);

  const markAll = useCallback(async () => {
    await markAllNotificationsRead().catch(() => {});
    refresh();
  }, [refresh]);

  const scan = useCallback(async () => {
    await scanAlerts().catch(() => {});
    refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    const socket = getSocket();
    if (!socket) return;
    const onNew = (doc) => { setItems((prev) => [doc, ...prev]); setUnread((u) => u + 1); };
    socket.on('notification:new', onNew);
    return () => socket.off('notification:new', onNew);
  }, [refresh]);

  return { items, unread, refresh, markRead, markAll, scan };
}

/** Icon + colour per notification type. */
export const NOTIF_ICON = {
  low_stock: { icon: 'inventory', cls: 'text-orange-500 bg-orange-50' },
  expiry: { icon: 'event_busy', cls: 'text-[#EA2831] bg-red-50' },
  shipment: { icon: 'local_shipping', cls: 'text-blue-500 bg-blue-50' },
  order: { icon: 'shopping_cart', cls: 'text-indigo-500 bg-indigo-50' },
  supply_status: { icon: 'sync_alt', cls: 'text-emerald-600 bg-emerald-50' },
  lot_incoming: { icon: 'move_to_inbox', cls: 'text-violet-600 bg-violet-50' },
};