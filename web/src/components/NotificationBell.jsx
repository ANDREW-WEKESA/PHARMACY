import { useState } from 'react';
import { useNotifications } from '../contexts/NotificationContext.jsx';
import { eatTime } from '../util.js';

export function NotificationBell() {
  const { notifications, unreadCount, criticalCount, markAsRead } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);

  const getTypeColor = (type) => {
    switch (type) {
      case 'critical': return 'bg-red-500';
      case 'warning': return 'bg-yellow-500';
      case 'security': return 'bg-purple-500';
      default: return 'bg-blue-500';
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'critical': return '🔴';
      case 'warning': return '⚠️';
      case 'security': return '🔒';
      default: return 'ℹ️';
    }
  };

  const handleNotificationClick = (notification) => {
    if (!notification.is_read) {
      markAsRead(notification.id);
    }
  };

  const recentNotifications = notifications.slice(0, 10);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 hover:bg-gray-100 rounded-full transition-colors"
        title="Notifications"
      >
        <span className="text-2xl">🔔</span>
        {unreadCount > 0 && (
          <span className={`absolute top-0 right-0 ${criticalCount > 0 ? 'bg-red-500' : 'bg-blue-500'} text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-[600px] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h3 className="font-semibold text-lg">Notifications</h3>
              <a 
                href="/owner/notifications" 
                className="text-blue-600 hover:text-blue-800 text-sm"
                onClick={() => setIsOpen(false)}
              >
                View All
              </a>
            </div>

            <div className="overflow-y-auto flex-1">
              {recentNotifications.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <span className="text-4xl">✨</span>
                  <p className="mt-2">No notifications</p>
                </div>
              ) : (
                recentNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
                      notification.is_read ? 'opacity-60' : 'bg-blue-50'
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 text-xl">
                        {getTypeIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-semibold text-sm text-gray-900">
                            {notification.title}
                          </h4>
                          <span className={`inline-block ${getTypeColor(notification.type)} text-white text-xs px-2 py-1 rounded whitespace-nowrap`}>
                            {notification.type}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 mt-1 line-clamp-2">
                          {notification.message}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {eatTime(notification.created_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {recentNotifications.length > 0 && (
              <div className="p-3 border-t border-gray-200 bg-gray-50">
                <a 
                  href="/owner/notifications" 
                  className="block text-center text-blue-600 hover:text-blue-800 text-sm font-medium"
                  onClick={() => setIsOpen(false)}
                >
                  See All Notifications →
                </a>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
