import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';

const landingStyles = `
  .landing-container {
    background-color: #0A0E17;
    color: #F3F4F6;
    min-height: 100vh;
    font-family: var(--font-sans);
    overflow-x: hidden;
    position: relative;
    transition: background-color 0.5s ease-in-out, color 0.5s ease-in-out;
  }
  
  /* Absolute-positioned glow backdrops */
  .glow-backdrop {
    position: absolute;
    border-radius: 50%;
    filter: blur(140px);
    pointer-events: none;
    z-index: 0;
    opacity: 0.15;
    transition: opacity 0.5s ease;
  }
  .glow-1 {
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(59, 130, 246, 0.4) 0%, transparent 70%);
    top: -10%;
    right: -10%;
  }
  .glow-2 {
    width: 500px;
    height: 500px;
    background: radial-gradient(circle, rgba(16, 185, 129, 0.3) 0%, transparent 70%);
    bottom: 20%;
    left: -10%;
  }
  .glow-3 {
    width: 700px;
    height: 700px;
    background: radial-gradient(circle, rgba(59, 130, 246, 0.3) 0%, transparent 70%);
    top: 40%;
    right: 20%;
  }

  .landing-header {
    background-color: rgba(10, 14, 23, 0.8);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    position: sticky;
    top: 0;
    z-index: 1000;
    transition: background-color 0.5s, border-color 0.5s;
  }

  /* Hero split layout */
  .hero-wrapper {
    position: relative;
    padding: 120px 24px 80px;
    overflow: hidden;
  }
  .hero-container {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 60px;
    align-items: center;
    max-width: 1200px;
    margin: 0 auto;
    position: relative;
    z-index: 1;
  }
  @media (max-width: 968px) {
    .hero-container {
      grid-template-columns: 1fr;
      text-align: center;
      gap: 40px;
    }
  }

  .hero-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background-color: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 30px;
    font-size: 11px;
    font-weight: 600;
    color: #9CA3AF;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    margin-bottom: 24px;
  }

  .hero-h1 {
    font-family: var(--font-serif);
    font-size: 2.8rem;
    line-height: 1.15;
    margin-bottom: 20px;
    letter-spacing: -0.8px;
    font-weight: 700;
    color: #FFFFFF;
  }
  @media (min-width: 769px) {
    .hero-h1 {
      font-size: 3.8rem;
    }
  }
  .hero-p {
    font-size: 18px;
    color: #9CA3AF;
    line-height: 1.6;
    margin-bottom: 36px;
    max-width: 600px;
  }
  @media (max-width: 968px) {
    .hero-p {
      margin-left: auto;
      margin-right: auto;
    }
  }

  .hero-buttons {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  @media (max-width: 968px) {
    .hero-buttons {
      justify-content: center;
    }
  }

  /* Luxury Buttons */
  .btn-luxury-primary {
    background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%);
    color: #FFFFFF;
    font-weight: 500;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 12px 28px;
    font-size: 15px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 20px rgba(37, 99, 235, 0.3);
  }
  .btn-luxury-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 24px rgba(37, 99, 235, 0.45);
  }
  .btn-luxury-secondary {
    background-color: rgba(255, 255, 255, 0.02);
    color: #FFFFFF;
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-weight: 500;
    border-radius: 8px;
    padding: 12px 28px;
    font-size: 15px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .btn-luxury-secondary:hover {
    background-color: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.15);
    transform: translateY(-2px);
  }

  /* Chat Terminal Mockup */
  .luxury-terminal {
    background: rgba(18, 22, 35, 0.5);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    width: 100%;
    max-width: 500px;
    margin: 0 auto;
    font-family: monospace;
    font-size: 13px;
    transition: background-color 0.5s, border-color 0.5s, box-shadow 0.5s;
  }
  .terminal-header {
    background-color: rgba(10, 14, 23, 0.7);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: background-color 0.5s, border-color 0.5s;
  }
  .terminal-dots {
    display: flex;
    gap: 6px;
  }
  .terminal-dots .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot-red { background-color: #EF4444; }
  .dot-yellow { background-color: #F59E0B; }
  .dot-green { background-color: #10B981; }
  .terminal-title {
    color: #9CA3AF;
    font-size: 11px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .terminal-status {
    color: #10B981;
    font-size: 10px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .pulse-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #10B981;
    box-shadow: 0 0 6px #10B981;
    animation: branding-pulse 2s infinite alternate;
  }
  @keyframes branding-pulse {
    0% { opacity: 0.4; }
    100% { opacity: 1; }
  }

  .terminal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .chat-msg {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .msg-meta {
    font-size: 10px;
    text-transform: uppercase;
    color: #6B7280;
    font-weight: 600;
  }
  .user-msg .msg-text {
    color: #FFFFFF;
    background-color: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: 10px 12px;
    border-radius: 6px;
    transition: background-color 0.5s, border-color 0.5s, color 0.5s;
  }
  .ai-msg .msg-text {
    color: #3B82F6;
    padding: 0 4px;
    line-height: 1.5;
  }
  .terminal-output {
    background-color: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.03);
    border-radius: 6px;
    padding: 12px;
    transition: background-color 0.5s, border-color 0.5s;
  }
  .output-header {
    font-size: 9px;
    text-transform: uppercase;
    color: #6B7280;
    margin-bottom: 6px;
    border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
    padding-bottom: 4px;
  }
  .output-content {
    color: #9CA3AF;
    font-size: 11.5px;
    line-height: 1.5;
    margin: 0;
    white-space: pre-wrap;
  }

  /* typing cursor effect */
  .typing-effect {
    border-right: 2px solid #3B82F6;
    white-space: normal;
    animation: blink-cursor 0.75s step-end infinite;
  }
  @keyframes blink-cursor {
    from, to { border-color: transparent }
    50% { border-color: #3B82F6 }
  }

  /* Bento Grid */
  .features-section {
    padding: 80px 24px 100px;
    position: relative;
  }
  .features-badge {
    display: inline-flex;
    margin: 0 auto 12px;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background-color: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 30px;
    font-size: 11px;
    font-weight: 600;
    color: #9CA3AF;
    letter-spacing: 1.2px;
    text-transform: uppercase;
  }
  .section-title {
    font-family: var(--font-serif);
    font-size: 2.2rem;
    text-align: center;
    color: #FFFFFF;
    margin-bottom: 8px;
  }
  .section-subtitle {
    font-size: 16px;
    color: #9CA3AF;
    text-align: center;
    margin-bottom: 50px;
  }
  .bento-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-auto-rows: minmax(280px, auto);
    gap: 24px;
    max-width: 1200px;
    margin: 0 auto;
  }
  .bento-card {
    background: rgba(18, 22, 35, 0.4);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    padding: 32px;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  .bento-card:hover {
    transform: translateY(-4px);
    border-color: rgba(59, 130, 246, 0.3);
    box-shadow: 0 12px 30px rgba(59, 130, 246, 0.1);
  }
  /* Alternate hover accent color for card-medium (gold accent) */
  .bento-card-medium:hover {
    border-color: rgba(212, 175, 55, 0.3);
    box-shadow: 0 12px 30px rgba(212, 175, 55, 0.08);
  }
  .bento-card-large {
    grid-column: span 2;
  }
  .bento-card-medium {
    grid-column: span 1;
  }
  .bento-card-span {
    grid-column: span 3;
  }

  .bento-card-glow {
    position: absolute;
    width: 200px;
    height: 200px;
    background: radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, transparent 70%);
    top: -50px;
    right: -50px;
    pointer-events: none;
    z-index: 0;
  }
  .bento-card-content {
    position: relative;
    z-index: 1;
  }
  .bento-header {
    margin-bottom: 16px;
  }
  .bento-tag {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #6B7280;
    font-weight: 600;
    display: block;
    margin-bottom: 6px;
  }
  .bento-title {
    font-family: var(--font-serif);
    font-size: 24px;
    color: #FFFFFF;
  }
  .bento-description {
    font-size: 14px;
    color: #9CA3AF;
    line-height: 1.6;
    margin-bottom: 24px;
  }
  .bento-footer {
    position: relative;
    z-index: 1;
  }
  .bento-link {
    font-size: 13.5px;
    font-weight: 600;
    color: #3B82F6;
    text-decoration: none;
    transition: color 0.2s;
  }
  .bento-link:hover {
    color: #2563EB;
  }

  /* Bento specific mini-mockups */
  .bento-mini-mockup {
    background-color: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.03);
    border-radius: 8px;
    padding: 16px;
    transition: background-color 0.5s, border-color 0.5s;
  }
  .mockup-clause-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
  }
  .clause-tag {
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 4px;
    width: fit-content;
    font-weight: 600;
  }
  .clause-tag.warning {
    background-color: rgba(245, 158, 11, 0.1);
    color: #F59E0B;
  }
  .clause-title {
    color: #FFFFFF;
    font-weight: 600;
  }
  .clause-text {
    color: #6B7280;
    font-style: italic;
    margin: 0;
  }
  .clause-rebuttal {
    color: #10B981;
    font-size: 11px;
  }

  .bento-mini-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .mini-list-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: rgba(0, 0, 0, 0.2);
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 12px;
    transition: background-color 0.5s;
  }
  .status-pill {
    font-size: 9px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .status-pill.red {
    background-color: rgba(239, 68, 68, 0.1);
    color: #EF4444;
  }
  .status-pill.yellow {
    background-color: rgba(245, 158, 11, 0.1);
    color: #F59E0B;
  }

  .bento-flex-row {
    display: flex;
    gap: 40px;
    align-items: center;
  }
  .bento-flex-left {
    flex: 1.2;
    display: flex;
    flex-direction: column;
  }
  .bento-flex-right {
    flex: 1;
    width: 100%;
  }

  .terminal-mini {
    background-color: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.03);
    border-radius: 8px;
    padding: 16px;
    font-family: monospace;
    font-size: 12px;
    transition: background-color 0.5s, border-color 0.5s;
  }
  .terminal-line {
    color: #9CA3AF;
    margin-bottom: 6px;
  }
  .terminal-line.success {
    color: #10B981;
    margin-bottom: 0;
  }
  .term-prompt {
    color: #3B82F6;
    margin-right: 8px;
  }

  /* Enterprise Trust Section */
  .trust-section {
    padding: 100px 24px;
    background-color: rgba(10, 14, 23, 0.5);
    border-top: 1px solid rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    position: relative;
    transition: background-color 0.5s, border-color 0.5s;
  }
  .trust-header {
    text-align: center;
    margin-bottom: 60px;
  }
  .trust-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background-color: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 30px;
    font-size: 11px;
    font-weight: 600;
    color: #9CA3AF;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .trust-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 32px;
    max-width: 1200px;
    margin: 0 auto;
  }
  .trust-card {
    background-color: rgba(255, 255, 255, 0.01);
    border: 1px solid rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    padding: 28px;
    transition: all 0.3s ease;
  }
  .trust-card:hover {
    background-color: rgba(255, 255, 255, 0.02);
    border-color: rgba(255, 255, 255, 0.08);
  }
  .trust-icon {
    font-size: 28px;
    margin-bottom: 16px;
  }
  .trust-card-title {
    font-size: 18px;
    color: #FFFFFF;
    margin-bottom: 10px;
  }
  .trust-card-description {
    font-size: 13.5px;
    color: #9CA3AF;
    line-height: 1.6;
  }
  .trust-seals {
    display: flex;
    justify-content: center;
    gap: 40px;
    margin-top: 60px;
    flex-wrap: wrap;
  }
  .seal-item {
    font-size: 11px;
    font-weight: 700;
    color: #6B7280;
    letter-spacing: 1px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .seal-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #10B981;
  }

  /* Light Theme Overrides */
  .landing-container[data-theme="light"] {
    background-color: #F8FAFC;
    color: #0F172A;
  }
  .landing-container[data-theme="light"] .landing-header {
    background-color: rgba(248, 250, 252, 0.8);
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }
  .landing-container[data-theme="light"] .hero-badge,
  .landing-container[data-theme="light"] .features-badge,
  .landing-container[data-theme="light"] .trust-badge {
    background-color: rgba(0, 0, 0, 0.02);
    border: 1px solid rgba(0, 0, 0, 0.05);
    color: #475569;
  }
  .landing-container[data-theme="light"] .hero-h1,
  .landing-container[data-theme="light"] .section-title,
  .landing-container[data-theme="light"] .bento-title,
  .landing-container[data-theme="light"] .trust-card-title {
    color: #0F172A;
  }
  .landing-container[data-theme="light"] .hero-p,
  .landing-container[data-theme="light"] .section-subtitle,
  .landing-container[data-theme="light"] .bento-description,
  .landing-container[data-theme="light"] .trust-card-description {
    color: #475569;
  }
  .landing-container[data-theme="light"] .btn-luxury-secondary {
    background-color: rgba(0, 0, 0, 0.02);
    color: #0F172A;
    border: 1px solid rgba(0, 0, 0, 0.08);
  }
  .landing-container[data-theme="light"] .btn-luxury-secondary:hover {
    background-color: rgba(0, 0, 0, 0.05);
    border-color: rgba(0, 0, 0, 0.15);
  }
  .landing-container[data-theme="light"] .luxury-terminal {
    background: rgba(255, 255, 255, 0.8);
    border-color: rgba(0, 0, 0, 0.06);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
  }
  .landing-container[data-theme="light"] .terminal-header {
    background-color: rgba(0, 0, 0, 0.02);
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }
  .landing-container[data-theme="light"] .user-msg .msg-text {
    background-color: rgba(0, 0, 0, 0.02);
    border-color: rgba(0, 0, 0, 0.04);
    color: #0F172A;
  }
  .landing-container[data-theme="light"] .bento-card {
    background: rgba(255, 255, 255, 0.8);
    border-color: rgba(0, 0, 0, 0.05);
  }
  .landing-container[data-theme="light"] .bento-card:hover {
    border-color: rgba(59, 130, 246, 0.4);
    box-shadow: 0 12px 30px rgba(59, 130, 246, 0.08);
  }
  .landing-container[data-theme="light"] .bento-card-medium:hover {
    border-color: rgba(212, 175, 55, 0.4);
    box-shadow: 0 12px 30px rgba(212, 175, 55, 0.06);
  }
  .landing-container[data-theme="light"] .trust-card {
    background-color: rgba(0, 0, 0, 0.01);
    border-color: rgba(0, 0, 0, 0.03);
  }
  .landing-container[data-theme="light"] .trust-card:hover {
    background-color: rgba(0, 0, 0, 0.02);
    border-color: rgba(0, 0, 0, 0.06);
  }
  .landing-container[data-theme="light"] .bento-mini-mockup,
  .landing-container[data-theme="light"] .bento-mini-list,
  .landing-container[data-theme="light"] .mini-list-item,
  .landing-container[data-theme="light"] .terminal-mini {
    background-color: rgba(0, 0, 0, 0.02);
    border-color: rgba(0, 0, 0, 0.04);
  }
  .landing-container[data-theme="light"] .mockup-clause-box .clause-title {
    color: #0F172A;
  }
  .landing-container[data-theme="light"] .glow-backdrop {
    opacity: 0.06;
  }

  @media (max-width: 768px) {
    .bento-grid {
      grid-template-columns: 1fr !important;
      grid-auto-rows: auto !important;
      padding: 0;
    }
    .bento-card, .bento-card-large, .bento-card-medium, .bento-card-span {
      grid-column: span 1 !important;
      padding: 24px;
    }
    .bento-flex-row {
      flex-direction: column;
      gap: 20px;
    }
    .trust-grid {
      grid-template-columns: 1fr;
      gap: 24px;
    }
    .trust-seals {
      gap: 20px;
      flex-direction: column;
      align-items: center;
    }
    .hero-wrapper {
      padding-top: 80px;
      padding-bottom: 40px;
    }
    .features-section {
      padding-bottom: 60px;
    }
    .trust-section {
      padding-top: 60px;
      padding-bottom: 60px;
    }
  }
`;

function ScrollReveal({ children }) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current);
      }
    };
  }, []);

  return (
    <div ref={ref} className={`scroll-animate ${isVisible ? 'animated' : ''}`}>
      {children}
    </div>
  );
}

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme();
  const [typedText, setTypedText] = useState('');
  const fullText = "Connecting to Case Vault... Found 3 documents. Extracting core issues under Indian Contract Act, Section 56. Compiling opening argument...";

  useEffect(() => {
    let index = 0;
    let isMounted = true;
    const type = () => {
      if (!isMounted) return;
      setTypedText(fullText.slice(0, index));
      index++;
      if (index > fullText.length) {
        setTimeout(() => {
          index = 0;
          type();
        }, 5000);
      } else {
        setTimeout(type, 40);
      }
    };
    type();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="landing-container" data-theme={theme}>
      <style>{landingStyles}</style>

      {/* Header */}
      <header className="landing-header">
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '0.5px' }}>LexAmplify</span>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', background: 'var(--accent-muted)', color: 'var(--accent-primary)', padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>
              India
            </span>
          </div>

          {/* Navigation Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-primary)',
              }}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            >
              {theme === 'dark' ? (
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              ) : (
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>

            {/* Enter Console Button */}
            <Link to="/login" className="btn-luxury-primary" style={{ padding: '8px 18px', fontSize: '14px' }}>
              Enter Console
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="hero-wrapper">
        <div className="glow-backdrop glow-1" />
        <div className="glow-backdrop glow-2" />
        <div className="hero-container">
          <div className="hero-text-block">
            <ScrollReveal>
              <span className="hero-badge">Sovereign Legal Intelligence</span>
              <h1 className="hero-h1">
                The Intelligence<br />Behind Elite Legal Counsel.
              </h1>
              <p className="hero-p">
                Synthesize contracts, run cross-document conflict audits, and query your case database with context-grounded AI precision. Engineered for elite advocates.
              </p>
              <div className="hero-buttons">
                <Link to="/login" className="btn-luxury-primary">
                  Get Started
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
                <a href="#features" className="btn-luxury-secondary">
                  Explore Platform
                </a>
              </div>
            </ScrollReveal>
          </div>

          <div className="hero-mockup-block">
            <ScrollReveal>
              <div className="luxury-terminal">
                <div className="terminal-header">
                  <div className="terminal-dots">
                    <span className="dot dot-red"></span>
                    <span className="dot dot-yellow"></span>
                    <span className="dot dot-green"></span>
                  </div>
                  <div className="terminal-title">Universal Agent Terminal</div>
                  <div className="terminal-status">
                    <span className="pulse-indicator"></span> SECURE
                  </div>
                </div>
                <div className="terminal-body">
                  <div className="chat-msg user-msg">
                    <div className="msg-meta">Advocate Prompt</div>
                    <div className="msg-text">Analyze case files and generate the appellant opening argument for case 101.</div>
                  </div>
                  <div className="chat-msg ai-msg">
                    <div className="msg-meta">AI Agent</div>
                    <div className="msg-text">
                      <span className="typing-effect">{typedText}</span>
                    </div>
                  </div>
                  <div className="terminal-output">
                    <div className="output-header">GENERATED STRATEGY PREVIEW</div>
                    <pre className="output-content">
{`STAGE 1: Legal Issue Extraction
- Unforeseen government ban qualifies as force majeure.
- Appellant has zero liability post-event duration.

STAGE 2: Opening Argument
"My Lords, the performance of the contract was rendered legally impossible..."`}
                    </pre>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </div>

      {/* Bento Grid Features Section */}
      <section id="features" className="features-section">
        <div className="glow-backdrop glow-3" />
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center' }}>
            <ScrollReveal>
              <span className="features-badge">Platform Capability</span>
              <h2 className="section-title">Engineered for Sovereign Precision</h2>
              <p className="section-subtitle">A cohesive suite of modules designed for high-stakes litigation.</p>
            </ScrollReveal>
          </div>

          <div className="bento-grid">
            {/* Card 1: Contract Risk (Large) */}
            <div className="bento-card bento-card-large">
              <div className="bento-card-glow" />
              <div className="bento-card-content">
                <ScrollReveal>
                  <div className="bento-header">
                    <span className="bento-tag">Module 01</span>
                    <h3 className="bento-title">Contract Risk Analyzer</h3>
                  </div>
                  <p className="bento-description">
                    Instantly scan agreements for liability flags, draft customized clause updates, and identify missing provisions standard to Indian Law.
                  </p>
                  <div className="bento-mini-mockup">
                    <div className="mockup-clause-box">
                      <span className="clause-tag warning">⚠️ RISK DETECTED</span>
                      <div className="clause-title">Clause 2.4: Suspension right</div>
                      <p className="clause-text">"...Client reserves the absolute right to suspend all payments..."</p>
                      <div className="clause-rebuttal">AI Suggestion: Revise to mutual suspension upon 15-day written notice.</div>
                    </div>
                  </div>
                </ScrollReveal>
              </div>
              <div className="bento-footer">
                <ScrollReveal>
                  <Link to="/login" className="bento-link">Launch Risk Scan ↗</Link>
                </ScrollReveal>
              </div>
            </div>

            {/* Card 2: Conflict Check (Medium) */}
            <div className="bento-card bento-card-medium">
              <div className="bento-card-glow" />
              <div className="bento-card-content">
                <ScrollReveal>
                  <div className="bento-header">
                    <span className="bento-tag">Module 02</span>
                    <h3 className="bento-title">Conflict Check</h3>
                  </div>
                  <p className="bento-description">
                    Execute cross-file comparison audits. Locate direct representation overlaps or potential conflict tags.
                  </p>
                  <div className="bento-mini-list">
                    <div className="mini-list-item conflict">
                      <span>Tech Corp India</span>
                      <span className="status-pill red">HIGH CONFLICT</span>
                    </div>
                    <div className="mini-list-item warning">
                      <span>Rajesh Sharma</span>
                      <span className="status-pill yellow">POTENTIAL</span>
                    </div>
                  </div>
                </ScrollReveal>
              </div>
              <div className="bento-footer">
                <ScrollReveal>
                  <Link to="/login" className="bento-link">Audit Roster ↗</Link>
                </ScrollReveal>
              </div>
            </div>

            {/* Card 3: Universal RAG Chat (Full Width / Span 3) */}
            <div className="bento-card bento-card-span">
              <div className="bento-card-glow" />
              <div className="bento-card-content bento-flex-row">
                <div className="bento-flex-left">
                  <ScrollReveal>
                    <div className="bento-header">
                      <span className="bento-tag">Module 03</span>
                      <h3 className="bento-title">Universal RAG Chat</h3>
                    </div>
                    <p className="bento-description" style={{ marginBottom: '16px' }}>
                      Query context-grounded data from vault files. Give natural directions to route screens, retrieve case documents, or search court listings.
                    </p>
                    <Link to="/login" className="btn-luxury-primary" style={{ alignSelf: 'flex-start' }}>
                      Query Console
                    </Link>
                  </ScrollReveal>
                </div>
                <div className="bento-flex-right">
                  <ScrollReveal>
                    <div className="terminal-mini">
                      <div className="terminal-line"><span className="term-prompt">&gt;</span> search court calendar for June 2026</div>
                      <div className="terminal-line success"><span className="term-prompt">&gt;</span> Found 5 events. Directing to /calendar...</div>
                    </div>
                  </ScrollReveal>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Enterprise Trust Section */}
      <section className="trust-section">
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 24px' }}>
          <div className="trust-header">
            <ScrollReveal>
              <span className="trust-badge">Security Architecture</span>
              <h2 className="section-title">Authoritative Data Custody</h2>
              <p className="section-subtitle">Engineered to exceed high-stakes enterprise compliance standards.</p>
            </ScrollReveal>
          </div>
          <div className="trust-grid">
            <div className="trust-card">
              <ScrollReveal>
                <div className="trust-icon">🛡️</div>
                <h3 className="trust-card-title">AES-256 Cryptography</h3>
                <p className="trust-card-description">All case files, plaints, and contracts are encrypted in transit and at rest using military-grade AES-256 protocols.</p>
              </ScrollReveal>
            </div>
            <div className="trust-card">
              <ScrollReveal>
                <div className="trust-icon">🇮🇳</div>
                <h3 className="trust-card-title">Sovereign Data Storage</h3>
                <p className="trust-card-description">Vector databases and index engines reside strictly on sovereign cloud nodes within the territorial borders of India.</p>
              </ScrollReveal>
            </div>
            <div className="trust-card">
              <ScrollReveal>
                <div className="trust-icon">🔒</div>
                <h3 className="trust-card-title">Zero Retention Protocol</h3>
                <p className="trust-card-description">Document processing vectors do not train base foundational LLMs. All database instances remain isolated.</p>
              </ScrollReveal>
            </div>
          </div>
          <div className="trust-seals">
            <ScrollReveal>
              <div style={{ display: 'flex', gap: '30px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <div className="seal-item">
                  <span className="seal-dot"></span> SOC 2 TYPE II COMPLIANT
                </div>
                <div className="seal-item">
                  <span className="seal-dot"></span> ISO 27001 CERTIFIED
                </div>
                <div className="seal-item">
                  <span className="seal-dot"></span> GDPR &amp; DPDPA ALIGNED
                </div>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border-subtle)', padding: '40px 24px', backgroundColor: 'var(--bg-sidebar)', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px', fontSize: '13px', color: 'var(--text-muted)' }}>
          <div>© 2026 LexAmplify India Software Solutions. All rights reserved.</div>
          <div style={{ display: 'flex', gap: '20px' }}>
            <Link to="/login" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Advocate Console</Link>
            <span style={{ color: 'var(--border-subtle)' }}>|</span>
            <span style={{ cursor: 'help' }}>India Kanoon Citations Compliant</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
