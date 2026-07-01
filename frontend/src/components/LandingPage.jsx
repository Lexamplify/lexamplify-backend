import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import LandingNavbar from './LandingNavbar';

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────
const landingStyles = `
  /* ── Base ── */
  .lp {
    background-color: #080B12;
    color: #F3F4F6;
    min-height: 100vh;
    font-family: var(--font-sans);
    overflow-x: hidden;
    position: relative;
    transition: background-color 0.45s ease, color 0.45s ease;
  }
  [data-theme="light"] .lp {
    background-color: #F8FAFC;
    color: #0F172A;
  }

  /* ── Scroll reveal ── */
  .sr {
    opacity: 0;
    transform: translateY(22px);
    transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1),
                transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .sr.visible { opacity: 1; transform: translateY(0); }
  .sr.d1 { transition-delay: 0.08s; }
  .sr.d2 { transition-delay: 0.16s; }
  .sr.d3 { transition-delay: 0.24s; }
  .sr.d4 { transition-delay: 0.32s; }
  .sr.d5 { transition-delay: 0.40s; }
  .sr.d6 { transition-delay: 0.48s; }

  /* ── Glow orbs ── */
  .glow-orb {
    position: absolute; border-radius: 50%;
    filter: blur(120px); pointer-events: none; z-index: 0;
  }
  .glow-orb-1 { width:700px; height:700px; background:radial-gradient(circle,rgba(59,130,246,0.18) 0%,transparent 70%); top:-15%; right:-10%; }
  .glow-orb-2 { width:500px; height:500px; background:radial-gradient(circle,rgba(139,92,246,0.14) 0%,transparent 70%); bottom:5%; left:-8%; }
  .glow-orb-3 { width:600px; height:600px; background:radial-gradient(circle,rgba(16,185,129,0.1) 0%,transparent 70%); top:45%; right:15%; }
  [data-theme="light"] .glow-orb { filter: blur(120px); }
  [data-theme="light"] .glow-orb-1 { background: radial-gradient(circle,rgba(59,130,246,0.07) 0%,transparent 70%); }
  [data-theme="light"] .glow-orb-2 { background: radial-gradient(circle,rgba(139,92,246,0.05) 0%,transparent 70%); }
  [data-theme="light"] .glow-orb-3 { background: radial-gradient(circle,rgba(16,185,129,0.04) 0%,transparent 70%); }

  /* ── Section utilities ── */
  .lp-section { padding: 96px 24px; position: relative; }
  .lp-inner { max-width: 1200px; margin: 0 auto; }
  .lp-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 13px; border-radius: 30px;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
    font-size: 10.5px; font-weight: 700; color: #6B7280;
    letter-spacing: 1.3px; text-transform: uppercase;
    margin-bottom: 14px;
    transition: background 0.4s, border-color 0.4s, color 0.4s;
  }
  [data-theme="light"] .lp-badge { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.07); color: #64748B; }
  .lp-section-title {
    font-family: var(--font-serif);
    font-size: clamp(1.85rem, 3.5vw, 2.6rem);
    text-align: center; color: #FFFFFF;
    margin-bottom: 10px; letter-spacing: -0.5px;
    transition: color 0.4s;
  }
  [data-theme="light"] .lp-section-title { color: #0F172A; }
  .lp-section-sub {
    font-size: 16px; color: #9CA3AF; text-align: center;
    margin-bottom: 56px; line-height: 1.65;
    transition: color 0.4s;
  }
  [data-theme="light"] .lp-section-sub { color: #475569; }

  /* ── Hero ── */
  .hero-wrap {
    padding: 128px 24px 88px;
    position: relative; overflow: hidden;
  }
  .hero-grid {
    display: grid; grid-template-columns: 1.15fr 1fr;
    gap: 64px; align-items: center;
    max-width: 1200px; margin: 0 auto; position: relative; z-index: 1;
  }
  @media (max-width: 968px) {
    .hero-grid { grid-template-columns: 1fr; text-align: center; gap: 44px; }
    .hero-btns { justify-content: center; }
    .hero-p { margin-left: auto; margin-right: auto; }
  }
  .hero-eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 14px; border-radius: 30px;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
    font-size: 11px; font-weight: 700; color: #9CA3AF;
    letter-spacing: 1.3px; text-transform: uppercase; margin-bottom: 24px;
    transition: background 0.4s, border-color 0.4s;
  }
  [data-theme="light"] .hero-eyebrow { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.07); color: #64748B; }
  .hero-h1 {
    font-family: var(--font-serif);
    font-size: clamp(2.6rem, 5.5vw, 4.1rem);
    line-height: 1.12; margin-bottom: 22px;
    letter-spacing: -1px; font-weight: 700; color: #FFFFFF;
    transition: color 0.4s;
  }
  [data-theme="light"] .hero-h1 { color: #0F172A; }
  .hero-h1 em { font-style: normal; color: #3B82F6; }
  .hero-p {
    font-size: 18px; color: #9CA3AF; line-height: 1.65;
    margin-bottom: 38px; max-width: 560px;
    transition: color 0.4s;
  }
  [data-theme="light"] .hero-p { color: #475569; }
  .hero-btns { display: flex; gap: 14px; flex-wrap: wrap; }
  .btn-primary {
    background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%);
    color: #FFFFFF; font-weight: 600; border: none;
    border-radius: 9px; padding: 13px 28px; font-size: 15px;
    cursor: pointer; text-decoration: none;
    display: inline-flex; align-items: center; gap: 8px;
    box-shadow: 0 4px 22px rgba(37,99,235,0.32);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(37,99,235,0.46); }
  .btn-secondary {
    background: rgba(255,255,255,0.03); color: #FFFFFF;
    border: 1px solid rgba(255,255,255,0.09); font-weight: 500;
    border-radius: 9px; padding: 13px 28px; font-size: 15px;
    cursor: pointer; text-decoration: none;
    display: inline-flex; align-items: center; gap: 8px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .btn-secondary:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.16); transform: translateY(-2px); }
  [data-theme="light"] .btn-secondary { background: rgba(0,0,0,0.03); color: #0F172A; border-color: rgba(0,0,0,0.09); }
  [data-theme="light"] .btn-secondary:hover { background: rgba(0,0,0,0.06); border-color: rgba(0,0,0,0.15); }

  /* ── Terminal mockup ── */
  .lp-terminal {
    background: rgba(14, 18, 28, 0.7);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 14px;
    box-shadow: 0 32px 64px rgba(0,0,0,0.55);
    overflow: hidden; width: 100%; max-width: 500px;
    margin: 0 auto; font-family: monospace; font-size: 13px;
    animation: terminal-float 6s ease-in-out infinite;
    transition: background 0.45s, border-color 0.45s, box-shadow 0.45s;
  }
  @keyframes terminal-float {
    0%, 100% { transform: translateY(0); }
    50%       { transform: translateY(-10px); }
  }
  [data-theme="light"] .lp-terminal {
    background: rgba(255,255,255,0.85);
    border-color: rgba(0,0,0,0.07);
    box-shadow: 0 24px 48px rgba(0,0,0,0.1);
  }
  .term-topbar {
    background: rgba(8,11,18,0.6); border-bottom: 1px solid rgba(255,255,255,0.05);
    padding: 11px 16px; display: flex; justify-content: space-between; align-items: center;
    transition: background 0.45s, border-color 0.45s;
  }
  [data-theme="light"] .term-topbar { background: rgba(0,0,0,0.03); border-bottom-color: rgba(0,0,0,0.06); }
  .term-dots { display: flex; gap: 6px; }
  .term-dot { width: 8px; height: 8px; border-radius: 50%; }
  .term-title { color: #6B7280; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; }
  .term-status { color: #10B981; font-size: 10px; font-weight: 700; display: flex; align-items: center; gap: 5px; }
  .term-pulse {
    width: 6px; height: 6px; border-radius: 50%;
    background: #10B981; box-shadow: 0 0 6px #10B981;
    animation: lp-pulse 2s infinite alternate;
  }
  @keyframes lp-pulse { 0% { opacity: 0.4; } 100% { opacity: 1; } }
  .term-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
  .term-msg-meta { font-size: 10px; text-transform: uppercase; color: #4B5563; font-weight: 700; margin-bottom: 4px; }
  .term-user-text {
    color: #E2E8F0; background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.04);
    padding: 10px 12px; border-radius: 7px; line-height: 1.5;
    transition: background 0.45s, border-color 0.45s, color 0.45s;
  }
  [data-theme="light"] .term-user-text { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.05); color: #1E293B; }
  .term-ai-text { color: #3B82F6; padding: 0 4px; line-height: 1.55; }
  .term-output {
    background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.03);
    border-radius: 7px; padding: 12px;
    transition: background 0.45s, border-color 0.45s;
  }
  [data-theme="light"] .term-output { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.05); }
  .term-output-hdr {
    font-size: 9px; text-transform: uppercase; color: #4B5563;
    margin-bottom: 6px; padding-bottom: 4px;
    border-bottom: 1px dashed rgba(255,255,255,0.05);
  }
  .term-output-pre { color: #9CA3AF; font-size: 11.5px; line-height: 1.55; margin: 0; white-space: pre-wrap; }
  [data-theme="light"] .term-output-pre { color: #475569; }
  .term-cursor { border-right: 2px solid #3B82F6; animation: lp-blink 0.75s step-end infinite; }
  @keyframes lp-blink { from,to { border-color: transparent } 50% { border-color: #3B82F6 } }

  /* ── Features bento ── */
  .bento {
    display: grid; grid-template-columns: repeat(3, 1fr);
    grid-auto-rows: auto; gap: 20px;
  }
  .bc {
    background: rgba(14,18,28,0.55);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 16px; padding: 30px;
    position: relative; overflow: hidden;
    display: flex; flex-direction: column;
    transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
  }
  .bc:hover {
    transform: translateY(-4px);
    border-color: rgba(59,130,246,0.28);
    box-shadow: 0 16px 36px rgba(59,130,246,0.1);
  }
  [data-theme="light"] .bc {
    background: rgba(255,255,255,0.82);
    border-color: rgba(0,0,0,0.06);
  }
  [data-theme="light"] .bc:hover {
    border-color: rgba(59,130,246,0.3);
    box-shadow: 0 12px 30px rgba(59,130,246,0.07);
  }
  .bc--lg { grid-column: span 2; }
  .bc--sm { grid-column: span 1; }
  .bc--fw { grid-column: span 3; }
  .bc-glow {
    position: absolute; width: 240px; height: 240px;
    background: radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%);
    top: -60px; right: -60px; pointer-events: none; z-index: 0;
  }
  .bc-tag {
    font-size: 10px; text-transform: uppercase; letter-spacing: 1.1px;
    color: #4B5563; font-weight: 700; margin-bottom: 7px; display: block;
    transition: color 0.4s;
  }
  [data-theme="light"] .bc-tag { color: #64748B; }
  .bc-title {
    font-family: var(--font-serif);
    font-size: 22px; color: #FFFFFF; margin-bottom: 10px;
    line-height: 1.25; position: relative; z-index: 1;
    transition: color 0.4s;
  }
  [data-theme="light"] .bc-title { color: #0F172A; }
  .bc-desc {
    font-size: 13.5px; color: #9CA3AF; line-height: 1.65;
    margin-bottom: 22px; position: relative; z-index: 1;
    transition: color 0.4s;
  }
  [data-theme="light"] .bc-desc { color: #475569; }
  .bc-content { position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; }
  .bc-footer { position: relative; z-index: 1; margin-top: auto; padding-top: 18px; }
  .bc-link {
    font-size: 13px; font-weight: 600; color: #3B82F6;
    text-decoration: none; transition: color 0.2s;
  }
  .bc-link:hover { color: #2563EB; }

  /* Bento mini mockups */
  .mini-box {
    background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.03);
    border-radius: 9px; padding: 14px; font-size: 12px;
    margin-bottom: 16px;
    transition: background 0.45s, border-color 0.45s;
  }
  [data-theme="light"] .mini-box { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.05); }
  .risk-pill {
    font-size: 9px; padding: 2px 7px; border-radius: 4px;
    font-weight: 700; width: fit-content; margin-bottom: 7px;
  }
  .risk-pill.red { background: rgba(239,68,68,0.12); color: #EF4444; }
  .risk-pill.amber { background: rgba(245,158,11,0.12); color: #F59E0B; }
  .risk-pill.green { background: rgba(16,185,129,0.12); color: #10B981; }
  .mini-clause-title { color: #FFFFFF; font-weight: 600; margin-bottom: 4px; transition: color 0.4s; }
  [data-theme="light"] .mini-clause-title { color: #0F172A; }
  .mini-clause-text { color: #6B7280; font-style: italic; margin: 0 0 6px; }
  .mini-clause-sug { color: #10B981; font-size: 11.5px; }
  .mini-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; border-radius: 7px;
    background: rgba(0,0,0,0.18); margin-bottom: 7px; font-size: 12px;
    transition: background 0.45s;
  }
  [data-theme="light"] .mini-row { background: rgba(0,0,0,0.03); }
  .mini-row:last-child { margin-bottom: 0; }
  .mini-row-label { color: #D1D5DB; transition: color 0.4s; }
  [data-theme="light"] .mini-row-label { color: #1E293B; }
  .status-tag {
    font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
  }
  .status-tag.conflict { background: rgba(239,68,68,0.12); color: #EF4444; }
  .status-tag.warn     { background: rgba(245,158,11,0.12); color: #F59E0B; }
  .status-tag.ok       { background: rgba(16,185,129,0.12); color: #10B981; }
  .mini-term {
    background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.03);
    border-radius: 8px; padding: 14px; font-family: monospace; font-size: 12px;
    transition: background 0.45s, border-color 0.45s;
  }
  [data-theme="light"] .mini-term { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.05); }
  .mini-term-line { color: #9CA3AF; margin-bottom: 5px; }
  .mini-term-line.ok { color: #10B981; margin-bottom: 0; }
  .mini-term-prompt { color: #3B82F6; margin-right: 7px; }
  .cal-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 7px; margin-bottom: 10px; }
  .cal-item {
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05);
    border-radius: 7px; padding: 9px 8px; text-align: center;
    transition: background 0.45s, border-color 0.45s;
  }
  [data-theme="light"] .cal-item { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.05); }
  .cal-item.urgent { border-color: rgba(239,68,68,0.35); background: rgba(239,68,68,0.06); }
  .cal-item.soon   { border-color: rgba(245,158,11,0.35); background: rgba(245,158,11,0.06); }
  .cal-date { font-size: 18px; font-weight: 700; color: #FFFFFF; line-height: 1; transition: color 0.4s; }
  [data-theme="light"] .cal-date { color: #0F172A; }
  .cal-label { font-size: 9.5px; color: #6B7280; margin-top: 3px; }
  .cal-badge { font-size: 9px; font-weight: 700; margin-top: 4px; }
  .cal-badge.urgent { color: #EF4444; }
  .cal-badge.soon   { color: #F59E0B; }
  .wr-step {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px; border-radius: 8px;
    background: rgba(255,255,255,0.02); margin-bottom: 8px;
    transition: background 0.45s;
  }
  [data-theme="light"] .wr-step { background: rgba(0,0,0,0.02); }
  .wr-step:last-child { margin-bottom: 0; }
  .wr-step-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
  .wr-step-text { font-size: 12px; color: #9CA3AF; line-height: 1.5; transition: color 0.4s; }
  [data-theme="light"] .wr-step-text { color: #475569; }
  .wr-step-title { font-size: 12.5px; font-weight: 600; color: #E2E8F0; margin-bottom: 2px; transition: color 0.4s; }
  [data-theme="light"] .wr-step-title { color: #1E293B; }
  .vault-row {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 12px; border-radius: 8px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.03);
    margin-bottom: 8px; transition: background 0.45s, border-color 0.45s;
  }
  [data-theme="light"] .vault-row { background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.04); }
  .vault-row:last-child { margin-bottom: 0; }
  .vault-icon { font-size: 16px; flex-shrink: 0; }
  .vault-name { font-size: 12.5px; color: #D1D5DB; flex: 1; transition: color 0.4s; }
  [data-theme="light"] .vault-name { color: #1E293B; }
  .vault-size { font-size: 10.5px; color: #4B5563; }
  .inziq-cmd {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 12px; border-radius: 8px;
    background: rgba(139,92,246,0.06);
    border: 1px solid rgba(139,92,246,0.12);
    margin-bottom: 7px; font-size: 12px;
    transition: background 0.45s, border-color 0.45s;
  }
  [data-theme="light"] .inziq-cmd { background: rgba(139,92,246,0.05); border-color: rgba(139,92,246,0.12); }
  .inziq-cmd:last-child { margin-bottom: 0; }
  .inziq-mic { font-size: 14px; }
  .inziq-text { color: #C4B5FD; }
  .inziq-arrow { margin-left: auto; color: #6B7280; font-size: 11px; }

  /* Bento row flex layouts */
  .bc-flex { display: flex; gap: 36px; align-items: flex-start; }
  .bc-flex-l { flex: 1.1; display: flex; flex-direction: column; }
  .bc-flex-r { flex: 1; }
  @media (max-width: 768px) {
    .bc-flex { flex-direction: column; gap: 20px; }
    .bento { grid-template-columns: 1fr !important; }
    .bc--lg, .bc--fw { grid-column: span 1 !important; }
  }

  /* ── How it works ── */
  .workflow-steps {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px;
    position: relative;
  }
  .workflow-steps::before {
    content: ''; position: absolute;
    top: 32px; left: calc(16.66% + 16px); right: calc(16.66% + 16px);
    height: 1px; background: rgba(255,255,255,0.07);
    pointer-events: none;
  }
  [data-theme="light"] .workflow-steps::before { background: rgba(0,0,0,0.06); }
  .wf-step {
    position: relative; text-align: center; padding-top: 0;
    display: flex; flex-direction: column; align-items: center;
  }
  .wf-num {
    width: 64px; height: 64px; border-radius: 50%;
    background: rgba(14,18,28,0.8);
    border: 1px solid rgba(255,255,255,0.08);
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; font-weight: 700; color: #3B82F6;
    font-family: var(--font-serif);
    margin-bottom: 20px; position: relative; z-index: 1;
    transition: background 0.45s, border-color 0.45s;
  }
  [data-theme="light"] .wf-num { background: rgba(255,255,255,0.9); border-color: rgba(0,0,0,0.08); }
  .wf-title {
    font-size: 18px; font-weight: 700; color: #FFFFFF;
    margin-bottom: 10px; font-family: var(--font-serif);
    transition: color 0.4s;
  }
  [data-theme="light"] .wf-title { color: #0F172A; }
  .wf-desc {
    font-size: 14px; color: #6B7280; line-height: 1.6;
    transition: color 0.4s;
  }
  [data-theme="light"] .wf-desc { color: #475569; }
  @media (max-width: 768px) {
    .workflow-steps { grid-template-columns: 1fr; gap: 40px; }
    .workflow-steps::before { display: none; }
  }

  /* ── Trust / Security ── */
  .trust-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px;
  }
  .trust-card {
    background: rgba(14,18,28,0.5);
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 14px; padding: 28px;
    transition: all 0.3s ease;
  }
  .trust-card:hover { background: rgba(14,18,28,0.7); border-color: rgba(255,255,255,0.08); }
  [data-theme="light"] .trust-card { background: rgba(255,255,255,0.7); border-color: rgba(0,0,0,0.05); }
  [data-theme="light"] .trust-card:hover { background: rgba(255,255,255,0.9); border-color: rgba(0,0,0,0.1); }
  .trust-icon { font-size: 28px; margin-bottom: 14px; }
  .trust-title { font-size: 17px; font-weight: 700; color: #FFFFFF; margin-bottom: 8px; transition: color 0.4s; }
  [data-theme="light"] .trust-title { color: #0F172A; }
  .trust-desc { font-size: 13.5px; color: #9CA3AF; line-height: 1.6; transition: color 0.4s; }
  [data-theme="light"] .trust-desc { color: #475569; }
  .trust-seals { display: flex; justify-content: center; gap: 36px; margin-top: 52px; flex-wrap: wrap; }
  .seal { font-size: 11px; font-weight: 700; color: #4B5563; letter-spacing: 0.9px; display: flex; align-items: center; gap: 8px; transition: color 0.4s; }
  [data-theme="light"] .seal { color: #64748B; }
  .seal-dot { width: 6px; height: 6px; border-radius: 50%; background: #10B981; }
  @media (max-width: 768px) { .trust-grid { grid-template-columns: 1fr; gap: 20px; } }

  /* ── CTA banner ── */
  .cta-band {
    margin: 0 24px 96px;
    border-radius: 24px;
    background: linear-gradient(135deg, rgba(30,41,80,0.85) 0%, rgba(15,23,42,0.9) 100%);
    border: 1px solid rgba(59,130,246,0.2);
    padding: 72px 40px;
    text-align: center; position: relative; overflow: hidden;
    transition: background 0.45s, border-color 0.45s;
  }
  [data-theme="light"] .cta-band {
    background: linear-gradient(135deg, rgba(239,246,255,0.95) 0%, rgba(224,231,255,0.95) 100%);
    border-color: rgba(37,99,235,0.2);
  }
  .cta-band-glow {
    position: absolute; width: 500px; height: 500px;
    background: radial-gradient(circle, rgba(37,99,235,0.12) 0%, transparent 70%);
    top: 50%; left: 50%; transform: translate(-50%,-50%);
    pointer-events: none;
  }
  .cta-h2 {
    font-family: var(--font-serif);
    font-size: clamp(1.9rem,4vw,2.8rem);
    color: #FFFFFF; margin-bottom: 12px; letter-spacing: -0.5px;
    position: relative; z-index: 1; transition: color 0.4s;
  }
  [data-theme="light"] .cta-h2 { color: #0F172A; }
  .cta-sub {
    font-size: 17px; color: #9CA3AF; margin-bottom: 36px;
    position: relative; z-index: 1; line-height: 1.6; transition: color 0.4s;
  }
  [data-theme="light"] .cta-sub { color: #475569; }
  .cta-btns {
    display: flex; gap: 14px; justify-content: center;
    flex-wrap: wrap; position: relative; z-index: 1;
  }

  /* ── Footer ── */
  .lp-footer {
    border-top: 1px solid rgba(255,255,255,0.04);
    padding: 40px 24px;
    position: relative; z-index: 1;
    transition: border-color 0.45s, background 0.45s;
  }
  [data-theme="light"] .lp-footer { border-top-color: rgba(0,0,0,0.06); }
  .footer-inner {
    max-width: 1200px; margin: 0 auto;
    display: flex; justify-content: space-between; align-items: center;
    flex-wrap: wrap; gap: 20px; font-size: 13px; color: #4B5563;
    transition: color 0.4s;
  }
  [data-theme="light"] .footer-inner { color: #64748B; }
  .footer-links { display: flex; gap: 20px; }
  .footer-link { color: #4B5563; text-decoration: none; transition: color 0.2s; }
  .footer-link:hover { color: #9CA3AF; }
  [data-theme="light"] .footer-link { color: #64748B; }
  [data-theme="light"] .footer-link:hover { color: #0F172A; }

  /* ── Section divider ── */
  .sec-divider {
    max-width: 1200px; margin: 0 auto;
    height: 1px; background: rgba(255,255,255,0.04);
    transition: background 0.45s;
  }
  [data-theme="light"] .sec-divider { background: rgba(0,0,0,0.05); }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Scroll-reveal hook
// ─────────────────────────────────────────────────────────────────────────────
function useSR() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, visible];
}

// Wrap a block in scroll-reveal
function SR({ children, delay = '', style = {} }) {
  const [ref, visible] = useSR();
  return (
    <div ref={ref} className={`sr ${visible ? 'visible' : ''} ${delay}`} style={style}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { theme } = useTheme();
  const [typed, setTyped] = useState('');
  const fullText = "Connecting to Case Vault... Found 3 documents. Extracting core issues under Indian Contract Act, Section 56. Compiling opening argument...";

  useEffect(() => {
    let idx = 0, alive = true;
    const go = () => {
      if (!alive) return;
      setTyped(fullText.slice(0, idx));
      idx++;
      if (idx > fullText.length) { setTimeout(() => { idx = 0; go(); }, 4800); }
      else { setTimeout(go, 38); }
    };
    go();
    return () => { alive = false; };
  }, []);

  return (
    <div className="lp" data-theme={theme}>
      <style>{landingStyles}</style>

      <LandingNavbar />
      <div style={{ height: '64px' }} aria-hidden="true" />

      {/* ══════════════════ HERO ══════════════════ */}
      <div className="hero-wrap">
        <div className="glow-orb glow-orb-1" />
        <div className="glow-orb glow-orb-2" />
        <div className="hero-grid">
          <div>
            <SR>
              <span className="hero-eyebrow">Sovereign Legal Intelligence</span>
              <h1 className="hero-h1">
                The Intelligence<br />Behind <em>Elite</em><br />Legal Counsel.
              </h1>
              <p className="hero-p">
                Synthesize contracts, run cross-document conflict audits, and query your entire case database with context-grounded AI precision. Built for Indian advocates.
              </p>
              <div className="hero-btns">
                <Link to="/login" className="btn-primary">
                  Get Started
                  <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
                <a href="#features" className="btn-secondary">Explore Platform</a>
              </div>
            </SR>
          </div>
          <div>
            <SR delay="d2">
              <div className="lp-terminal">
                <div className="term-topbar">
                  <div className="term-dots">
                    <span className="term-dot" style={{ background: '#EF4444' }} />
                    <span className="term-dot" style={{ background: '#F59E0B' }} />
                    <span className="term-dot" style={{ background: '#10B981' }} />
                  </div>
                  <span className="term-title">InzIQ Terminal</span>
                  <span className="term-status"><span className="term-pulse" /> SECURE</span>
                </div>
                <div className="term-body">
                  <div>
                    <div className="term-msg-meta">Advocate Prompt</div>
                    <div className="term-user-text">Analyze case files and generate the appellant opening argument for case 101.</div>
                  </div>
                  <div>
                    <div className="term-msg-meta">AI Agent</div>
                    <div className="term-ai-text"><span className="term-cursor">{typed}</span></div>
                  </div>
                  <div className="term-output">
                    <div className="term-output-hdr">Generated Strategy Preview</div>
                    <pre className="term-output-pre">{`STAGE 1: Legal Issue Extraction\n- Force majeure qualifies under Section 56.\n- Appellant bears zero liability post-event.\n\nSTAGE 2: Opening Argument\n"My Lords, performance was rendered legally\nimpossible..."`}</pre>
                  </div>
                </div>
              </div>
            </SR>
          </div>
        </div>
      </div>

      {/* ══════════════════ FEATURES ══════════════════ */}
      <section id="features" className="lp-section" style={{ paddingTop: '88px' }}>
        <div className="glow-orb glow-orb-3" />
        <div className="lp-inner">
          <SR style={{ textAlign: 'center' }}>
            <span className="lp-badge">Platform Modules</span>
            <h2 className="lp-section-title">Every Tool an Elite Advocate Needs</h2>
            <p className="lp-section-sub">Eight purpose-built modules. One sovereign console.</p>
          </SR>

          <div className="bento">

            {/* ── Contract Risk Analyzer (large) ── */}
            <SR delay="d1" style={{ display: 'contents' }}>
              <div className="bc bc--lg">
                <div className="bc-glow" />
                <div className="bc-content">
                  <span className="bc-tag">Module 01</span>
                  <h3 className="bc-title">Contract Risk Analyzer</h3>
                  <p className="bc-desc">Flag liabilities in under 2 minutes. Enforce your firm's non-negotiable rule book as an absolute override on every clause.</p>
                  <div className="mini-box">
                    <div className="risk-pill amber">⚠️ RISK DETECTED</div>
                    <div className="mini-clause-title">Clause 2.4 — Unilateral Suspension</div>
                    <p className="mini-clause-text">"Client reserves absolute right to suspend all payments…"</p>
                    <div className="mini-clause-sug">AI Fix: Mutual suspension — 15-day written notice required.</div>
                  </div>
                </div>
                <div className="bc-footer">
                  <Link to="/login" className="bc-link">Launch Risk Scan ↗</Link>
                </div>
              </div>
            </SR>

            {/* ── Conflict Engine (small) ── */}
            <SR delay="d2" style={{ display: 'contents' }}>
              <div className="bc bc--sm">
                <div className="bc-glow" style={{ background: 'radial-gradient(circle,rgba(239,68,68,0.07) 0%,transparent 70%)' }} />
                <div className="bc-content">
                  <span className="bc-tag">Module 02</span>
                  <h3 className="bc-title">Conflict Engine</h3>
                  <p className="bc-desc">Cross-file audit in seconds. No representation overlap reaches the bench.</p>
                  <div>
                    {[
                      { name: 'Tech Corp India', tag: 'HIGH CONFLICT', cls: 'conflict' },
                      { name: 'Rajesh Sharma',   tag: 'POTENTIAL',     cls: 'warn'     },
                      { name: 'Arora & Sons Ltd', tag: 'CLEAR',        cls: 'ok'       },
                    ].map(({ name, tag, cls }) => (
                      <div key={name} className="mini-row">
                        <span className="mini-row-label">{name}</span>
                        <span className={`status-tag ${cls}`}>{tag}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bc-footer">
                  <Link to="/login" className="bc-link">Audit Roster ↗</Link>
                </div>
              </div>
            </SR>

            {/* ── InzIQ AI Suite (small) ── */}
            <SR delay="d1" style={{ display: 'contents' }}>
              <div className="bc bc--sm" style={{ borderColor: 'rgba(139,92,246,0.12)' }}>
                <div className="bc-glow" style={{ background: 'radial-gradient(circle,rgba(139,92,246,0.09) 0%,transparent 70%)' }} />
                <div className="bc-content">
                  <span className="bc-tag">Module 03</span>
                  <h3 className="bc-title">InzIQ AI Suite</h3>
                  <p className="bc-desc">Speak a command. Your entire case database responds in real time.</p>
                  {[
                    { cmd: '"Draft notice to Tech Corp"',      result: 'Drafting → /contract...' },
                    { cmd: '"Find limitation for Arora case"', result: '14 days remaining' },
                  ].map(({ cmd, result }) => (
                    <div key={cmd} className="inziq-cmd">
                      <span className="inziq-mic">🎤</span>
                      <div>
                        <div className="inziq-text">{cmd}</div>
                        <div style={{ fontSize: '11px', color: '#10B981', marginTop: '2px' }}>{result}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bc-footer">
                  <Link to="/login" className="bc-link">Open Console ↗</Link>
                </div>
              </div>
            </SR>

            {/* ── Legal Calendar (small) ── */}
            <SR delay="d2" style={{ display: 'contents' }}>
              <div className="bc bc--sm">
                <div className="bc-content">
                  <span className="bc-tag">Module 04</span>
                  <h3 className="bc-title">Legal Calendar</h3>
                  <p className="bc-desc">Limitation periods, hearing dates, filing deadlines — auto-tracked. Never miss a critical date.</p>
                  <div className="cal-grid">
                    {[
                      { date: '07', label: 'HC Hearing', type: 'urgent', badge: 'TODAY' },
                      { date: '14', label: 'Limitation', type: 'soon',   badge: '7 DAYS' },
                      { date: '28', label: 'NCLT Filing', type: '',      badge: '' },
                    ].map(({ date, label, type, badge }) => (
                      <div key={date} className={`cal-item ${type}`}>
                        <div className="cal-date">{date}</div>
                        <div className="cal-label">{label}</div>
                        {badge && <div className={`cal-badge ${type}`}>{badge}</div>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bc-footer">
                  <Link to="/login" className="bc-link">Open Calendar ↗</Link>
                </div>
              </div>
            </SR>

            {/* ── Virtual Courtroom (large) ── */}
            <SR delay="d3" style={{ display: 'contents' }}>
              <div className="bc bc--lg" style={{ borderColor: 'rgba(16,185,129,0.1)' }}>
                <div className="bc-glow" style={{ background: 'radial-gradient(circle,rgba(16,185,129,0.07) 0%,transparent 70%)' }} />
                <div className="bc-content bc-flex">
                  <div className="bc-flex-l">
                    <span className="bc-tag">Module 05</span>
                    <h3 className="bc-title">Virtual Courtroom</h3>
                    <p className="bc-desc">Stress-test every argument before the bench. AI opposition counsel probes every weak point.</p>
                    <Link to="/login" className="btn-primary" style={{ alignSelf: 'flex-start', fontSize: '13px', padding: '10px 20px' }}>
                      Enter War Room
                    </Link>
                  </div>
                  <div className="bc-flex-r">
                    {[
                      { icon: '⚖️', title: 'Bench Q: "Section 56 applies?"',      text: 'AI surfaces 3 contrary precedents for drill.' },
                      { icon: '🔥', title: 'Weakness flagged in Para 7',           text: 'Rewrite prompted before live hearing.' },
                      { icon: '✅', title: 'Cross-exam simulated',                  text: 'Argument stress-score: 87/100.' },
                    ].map(({ icon, title, text }) => (
                      <div key={title} className="wr-step">
                        <span className="wr-step-icon">{icon}</span>
                        <div>
                          <div className="wr-step-title">{title}</div>
                          <div className="wr-step-text">{text}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SR>

            {/* ── Case Vault (full width) ── */}
            <SR delay="d1" style={{ display: 'contents' }}>
              <div className="bc bc--fw">
                <div className="bc-glow" />
                <div className="bc-content bc-flex">
                  <div className="bc-flex-l">
                    <span className="bc-tag">Module 06 — 08</span>
                    <h3 className="bc-title">Case Vault, Workspace & Firm Library</h3>
                    <p className="bc-desc">
                      All case files, briefs, and plaints — indexed, encrypted, and retrieved in seconds. Zero-retention protocol ensures client privilege is never compromised.
                    </p>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '4px' }}>
                      <Link to="/login" className="bc-link">Open Vault ↗</Link>
                      <Link to="/login" className="bc-link" style={{ marginLeft: '8px' }}>Firm Library ↗</Link>
                    </div>
                  </div>
                  <div className="bc-flex-r">
                    {[
                      { icon: '📄', name: 'Arora_NDA_Draft_v3.pdf',     size: '2.1 MB' },
                      { icon: '⚖️', name: 'TechCorp_Plaint_HC.docx',    size: '840 KB' },
                      { icon: '📋', name: 'Limitation_Matrix_2026.xlsx', size: '420 KB' },
                      { icon: '🔒', name: 'Confidential_LOA.pdf',        size: '1.3 MB' },
                    ].map(({ icon, name, size }) => (
                      <div key={name} className="vault-row">
                        <span className="vault-icon">{icon}</span>
                        <span className="vault-name">{name}</span>
                        <span className="vault-size">{size}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SR>
          </div>
        </div>
      </section>

      <div className="lp-inner" style={{ padding: '0 24px' }}><div className="sec-divider" /></div>

      {/* ══════════════════ HOW IT WORKS ══════════════════ */}
      <section className="lp-section" style={{ paddingTop: '80px', paddingBottom: '80px' }}>
        <div className="lp-inner">
          <SR style={{ textAlign: 'center' }}>
            <span className="lp-badge">Workflow</span>
            <h2 className="lp-section-title">From Upload to Strategy in 3 Steps</h2>
            <p className="lp-section-sub">No onboarding sessions. No consultant fees. Open the console and go.</p>
          </SR>
          <div className="workflow-steps">
            {[
              {
                n: '01',
                title: 'Upload',
                desc: 'Drop a contract, plaint, or case file. LexAmplify extracts, indexes, and encrypts it instantly — PDFs up to 100MB.',
              },
              {
                n: '02',
                title: 'Analyze',
                desc: 'AI benchmarks every clause against the Indian Contract Act, IPC, RERA, and your firm\'s custom rule book simultaneously.',
              },
              {
                n: '03',
                title: 'Act',
                desc: 'Draft rewrites, flag risk clauses, schedule hearings, and build your litigation strategy — all from a single command console.',
              },
            ].map(({ n, title, desc }, i) => (
              <SR key={n} delay={`d${i + 1}`}>
                <div className="wf-step">
                  <div className="wf-num">{n}</div>
                  <div className="wf-title">{title}</div>
                  <div className="wf-desc">{desc}</div>
                </div>
              </SR>
            ))}
          </div>
        </div>
      </section>

      <div className="lp-inner" style={{ padding: '0 24px' }}><div className="sec-divider" /></div>

      {/* ══════════════════ SECURITY ══════════════════ */}
      <section id="security" className="lp-section" style={{ paddingTop: '80px', background: 'rgba(8,11,18,0.3)', transition: 'background 0.45s' }}>
        <div className="lp-inner">
          <SR style={{ textAlign: 'center' }}>
            <span className="lp-badge">Security Architecture</span>
            <h2 className="lp-section-title">Client Privilege, Engineered In</h2>
            <p className="lp-section-sub">Not just compliance checkboxes — architecture that treats every brief as a state secret.</p>
          </SR>
          <div className="trust-grid">
            {[
              { icon: '🛡️', title: 'AES-256 Cryptography', desc: 'Every case file, plaint, and contract encrypted in transit and at rest. Military-grade, no exceptions.' },
              { icon: '🇮🇳', title: 'Sovereign Data Storage', desc: 'Vector databases reside exclusively on cloud nodes within Indian territorial borders. No data leaves sovereignty.' },
              { icon: '🔒', title: 'Zero Retention Protocol', desc: 'Document vectors never train base LLMs. All instances are isolated. Your strategy stays yours.' },
            ].map(({ icon, title, desc }) => (
              <SR key={title}>
                <div className="trust-card">
                  <div className="trust-icon">{icon}</div>
                  <h3 className="trust-title">{title}</h3>
                  <p className="trust-desc">{desc}</p>
                </div>
              </SR>
            ))}
          </div>
          <SR>
            <div className="trust-seals">
              {['SOC 2 TYPE II COMPLIANT', 'ISO 27001 CERTIFIED', 'GDPR & DPDPA ALIGNED'].map(s => (
                <div key={s} className="seal"><span className="seal-dot" />{s}</div>
              ))}
            </div>
          </SR>
        </div>
      </section>

      {/* ══════════════════ CTA BANNER ══════════════════ */}
      <section id="about" className="lp-section" style={{ paddingTop: '80px', paddingBottom: '0' }}>
        <div className="cta-band">
          <div className="cta-band-glow" />
          <SR>
            <h2 className="cta-h2">Stop billing for research hours.<br />Start billing for strategy.</h2>
            <p className="cta-sub">Join 380+ law firms already operating at elite speed.</p>
            <div className="cta-btns">
              <Link to="/login" className="btn-primary" style={{ fontSize: '15px', padding: '13px 30px' }}>
                Enter Advocate Console
                <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <a href="mailto:enterprise@lexamplify.in" className="btn-secondary" style={{ fontSize: '15px', padding: '13px 30px' }}>
                Talk to Sales
              </a>
            </div>
          </SR>
        </div>
      </section>

      {/* ══════════════════ FOOTER ══════════════════ */}
      <footer className="lp-footer" style={{ marginTop: '80px' }}>
        <div className="footer-inner">
          <div>© 2026 LexAmplify India Software Solutions. All rights reserved.</div>
          <div className="footer-links">
            <Link to="/login"  className="footer-link">Advocate Console</Link>
            <a href="#security" className="footer-link">Security</a>
            <a href="#pricing"  className="footer-link">Pricing</a>
            <span style={{ cursor: 'default' }}>India Kanoon Citations Compliant</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
