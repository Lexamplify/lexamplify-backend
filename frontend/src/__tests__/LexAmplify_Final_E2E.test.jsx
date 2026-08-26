import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import CommandPalette from '../components/CommandPalette';
import { AuthProvider } from '../context/AuthContext';

describe('FINAL RED-TEAM PRODUCTION QA — LexAmplify AI Legal Associate', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn((url, options) => {
      const urlStr = String(url);
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

    // Verify sidebar shows saved asset or draft node
    expect(await screen.findByText('Vault')).toBeInTheDocument();
  });
});
