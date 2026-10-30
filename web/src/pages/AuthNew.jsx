import { useState } from 'react';
import { post, setToken } from '../api.js';
import { Spinner } from '../ui.jsx';

export function AuthNew({ onDone, needsSetup }) {
  const [mode, setMode] = useState('login'); // login, register, reset, verify, welcome
  const [form, setForm] = useState({ identifier: '', password: '', name: '', email: '', code: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await post('/auth/login', {
        identifier: form.identifier,
        password: form.password,
      });
      setMode('welcome');
      setTimeout(() => onDone(token), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await post('/auth/reset-password-request', { email: form.email });
      setMessage('Password reset link sent to your email!');
      setTimeout(() => {
        setMode('login');
        setMessage('');
      }, 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await post('/setup', {
        pharmacy_name: form.pharmacyName,
        owner_name: form.name,
        owner_email: form.email,
        owner_phone: form.phone,
        password: form.password,
        is_system_owner: form.isSystemOwner ? 1 : 0,
      });
      setMode('welcome');
      setTimeout(() => onDone(token), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'welcome') {
    return (
      <div className="auth-wrapper">
        <div className="auth-container welcome-screen">
          <div className="welcome-animation">
            <div className="success-checkmark">
              <div className="check-icon">
                <span className="icon-line line-tip"></span>
                <span className="icon-line line-long"></span>
                <div className="icon-circle"></div>
                <div className="icon-fix"></div>
              </div>
            </div>
          </div>
          <h1 style={{ fontFamily: 'Poppins, sans-serif', fontSize: 32, marginTop: 20, color: '#667eea' }}>Welcome! 🎉</h1>
          <p style={{ fontSize: 16, color: '#6b6a85', marginTop: 10 }}>Setting up your dashboard...</p>
          <div style={{ marginTop: 20 }}>
            <Spinner />
          </div>
        </div>
      </div>
    );
  }

  if (needsSetup) {
    return (
      <div className="auth-wrapper">
        <div className="auth-container">
          <div className="auth-header">
            <div className="auth-logo">💊</div>
            <h1>Pharmacy Setup</h1>
            <p>Let's set up your pharmacy management system</p>
          </div>

          <form onSubmit={handleSetup} className="auth-form">
            <div className="form-group">
              <label>Pharmacy Name *</label>
              <input
                type="text"
                value={form.pharmacyName || ''}
                onChange={(e) => setForm({ ...form, pharmacyName: e.target.value })}
                placeholder="Your Pharmacy Ltd"
                required
              />
            </div>

            <div className="form-group">
              <label>Your Name *</label>
              <input
                type="text"
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="John Doe"
                required
              />
            </div>

            <div className="form-group">
              <label>Email Address *</label>
              <input
                type="email"
                value={form.email || ''}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@pharmacy.com"
                required
              />
            </div>

            <div className="form-group">
              <label>Phone Number</label>
              <input
                type="tel"
                value={form.phone || ''}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="0712345678"
              />
            </div>

            <div className="form-group">
              <label>Password *</label>
              <input
                type="password"
                value={form.password || ''}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                required
                minLength={8}
              />
              <small>At least 8 characters</small>
            </div>

            <div className="form-group">
              <label className="check" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input 
                  type="checkbox" 
                  checked={!!form.isSystemOwner} 
                  onChange={(e) => setForm({ ...form, isSystemOwner: e.target.checked })} 
                />
                <span>I manage multiple pharmacy locations</span>
              </label>
              {form.isSystemOwner && (
                <div style={{ 
                  padding: 10, 
                  background: '#f0f9ff', 
                  border: '1px solid #0ea5e9', 
                  borderRadius: 4,
                  fontSize: 14,
                  marginTop: 8
                }}>
                  ℹ️ You'll be able to add more pharmacies and assign staff after setup
                </div>
              )}
            </div>

            {error && <div className="auth-error">{error}</div>}

            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? 'Setting up...' : '🚀 Complete Setup'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <div className="auth-wrapper">
        <div className="auth-container">
          <div className="auth-header">
            <div className="auth-logo">🔐</div>
            <h1>Reset Password</h1>
            <p>Enter your email to receive a password reset link</p>
          </div>

          <form onSubmit={handlePasswordReset} className="auth-form">
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                value={form.email || ''}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@pharmacy.com"
                required
                autoFocus
              />
            </div>

            {error && <div className="auth-error">{error}</div>}
            {message && <div className="auth-success">{message}</div>}

            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? 'Sending...' : '📧 Send Reset Link'}
            </button>

            <div className="auth-footer">
              <button type="button" className="auth-link" onClick={() => setMode('login')}>
                ← Back to Login
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-container">
        <div className="auth-header">
          <div className="auth-logo">💊</div>
          <h1>Welcome Back</h1>
          <p>Sign in to your pharmacy management system</p>
        </div>

        <form onSubmit={handleLogin} className="auth-form">
          <div className="form-group">
            <label>Email or Phone</label>
            <input
              type="text"
              value={form.identifier}
              onChange={(e) => setForm({ ...form, identifier: e.target.value })}
              placeholder="you@pharmacy.com or 0712345678"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? <Spinner /> : '🚀 Sign In'}
          </button>

          <div className="auth-footer">
            <button type="button" className="auth-link" onClick={() => setMode('reset')}>
              Forgot your password?
            </button>
          </div>
        </form>

        <div className="auth-decoration">
          <div className="decoration-circle"></div>
          <div className="decoration-circle"></div>
          <div className="decoration-circle"></div>
        </div>
      </div>
    </div>
  );
}
