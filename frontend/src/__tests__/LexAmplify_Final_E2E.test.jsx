import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import CommandPalette from '../components/CommandPalette';
import { AuthProvider } from '../context/AuthContext';

describe('FINAL RED-TEAM PRODUCTION QA — LexAmplify AI Legal Associate', () => {
  // Overridable per-test so the failure-path test below can force a
  // rejected save without a separate mock setup.
  let vaultSaveResponse = () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, id: 42, location: 'Contracts / Mutual NDA Agreement' }),
  });

  beforeEach(() => {
    localStorage.clear();
    vaultSaveResponse = () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, id: 42, location: 'Contracts / Mutual NDA Agreement' }),
    });
    global.fetch = vi.fn((url, options) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/vault/save')) {
        return Promise.resolve(vaultSaveResponse());
      }
      if (urlStr.includes('/api/vault/folders')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ flat: [{ id: 1, name: 'Contracts', parent_id: null }], folders: [] }),
        });
      }
      if (urlStr.includes('/api/vault/meta')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ documents: [] }),
        });
      }
      if (urlStr.includes('/api/ai/rag-chat')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
          body: {
            getReader: () => {
              let step = 0;
              return {
                read: async () => {
                  if (step === 0) {
                    step++;
                    const encoder = new TextEncoder();
                    const sseChunk =
                      'data: {"token": "I have drafted the agreement."}\n\n' +
                      'data: {"action": "review_document", "draft": {"title": "Mutual NDA Agreement", "doc_type": "nda", "content": "# 01 PARTIES\\n\\n| Party | Details | Address |\\n|---|---|---|\\n| Disclosing Party | [Disclosing Party Name] | [Registered Address] |\\n\\n# 02 CONFIDENTIALITY\\n\\nThe recipient agrees to hold all confidential information in strict confidence."}}\n\n' +
                      'data: [DONE]\n\n';
                    return { done: false, value: encoder.encode(sseChunk) };
                  }
                  return { done: true, value: undefined };
                },
              };
            },
          },
          json: async () => ({}),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    });
  });

  it('Flow A: Verifies Command Center, Slash commands, Suggestions, and Assistant Tools', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <CommandPalette />
        </AuthProvider>
      </MemoryRouter>
    );

    // Open palette
    window.dispatchEvent(new CustomEvent('toggle-rag-palette'));

    // Command Center elements
    const textarea = await screen.findByPlaceholderText(/Ask LexAmplify anything/i);
    expect(textarea).toBeInTheDocument();

    // Verify Assistant Tools
    expect(screen.getByText('Find Citation')).toBeInTheDocument();
    expect(screen.getByText('Cause List')).toBeInTheDocument();
    expect(screen.getByText('Statutory Research')).toBeInTheDocument();

    // Verify Prompt Suggestion Chips
    expect(screen.getByText('✦ Draft Mutual NDA')).toBeInTheDocument();
    expect(screen.getByText('✦ Analyze Contract Risks')).toBeInTheDocument();

    // Verify Slash Commands Autocomplete Popup
    await userEvent.type(textarea, '/');
    expect(await screen.findByText('Mutual NDA Agreement')).toBeInTheDocument();
    expect(screen.getByText('Legal Notice for Breach')).toBeInTheDocument();

    // Click slash command
    const ndaSlash = screen.getByText('Mutual NDA Agreement');
    await userEvent.click(ndaSlash);

    // Verify textarea populated with full template
    expect(textarea.value).toContain('Draft a mutual Non-Disclosure Agreement');

    // Verify Send button is active (not disabled)
    const sendBtn = screen.getByRole('button', { name: /Send/i });
    expect(sendBtn).not.toBeDisabled();
  });

  it('Flow B & C: Verifies Streaming Generation, Semantic Table Parsing, A4 Paper, Placeholders, and Outline', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <CommandPalette />
        </AuthProvider>
      </MemoryRouter>
    );

    window.dispatchEvent(new CustomEvent('toggle-rag-palette'));

    const textarea = await screen.findByPlaceholderText(/Ask LexAmplify anything/i);
    await userEvent.type(textarea, 'Draft a mutual NDA');

    const sendBtn = screen.getByRole('button', { name: /Send/i });
    await userEvent.click(sendBtn);

    // Verify artifact card renders in the conversation stream
    expect(await screen.findByText('Open Draft in Workspace →')).toBeInTheDocument();
    expect(screen.getAllByText(/AI Generated · Draft/i).length).toBeGreaterThan(0);

    // Open Draft in Workspace
    const openDraftBtn = screen.getByText('Open Draft in Workspace →');
    await userEvent.click(openDraftBtn);

    // Verify A4 Document Paper canvas is rendered
    const paper = document.querySelector('.lex-doc-paper');
    expect(paper).toBeInTheDocument();

    // Verify semantic HTML table is rendered (NOT raw markdown pipes)
    const table = paper.querySelector('table.lex-legal-table');
    expect(table).toBeInTheDocument();
    expect(table.querySelector('th')).toHaveTextContent('Party');
    expect(table.querySelector('td')).toHaveTextContent('Disclosing Party');

    // Verify placeholder detection badge
    expect(screen.getAllByText(/details required/i).length).toBeGreaterThan(0);

    // Toggle Complete Draft Fields form
    const toggleFieldsBtn = screen.getByText('⚡ Complete Draft Fields');
    await userEvent.click(toggleFieldsBtn);

    const inputParty = screen.getByPlaceholderText(/Enter Disclosing Party Name/i);
    expect(inputParty).toBeInTheDocument();
    await userEvent.type(inputParty, 'Acme Legal Corp');

    const fillAllBtn = screen.getByText('Fill All in Draft');
    await userEvent.click(fillAllBtn);

    // Verify updated content in paper
    expect(paper.innerHTML).toContain('Acme Legal Corp');

    // Verify Document Outline
    const outlineToggle = screen.getByTitle('Toggle Document Outline');
    await userEvent.click(outlineToggle);
    expect(await screen.findByText('Document Outline')).toBeInTheDocument();
    expect(screen.getAllByText(/01 PARTIES/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/02 CONFIDENTIALITY/i).length).toBeGreaterThan(0);

    // Verify Clause AI Actions
    expect(screen.getByText('✦ Improve')).toBeInTheDocument();
    expect(screen.getByText('✦ Legally Stronger')).toBeInTheDocument();
    expect(screen.getByText('✦ Simplify')).toBeInTheDocument();
  });

  it('Flow D & E: Verifies Document Actions (Copy, Export, Save to Vault) and Sidebar Management', async () => {
    // Seed test session with a document
    const testSession = {
      id: 's_test_1',
      title: 'Mutual NDA Agreement',
      messages: [{ role: 'user', text: 'Draft NDA' }],
      activeDocument: {
        title: 'Mutual NDA Agreement',
        doc_type: 'nda',
        content: '# 01 PARTIES\n\nDisclosing Party: [Name]\n\n# 02 TERMS\n\nConfidential information terms.',
      },
      savedAssets: [],
      updatedAt: Date.now(),
    };
    localStorage.setItem('lexai_sessions_v2', JSON.stringify([testSession]));
    localStorage.setItem('lexai_current_session_v2', 's_test_1');

    render(
      <MemoryRouter>
        <AuthProvider>
          <CommandPalette />
        </AuthProvider>
      </MemoryRouter>
    );

    window.dispatchEvent(new CustomEvent('toggle-rag-palette'));

    // Open draft from top header or sidebar tree
    const viewDraftBtn = await screen.findByText('View Draft');
    await userEvent.click(viewDraftBtn);

    // The document canvas must actually render the draft's content, not
    // just the toolbar/title around it — activeDocument was already
    // populated (from localStorage) before the palette was ever opened,
    // which previously left the canvas permanently empty: the sync effect
    // ran while isOpen was still false (this component returns null when
    // closed, so the canvas's DOM node didn't exist yet), bailed out on a
    // null ref without recording a key, and then never got another chance
    // to run once the palette opened and the node was created, because
    // activeDocument itself never changed again.
    await waitFor(() => {
      const paper = document.querySelector('.lex-doc-paper');
      expect(paper).toBeTruthy();
      expect(paper.textContent).toContain('01 PARTIES');
      expect(paper.textContent).toContain('Confidential information terms');
    });

    // Test Copy button
    const copyBtn = screen.getByTitle('Copy Draft');
    await userEvent.click(copyBtn);

    // Test Save to Vault modal
    const saveToVaultBtn = screen.getByTitle('Save to Case Vault');
    await userEvent.click(saveToVaultBtn);

    expect(await screen.findByText('Save Draft to Case Vault')).toBeInTheDocument();
    expect(screen.getByText('📁 Root (Case Vault)')).toBeInTheDocument();

    const confirmBtn = screen.getByText('Confirm & Save');
    await userEvent.click(confirmBtn);

    // The modal must actually hit the backend — a sidebar entry appearing
    // is not proof the document was persisted (this previously passed with
    // zero network calls to /api/vault/save, silently discarding the draft).
    await waitFor(() => {
      const saveCall = global.fetch.mock.calls.find(([url]) => String(url).includes('/api/vault/save'));
      expect(saveCall).toBeTruthy();
      const body = JSON.parse(saveCall[1].body);
      expect(body.title).toBeTruthy();
      expect(body.content).toContain('Disclosing Party');
      expect(body.case_id).toBeTruthy();
      expect(body.doc_type).toBe('nda');

      // AI-provenance audit trail: the backend's vault_audit table (and the
      // audit-trail authorization boundary protecting it) only has anything
      // to protect if the save request actually carries this — a prior
      // UI refactor silently dropped these two fields from the request
      // while leaving every other assertion here green.
      expect(body.session_title).toBe('Mutual NDA Agreement');
      expect(typeof body.audit_messages).toBe('string');
      const auditMessages = JSON.parse(body.audit_messages);
      expect(Array.isArray(auditMessages)).toBe(true);
      expect(auditMessages.some(m => m.role === 'user')).toBe(true);
    });

    // Verify sidebar shows saved asset or draft node
    expect(await screen.findByText('Vault')).toBeInTheDocument();
  });

  it('Flow F: Save to Vault surfaces a backend failure instead of a false success', async () => {
    vaultSaveResponse = () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: true, message: 'Vault database is unavailable.' }),
    });

    const testSession = {
      id: 's_test_2',
      title: 'Mutual NDA Agreement',
      messages: [{ role: 'user', text: 'Draft NDA' }],
      activeDocument: {
        title: 'Mutual NDA Agreement',
        doc_type: 'nda',
        content: '# 01 PARTIES\n\nDisclosing Party: [Name]',
      },
      savedAssets: [],
      updatedAt: Date.now(),
    };
    localStorage.setItem('lexai_sessions_v2', JSON.stringify([testSession]));
    localStorage.setItem('lexai_current_session_v2', 's_test_2');

    render(
      <MemoryRouter>
        <AuthProvider>
          <CommandPalette />
        </AuthProvider>
      </MemoryRouter>
    );

    window.dispatchEvent(new CustomEvent('toggle-rag-palette'));

    const viewDraftBtn = await screen.findByText('View Draft');
    await userEvent.click(viewDraftBtn);

    const saveToVaultBtn = screen.getByTitle('Save to Case Vault');
    await userEvent.click(saveToVaultBtn);
    await screen.findByText('Save Draft to Case Vault');

    const confirmBtn = screen.getByText('Confirm & Save');
    await userEvent.click(confirmBtn);

    // The failure must surface in the modal, the modal must stay open,
    // and no false "saved" message may be pushed into the conversation.
    expect(await screen.findByText('Vault database is unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Save Draft to Case Vault')).toBeInTheDocument();
    expect(screen.queryByText(/saved to Case Vault/i)).not.toBeInTheDocument();
  });

  it('Flow G: Fixed-position conversation menu closes on scroll instead of going stale', async () => {
    const testSession = {
      id: 's_test_3',
      title: 'Menu Position Test',
      messages: [],
      savedAssets: [],
      updatedAt: Date.now(),
    };
    localStorage.setItem('lexai_sessions_v2', JSON.stringify([testSession]));
    localStorage.setItem('lexai_current_session_v2', 's_test_3');

    render(
      <MemoryRouter>
        <AuthProvider>
          <CommandPalette />
        </AuthProvider>
      </MemoryRouter>
    );

    window.dispatchEvent(new CustomEvent('toggle-rag-palette'));

    const menuTrigger = await screen.findByTitle('Matter Options');
    await userEvent.click(menuTrigger);
    expect(await screen.findByText('Pin Matter')).toBeInTheDocument();

    // The menu's {x, y} is a one-time getBoundingClientRect() snapshot from
    // the trigger button, not re-measured on scroll — without a dismiss
    // listener it would stay floating at that stale position, detached
    // from the row that opened it, once the sidebar list scrolls.
    window.dispatchEvent(new Event('scroll'));
    await waitFor(() => {
      expect(screen.queryByText('Pin Matter')).not.toBeInTheDocument();
    });
  });
});
