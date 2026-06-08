import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';

const loginStyles = `
  .login-container {
    display: flex;
    min-height: 100vh;
    background-color: var(--bg-app);
    color: var(--text-primary);
    font-family: var(--font-sans);
  }
  
  /* Left Panel: abstract branding, hidden on mobile */
  .login-branding {
    display: none;
    flex: 1;
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    border-right: 1px solid var(--border-subtle);
    padding: 60px;
    flex-direction: column;
    justify-content: space-between;
    position: relative;
    overflow: hidden;
  }
  
  [data-theme="light"] .login-branding {
    background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
  }

  @media (min-width: 768px) {
    .login-branding {
      display: flex;
    }
  }

  .branding-circle {
    position: absolute;
    width: 400px;
    height: 400px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 70%);
    top: -100px;
    left: -100px;
    animation: branding-pulse 8s infinite alternate ease-in-out;
  }

  @keyframes branding-pulse {
    0% { transform: scale(1); opacity: 0.7; }
    100% { transform: scale(1.15); opacity: 1; }
  }

  /* Right Panel: login form */
  .login-form-panel {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 24px;
    position: relative;
  }

  .login-card {
    width: 100%;
    max-width: 400px;
  }

  .login-input-group {
    margin-bottom: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .login-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .login-input {
    background-color: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 14px;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .login-input:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .login-btn {
    background-color: var(--accent-primary);
    color: #FFFFFF;
    font-weight: 500;
    border: none;
    border-radius: 8px;
    padding: 14px;
    font-size: 15px;
    cursor: pointer;
    transition: background-color 0.2s, transform 0.2s;
    width: 100%;
    margin-top: 10px;
  }

  .login-btn:hover {
    background-color: var(--accent-hover);
  }

  .login-btn:active {
    transform: scale(0.99);
  }

  .floating-theme-toggle {
    position: absolute;
    top: 24px;
    right: 24px;
    background: transparent;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-primary);
    transition: background-color 0.2s;
  }

  .floating-theme-toggle:hover {
    background-color: var(--accent-muted);
  }
`;

export default function LoginPage() {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState('advocate@lexamplify.in');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // --- 1. THE DYNAMIC REGISTRATION FUNCTION ---
  const handleRegister = async (e) => {
    e.preventDefault();
    if (!email || !password) return setError('Please provide email and password.');
    setLoading(true); setError('');

    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // DEFENSIVE MAPPING: Send both keys so backend never misses it
        body: JSON.stringify({ email: email, username: email, password: password }) 
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Registration failed.');
      
      alert("Account created securely! You can now click Sign In.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- 2. THE DYNAMIC LOGIN FUNCTION ---
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return setError('Please provide email and password.');
    setLoading(true); setError('');

    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // DEFENSIVE MAPPING: Guarantee Python catches it
        body: JSON.stringify({ email: email, username: email, password: password }) 
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || 'Invalid credentials.');
      if (!data.access_token) throw new Error('No JWT token received from server.');

      localStorage.setItem('token', data.access_token);
      localStorage.setItem('lexai_token', data.access_token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <style>{loginStyles}</style>

      {/* Floating Theme Button */}
      <button
        onClick={toggleTheme}
        className="floating-theme-toggle"
        title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
      >
        {theme === 'dark' ? (
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="5" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        ) : (
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>

      {/* Left branding panel: hidden on mobile */}
      <div className="login-branding">
        <div className="branding-circle" />
        
        {/* Top Branding Section */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', zIndex: 2 }}>
          <span style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '0.5px' }}>LexAmplify</span>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', background: 'var(--accent-muted)', color: 'var(--accent-primary)', padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>
            India
          </span>
        </div>

        {/* Middle Value Proposition Section */}
        <div style={{ zIndex: 2, maxWidth: '460px', margin: 'auto 0' }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '38px', lineHeight: '1.25', marginBottom: '20px', fontWeight: '700' }}>
            The sovereign workspace for Indian advocacy.
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '15px', lineHeight: '1.6' }}>
            Access specialized modules including Contract Risk Analysis, Conflict comparison indexes, and RAG chat directories grounded in Indian Law.
          </p>
        </div>

        {/* Bottom Compliance Badge */}
        <div style={{ zIndex: 2, display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
          <span>🔒 Compliance Secured</span>
          <span>•</span>
          <span>Indian Law Sovereignty</span>
        </div>
      </div>

      {/* Right form panel */}
      <div className="login-form-panel">
        <div className="login-card">
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px', fontFamily: 'var(--font-serif)' }}>
              Enter advocate console
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
              Sign in with your credentials to launch LexAmplify.
            </p>
          </div>

          <form onSubmit={(e) => e.preventDefault()}>
            {error && (
              <div style={{ color: 'var(--accent-danger)', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px' }}>
                ⚠️ {error}
              </div>
            )}

            <div className="login-input-group">
              <label className="login-label">Email Address</label>
              <input
                type="email"
                className="login-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="advocate@lexamplify.in"
                required
                disabled={loading}
              />
            </div>

            <div className="login-input-group" style={{ marginBottom: '28px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="login-label">Password</label>
                <span style={{ fontSize: '12px', color: 'var(--accent-primary)', cursor: 'not-allowed' }}>Forgot?</span>
              </div>
              <input
                type="password"
                className="login-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
              />
            </div>

            {/* Replace your old <button type="submit"> with these two: */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button 
                type="button" 
                onClick={handleRegister} 
                className="login-btn" 
                style={{ background: 'transparent', border: '1px solid var(--accent-primary)', color: 'var(--accent-primary)' }}
                disabled={loading}
              >
                Create Account
              </button>
              
              <button 
                type="button" 
                onClick={handleLogin} 
                className="login-btn" 
                style={{ margin: 0 }}
                disabled={loading}
              >
                {loading ? 'Authenticating...' : 'Sign In'}
              </button>
            </div>
          </form>

          {/* Bottom Back Button */}
          <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '13px' }}>
            <Link to="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              ← Return to public website
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
