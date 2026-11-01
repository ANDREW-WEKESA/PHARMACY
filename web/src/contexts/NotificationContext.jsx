import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { get, put } from '../api.js';

const NotificationContext = createContext(null);

export function NotificationProvider({ children, user }) {
  const isSystemOwner = user?.is_system_owner === 1;
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!isSystemOwner) return;
    
    try {
      setLoading(true);
      const data = await get('/owner/notifications?limit=50');
      setNotifications(data.notifications || []);
      
      // Calculate counts
      const unread = data.notifications.filter(n => !n.is_read).length;
      const critical = data.notifications.filter(n => !n.is_read && n.type === 'critical').length;
      setUnreadCount(unread);
      setCriticalCount(critical);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [isSystemOwner]);

  const markAsRead = useCallback(async (id) => {
    try {
      await put(`/owner/notifications/${id}/read`);
      setNotifications(prev => 
        prev.map(n => n.id === id ? { ...n, is_read: 1 } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
      setCriticalCount(prev => {
        const notification = notifications.find(n => n.id === id);
        return notification?.type === 'critical' ? Math.max(0, prev - 1) : prev;
      });
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  }, [notifications]);

  const markAllAsRead = useCallback(async () => {
    try {
      await put('/owner/notifications/mark-all-read');
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
      setUnreadCount(0);
      setCriticalCount(0);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  }, []);

  // Fetch on mount and auto-refresh every 30 seconds
  useEffect(() => {
    if (isSystemOwner) {
      fetchNotifications();
      const interval = setInterval(fetchNotifications, 30000);
      return () => clearInterval(interval);
    }
  }, [isSystemOwner, fetchNotifications]);

  if (!isSystemOwner) {
    return children;
  }

  const value = {
    notifications,
    unreadCount,
    criticalCount,
    loading,
    fetchNotifications,
    markAsRead,
    markAllAsRead
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    // Not a system owner or context not provided
    return {
      notifications: [],
      unreadCount: 0,
      criticalCount: 0,
      loading: false,
      fetchNotifications: () => {},
      markAsRead: () => {},
      markAllAsRead: () => {}
    };
  }
  return context;
}
