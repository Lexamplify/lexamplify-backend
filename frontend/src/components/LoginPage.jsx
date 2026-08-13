import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import LexLogoMark from './LexLogoMark';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''; // relative — same-origin via Vite proxy in dev

const loginStyles = `
  /* ── Root layout ── */
  .lx-login {
    display: flex; min-height: 100vh;
    font-family: var(--font-sans);
    background: #06090F;
    transition: background 0.45s;
  }
  [data-theme="light"] .lx-login { background: #F1F5F9; }

  /* ── Left panel ── */
  .lx-left {
    display: none; flex: 1.1;
    position: relative; overflow: hidden;
    background: linear-gradient(160deg, #0B1120 0%, #0D1528 50%, #091020 100%);
    padding: 0;
    transition: background 0.45s;
  }
  [data-theme="light"] .lx-left {
    background: linear-gradient(160deg, #0F1F42 0%, #152247 50%, #0D1A38 100%);
  }
  @media (min-width: 900px) { .lx-left { display: flex; flex-direction: column; } }

  /* background grid */
  .lx-left-grid {
    position: absolute; inset: 0; z-index: 0;
    background-image:
      linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
    background-size: 44px 44px;
  }
  [data-theme="light"] .lx-left-grid {
    background-image:
      linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
  }
  /* animated orbs */
  .lx-orb {
    position: absolute; border-radius: 50%;
    filter: blur(100px); pointer-events: none; z-index: 0;
  }
  .lx-orb-1 {
    width: 560px; height: 560px;
    background: radial-gradient(circle, rgba(37,99,235,0.18) 0%, transparent 70%);
    top: -120px; left: -80px;
    animation: lx-drift1 14s ease-in-out infinite alternate;
  }
  .lx-orb-2 {
    width: 400px; height: 400px;
    background: radial-gradient(circle, rgba(139,92,246,0.14) 0%, transparent 70%);
    bottom: 80px; right: -60px;
    animation: lx-drift2 18s ease-in-out infinite alternate;
  }
  .lx-orb-3 {
    width: 280px; height: 280px;
    background: radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%);
    bottom: -60px; left: 40%;
    animation: lx-drift1 22s ease-in-out infinite alternate-reverse;
  }
  @keyframes lx-drift1 { 0% { transform: translate(0,0); } 100% { transform: translate(30px, 40px); } }
  @keyframes lx-drift2 { 0% { transform: translate(0,0); } 100% { transform: translate(-20px, -30px); } }

  /* left inner content */
  .lx-left-inner {
    position: relative; z-index: 2;
    display: flex; flex-direction: column;
    height: 100%; padding: 40px 52px;
  }

  /* brand */
  .lx-brand { display: flex; align-items: center; gap: 10px; }
  .lx-brand-name {
    font-size: 20px; font-weight: 700; color: #FFFFFF;
    letter-spacing: -0.3px;
  }

  /* hero text */
  .lx-hero { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 0 0 20px; }
  .lx-hero-badge {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 5px 13px; border-radius: 30px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    font-size: 10.5px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 1.1px;
    color: #6B7280; margin-bottom: 20px; width: fit-content;
  }
  .lx-badge-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: #10B981;
    box-shadow: 0 0 6px #10B981;
    animation: lx-pulse 2s infinite alternate;
  }
  @keyframes lx-pulse { 0% { opacity: 0.4; } 100% { opacity: 1; } }
  .lx-hero-h {
    font-family: var(--font-serif);
    font-size: clamp(2rem, 2.8vw, 2.9rem);
    color: #FFFFFF; line-height: 1.15;
    letter-spacing: -0.8px; margin-bottom: 18px;
    font-weight: 700;
  }
  .lx-hero-h em { font-style: normal; color: #3B82F6; }
  .lx-hero-sub {
    font-size: 15px; color: rgba(255,255,255,0.45);
    line-height: 1.65; max-width: 400px; margin-bottom: 44px;
  }

  /* feature pillars */
  .lx-pillars { display: flex; flex-direction: column; gap: 12px; }
  .lx-pillar {
    display: flex; align-items: flex-start; gap: 14px;
    padding: 14px 16px; border-radius: 12px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.05);
    transition: background 0.25s, border-color 0.25s;
    cursor: default;
  }
  .lx-pillar:hover {
    background: rgba(255,255,255,0.05);
    border-color: rgba(59,130,246,0.2);
  }
  .lx-pillar-icon {
    width: 36px; height: 36px; border-radius: 9px;
    display: flex; align-items: center; justify-content: center;
    font-size: 17px; flex-shrink: 0;
  }
  .lx-pillar-icon.blue   { background: rgba(37,99,235,0.12); }
  .lx-pillar-icon.violet { background: rgba(139,92,246,0.12); }
  .lx-pillar-icon.green  { background: rgba(16,185,129,0.12); }
  .lx-pillar-title {
    font-size: 13px; font-weight: 600; color: #FFFFFF;
    margin-bottom: 2px;
  }
  .lx-pillar-desc { font-size: 12px; color: rgba(255,255,255,0.38); line-height: 1.45; }

  /* trust row */
  .lx-trust-row {
    display: flex; align-items: center; gap: 20px;
    padding-top: 32px; flex-wrap: wrap;
  }
  .lx-trust-item {
    font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.25);
    letter-spacing: 0.7px; text-transform: uppercase;
    display: flex; align-items: center; gap: 6px;
  }
  .lx-trust-item-dot {
    width: 4px; height: 4px; border-radius: 50%;
    background: #10B981; opacity: 0.5;
  }

  /* ── Right panel ── */
  .lx-right {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 32px 24px; position: relative;
    background: #06090F;
    transition: background 0.45s;
  }
  [data-theme="light"] .lx-right { background: #F8FAFC; }

  /* theme toggle */
  .lx-theme-btn {
    position: absolute; top: 24px; right: 24px;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 9px; width: 38px; height: 38px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: rgba(255,255,255,0.45);
    transition: all 0.2s;
  }
  .lx-theme-btn:hover {
    background: rgba(255,255,255,0.05);
    border-color: rgba(255,255,255,0.16);
    color: rgba(255,255,255,0.85);
  }
  [data-theme="light"] .lx-theme-btn {
    border-color: rgba(0,0,0,0.08); color: rgba(15,23,42,0.45);
  }
  [data-theme="light"] .lx-theme-btn:hover {
    background: rgba(0,0,0,0.04);
    border-color: rgba(0,0,0,0.14);
    color: #0F172A;
  }

  /* card — glassmorphism panel */
  .lx-card {
    width: 100%; max-width: 400px;
    display: flex; flex-direction: column; gap: 0;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 20px;
    padding: 32px;
    backdrop-filter: blur(20px) saturate(160%);
    -webkit-backdrop-filter: blur(20px) saturate(160%);
    box-shadow: 0 8px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05);
  }
  [data-theme="light"] .lx-card {
    background: rgba(255,255,255,0.55);
    border-color: rgba(15,23,42,0.08);
    box-shadow: 0 8px 40px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.6);
  }

  /* header */
  .lx-card-header { margin-bottom: 28px; }
  .lx-card-title {
    font-family: var(--font-serif);
    font-size: 26px; font-weight: 700; color: #FFFFFF;
    letter-spacing: -0.4px; margin-bottom: 6px;
    transition: color 0.4s;
  }
  [data-theme="light"] .lx-card-title { color: #0F172A; }
  .lx-card-sub {
    font-size: 14px; color: rgba(255,255,255,0.38);
    line-height: 1.5;
    transition: color 0.4s;
  }
  [data-theme="light"] .lx-card-sub { color: rgba(15,23,42,0.45); }

  /* tab switcher */
  .lx-tabs {
    display: flex; gap: 2px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px; padding: 3px;
    margin-bottom: 28px;
    transition: background 0.45s, border-color 0.45s;
  }
  [data-theme="light"] .lx-tabs { background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.07); }
  .lx-tab {
    flex: 1; padding: 8px; border-radius: 8px;
    font-size: 13.5px; font-weight: 600; cursor: pointer;
    border: none; background: transparent;
    color: rgba(255,255,255,0.36);
    transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
  }
  [data-theme="light"] .lx-tab { color: rgba(15,23,42,0.4); }
  .lx-tab.active {
    background: rgba(255,255,255,0.07);
    color: #FFFFFF;
    box-shadow: 0 1px 6px rgba(0,0,0,0.25);
  }
  [data-theme="light"] .lx-tab.active {
    background: #FFFFFF;
    color: #0F172A;
    box-shadow: 0 1px 6px rgba(0,0,0,0.08);
  }

  /* tab content cross-fade */
  .lx-tab-fade {
    animation: lx-tab-fade-in 0.5s ease-in-out;
  }
  @keyframes lx-tab-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* field */
  .lx-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
  .lx-field-row { display: flex; justify-content: space-between; align-items: center; }
  .lx-label {
    font-size: 12.5px; font-weight: 600;
    color: rgba(255,255,255,0.55); letter-spacing: 0.02em;
    transition: color 0.4s;
  }
  [data-theme="light"] .lx-label { color: rgba(15,23,42,0.58); }
  .lx-input-wrap { position: relative; }
  .lx-input-icon {
    position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
    color: rgba(255,255,255,0.2); pointer-events: none;
    transition: color 0.2s; z-index: 1;
  }
  [data-theme="light"] .lx-input-icon { color: rgba(15,23,42,0.22); }
  .lx-input-wrap:focus-within .lx-input-icon { color: #3B82F6; }
  .lx-input {
    width: 100%; box-sizing: border-box;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
    color: #FFFFFF;
    border-radius: 10px;
    padding: 12px 14px 12px 40px !important;
    font-size: 14px; outline: none;
    transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
    font-family: var(--font-sans);
  }
  [data-theme="light"] .lx-input {
    background: #FFFFFF; border-color: rgba(0,0,0,0.1); color: #0F172A;
  }
  .lx-input::placeholder { color: rgba(255,255,255,0.2); }
  [data-theme="light"] .lx-input::placeholder { color: rgba(15,23,42,0.25); }

  /* Chrome/Edge autofill: browser forces its own white-bg/black-text UA
     style, invisible against this dark glassmorphism card — override both
     the fill and the text color, per theme. The 5000s transition delay is
     the standard trick to stop it snapping back before our override paints. */
  .lx-input:-webkit-autofill,
  .lx-input:-webkit-autofill:hover,
  .lx-input:-webkit-autofill:focus {
    -webkit-text-fill-color: #FFFFFF;
    -webkit-box-shadow: 0 0 0 1000px #131a2b inset;
    box-shadow: 0 0 0 1000px #131a2b inset;
    caret-color: #FFFFFF;
    transition: background-color 5000s ease-in-out 0s;
  }
  [data-theme="light"] .lx-input:-webkit-autofill,
  [data-theme="light"] .lx-input:-webkit-autofill:hover,
  [data-theme="light"] .lx-input:-webkit-autofill:focus {
    -webkit-text-fill-color: #0F172A;
    -webkit-box-shadow: 0 0 0 1000px #FFFFFF inset;
    box-shadow: 0 0 0 1000px #FFFFFF inset;
    caret-color: #0F172A;
  }
  /* glowing focus border — glassmorphism accent */
  .lx-input:focus {
    border-color: rgba(59,130,246,0.7);
    box-shadow: 0 0 0 4px rgba(59,130,246,0.15), 0 0 18px rgba(59,130,246,0.35);
    background: rgba(255,255,255,0.06);
  }
  [data-theme="light"] .lx-input:focus {
    background: #FFFFFF;
    box-shadow: 0 0 0 4px rgba(59,130,246,0.14), 0 0 18px rgba(59,130,246,0.25);
  }

  /* eye toggle on password */
  .lx-eye-btn {
    position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.2); padding: 4px;
    transition: color 0.2s;
  }
  .lx-eye-btn:hover { color: rgba(255,255,255,0.5); }
  [data-theme="light"] .lx-eye-btn { color: rgba(15,23,42,0.25); }
  [data-theme="light"] .lx-eye-btn:hover { color: rgba(15,23,42,0.55); }

  /* forgot link */
  .lx-forgot {
    font-size: 12px; font-weight: 600;
    color: #3B82F6; cursor: pointer; background: none; border: none;
    padding: 0; transition: color 0.2s;
  }
  .lx-forgot:hover { color: #60A5FA; }

  /* error */
  .lx-error {
    display: flex; align-items: flex-start; gap: 9px;
    background: rgba(239,68,68,0.06);
    border: 1px solid rgba(239,68,68,0.18);
    border-left: 3px solid #EF4444;
    border-radius: 9px; padding: 11px 14px;
    font-size: 13px; color: #FCA5A5; line-height: 1.45;
    margin-bottom: 18px;
    animation: lx-slide-in 0.25s ease;
  }
  @keyframes lx-slide-in { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }

  /* CTA button */
  .lx-btn {
    width: 100%; padding: 13px;
    border-radius: 10px; border: none;
    font-size: 15px; font-weight: 600; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: all 0.25s cubic-bezier(0.4,0,0.2,1);
    margin-top: 6px;
    letter-spacing: 0.01em;
    position: relative; overflow: hidden;
  }
  .lx-btn::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(to bottom, rgba(255,255,255,0.06), transparent);
    pointer-events: none;
  }
  .lx-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none !important; }
  .lx-btn-signin {
    background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%);
    color: #FFFFFF;
    box-shadow: 0 4px 20px rgba(37,99,235,0.35);
  }
  .lx-btn-signin:hover:not(:disabled) {
    box-shadow: 0 6px 28px rgba(37,99,235,0.5);
    transform: translateY(-1px);
  }
  .lx-btn-register {
    background: rgba(255,255,255,0.05);
    color: #FFFFFF;
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: none;
  }
  .lx-btn-register:hover:not(:disabled) {
    background: rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.14);
    transform: translateY(-1px);
  }
  [data-theme="light"] .lx-btn-register {
    background: rgba(0,0,0,0.04); color: #0F172A;
    border-color: rgba(0,0,0,0.1);
  }
  [data-theme="light"] .lx-btn-register:hover:not(:disabled) {
    background: rgba(0,0,0,0.07); border-color: rgba(0,0,0,0.15);
  }

  /* spinner */
  .lx-spinner {
    width: 16px; height: 16px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.25);
    border-top-color: #FFFFFF;
    animation: lx-spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes lx-spin { to { transform: rotate(360deg); } }

  /* divider */
  .lx-divider {
    display: flex; align-items: center; gap: 12px;
    margin: 22px 0; color: rgba(255,255,255,0.12);
    font-size: 11.5px; font-weight: 600; letter-spacing: 0.05em;
    text-transform: uppercase;
    transition: color 0.4s;
  }
  [data-theme="light"] .lx-divider { color: rgba(0,0,0,0.12); }
  .lx-divider::before,.lx-divider::after {
    content:''; flex:1; height:1px;
    background: rgba(255,255,255,0.06);
    transition: background 0.45s;
  }
  [data-theme="light"] .lx-divider::before,
  [data-theme="light"] .lx-divider::after { background: rgba(0,0,0,0.07); }

  /* SSO row */
  .lx-sso-row { display: flex; flex-direction: column; gap: 10px; }
  .lx-sso-btn {
    width: 100%; box-sizing: border-box;
    display: flex; align-items: center; justify-content: center; gap: 10px;
    padding: 11px; border-radius: 10px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    color: #FFFFFF; text-decoration: none;
    font-size: 13.5px; font-weight: 600;
    transition: all 0.2s;
  }
  .lx-sso-btn:hover {
    background: rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.16);
    transform: translateY(-1px);
  }
  [data-theme="light"] .lx-sso-btn {
    background: #FFFFFF; color: #0F172A; border-color: rgba(0,0,0,0.1);
  }
  [data-theme="light"] .lx-sso-btn:hover { background: rgba(0,0,0,0.03); }

  /* footer link */
  .lx-footer-link {
    text-align: center; margin-top: 28px;
    font-size: 13px;
  }
  .lx-footer-link a {
    color: rgba(255,255,255,0.3); text-decoration: none;
    display: inline-flex; align-items: center; gap: 5px;
    transition: color 0.2s;
  }
  .lx-footer-link a:hover { color: rgba(255,255,255,0.6); }
  [data-theme="light"] .lx-footer-link a { color: rgba(15,23,42,0.35); }
  [data-theme="light"] .lx-footer-link a:hover { color: rgba(15,23,42,0.7); }

  /* ── VERIFY BANNER ── */
  .lx-verify {
    display: flex; align-items: flex-start; gap: 11px;
    background: rgba(16,185,129,0.06);
    border: 1px solid rgba(16,185,129,0.2);
    border-left: 3px solid #10B981;
    border-radius: 9px; padding: 12px 14px;
    margin-bottom: 20px;
    animation: lx-slide-in 0.3s ease;
  }
  .lx-verify-title { font-size: 13px; font-weight: 600; color: #6EE7B7; margin-bottom: 2px; }
  .lx-verify-body  { font-size: 12px; color: rgba(255,255,255,0.38); line-height: 1.5; }
  .lx-verify-badge {
    display: inline-block; margin-top: 5px;
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: #FCD34D; background: rgba(245,158,11,0.1);
    border: 1px solid rgba(245,158,11,0.2); border-radius: 4px; padding: 2px 6px;
  }

  /* ── RESET MODAL ── */
  .lx-modal-overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.75); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center; padding: 20px;
    animation: lx-fade 0.2s ease;
  }
  @keyframes lx-fade { from { opacity:0; } to { opacity:1; } }
  .lx-modal {
    width: 100%; max-width: 420px;
    background: #0E1420;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 16px; padding: 30px;
    box-shadow: 0 32px 80px rgba(0,0,0,0.6);
    animation: lx-pop 0.25s cubic-bezier(0.16,1,0.3,1);
    position: relative;
  }
  [data-theme="light"] .lx-modal { background: #FFFFFF; border-color: rgba(0,0,0,0.08); }
  @keyframes lx-pop { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:none; } }
  .lx-modal-close {
    position: absolute; top: 14px; right: 14px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
    border-radius: 7px; width: 30px; height: 30px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: rgba(255,255,255,0.4);
    font-size: 17px; line-height: 1; transition: all 0.2s;
  }
  .lx-modal-close:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.8); }
  [data-theme="light"] .lx-modal-close { background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.07); color: rgba(15,23,42,0.4); }
  [data-theme="light"] .lx-modal-close:hover { background: rgba(0,0,0,0.08); color: #0F172A; }
  .lx-modal-title {
    font-family: var(--font-serif); font-size: 20px; font-weight: 700;
    color: #FFFFFF; margin-bottom: 6px; transition: color 0.4s;
  }
  [data-theme="light"] .lx-modal-title { color: #0F172A; }
  .lx-modal-sub { font-size: 13.5px; color: rgba(255,255,255,0.4); line-height: 1.55; margin-bottom: 22px; transition: color 0.4s; }
  [data-theme="light"] .lx-modal-sub { color: rgba(15,23,42,0.5); }
  .lx-modal-note { font-size: 11.5px; color: rgba(255,255,255,0.2); text-align: center; margin-top: 14px; line-height: 1.5; transition: color 0.4s; }
  [data-theme="light"] .lx-modal-note { color: rgba(15,23,42,0.3); }

  /* ── TOAST ── */
  .lx-toast {
    position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
    z-index: 1100; display: flex; align-items: center; gap: 10px;
    padding: 13px 20px; border-radius: 11px;
    font-size: 13.5px; font-weight: 500;
    box-shadow: 0 16px 48px rgba(0,0,0,0.4);
    animation: lx-toast-in 0.3s cubic-bezier(0.16,1,0.3,1);
    max-width: 460px; white-space: nowrap;
  }
  @keyframes lx-toast-in {
    from { opacity:0; transform:translateX(-50%) translateY(14px); }
    to   { opacity:1; transform:translateX(-50%) translateY(0); }
  }
  .lx-toast--success { background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.25); color:#6EE7B7; }
  .lx-toast--error   { background:rgba(239,68,68,0.1);  border:1px solid rgba(239,68,68,0.25);  color:#FCA5A5; }
`;

const PILLARS = [
  {
    icon: '⚖️',
    cls: 'blue',
    title: 'Contract Risk Analyzer',
    desc: 'AI flags every liability clause in under 2 minutes. Rule book enforced.',
  },
  {
    icon: '🤖',
    cls: 'violet',
    title: 'InzIQ AI Command Suite',
    desc: 'Voice-activated. Query your entire case database in real time.',
  },
  {
    icon: '🔒',
    cls: 'green',
    title: 'Sovereign Data Vault',
    desc: 'AES-256, Indian data residency. Zero-retention protocol — always.',
  },
];

export default function LoginPage() {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const resetToken = searchParams.get('resetToken');

  const [tab, setTab] = useState('signin'); // 'signin' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot-password modal has two modes: 'request' (enter email) and
  // 'confirm' (set a new password) — 'confirm' opens automatically when
  // the page loads with ?resetToken=... from the emailed link.
  const [showResetModal, setShowResetModal] = useState(Boolean(resetToken));
  const [resetMode, setResetMode] = useState(resetToken ? 'confirm' : 'request');
  const [resetEmail, setResetEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // SSO redirects back here with ?sso_error=... (see routes/sso_routes.py's
  // _sso_redirect_with_error) when a provider is unconfigured or the OAuth
  // exchange itself failed — the click on "Continue with Google" is a real
  // top-level navigation (must be, for the OAuth consent redirect chain to
  // work), so this is the only way the backend can hand an error back to a
  // React state instead of leaving the browser on a bare JSON response.
  useEffect(() => {
    const ssoError = searchParams.get('sso_error');
    if (!ssoError) return;
    const provider = searchParams.get('provider') || 'This sign-in method';
    const detail = searchParams.get('detail');
    const message = ssoError === 'unavailable'
      ? `${provider} sign-in is temporarily unavailable. Please log in with email/password.`
      : ssoError === 'no_email'
      ? `${provider} did not share an email address — this account can't be created.`
      : `${provider} sign-in failed. Please try again or use email/password.`;
    setToast({ type: 'error', message: detail || message });
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('sso_error'); next.delete('provider'); next.delete('detail');
      return next;
    }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // clear errors when switching tabs
  useEffect(() => { setError(''); }, [tab]);

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const openResetModal = () => { setResetMode('request'); setResetEmail(email || ''); setShowResetModal(true); };
  const closeResetModal = () => {
    setShowResetModal(false);
    if (resetToken) {
      searchParams.delete('resetToken');
      setSearchParams(searchParams, { replace: true });
    }
  };

  // Step 1: request a reset link — generic response either way (backend
  // never reveals whether the email has an account).
  const handlePasswordReset = async (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(resetEmail.trim())) {
      setToast({ type: 'error', message: 'Please enter a valid email address.' });
      return;
    }
    setResetLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim(), frontend_origin: window.location.origin }),
      });
      const data = await res.json().catch(() => ({}));
      setShowResetModal(false);
      setToast({ type: 'success', message: data.message || 'If an account exists for that email, a reset link has been sent.' });
    } catch {
      // Same generic message on a network error too — never let failure
      // modes leak information the success path doesn't.
      setShowResetModal(false);
      setToast({ type: 'success', message: 'If an account exists for that email, a reset link has been sent.' });
    } finally {
      setResetLoading(false);
    }
  };

  // Step 2: consume the token from the emailed link and set a new password.
  const handleResetConfirm = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setToast({ type: 'error', message: 'Password must be at least 8 characters.' });
      return;
    }
    setResetLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'This reset link is invalid or has expired.');
      closeResetModal();
      setNewPassword('');
      setTab('signin');
      setToast({ type: 'success', message: 'Password updated. Sign in with your new password.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setResetLoading(false);
    }
  };

  // Cookies are set by the browser directly from the Set-Cookie response
  // header (via the global credentials:'include' fetch patch) — there is
  // no token in `data` to store. Register logs straight in, same as login,
  // for a zero-friction single step (no separate email-verification hop).
  const handleRegister = async (e) => {
    e.preventDefault();
    if (!email || !password) return setError('Email and password are required.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      // Same HTML-error-page guard as handleLogin above.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error ||
          (res.status >= 500 ? 'Server error. Please try again shortly.' : 'Registration failed.')
        );
      }
      navigate('/dashboard');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return setError('Email and password are required.');
    setLoading(true); setError('');
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ email, password }),
      });
      // A 500/502 error page is HTML, not JSON — res.json() would throw
      // "JSON.parse: unexpected character…" straight into the UI as the
      // error message. .catch(() => ({})) makes that a clean {} instead,
      // same defensive pattern already used by handlePasswordReset/
      // handleResetConfirm below.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error || data.message ||
          (res.status >= 500 ? 'Server error. Please try again shortly.' : 'Invalid credentials.')
        );
      }
      navigate('/dashboard');
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Authentication server is slow to respond (possibly waking from sleep). Please try again in a moment.');
      } else {
        setError(err.message);
      }
    } finally { clearTimeout(tid); setLoading(false); }
  };

  const isSignIn = tab === 'signin';

  return (
    <div className="lx-login" data-theme={theme}>
      <style>{loginStyles}</style>

      {/* ═══════════════════ LEFT PANEL ═══════════════════ */}
      <div className="lx-left">
        <div className="lx-left-grid" />
        <div className="lx-orb lx-orb-1" />
        <div className="lx-orb lx-orb-2" />
        <div className="lx-orb lx-orb-3" />

        <div className="lx-left-inner">
          {/* Brand */}
          <div className="lx-brand">
            <LexLogoMark size={30} />
            <span className="lx-brand-name">LexAmplify</span>
          </div>

          {/* Hero */}
          <div className="lx-hero">
            <div className="lx-hero-badge">
              <span className="lx-badge-dot" />
              Sovereign Legal Intelligence
            </div>
            <h1 className="lx-hero-h">
              The intelligence<br />behind <em>elite</em><br />Indian counsel.
            </h1>
            <p className="lx-hero-sub">
              Contract AI, case intelligence, and voice-driven research — built exclusively for Indian advocates.
            </p>

            <div className="lx-pillars">
              {PILLARS.map(({ icon, cls, title, desc }) => (
                <div key={title} className="lx-pillar">
                  <div className={`lx-pillar-icon ${cls}`}>{icon}</div>
                  <div>
                    <div className="lx-pillar-title">{title}</div>
                    <div className="lx-pillar-desc">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Trust row */}
          <div className="lx-trust-row">
            {['AES-256 Encrypted', 'Indian Data Residency', 'Zero Retention'].map((t) => (
              <div key={t} className="lx-trust-item">
                <span className="lx-trust-item-dot" />
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════ RIGHT PANEL ═══════════════════ */}
      <div className="lx-right">
        {/* Theme toggle */}
        <button
          className="lx-theme-btn"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="5"/>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          ) : (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>

        <div className="lx-card">
          {/* Header */}
          <div className="lx-card-header">
            <div className="lx-card-title">{isSignIn ? 'Welcome back.' : 'Create your account.'}</div>
            <div className="lx-card-sub">
              {isSignIn
                ? 'Sign in to access your advocate console.'
                : 'Join 380+ Indian law firms on LexAmplify.'}
            </div>
          </div>

          {/* Tabs */}
          <div className="lx-tabs" role="tablist">
            <button
              role="tab"
              className={`lx-tab ${tab === 'signin' ? 'active' : ''}`}
              onClick={() => setTab('signin')}
            >
              Sign In
            </button>
            <button
              role="tab"
              className={`lx-tab ${tab === 'register' ? 'active' : ''}`}
              onClick={() => setTab('register')}
            >
              Create Account
            </button>
          </div>

          <form key={tab} className="lx-tab-fade" onSubmit={(e) => e.preventDefault()}>
            {/* Error */}
            {error && (
              <div className="lx-error">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            {/* Email — standard stacked label above input. No floating-label
                pseudo-class trickery: label and input are two plain,
                independent DOM siblings, permanently in their final
                position, wired together with htmlFor/id like any other
                form field. Nothing here can "desync" because nothing here
                derives its state from anything except its own value prop. */}
            <div className="lx-field">
              <label htmlFor="login-email" className="lx-label">Email address</label>
              <div className="lx-input-wrap">
                <span className="lx-input-icon">
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                </span>
                <input
                  id="login-email"
                  type="email"
                  className="lx-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  disabled={loading}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            {/* Password — same stacked layout */}
            <div className="lx-field" style={{ marginBottom: isSignIn ? '8px' : '20px' }}>
              <div className="lx-field-row">
                <label htmlFor="login-password" className="lx-label">Password</label>
                {isSignIn && (
                  <button type="button" className="lx-forgot" onClick={openResetModal} tabIndex={0}>
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="lx-input-wrap">
                <span className="lx-input-icon">
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </span>
                <input
                  id="login-password"
                  type={showPwd ? 'text' : 'password'}
                  className="lx-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  disabled={loading}
                  autoComplete={isSignIn ? 'current-password' : 'new-password'}
                  style={{ paddingRight: '42px' }}
                  required
                />
                <button
                  type="button"
                  className="lx-eye-btn"
                  onClick={() => setShowPwd((p) => !p)}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPwd ? (
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* CTA */}
            {isSignIn ? (
              <button
                type="button"
                className="lx-btn lx-btn-signin"
                onClick={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <><span className="lx-spinner" /> Authenticating…</>
                ) : (
                  <>Sign In
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/>
                    </svg>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="lx-btn lx-btn-signin"
                onClick={handleRegister}
                disabled={loading}
              >
                {loading ? (
                  <><span className="lx-spinner" /> Creating account…</>
                ) : 'Create Advocate Account'}
              </button>
            )}
          </form>

          {/* SSO */}
          <div className="lx-divider">Or continue with</div>
          <div className="lx-sso-row">
            <a className="lx-sso-btn" href={`${API_BASE_URL}/api/auth/sso/google/login`}>
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.89c2.28-2.1 3.56-5.19 3.56-8.82z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.89-3c-1.08.73-2.46 1.16-4.04 1.16-3.1 0-5.73-2.1-6.67-4.92H1.3v3.09A12 12 0 0 0 12 24z"/>
                <path fill="#FBBC05" d="M5.33 14.33A7.2 7.2 0 0 1 4.95 12c0-.81.14-1.6.38-2.33V6.58H1.3A12 12 0 0 0 0 12c0 1.94.46 3.77 1.3 5.42z"/>
                <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.59 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0A12 12 0 0 0 1.3 6.58l4.03 3.09C6.27 6.86 8.9 4.77 12 4.77z"/>
              </svg>
              Continue with Google
            </a>
          </div>

          {/* Footer */}
          <div className="lx-footer-link">
            <Link to="/">
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
              </svg>
              Return to public website
            </Link>
          </div>
        </div>
      </div>

      {/* ═══════════════════ FORGOT / RESET PASSWORD MODAL ═══════════════════ */}
      {showResetModal && resetMode === 'request' && (
        <div className="lx-modal-overlay" onClick={closeResetModal}>
          <div className="lx-modal" onClick={(e) => e.stopPropagation()}>
            <button className="lx-modal-close" onClick={closeResetModal} aria-label="Close">×</button>
            <div className="lx-modal-title">Reset your password</div>
            <div className="lx-modal-sub">
              Enter the email tied to your advocate console and we'll send a secure reset link.
            </div>
            <form onSubmit={handlePasswordReset}>
              <div className="lx-field">
                <label className="lx-label">Email address</label>
                <div className="lx-input-wrap">
                  <span className="lx-input-icon">
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                  </span>
                  <input
                    type="email"
                    className="lx-input"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="advocate@lexamplify.in"
                    autoFocus
                    disabled={resetLoading}
                  />
                </div>
              </div>
              <button
                type="submit"
                className="lx-btn lx-btn-signin"
                style={{ marginTop: '8px' }}
                disabled={resetLoading}
              >
                {resetLoading ? <><span className="lx-spinner" /> Sending…</> : 'Send reset link'}
              </button>
            </form>
            <div className="lx-modal-note">
              For your security, we'll show the same message whether or not an account exists for that email.
            </div>
          </div>
        </div>
      )}

      {showResetModal && resetMode === 'confirm' && (
        <div className="lx-modal-overlay" onClick={closeResetModal}>
          <div className="lx-modal" onClick={(e) => e.stopPropagation()}>
            <button className="lx-modal-close" onClick={closeResetModal} aria-label="Close">×</button>
            <div className="lx-modal-title">Set a new password</div>
            <div className="lx-modal-sub">Choose a new password for your advocate console.</div>
            <form onSubmit={handleResetConfirm}>
              <div className="lx-field">
                <label className="lx-label">New password</label>
                <div className="lx-input-wrap">
                  <span className="lx-input-icon">
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </span>
                  <input
                    type="password"
                    className="lx-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoFocus
                    disabled={resetLoading}
                  />
                </div>
              </div>
              <button
                type="submit"
                className="lx-btn lx-btn-signin"
                style={{ marginTop: '8px' }}
                disabled={resetLoading}
              >
                {resetLoading ? <><span className="lx-spinner" /> Updating…</> : 'Update password'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════ TOAST ═══════════════════ */}
      {toast && (
        <div className={`lx-toast lx-toast--${toast.type}`}>
          <span>{toast.type === 'success' ? '✅' : '⚠️'}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
