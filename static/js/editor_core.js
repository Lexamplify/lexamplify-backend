/*
    editor_core.js
    Professional Smart Editor Logic for LexAI
*/

// ═══ Custom History Manager ═══
// Tracks AI-driven DOM mutations that native execCommand('undo') cannot reach.
// Falls back to native undo/redo for manual keystrokes inside the editable scanner.
const LexHistory = {
    undoStack: [],
    redoStack: [],
    saveState: function() {
        const scanner = document.getElementById('document-scanner');
        if (scanner) {
            this.undoStack.push({
                html: scanner.innerHTML,
                clauses: sessionStorage.getItem('lexai_clauses') || '[]'
            });
            this.redoStack = [];
        }
    },
    undo: function() {
        if (this.undoStack.length > 0) {
            const scanner = document.getElementById('document-scanner');
            this.redoStack.push({
                html: scanner.innerHTML,
                clauses: sessionStorage.getItem('lexai_clauses') || '[]'
            });
            const prevState = this.undoStack.pop();
            scanner.innerHTML = prevState.html;
            sessionStorage.setItem('lexai_clauses', prevState.clauses);
            if (typeof updateCounts === 'function') updateCounts();
        } else {
            document.execCommand('undo', false, null);
        }
    },
    redo: function() {
        if (this.redoStack.length > 0) {
            const scanner = document.getElementById('document-scanner');
            this.undoStack.push({
                html: scanner.innerHTML,
                clauses: sessionStorage.getItem('lexai_clauses') || '[]'
            });
            const nextState = this.redoStack.pop();
            scanner.innerHTML = nextState.html;
            sessionStorage.setItem('lexai_clauses', nextState.clauses);
            if (typeof updateCounts === 'function') updateCounts();
        } else {
            document.execCommand('redo', false, null);
        }
    }
};

// 1. Initial State
let clauses = [];
let activeClauseId = null;
let rawText = "";
let actionLogs = [];

function logAction(msg, type) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const color = type === 'ai' ? '#28a745' : type === 'save' ? '#c8922a' : '#faf6ee';
    actionLogs.unshift({time, msg, color});
    renderLogs();
}

function renderLogs() {
    const list = document.getElementById('history-list');
    if (actionLogs.length === 0) {
        list.innerHTML = '<li style="color:#aaa; font-size:12px; font-style:italic;">No changes recorded.</li>';
        return;
    }
    list.innerHTML = actionLogs.map(log => 
        `<li style="font-size:13px; color:${log.color}; padding:6px; border-radius:4px; background:rgba(255,255,255,0.05);"><span style="color:#888; margin-right:5px; font-size:11px;">[${log.time}]</span> ${log.msg}</li>`
    ).join('');
}

document.getElementById('btn-toggle-history')?.addEventListener('click', () => {
    const panel = document.getElementById('history-panel');
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
});



// DOM Layout Triggers
document.addEventListener('DOMContentLoaded', async () => {
    const storedClauses = sessionStorage.getItem('lexai_clauses');
    const storedRaw = sessionStorage.getItem('lexai_raw_text');
    const scanner = document.getElementById('document-scanner');

    // Auto-switch tab if URL requests it (e.g. arriving from "Select for Draft" on the dashboard)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('tab') === 'autodraft') {
        switchLeftTab('autodraft');
    }

    if (!storedClauses) {
        if (scanner) scanner.innerHTML = '<div class="scanner-loading" style="color:var(--red);">No contract data found. Please go back and analyze a document.</div>';
        return;
    }

    // Normalize: support both old schema (text/risk/id/issue)
    // and new LLM schema (original_text/risk_level/explanation)
    const rawClauses = JSON.parse(storedClauses);
    clauses = rawClauses.map((c, idx) => ({
        id:    c.id    != null ? String(c.id) : `auto-${idx}`,
        text:  c.text  || c.original_text     || '',
        risk:  c.risk  || (c.risk_level === 'High' ? 'RED' : c.risk_level === 'Medium' ? 'AMBER' : 'GREEN'),
        issue: c.issue || c.explanation        || 'Risk identified — please review.'
    }));
    console.log('[LexAI] Loaded clauses from session:', clauses.length);
    rawText = storedRaw || clauses.map(c => c.text).join('\n\n');
    console.log('[LexAI] Raw text length:', rawText.length);

    // Bulletproof event delegation — handles marks injected by renderDocumentScanner
    // at any point, including after re-renders. Reads everything it needs from
    // data-attributes so it never silently fails on a missed lookup.
    const scannerEl = document.getElementById('document-scanner');
    if (scannerEl) {
        scannerEl.addEventListener('click', function(e) {
            const target = e.target.closest('mark[data-id]');
            if (!target) return;
            window.inspectRisk(target.dataset.id);
        });
    }

    renderDocumentScanner();
    updateCounts();
    generateExecutiveSummary();
});

// --- Right Panel Tab Switching ---
const tabs = ['tab-risks', 'tab-recs', 'tab-draft', 'tab-chat'];
const panels = ['panel-risks', 'panel-recs', 'panel-draft', 'panel-chat'];

tabs.forEach((tabId, index) => {
    const tabEl = document.getElementById(tabId);
    if(tabEl) {
        tabEl.addEventListener('click', () => {
            tabs.forEach(t => document.getElementById(t)?.classList.remove('active'));
            document.getElementById('tab-citations')?.classList.remove('active');
            panels.forEach(p => document.getElementById(p)?.classList.remove('active'));
            const citationsView = document.getElementById('right-view-citations');
            if (citationsView) citationsView.style.display = 'none';
            tabEl.classList.add('active');
            document.getElementById(panels[index])?.classList.add('active');
        });
    }
});

// Citations tab uses display toggle (not sidebar-panel active class) and triggers live analysis
document.getElementById('tab-citations')?.addEventListener('click', () => {
    tabs.forEach(t => document.getElementById(t)?.classList.remove('active'));
    document.getElementById('tab-citations')?.classList.add('active');
    panels.forEach(p => document.getElementById(p)?.classList.remove('active'));
    const citationsView = document.getElementById('right-view-citations');
    if (citationsView) citationsView.style.display = 'block';
    generateCitations();
});

// --- Left Panel Tab Switching ---
function switchLeftTab(tab) {
    const scannerView  = document.getElementById('left-view-scanner');
    const draftView    = document.getElementById('left-view-autodraft');
    const scannerTab   = document.getElementById('left-tab-scanner');
    const draftTab     = document.getElementById('left-tab-autodraft');
    if (!scannerView || !draftView) return;

    const isScanner = (tab === 'scanner');
    scannerView.style.display  = isScanner ? 'flex'  : 'none';
    draftView.style.display    = isScanner ? 'none'  : 'block';

    if (scannerTab) {
        scannerTab.style.borderLeftColor = isScanner ? 'var(--gold)'      : 'transparent';
        scannerTab.style.color           = isScanner ? 'var(--ink)'        : 'var(--text-muted)';
        scannerTab.style.background      = isScanner ? 'var(--cream)'      : 'transparent';
    }
    if (draftTab) {
        draftTab.style.borderLeftColor   = isScanner ? 'transparent'       : 'var(--gold)';
        draftTab.style.color             = isScanner ? 'var(--text-muted)' : 'var(--ink)';
        draftTab.style.background        = isScanner ? 'transparent'       : 'var(--cream)';
    }
}

// --- LLM Logic : Summary ---
async function generateExecutiveSummary() {
    const summaryElement = document.getElementById('executive-summary-content')
        || document.getElementById('executive-summary')
        || document.querySelector('.summary-content');

    try {
        const res = await fetch('/api/contract/summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_text: rawText })
        });
        const data = await res.json();

        // Always log the full response so failures are immediately visible in DevTools
        console.log('[LexAI] Summary API response:', data);

        // Surface backend errors cleanly — no Regex fallback on API failures
        if (!res.ok || data.error) {
            console.error('[LexAI] Summary API error:', data.error || `HTTP ${res.status}`);
            if (summaryElement) summaryElement.innerText = 'Summary unavailable — backend error. Check console for details.';
            return;
        }

        // Direct key access — backend returns { "summary": "..." }
        const extractedSummary = data.summary || data.executive_summary || data.executiveSummary || data.overview;

        if (!extractedSummary) {
            console.warn('[LexAI] Summary key missing in response:', data);
            if (summaryElement) summaryElement.innerText = 'Summary key missing in AI response.';
            return;
        }

        if (summaryElement) {
            summaryElement.innerHTML = `<b>Executive Summary:</b> <span style="color: #333;">${escapeHtml(extractedSummary)}</span>`;
        }
    } catch (err) {
        console.error('[LexAI] Network error in generateExecutiveSummary:', err);
        if (summaryElement) summaryElement.innerText = 'Network error while generating summary.';
    }
}

// --- LLM Logic : Auto-Drafting ---
const activeDraftContext = localStorage.getItem('activeDraftingContext');
const activeDraftingFile = localStorage.getItem('activeDraftingFile') || 'Selected File';
const statusDiv = document.getElementById('draft-context-status');
if(activeDraftContext && statusDiv) {
    statusDiv.style.background = '#d4edda';
    statusDiv.style.borderLeftColor = '#28a745';
    statusDiv.style.color = '#155724';
    statusDiv.innerHTML = `Context Status: ✅ Bound to ${escapeHtml(activeDraftingFile)}`;
}

async function handleAutoDraft() {
    const promptInput = document.getElementById('draft-prompt')?.value?.trim();
    const errorDiv    = document.getElementById('draft-error');
    const loader      = document.getElementById('draft-loader');

    if (!promptInput) {
        if (errorDiv) { errorDiv.innerText = "Please provide drafting instructions."; errorDiv.style.display = "block"; }
        return;
    }
    if (!activeDraftContext) {
        if (errorDiv) { errorDiv.innerText = "Please go to Document Management, select a case file first, then return here."; errorDiv.style.display = "block"; }
        return;
    }

    if (errorDiv) errorDiv.style.display = "none";
    if (loader)   loader.style.display   = "block";

    try {
        const res = await fetch('/api/documents/draft', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ prompt: promptInput, context: activeDraftContext })
        });
        const data = await res.json();
        if (loader) loader.style.display = "none";

        if (res.ok && data.draft) {
            const cleanDraft = data.draft.replace(/^"|"$/g, '').trim();
            const draftView  = document.getElementById('left-view-autodraft');
            if (draftView) {
                const placeholder = document.getElementById('autodraft-placeholder');
                if (placeholder) placeholder.remove();
                draftView.innerText = cleanDraft;
            }
            switchLeftTab('autodraft');
            logAction("Document synthesized in Auto-Draft tab.", "ai");
        } else {
            if (errorDiv) { errorDiv.innerText = data.error || "Backend parsing failure."; errorDiv.style.display = "block"; }
        }
    } catch(err) {
        if (loader)   loader.style.display   = "none";
        if (errorDiv) { errorDiv.innerText = "Network fetch timeout or offline."; errorDiv.style.display = "block"; }
    }
}

// Single document-level delegation — handles left-panel tabs, the synthesize button,
// and export modal open/close. Fires regardless of panel visibility or insertion order.
document.addEventListener('click', function(e) {
    if (e.target.closest('#left-tab-scanner'))   { switchLeftTab('scanner');   return; }
    if (e.target.closest('#left-tab-autodraft'))  { switchLeftTab('autodraft'); return; }
    if (e.target.closest('#btn-auto-draft'))      { handleAutoDraft();          return; }
    if (e.target.closest('#btn-save-case'))       { openExportModal();          return; }
    if (e.target.closest('#close-save-modal'))    { closeExportModal();         return; }
    if (e.target.id === 'save-case-modal')        { closeExportModal();         return; }
});

// --- LLM Logic : Recommendations ---
document.getElementById('btn-fetch-recs')?.addEventListener('click', async () => {
    try {
        const loader = document.getElementById('recs-loader');
        const container = document.getElementById('recs-result-container');
        const stickyBar = document.getElementById('sticky-recs-bar');
        
        if (loader) loader.style.display = 'block';
        if (container) {
            container.style.display = 'none';
            container.innerHTML = '';
        }
        if (stickyBar) stickyBar.style.display = 'none';
        
        const res = await fetch('/api/contract/recommendations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_text: rawText })
        });
        
        const data = await res.json();
        if (loader) loader.style.display = 'none';
        
        if (res.ok && data.recommendations) {
            let parsedClauses = [];
            
            try {
                if (typeof data.recommendations === 'string') {
                    const text = data.recommendations.replace(/```json/g, '').replace(/```/g, '');
                    const extracted = text.substring(text.indexOf('['), text.lastIndexOf(']') + 1);
                    parsedClauses = JSON.parse(extracted);
                } else {
                    parsedClauses = data.recommendations;
                }
            } catch (e) {
                parsedClauses = [];
            }

            // Normalizing LLM keys per user instruction
            if (data.format === 'json' && Array.isArray(data.recommendations)) {
                parsedClauses = data.recommendations.map((item, idx) => ({
                    title: item.title || item.name || item.heading || `Missing Clause ${idx+1}`,
                    clause: item.clause || item.text || item.content || item.description || item.body || ''
                }));
            } else if (Array.isArray(parsedClauses)) {
                parsedClauses = parsedClauses.map((item, idx) => ({
                    title: item.title || item.name || item.heading || `Missing Clause ${idx+1}`,
                    clause: item.clause || item.suggestion || item.text || item.content || item.description || item.body || ''
                }));
            }

            if (Array.isArray(parsedClauses) && parsedClauses.length > 0 && container) {
                let html = '';
                parsedClauses.forEach((rc, i) => {
                    html += `
                        <div class="rec-card" style="background:#fff; border:1px solid #ddd; border-left:4px solid var(--gold); padding:15px; border-radius:6px; margin-bottom:10px;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                                <div style="font-weight:bold; color:var(--ink); font-size:14px;">${escapeHtml(rc.title || 'Missing Clause')}</div>
                                <input type="checkbox" class="rec-checkbox" data-index="${i}" style="width:16px; height:16px; cursor:pointer;" checked>
                            </div>
                            <textarea class="rec-suggestion" style="width:100%; height:80px; padding:10px; border:1px solid var(--border); border-radius:4px; font-family:'DM Sans'; font-size:13px; color:#444; box-sizing:border-box;">${escapeHtml(rc.clause || '')}</textarea>
                        </div>
                    `;
                });
                container.innerHTML = html;
                container.style.display = 'flex';
                if (stickyBar) stickyBar.style.display = 'block';
            } else if (container) {
                container.innerHTML = '<div style="color:var(--text-muted); font-style:italic;">No missing clauses identified.</div>';
                container.style.display = 'flex';
            }
        } else {
            if (container) {
                container.innerHTML = '<div style="color:var(--red);">Failed to retrieve recommendations.</div>';
                container.style.display = 'flex';
            }
        }
    } catch (err) {
        const loader = document.getElementById('recs-loader');
        const container = document.getElementById('recs-result-container');
        if (loader) loader.style.display = 'none';
        if (container) {
            container.innerHTML = '<div style="color:var(--red);">Network error while fetching extensions.</div>';
            container.style.display = 'flex';
        }
    }
});

document.getElementById('btn-add-recs')?.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('.rec-checkbox:checked');
    if (checkboxes.length === 0) return alert("Please select at least one missing clause to add.");
    
    const scanner = document.getElementById('document-scanner');
    let appendCount = 0;
    
    checkboxes.forEach(box => {
        const card = box.closest('.rec-card');
        const text = card.querySelector('.rec-suggestion').value.trim();
        const title = card.querySelector('div[style*="font-weight: bold"]').innerText.trim();
        
        if (text) {
            const newExtensionHTML = `<div style="margin-top: 25px; padding: 15px; border-left: 4px solid #2980b9; background-color: #ebf5fb; border-radius: 4px; font-family: inherit;"><strong style="color: #2980b9; font-size: 14px;">[Added Missing Clause: ${escapeHtml(title)}]</strong><br><br><span style="color: #333; line-height: 1.6;">${escapeHtml(text)}</span></div>`;
            scanner.insertAdjacentHTML('beforeend', newExtensionHTML);
            appendCount++;
        }
        
        box.checked = false;
        card.remove();
    });
    
    if (appendCount > 0) {
        scanner.scrollTop = scanner.scrollHeight;
        alert(`${appendCount} clauses successfully added to the bottom of the document.`);
    }
});

// --- Counts ---
function updateCounts() {
    const red = clauses.filter(c => c.risk === 'RED').length;
    const amber = clauses.filter(c => c.risk === 'AMBER').length;
    const green = clauses.filter(c => c.risk === 'GREEN').length;
    const cr = document.getElementById('count-red');
    const ca = document.getElementById('count-amber');
    const cg = document.getElementById('count-green');
    if (cr) cr.innerText = red;
    if (ca) ca.innerText = amber;
    if (cg) cg.innerText = green;
}

// ═══ Document Scanner (Left Panel) ═══
// Robust text matching to prevent crashes
function findClausePosition(fullText, clauseText) {
    if (!fullText || !clauseText) return null;
    try {
        const normFull = fullText.replace(/\s+/g, '');
        const normClause = clauseText.replace(/\s+/g, '');
        const normIdx = normFull.indexOf(normClause);
        if (normIdx === -1) return null;
        
        let start = -1, nc = 0;
        for (let i = 0; i < fullText.length; i++) { 
            if (nc === normIdx) { start = i; break; } 
            if (!/\s/.test(fullText[i])) nc++; 
        }
        
        let end = start, tc = 0;
        if (start !== -1) {
            for (let i = start; i < fullText.length; i++) { 
                if (tc === normClause.length) { end = i; break; } 
                if (!/\s/.test(fullText[i])) tc++; 
            }
            if (tc < normClause.length) end = fullText.length; // Fallback
        }
        
        if (start === -1 || end === -1 || start >= end) return null;
        return { start, end };
    } catch (e) {
        console.warn('Clause matching failed safely:', e);
        return null;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function buildFuzzyRegex(clauseText) {
    const trimmed = clauseText.trim();
    if (!trimmed) return null;
    // Escape all regex-special characters in the LLM's original_text
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Replace every whitespace run with a flexible pattern so newlines,
    // tabs, and extra spaces in the raw PDF text are all matched correctly
    const flexible = escaped.replace(/\s+/g, '[\\s]+');
    try {
        return new RegExp(flexible);
    } catch(e) {
        console.warn('[LexAI] Regex build failed for clause:', clauseText.slice(0, 50));
        return null;
    }
}

function renderDocumentScanner() {
    const scanner = document.getElementById('document-scanner');
    if (!scanner) return;

    const riskClauses = clauses.filter(c => c.risk === 'RED' || c.risk === 'AMBER');
    riskClauses.sort((a, b) => b.text.length - a.text.length);

    // Build a flexible regex per clause (whitespace-agnostic), exec against rawText,
    // collect non-overlapping {start, end} ranges for segment-by-segment HTML building.
    const ranges = [];
    riskClauses.forEach(c => {
        const regex = buildFuzzyRegex(c.text.trim());
        if (!regex) return;
        const match = regex.exec(rawText);
        if (!match) {
            console.warn('[LexAI] No match for clause (risk=' + c.risk + '):', c.text.slice(0, 60));
            return;
        }
        const pos = { start: match.index, end: match.index + match[0].length };
        if (!ranges.some(r => pos.start < r.end && pos.end > r.start)) {
            ranges.push({ start: pos.start, end: pos.end, clause: c });
        }
    });
    ranges.sort((a, b) => a.start - b.start);

    // Walk the ranges and build HTML segment-by-segment to avoid double-escaping.
    let html = '';
    let cursor = 0;
    ranges.forEach(r => {
        const c = r.clause;
        const bgColor   = c.risk === 'RED' ? 'rgba(220, 53, 69, 0.3)' : 'rgba(253, 126, 20, 0.3)';
        const safeIssue = escapeHtml((c.issue || 'Risk identified — please review.').replace(/\n/g, ' '));
        html += escapeHtml(rawText.slice(cursor, r.start));
        html += `<mark id="clause-left-${c.id}" data-id="${c.id}" data-risk="${c.risk}" data-issue="${safeIssue}" style="background-color:${bgColor}; padding:2px 0; border-radius:3px; cursor:pointer; transition:0.2s; color:inherit; box-decoration-break:clone; -webkit-box-decoration-break:clone;">${escapeHtml(rawText.slice(r.start, r.end))}</mark>`;
        cursor = r.end;
    });
    html += escapeHtml(rawText.slice(cursor));

    html = html.replace(/\n\n/g, '</p><p style="margin-bottom: 15px;">').replace(/\n/g, '<br>');
    if (typeof setDocumentHTML === 'function') {
        setDocumentHTML('<p style="margin-bottom: 15px;">' + html + '</p>');
    } else {
        scanner.innerHTML = '<p style="margin-bottom: 15px;">' + html + '</p>';
    }
}

// ═══ Contextual Inspector (Right Panel) ═══
window.inspectRisk = function(id) {
    activeClauseId = id;                        // track for quick-action buttons
    const c = clauses.find(cl => cl.id == id);
    if (!c) return;

    const tabRisks = document.getElementById('tab-risks');
    if (tabRisks) tabRisks.click();

    const emptyState = document.getElementById('inspector-empty');
    const contentBox = document.getElementById('inspector-content');
    if (emptyState) emptyState.style.display = 'none';
    if (contentBox) contentBox.style.display = 'flex';

    const badge = document.getElementById('inspector-badge');
    const title = document.getElementById('inspector-title');
    
    if (c.risk === 'RED') {
        if(badge) badge.className = 'risk-pill-badge red';
        if(title) {
            title.innerText = 'High Risk Detected';
            title.style.color = '#c0392b';
        }
    } else if (c.risk === 'AMBER') {
        if(badge) badge.className = 'risk-pill-badge amber';
        if(title) {
            title.innerText = 'Medium Risk Detected';
            title.style.color = '#b7770d';
        }
    }

    const origEl = document.getElementById('inspector-original');
    const issueEl = document.getElementById('inspector-issue');
    if(origEl) origEl.innerHTML = escapeHtml(c.text);
    if(issueEl) issueEl.innerHTML = escapeHtml(c.issue || 'Potential risk identified.');
    
    const intentBox = document.getElementById('inspector-intent');
    const loader = document.getElementById('inspector-loader');
    const suggContainer = document.getElementById('inspector-suggestion-container');
    
    if(intentBox) intentBox.value = '';
    if(loader) loader.style.display = 'none';
    if(suggContainer) suggContainer.style.display = 'none';

    const btnRewrite = document.getElementById('btn-inspector-rewrite');
    const btnApply   = document.getElementById('btn-inspector-apply');
    if(btnRewrite) btnRewrite.onclick = () => window.rewriteClause(id);
    if(btnApply)   btnApply.onclick   = () => window.applyChanges(id);
};

window.rewriteClause = async function(id) {
    const c = clauses.find(cl => cl.id == id);
    if (!c) return;

    const intentBox = document.getElementById('inspector-intent');
    const intent = intentBox ? intentBox.value.trim() : '';
    if (!intent) return alert('Please enter your rewrite intent.');

    const loader = document.getElementById('inspector-loader');
    const container = document.getElementById('inspector-suggestion-container');
    const suggestionBox = document.getElementById('inspector-suggestion');

    if(loader) loader.style.display = 'block';
    if(container) container.style.display = 'none';

    try {
        const origEl = document.getElementById('inspector-original');
        const editedClauseText = (origEl && origEl.innerText.trim()) ? origEl.innerText.trim() : c.text;

        const res = await fetch('/api/contract/rewrite', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ original_clause: editedClauseText, issue: c.issue || '', user_intent: intent })
        });
        const data = await res.json();
        if(loader) loader.style.display = 'none';
        
        if (res.ok && data.rewritten) {
            // Strip surrounding quotes that LLMs sometimes wrap around clause text
            const cleanRewritten = data.rewritten.replace(/^"|"$/g, '').trim();
            if(suggestionBox) suggestionBox.value = cleanRewritten;
            if(container) container.style.display = 'block';
        } else {
            alert(data.error || 'Failed to generate suggestion.');
        }
    } catch (err) {
        if(loader) loader.style.display = 'none';
        alert('Network error while rewriting. Please retry.');
    }
};

window.onApply = function(id, newSafeText) {
    const markEl = document.getElementById(`clause-left-${id}`);
    if (markEl) {
        LexHistory.saveState(); // snapshot before any DOM mutation
        markEl.style.textDecoration = "line-through";
        markEl.style.textDecorationThickness = "2px";
        markEl.style.color = "#888";
        markEl.style.backgroundColor = "transparent";
        
        const newClauseHTML = `<div style="color: #1e8449; font-family: inherit; font-weight: 500; border-left: 4px solid #1e8449; background-color: #eafaf1; padding: 12px; margin: 15px 0; border-radius: 4px; line-height: 1.6; text-decoration: none;">${escapeHtml(newSafeText)}</div>`;
        markEl.insertAdjacentHTML('afterend', newClauseHTML);
        
        markEl.onclick = null;
        markEl.style.cursor = "default";
    }
};

window.applyChanges = function(id) {
    const cIdx = clauses.findIndex(cl => cl.id == id);
    if (cIdx === -1) return;

    const suggBox = document.getElementById('inspector-suggestion');
    const newSafeText = (suggBox ? suggBox.value.trim() : '').replace(/\[?Approved AI Revision\]?:?\s*/gi, '');
    if (!newSafeText) return alert('No valid rewritten text found to apply.');

    // 1. Strikethrough in Left Panel
    window.onApply(id, newSafeText);

    clauses[cIdx].risk = 'GREEN';
    clauses[cIdx].issue = 'Approved and replaced.';
    
    // Update Inspector state
    const emptyState = document.getElementById('inspector-empty');
    const contentBox = document.getElementById('inspector-content');
    if(emptyState) emptyState.style.display = 'block';
    if(contentBox) contentBox.style.display = 'none';
    
    updateCounts();
    logAction(`Applied rewrite for clause ${id}`, 'ai');
};

// --- Strictly Grounded RAG Chatbot Integration ---
if (document.getElementById('btn-send-chat')) {
    document.getElementById('btn-send-chat').addEventListener('click', sendRagChat);
    document.getElementById('rag-chat-input').addEventListener('keypress', (e) => {
        if(e.key === 'Enter') sendRagChat();
    });
}

async function sendRagChat() {
    const input = document.getElementById('rag-chat-input');
    const msg = input.value.trim();
    if(!msg) return;
    
    const stream = document.getElementById('chat-stream');
    stream.innerHTML += `<div style="background:var(--gold); color:white; padding:12px 15px; border-radius:8px; border-top-right-radius:0; font-size:14px; max-width:85%; align-self:flex-end;">${escapeHtml(msg)}</div>`;
    input.value = '';
    
    const loaderId = 'loader-' + Date.now();
    stream.innerHTML += `<div id="${loaderId}" style="background:var(--cream); border:1px solid var(--border); padding:12px 15px; border-radius:8px; border-top-left-radius:0; font-size:14px; color:var(--text-muted); font-style:italic; max-width:85%; align-self:flex-start;">Searching the document strictly...</div>`;
    stream.scrollTop = stream.scrollHeight;
    
    try {
        const res = await fetch('/api/contract/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_text: rawText, query: msg })
        });
        const data = await res.json();
        const responseEl = document.getElementById(loaderId);
        responseEl.style.fontStyle = 'normal';
        responseEl.style.color = 'var(--ink)';
        
        if(res.ok && data.response) {
            responseEl.innerText = data.response;
        } else {
            responseEl.innerText = data.error || "Failed context retrieval.";
            responseEl.style.color = 'var(--red)';
        }
    } catch(e) {
        document.getElementById(loaderId).innerText = "Network engine failed.";
        document.getElementById(loaderId).style.color = 'var(--red)';
    }
    stream.scrollTop = stream.scrollHeight;
}
// --- Export Modal ---
function openExportModal() {
    const modal = document.getElementById('save-case-modal');
    if (modal) modal.style.display = 'flex';
}

function closeExportModal() {
    const modal = document.getElementById('save-case-modal');
    if (modal) modal.style.display = 'none';
    const statusMsg = document.getElementById('export-status-msg');
    if (statusMsg) statusMsg.style.display = 'none';
}

// Highlight the active format card when the radio selection changes.
['export-fmt-pdf', 'export-fmt-docx'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
        const isPdf = document.getElementById('export-fmt-pdf')?.checked;
        const pdfLabel  = document.getElementById('fmt-pdf-label');
        const docxLabel = document.getElementById('fmt-docx-label');
        if (pdfLabel) {
            pdfLabel.style.border     = isPdf ? '2px solid var(--gold)' : '1px solid var(--border)';
            pdfLabel.style.background = isPdf ? 'rgba(200,146,42,0.08)' : 'transparent';
        }
        if (docxLabel) {
            docxLabel.style.border     = isPdf ? '1px solid var(--border)' : '2px solid var(--gold)';
            docxLabel.style.background = isPdf ? 'transparent' : 'rgba(200,146,42,0.08)';
        }
    });
});

document.getElementById('btn-execute-save')?.addEventListener('click', async () => {
    const includeDoc   = document.getElementById('export-include-doc')?.checked;
    const includeDraft = document.getElementById('export-include-draft')?.checked;
    const fmt          = document.querySelector('input[name="export-format"]:checked')?.value || 'pdf';
    const statusMsg    = document.getElementById('export-status-msg');
    const btn          = document.getElementById('btn-execute-save');

    if (!includeDoc && !includeDraft) {
        if (statusMsg) { statusMsg.innerText = 'Please select at least one content section to export.'; statusMsg.style.display = 'block'; }
        return;
    }
    if (statusMsg) statusMsg.style.display = 'none';

    let documentText = '';
    let draftText    = '';

    if (includeDoc) {
        const scanner = document.getElementById('document-scanner');
        documentText  = scanner ? (scanner.innerText || scanner.textContent || '') : rawText;
    }
    if (includeDraft) {
        const draftView = document.getElementById('left-view-autodraft');
        draftText       = draftView ? (draftView.innerText || draftView.textContent || '') : '';
        if (!draftText.trim()) {
            if (statusMsg) { statusMsg.innerText = 'Auto-Draft tab is empty — generate a draft first before exporting it.'; statusMsg.style.display = 'block'; }
            return;
        }
    }

    const defaultFilename = `LexAI_Export.${fmt === 'docx' ? 'docx' : 'pdf'}`;
    const mimeType = fmt === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf';

    // STEP 1: Ask for the save location FIRST — must happen within the user gesture
    // (before any await on fetch, which consumes the transient activation token).
    let fileHandle;
    if (window.showSaveFilePicker) {
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: defaultFilename,
                types: [{
                    description: fmt === 'docx' ? 'Word Document' : 'PDF Document',
                    accept: { [mimeType]: [`.${fmt}`] },
                }],
            });
        } catch (err) {
            if (err.name === 'AbortError') return; // User clicked Cancel — silent exit
            console.warn('[LexAI] File picker failed, falling back to auto-download:', err);
        }
    }

    // STEP 2: Generate the file on the backend
    if (btn) { btn.disabled = true; btn.innerText = 'Generating…'; }

    try {
        const res = await fetch('/api/contract/export', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ document_text: documentText, draft_text: draftText, format: fmt })
        });

        if (!res.ok) throw new Error(`Server error ${res.status}`);

        const blob = await res.blob();

        // STEP 3: Write to the chosen file, or fall back to standard download
        if (fileHandle) {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
        } else {
            // Fallback for Firefox / Safari (no showSaveFilePicker support)
            const url = URL.createObjectURL(blob);
            const a   = document.createElement('a');
            a.href     = url;
            a.download = defaultFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        closeExportModal();
        if (typeof logAction === 'function') logAction('Exported document locally.', 'save');
    } catch (err) {
        if (statusMsg) { statusMsg.innerText = `Export failed: ${err.message}`; statusMsg.style.display = 'block'; }
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = '⬇️ Export & Download'; }
    }
});

window.addMissingClauses = function() {
    const checkboxes = document.querySelectorAll('.rec-checkbox:checked');
    if (checkboxes.length === 0) return alert("Please select at least one missing clause to add.");
    
    const scanner = document.getElementById('document-scanner');
    let appendCount = 0;
    
    checkboxes.forEach(box => {
        const card = box.closest('.rec-card');
        if (!card) return;
        
        // Grab the text and title safely
        const textArea = card.querySelector('.rec-suggestion');
        const titleDiv = card.querySelector('div[style*="font-weight: bold"]');
        
        const text = textArea ? textArea.value.trim() : "";
        const title = titleDiv ? titleDiv.innerText.trim() : "Missing Clause";
        
        if (text) {
            // Inject at the bottom of the Document Scanner
            const newExtensionHTML = `<div style="margin-top: 25px; padding: 15px; border-left: 4px solid #2980b9; background-color: #ebf5fb; border-radius: 4px; font-family: inherit;"><strong style="color: #2980b9; font-size: 14px;">[Added Missing Clause: ${escapeHtml(title)}]</strong><br><br><span style="color: #333; line-height: 1.6;">${escapeHtml(text)}</span></div>`;
            scanner.insertAdjacentHTML('beforeend', newExtensionHTML);
            appendCount++;
        }
        
        // Clear the card from the UI
        box.checked = false;
        card.remove();
    });
    
    if (appendCount > 0) {
        // Scroll the left panel down to show the newly added clauses
        scanner.scrollTop = scanner.scrollHeight;
        alert(`${appendCount} clauses successfully added to the bottom of the document.`);
    }
};

// --- Instant Strategy Switch ---
document.getElementById('inline-strategy-select')?.addEventListener('change', async function(e) {
    const newStrategy = e.target.value;
    const scanner = document.getElementById('document-scanner');
    if (!scanner || !rawText) return;

    const originalHtml = scanner.innerHTML;
    scanner.innerHTML = `<div class="scanner-loading" style="color: var(--gold);">Re-analyzing contract in ${newStrategy} mode... Please wait ⚡</div>`;

    try {
        const res = await fetch('/api/contract/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: rawText, scanStrategy: newStrategy })
        });

        const data = await res.json();

        if (res.ok) {
            const rawClauses = data.clauses || [];
            clauses = rawClauses.map((c, idx) => ({
                id:    c.id != null ? String(c.id) : `auto-${idx}`,
                text:  c.text  || c.original_text || '',
                risk:  c.risk  || (c.risk_level === 'High' ? 'RED' : c.risk_level === 'Medium' ? 'AMBER' : 'GREEN'),
                issue: c.issue || c.explanation   || 'Risk identified.'
            }));

            sessionStorage.setItem('lexai_clauses', JSON.stringify(clauses));
            renderDocumentScanner();
            updateCounts();
            logAction(`Switched to ${newStrategy} analysis mode.`, 'ai');
        } else {
            throw new Error(data.error || 'Analysis failed');
        }
    } catch (err) {
        console.error('[LexAI] Strategy switch failed:', err);
        scanner.innerHTML = originalHtml;
        e.target.value = newStrategy === 'Aggressive' ? 'Defensive' : 'Aggressive';
        alert('Failed to switch modes: ' + err.message);
    }
});

// --- CONTEXT-AWARE AUTOCOMPLETE LOGIC ---

function getDynamicIntents(clauseText, riskLevel) {
    const text = (clauseText || "").toLowerCase();
    const intents = [];

    if (text.includes('liability') || text.includes('penalty') || text.includes('damages') || text.includes('$')) {
        intents.push("Cap total liability to 12 months of fees paid");
        intents.push("Make the financial penalty mutual for both parties");
        intents.push("Exclude indirect, punitive, and consequential damages");
    }
    if (text.includes('terminate') || text.includes('termination') || text.includes('notice')) {
        intents.push("Add a 30-day written notice and cure period before termination");
        intents.push("Ensure termination rights are mutual for both parties");
    }
    if (text.includes('confidential') || text.includes('information')) {
        intents.push("Limit the survival of confidentiality obligations to 3 years");
        intents.push("Exclude publicly known information from confidentiality restrictions");
    }
    if (text.includes('jurisdiction') || text.includes('law') || text.includes('court') || text.includes('dispute') || text.includes('committee')) {
        intents.push("Change governing law to the laws of India");
        intents.push("Mandate neutral arbitration before approaching courts");
    }
    if (text.includes('intellectual') || text.includes('property') || text.includes('ip ')) {
        intents.push("Ensure the Vendor retains pre-existing Intellectual Property rights");
        intents.push("Grant a perpetual, royalty-free license instead of full IP transfer");
    }
    if (text.includes('discretion') || text.includes('withheld') || text.includes('reduce')) {
        intents.push("Require mutual written consent before altering payment terms");
        intents.push("Remove the unilateral right to withhold or reduce payments");
    }

    if (riskLevel === 'RED') {
        intents.push("Remove this clause entirely as it imposes severe disproportionate risk");
        intents.push("Make this clause perfectly mutual and balanced");
    } else {
        intents.push("Clarify the ambiguous terms to prevent future legal disputes");
        intents.push("Align this clause with standard Indian industry practices");
    }

    return [...new Set(intents)].slice(0, 5);
}

document.addEventListener('DOMContentLoaded', () => {
    function handleIntentInput(inputEl) {
        const suggestionsBox  = document.getElementById('intent-suggestions');
        const originalClauseEl = document.getElementById('inspector-original');
        const badgeEl          = document.getElementById('inspector-badge');
        if (!suggestionsBox) return;

        const clauseText = originalClauseEl ? originalClauseEl.innerText : "";
        const riskClass  = badgeEl ? badgeEl.className : "";
        const riskLevel  = riskClass.includes('red') ? 'RED' : (riskClass.includes('amber') ? 'AMBER' : 'GREEN');

        const dynamicIntents = getDynamicIntents(clauseText, riskLevel);
        const val = inputEl.value.toLowerCase().trim();
        const filtered = val
            ? dynamicIntents.filter(s => s.toLowerCase().includes(val))
            : dynamicIntents;

        renderSuggestions(filtered, inputEl, suggestionsBox);
    }

    function renderSuggestions(list, inputEl, box) {
        box.innerHTML = '';
        if (list.length === 0) { box.style.display = 'none'; return; }

        list.forEach(intent => {
            const div = document.createElement('div');
            div.style.cssText = 'padding:10px 14px; cursor:pointer; font-size:13px; color:var(--ink); border-bottom:1px solid var(--border); transition:background 0.2s;';
            div.onmouseover = () => div.style.background = 'rgba(200,146,42,0.1)';
            div.onmouseout  = () => div.style.background = 'transparent';
            div.innerHTML   = `<span style="color:var(--text-muted); margin-right:8px;">💡</span> ${intent}`;
            div.onmousedown = (e) => {
                e.preventDefault();
                inputEl.value = intent;
                box.style.display = 'none';
            };
            box.appendChild(div);
        });
        box.style.display = 'block';
    }

    document.body.addEventListener('focusin', (e) => {
        if (e.target && e.target.id === 'inspector-intent') handleIntentInput(e.target);
    });
    document.body.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'inspector-intent') handleIntentInput(e.target);
    });

    document.addEventListener('click', (e) => {
        const box   = document.getElementById('intent-suggestions');
        const input = document.getElementById('inspector-intent');
        if (box && input && e.target !== input && !box.contains(e.target)) {
            box.style.display = 'none';
        }
    });
});

// ═══ Keyboard Shortcuts: Ctrl+Z (undo) / Ctrl+Y or Ctrl+Shift+Z (redo) ═══
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        LexHistory.undo();
    } else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        LexHistory.redo();
    }
});

// ═══ Contextual Citation Engine ═══
function generateCitations() {
    const scanner = document.getElementById('document-scanner');
    const listEl  = document.getElementById('citations-list');
    if (!scanner || !listEl) return;

    const text = scanner.innerText || scanner.textContent || '';
    const citations = [];

    // Case-insensitive, expanded phrase matching for real-world contract language
    if (/\b(liquidated damages|fixed penalty|actual damages|penalty of|reduce the final invoice|payments withheld|discretion of the client)\b/i.test(text)) {
        citations.push({
            title: 'Kailash Nath Associates v. Delhi Development Authority',
            desc: 'Supreme Court landmark ruling on Section 74 of the Indian Contract Act. Established that compensation/penalties can only be awarded if actual damage or loss is proved.',
            url: 'https://indiankanoon.org/doc/11624932/'
        });
    }
    if (/\b(terminate.*convenience|termination.*without cause|terminate this agreement at any time|without prior notice|reject any deliverables)\b/i.test(text)) {
        citations.push({
            title: 'Indian Oil Corporation Ltd. v. Amritsar Gas Service',
            desc: 'Held that a contract determinable in nature cannot be specifically enforced under the Specific Relief Act, and the remedy for wrongful termination is damages for the notice period.',
            url: 'https://indiankanoon.org/doc/45790435/'
        });
    }
    if (/\b(exclusive jurisdiction|seat of arbitration|sole arbitrator|courts located in|inconvenient forum|internal committee|waives all rights to approach any court)\b/i.test(text)) {
        citations.push({
            title: 'Bharat Aluminium Co. v. Kaiser Aluminium',
            desc: 'Constitution Bench ruling clarifying the applicability of Part I of the Arbitration and Conciliation Act to foreign-seated arbitrations.',
            url: 'https://indiankanoon.org/doc/137226892/'
        });
    }
    if (/\b(confidential information|trade secret|non-disclosure|maintain secrecy|disclose to others|protect this confidential information)\b/i.test(text)) {
        citations.push({
            title: 'Zee Telefilms Ltd. v. Sundial Communications Pvt. Ltd.',
            desc: 'Bombay High Court ruling establishing the protection of confidential information and trade secrets under the law of breach of confidence.',
            url: 'https://indiankanoon.org/doc/84589699/'
        });
    }
    if (/\b(intellectual property|work made for hire|exclusive property|transfer.*ip|no ip rights|moral rights)\b/i.test(text)) {
        citations.push({
            title: 'Indian Performing Right Society Ltd. v. Eastern Indian Motion Pictures',
            desc: "Supreme Court ruling clarifying copyright ownership in 'work made for hire' scenarios and the statutory rights of the commissioning party.",
            url: 'https://indiankanoon.org/doc/91660613/'
        });
    }

    listEl.innerHTML = '';

    if (citations.length === 0) {
        listEl.innerHTML = '<div style="padding:14px; color:var(--text-muted); font-size:13px; text-align:center; border:1px dashed var(--border); border-radius:6px;">No specific landmark precedents found for the currently visible text.</div>';
        return;
    }

    citations.forEach(c => {
        const kanoonUrl = c.url; // Direct document link — no search page
        const div = document.createElement('div');
        div.style.cssText = 'padding:14px; border:1px solid var(--border); border-radius:6px; background:var(--cream); box-shadow:0 2px 4px rgba(0,0,0,0.02);';
        div.innerHTML = `
            <div style="display:flex; gap:10px; align-items:flex-start;">
                <div style="font-size:16px; margin-top:2px;">⚖️</div>
                <div>
                    <div style="font-weight:bold; font-size:13px; margin-bottom:4px; line-height:1.4;">
                        <a href="${kanoonUrl}" target="_blank" rel="noopener noreferrer"
                           style="color:var(--gold); text-decoration:none; border-bottom:1px solid transparent; transition:0.2s;"
                           onmouseover="this.style.borderBottomColor='var(--gold)'"
                           onmouseout="this.style.borderBottomColor='transparent'">
                            ${escapeHtml(c.title)} ↗
                        </a>
                    </div>
                    <div style="font-size:12px; color:var(--text-muted); line-height:1.5;">${escapeHtml(c.desc)}</div>
                </div>
            </div>
        `;
        listEl.appendChild(div);
    });
}
