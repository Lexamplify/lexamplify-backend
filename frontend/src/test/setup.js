import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// React Testing Library does not auto-unmount between tests under Vitest —
// without this, DOM nodes/effects from one test bleed into the next.
afterEach(() => {
  cleanup();
});

// Every module under test reads/writes localStorage on mount (theme,
// LexAmplify chat sessions, Firm Library notes/reviewed sets) — start each test
// from a clean slate so one test's writes can't change another's render.
beforeEach(() => {
  window.localStorage.clear();
});

// jsdom implements neither API; several components call them defensively
// (responsive layout checks, scroll-into-view on tab switch) and would
// otherwise throw "not implemented" errors that have nothing to do with
// the behavior under test.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => { },
    removeListener: () => { },
    addEventListener: () => { },
    removeEventListener: () => { },
    dispatchEvent: () => false,
  });
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
  };
}

if (!window.IntersectionObserver) {
  window.IntersectionObserver = class IntersectionObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
  };
}

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => { };
}
