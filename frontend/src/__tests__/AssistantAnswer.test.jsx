import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import Assistant from '../pages/Assistant.jsx';
import AssistantAnswer from '../components/AssistantAnswer.jsx';

const WORKSPACE_STORAGE_KEY = 'lexai_active_workspace_id';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe" data-path={location.pathname} />;
}

function renderAssistant(initialEntry = '/assistant') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/assistant"
          element={(
            <>
              <Assistant />
              <LocationProbe />
            </>
          )}
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[String(name).toLowerCase()] ?? null },
    json: async () => body,
  };
}

function mockFetch(commandHandler) {
  const spy = vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u === '/api/assistant/conversations' && (init.method || 'GET') === 'GET') {
      return jsonResponse({ conversations: [], requestId: 'r-conv' });
    }
    if (u === '/api/assistant/command' && init.method === 'POST') {
      const parsed = JSON.parse(init.body || '{}');
      return commandHandler(parsed, init);
    }
    throw new Error(`Unexpected fetch: ${u}`);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function sendQuestion(text) {
  const input = screen.getByLabelText('Your command');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /Send/i }));
}

beforeEach(() => {
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, '1');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('Part B: AssistantAnswer and Assistant answer screen (B1-B12)', () => {
  it('B1 + XSS: strips images, converts Markdown links to plain text, and never renders <script>, <img>, <a> or onerror', async () => {
    const hostileAnswer = [
      'Safe intro **bold**.',
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[click](javascript:alert(1))',
      '[click](https://evil.com)',
      '![x](https://evil.com/p.png)',
    ].join(' ');

    mockFetch(() => jsonResponse({
      intent: 'answer',
      understood: 'Question for Lexamplify.',
      answer: hostileAnswer,
      answerKind: 'grounded',
      badge: 'From sources',
      sources: [
        {
          ref: 'S1',
          title: '<script>alert(2)</script> <img src=x onerror=alert(2)> [bad](https://evil.com)',
          snippet: '<img src=y onerror=alert(3)> ![pic](https://evil.com/a.png) [link](javascript:alert(4))',
        },
      ],
      suggestion: null,
      choices: [],
    }));

    const { container } = renderAssistant();
    await sendQuestion('What is bail?');

    expect(await screen.findByText(/Safe intro/)).toBeTruthy();
    // Open sources so source title & snippet are also in the DOM
    fireEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    expect(await screen.findByText(/<script>alert\(2\)<\/script>/)).toBeTruthy();

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.innerHTML).not.toContain('https://evil.com');
  });

  it.each([
    ['grounded', 'From sources', true],
    ['general_legal', 'General legal knowledge, not verified', true],
    ['general', 'General answer', true],
    ['general', 'General answer, not verified', true],
    ['unverified', 'Not verified', true],
    ['none', '', false],
    ['smalltalk', 'Should Not Show', false],
    ['own_data', 'Should Not Show', false],
    ['feature_help', 'Should Not Show', false],
  ])('B2: answerKind=%s renders expected badge state (shown=%s) with an icon when shown', (answerKind, badge, expectsBadge) => {
    const { container } = render(
      <AssistantAnswer
        reply={{
          answer: 'Sample answer text.',
          answerKind,
          badge,
          sources: [],
          suggestion: null,
        }}
        onOpenSuggestion={() => {}}
      />,
    );
    const badgeEl = container.querySelector('.lx-assistant-badge');
    if (expectsBadge) {
      expect(badgeEl).not.toBeNull();
      expect(badgeEl.textContent).toBe(badge);
      expect(badgeEl.querySelector('svg')).not.toBeNull();
    } else {
      expect(badgeEl).toBeNull();
    }
  });

  it('B3: Sources (2) is closed by default, opens on click, and is absent when sources is empty', () => {
    const { rerender } = render(
      <AssistantAnswer
        reply={{
          answer: 'Bail is discretionary [S1] [S2].',
          answerKind: 'grounded',
          badge: 'From sources',
          sources: [
            { ref: 'S1', title: 'Judgment Alpha', snippet: 'First judgment snippet.' },
            { ref: 'S2', title: 'Judgment Beta', snippet: 'Second judgment snippet.' },
          ],
        }}
        onOpenSuggestion={() => {}}
      />,
    );

    const toggle = screen.getByRole('button', { name: 'Sources (2)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Judgment Alpha')).toBeNull();
    expect(screen.queryByText('First judgment snippet.')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('S1')).toBeTruthy();
    expect(screen.getByText('Judgment Alpha')).toBeTruthy();
    expect(screen.getByText('First judgment snippet.')).toBeTruthy();
    expect(screen.getByText('S2')).toBeTruthy();
    expect(screen.getByText('Judgment Beta')).toBeTruthy();

    rerender(
      <AssistantAnswer
        reply={{
          answer: 'General explanation.',
          answerKind: 'general',
          badge: 'General answer',
          sources: [],
        }}
        onOpenSuggestion={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /Sources/i })).toBeNull();
  });

  it('B4: currencyFlags renders the old-law note when present and nothing when absent', () => {
    const note = 'IPC, CrPC and the Evidence Act were replaced by BNS, BNSS and BSA from 1 July 2024. Check which law applies to your case dates.';
    const { rerender } = render(
      <AssistantAnswer
        reply={{
          answer: 'Under Section 438 CrPC anticipatory bail may be granted.',
          answerKind: 'general_legal',
          badge: 'General legal knowledge, not verified',
          sources: [],
          currencyFlags: [{ code: 'criminal_codes_2024', note }],
        }}
        onOpenSuggestion={() => {}}
      />,
    );
    expect(screen.getByText(note)).toBeTruthy();

    rerender(
      <AssistantAnswer
        reply={{
          answer: 'Under Section 482 BNSS anticipatory bail may be granted.',
          answerKind: 'general_legal',
          badge: 'General legal knowledge, not verified',
          sources: [],
          currencyFlags: [],
        }}
        onOpenSuggestion={() => {}}
      />,
    );
    expect(screen.queryByText(note)).toBeNull();
  });

  it('B5: Copy copies answer + badge and shows Copied; clipboard failure shows Could not copy without throwing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const { rerender } = render(
      <AssistantAnswer
        reply={{
          answer: 'Bail is temporary release.',
          answerKind: 'grounded',
          badge: 'From sources',
          sources: [],
        }}
        onOpenSuggestion={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Copy/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Bail is temporary release.\nFrom sources'));
    expect(screen.getAllByText('Copied').length).toBeGreaterThan(0);

    // Rejecting clipboard does not throw and shows "Could not copy"
    const failingWrite = vi.fn().mockRejectedValue(new Error('Denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: failingWrite },
      configurable: true,
    });

    rerender(
      <AssistantAnswer
        reply={{
          answer: 'Hello!',
          answerKind: 'smalltalk',
          badge: '',
          sources: [],
        }}
        onOpenSuggestion={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Copy|Copied/i }));
    expect(await screen.findByText('Could not copy')).toBeTruthy();
  });

  it('B6: while waiting, Thinking... is shown, Send is disabled, Stop is shown; clicking Stop aborts the request and shows Stopped.', async () => {
    let capturedSignal = null;
    mockFetch((_body, init) => new Promise((_resolve, reject) => {
      capturedSignal = init.signal;
      init.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      });
    }));

    renderAssistant();
    await sendQuestion('What is anticipatory bail?');

    expect(await screen.findByText('Thinking...')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send/i }).disabled).toBe(true);
    const stopBtn = screen.getByRole('button', { name: 'Stop' });
    expect(stopBtn).toBeTruthy();

    fireEvent.click(stopBtn);
    expect(capturedSignal?.aborted).toBe(true);
    expect(await screen.findByText('Stopped.')).toBeTruthy();
    expect(screen.queryByText('Thinking...')).toBeNull();
  });

  it('B7: suggestion with /calendar renders Open Legal Calendar and navigates; unsafe or null routes render no button', async () => {
    mockFetch(() => jsonResponse({
      intent: 'answer',
      understood: 'Look up records in Legal Calendar.',
      answer: 'I cannot look up your own matters, hearings, clients or documents from here yet. You can see them in Legal Calendar.',
      answerKind: 'own_data',
      badge: '',
      sources: [],
      suggestion: { feature: 'calendar', route: '/calendar', name: 'Legal Calendar' },
      choices: [],
    }));

    renderAssistant();
    await sendQuestion('when is my next hearing?');

    const openBtn = await screen.findByRole('button', { name: /Open Legal Calendar/i });
    fireEvent.click(openBtn);
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.path).toBe('/calendar'));

    for (const badRoute of ['https://evil.com', '//evil.com', 'javascript:alert(1)', '']) {
      cleanup();
      render(
        <AssistantAnswer
          reply={{
            answer: 'Plain answer.',
            answerKind: 'own_data',
            badge: '',
            sources: [],
            suggestion: { feature: 'calendar', route: badRoute, name: 'Legal Calendar' },
          }}
          onOpenSuggestion={() => {}}
        />,
      );
      expect(screen.queryByRole('button', { name: /Open Legal Calendar/i })).toBeNull();
    }

    cleanup();
    render(
      <AssistantAnswer
        reply={{
          answer: 'Plain answer.',
          answerKind: 'smalltalk',
          badge: '',
          sources: [],
          suggestion: null,
        }}
        onOpenSuggestion={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Open /i })).toBeNull();
  });

  it('B8: 503, 429, 502 and network failure show fixed English messages without raw server error text or request ids', async () => {
    const cases = [
      {
        reply: () => jsonResponse({ error: true, code: 'ASSISTANT_BUSY', message: 'RAW_SECRET_503', request_id: 'req-secret-503' }, { status: 503 }),
        expected: 'I am busy right now. Please try again in a minute.',
        secret: 'RAW_SECRET_503',
        reqId: 'req-secret-503',
      },
      {
        reply: () => jsonResponse({ error: true, code: 'RATE_LIMITED', message: 'RAW_SECRET_429', request_id: 'req-secret-429' }, { status: 429 }),
        expected: 'You are asking too fast. Please wait a minute.',
        secret: 'RAW_SECRET_429',
        reqId: 'req-secret-429',
      },
      {
        reply: () => jsonResponse({ error: true, code: 'ASSISTANT_UNAVAILABLE', message: 'RAW_SECRET_502', request_id: 'req-secret-502' }, { status: 502 }),
        expected: 'I could not reach the answer service. Please try again.',
        secret: 'RAW_SECRET_502',
        reqId: 'req-secret-502',
      },
      {
        reply: () => { throw new TypeError('Failed to fetch'); },
        expected: 'I could not reach the server. Please try again.',
        secret: 'Failed to fetch',
        reqId: 'req-secret-net',
      },
    ];

    for (const c of cases) {
      cleanup();
      mockFetch(c.reply);
      const { container } = renderAssistant();
      await sendQuestion('What is arbitration?');
      expect(await screen.findByText(c.expected)).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(container.textContent).not.toContain(c.secret);
      expect(container.textContent).not.toContain(c.reqId);
    }
  });

  it('B9: confidentiality notice is always visible above the input box', () => {
    renderAssistant();
    expect(
      screen.getByText('Your question is sent to an AI service. Please do not type client names, phone numbers or other personal details.'),
    ).toBeTruthy();
  });

  it('B10: Devanagari and Tamil answers render without crash', async () => {
    const replies = [
      {
        answer: 'अग्रिम जमानत गिरफ्तारी से पहले मिलने वाली राहत है।',
        answerKind: 'unverified',
        badge: 'Not verified',
      },
      {
        answer: 'முன்ஜாமீன் என்பது கைதுக்கு முன் நீதிமன்றம் வழங்கும் நிவாரணம் ஆகும்.',
        answerKind: 'unverified',
        badge: 'Not verified',
      },
    ];
    let idx = 0;
    mockFetch(() => jsonResponse({
      intent: 'answer',
      understood: 'Question for Lexamplify.',
      ...replies[idx++],
      sources: [],
      suggestion: null,
      choices: [],
    }));

    renderAssistant();
    await sendQuestion('जमानत क्या है');
    expect(await screen.findByText('अग्रिम जमानत गिरफ्तारी से पहले मिलने वाली राहत है।')).toBeTruthy();

    await sendQuestion('முன்ஜாமீன் என்றால் என்ன');
    expect(await screen.findByText('முன்ஜாமீன் என்பது கைதுக்கு முன் நீதிமன்றம் வழங்கும் நிவாரணம் ஆகும்.')).toBeTruthy();
  });

  it('B12: navigating from Today with location.state.initialCommand sends once in StrictMode and shows the answer', async () => {
    const seen = [];
    mockFetch((body) => {
      seen.push(body);
      return jsonResponse({
        intent: 'answer',
        understood: 'Question for Lexamplify.',
        answer: 'Bail is release from custody on conditions [S1].',
        answerKind: 'grounded',
        badge: 'From sources',
        sources: [{ ref: 'S1', title: 'SC Bail Case', snippet: 'Bail is the rule.' }],
        suggestion: null,
        choices: [],
      });
    });

    render(
      <React.StrictMode>
        <MemoryRouter initialEntries={[{ pathname: '/assistant', state: { initialCommand: 'What is bail?' } }]}>
          <Routes>
            <Route path="/assistant" element={<Assistant />} />
          </Routes>
        </MemoryRouter>
      </React.StrictMode>,
    );

    expect(await screen.findByText(/Bail is release from custody on conditions/)).toBeTruthy();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ text: 'What is bail?' });
  });

  it.each([
    ['unverified', 'Not verified', true],
    ['general_legal', 'General legal knowledge, not verified', true],
    ['grounded', 'From sources', false],
    ['general', 'General answer', false],
    ['none', '', false],
  ])('Run 3 TASK 2: answerKind=%s shows the non-grounded warning note=%s', (answerKind, badge, expectsNote) => {
    const warningText = 'This answer may be wrong. Please check with a lawyer or an official source.';
    render(
      <AssistantAnswer
        reply={{
          answer: 'Sample answer text.',
          answerKind,
          badge,
          sources: [],
        }}
        onOpenSuggestion={() => {}}
      />,
    );
    if (expectsNote) {
      expect(screen.getByText(warningText)).toBeTruthy();
    } else {
      expect(screen.queryByText(warningText)).toBeNull();
    }
  });
});
