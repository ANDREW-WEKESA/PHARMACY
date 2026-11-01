// Notification service for owner alerts
import { q, nowUtc } from './lib.js';

/**
 * Create a notification for the owner
 * @param {Object} db - D1 database instance
 * @param {number} ownerId - Owner user ID
 * @param {Object} options - Notification details
 * @param {number} options.pharmacyId - Pharmacy ID (nullable for system-wide)
 * @param {string} options.type - Notification type: info|warning|critical|security
 * @param {string} options.category - Category: sales|stock|staff|auth|security|system
 * @param {string} options.title - Notification title
 * @param {string} options.message - Notification message
 * @param {Object} options.metadata - Additional data (will be JSON stringified)
 * @param {boolean} options.requiresAction - Whether this requires owner action
 */
export async function notifyOwner(db, ownerId, { pharmacyId, type, category, title, message, metadata, requiresAction }) {
  try {
    await q.run(db,
      `INSERT INTO owner_notifications (owner_user_id, pharmacy_id, type, category, title, message, metadata, requires_action)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ownerId,
      pharmacyId || null,
      type || 'info',
      category,
      title,
      message,
      metadata ? JSON.stringify(metadata) : null,
      requiresAction ? 1 : 0
    );
  } catch (err) {
    console.error('Failed to create owner notification:', err);
  }
}

/**
 * Detect if a sale is abnormal based on multiple criteria
 * @param {Object} pharmacy - Pharmacy record
 * @param {Object} sale - Sale record
 * @returns {Object|null} - { reason, severity } if abnormal, null otherwise
 */
export function detectAbnormalSale(pharmacy, sale) {
  const saleHour = new Date(sale.sale_date).getHours();
  
  // After hours sale (before 6am or after 10pm)
  if (saleHour < 6 || saleHour >= 22) {
    return { 
      reason: `After-hours sale at ${saleHour}:00`,
      severity: 'warning'
    };
  }
  
  // High value sale (using expiry_warn_days as heuristic threshold multiplier)
  const threshold = (pharmacy.expiry_warn_days || 90) * 100;
  if (sale.total > threshold) {
    return {
      reason: `High-value sale of ${sale.total.toLocaleString()}`,
      severity: 'warning'
    };
  }
  
  // Large discount (>50%)
  if (sale.discount && sale.subtotal) {
    const discountPercent = (sale.discount / sale.subtotal) * 100;
    if (discountPercent > 50) {
      return {
        reason: `Large discount of ${discountPercent.toFixed(0)}% applied`,
        severity: 'warning'
      };
    }
  }
  
  return null;
}

/**
 * Check for multiple failed login attempts (security issue)
 * @param {Object} db - Database instance
 * @param {string} identifier - Email or phone being attempted
 * @returns {Promise<number>} - Number of failed attempts in last 10 minutes
 */
export async function checkFailedLoginAttempts(db, identifier) {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const result = await q.first(db,
    `SELECT COUNT(*) count FROM audit_log 
     WHERE action = 'login_failed' AND detail = ? AND created_at >= ?`,
    identifier, tenMinutesAgo
  );
  return result.count;
}

/**
 * Detect if stock change is abnormal
 * @param {Object} currentStock - Current stock amount for drug
 * @param {number} changeAmount - Amount being adjusted
 * @returns {Object|null} - { reason, severity } if abnormal
 */
export function detectAbnormalStock(currentStock, changeAmount) {
  const absChange = Math.abs(changeAmount);
  
  // Large absolute change (> 500 units)
  if (absChange > 500) {
    return {
      reason: `Large stock adjustment of ${absChange} units`,
      severity: 'warning'
    };
  }
  
  // Large percentage change (> 20% of current stock)
  if (currentStock && currentStock > 0) {
    const percentChange = (absChange / currentStock) * 100;
    if (percentChange > 20) {
      return {
        reason: `Stock adjustment of ${percentChange.toFixed(0)}% of current inventory`,
        severity: 'warning'
      };
    }
  }
  
  return null;
}

/**
 * Detect security issues
 * All specified auth events are considered security issues
 */
export function detectSecurityIssue(action) {
  const securityActions = [
    'login_failed',
    'password_changed',
    'user_created',
    'user_updated_role',
    'user_deactivated'
  ];
  return securityActions.includes(action);
}

/**
 * Detect critical system alerts
 * Currently catches system-wide critical events
 */
export function detectCriticalAlert(event) {
  // Future: define critical event types
  return event.critical === true;
}
