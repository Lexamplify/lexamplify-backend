import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import MicButton from '../components/MicButton.jsx';
import Markdown from '../components/Markdown.jsx';
import { FEATURES, getAction, isWrite } from '../assistant/featureRegistry.js';
import '../styles/assistant.css';

/*
 * The assistant workspace.
 *
 * Two rules this page exists to keep:
 *
 *  1. It never changes the lawyer's data. The backend only ever PROPOSES. "Confirm" here means "take me to the page
 *     that does this, with my words carried over" - this page calls no write endpoint, ever.
 *  2. It never navigates to anything the model said. The destination is looked up in the feature registry by the
 *     validated feature id; a route, URL or link in the reply is ignored completely.
 *
 * Network calls go through the plain global `fetch`, which utils/authFetch.js patches once at start-up to add the auth
 * cookie, the CSRF header and X-Workspace-Id - the same path every other page uses.
 */

const MAX_CHARS = 1000;

// What the lawyer is told will happen. Built here from the registry, never from words the model wrote.
const ACTION_VERB = {
  open: 'Open', search: 'Search in', analyze: 'Analyze in', summarize: 'Summarize in', answer: 'Answer from',
  export: 'Export from', create: 'Create something in', edit: 'Change something in', delete: 'Delete something in',
  upload: 'Upload something to', share: 'Share something from', send: 'Send something from',
};

// The one page that already accepts a prefilled command: Draft.jsx reads location.state.prompt.
const PREFILLABLE = { auto_draft: '/draft' };

const ERRORS = {
  RATE_LIMITED: 'You have asked for a lot at once. Please wait a minute, then try again.',
  ASSISTANT_BUSY: 'The assistant is busy right now.',
  ASSISTANT_UNAVAILABLE: 'The assistant could not be reached just now. Nothing was changed, and I will not guess an answer.',
  NO_WORKSPACE: 'Please choose a client workspace first, then ask me again.',
  WORKSPACE_FORBIDDEN: 'You do not have access to that workspace. Please choose one of your own.',
  INVALID_WORKSPACE: 'That workspace is not valid. Please choose a client workspace.',
  TEXT_TOO_LONG: `That is longer than ${MAX_CHARS} characters. Please shorten it a little.`,
  NO_TEXT: 'Tell me what you would like to do.',
  NOT_FOUND: 'That conversation is not there any more.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again, then ask me once more.',
  NETWORK: 'I could not reach the server. Please check your connection and try again.',
};

const WORKSPACE_CODES = new Set(['NO_WORKSPACE', 'WORKSPACE_FORBIDDEN', 'INVALID_WORKSPACE']);

function registryRoute(featureId) {
  const feature = FEATURES.find((f) => f.id === featureId);
  return feature ? feature.route : null;
}

function featureName(featureId) {
  const feature = FEATURES.find((f) => f.id === featureId);
  return feature ? feature.name : null;
}

// The page jumps to a feature by itself ONLY when the server says so: autoOpen exactly true. The server sets it only for a
// command a rule settled with an explicit opening verb ("open matters") or a multi-word feature name ("legal forms"); a bare
// word ("tomorrow", "notice", "matters") gets the normal card with an Open button instead, so a stray dictated word or a
// one-word answer to a question can never make the page jump away. A missing autoOpen means false: nothing is guessed from
// modelUsed or inputs. The checks after it are not guesses, they only refuse a malformed reply (a write, a question, an
// unknown feature). The destination is looked up in the registry, never read from the reply.
function isPlainRuleOpen(reply) {
  if (!reply || reply.autoOpen !== true) return false;
  if (reply.intent !== 'navigate' || reply.action !== 'open' || reply.requires_confirm) return false;
  return Boolean(registryRoute(reply.feature)) && Boolean(getAction(reply.feature, 'open')) && !isWrite(reply.feature, 'open');
}

function whatWillHappen(featureId, actionId) {
  const name = featureName(featureId);
  if (!name || !getAction(featureId, actionId)) return null;
  return `${ACTION_VERB[actionId] || 'Open'} ${name}.`;
}

function whenLabel(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return then.toLocaleDateString();
}

let turnSeq = 0;
const nextId = () => { turnSeq += 1; return `t${turnSeq}`; };

export default function Assistant() {
  const navigate = useNavigate();
  const location = useLocation();

  const [turns, setTurns] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [countdown, setCountdown] = useState(0);

  const alive = useRef(true);
  const abortRef = useRef(null);
  const handedOver = useRef(false);
  // The last sentence the lawyer TYPED or DICTATED (the box here, or the hand-over from the Today bar). A chip click never
  // changes it. Auto-Draft is prefilled from this, never from a chip's label.
  const lastTyped = useRef('');
  // The destination of a plain rule-matched "open <page>", and the ids already opened: a ref, so React's development
  // double-run of effects can never open a page twice.
  const [pendingOpen, setPendingOpen] = useState(null);
  const openedRef = useRef(new Set());
  const streamRef = useRef(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abortRef.current?.abort();          // leaving the page cancels the request; no state is set afterwards
    };
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/assistant/conversations', { method: 'GET' });
      if (!res.ok) return;
      const data = await res.json();
      if (alive.current && Array.isArray(data?.conversations)) setConversations(data.conversations);
    } catch {
      /* the list is a convenience: a failure here must never break the page */
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    if (!countdown) return undefined;
    const timer = setTimeout(() => { if (alive.current) setCountdown((n) => Math.max(0, n - 1)); }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    streamRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [turns.length, busy]);

  const send = useCallback(async (raw, { conversationId: forced, chip = false, typed: typedFrom, handover = false } = {}) => {
    const command = String(raw ?? '').trim();
    if (!command || command.length > MAX_CHARS) return;

    // A chip click sends its label as an ordinary command but is NOT something the lawyer typed: the typed sentence stays
    // what it was. Anything typed or dictated (including the Today hand-over) replaces it.
    if (!chip) lastTyped.current = command;
    const typed = chip ? (typedFrom ?? lastTyped.current) || command : command;
    // The lawyer's last TYPED sentence, when this send is a chip click (never the chip's own label, never empty).
    const seedFrom = chip ? (typedFrom ?? lastTyped.current) : '';

    const userTurn = { id: nextId(), role: 'user', text: command };
    setTurns((prev) => [...prev, userTurn]);
    setText('');
    setBusy(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let reply;
    try {
      const res = await fetch('/api/assistant/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: command, conversationId: forced ?? conversationId ?? undefined }),
        signal: controller.signal,
      });
      let data = {};
      try { data = await res.json(); } catch { data = {}; }
      reply = res.ok && !data?.error
        ? { id: nextId(), role: 'assistant', command, typed, chip, reply: data }
        : {
          id: nextId(),
          role: 'assistant',
          command,
          typed,
          chip,
          error: {
            code: data?.code || (res.status === 401 ? 'SESSION_EXPIRED' : 'ASSISTANT_UNAVAILABLE'),
            message: data?.message,
            retryAfter: Number(res.headers?.get?.('Retry-After')) || 0,
          },
        };
    } catch (err) {
      if (err?.name === 'AbortError') return;                       // the page was left: say nothing, set nothing
      reply = { id: nextId(), role: 'assistant', command, typed, chip, error: { code: 'NETWORK' } };
    }

    if (!alive.current) return;
    const direct = isPlainRuleOpen(reply.reply);
    if (direct) reply.opening = true;
    setBusy(false);
    setTurns((prev) => [...prev, reply]);
    // REPLACE only when the command was handed over from Today (so Back goes to Today, not back here); a command typed on
    // this page is a normal push, so Back returns to the conversation.
    if (direct) {
      const target = reply.reply.feature;
      // A chip click that opens Auto-Draft carries the lawyer's last typed sentence, exactly like Confirm does. A command
      // typed directly ("open auto-draft") seeds nothing. (Draft.jsx only shows a seeded request and picks a document type;
      // nothing starts until the lawyer clicks Start drafting.) Auto-Draft opens at /draft, where Confirm also goes.
      const seed = chip && target === 'auto_draft' ? seedFrom : '';
      setPendingOpen({
        turnId: reply.id,
        route: PREFILLABLE[target] ?? registryRoute(target),
        replace: handover,
        state: seed ? { prompt: seed } : undefined,
      });
    }
    if (reply.reply?.conversationId) setConversationId(reply.reply.conversationId);
    if (reply.error?.code === 'ASSISTANT_BUSY') setCountdown(reply.error.retryAfter || 5);
    if (reply.reply) loadConversations();
  }, [conversationId, loadConversations]);

  // The command handed over from the Today bar runs EXACTLY once - a ref, not state, so React's development
  // double-mount cannot run it twice - and the router state is then replaced, so a refresh does not run it again.
  useEffect(() => {
    const handed = location.state?.assistantCommand;
    if (!handed || handedOver.current) return;
    handedOver.current = true;
    navigate(location.pathname, { replace: true, state: null });
    send(handed, { handover: true });
  }, [location.state, location.pathname, navigate, send]);

  // Navigates AFTER the "Opening ..." line has rendered, exactly once per turn.
  useEffect(() => {
    if (!pendingOpen || !pendingOpen.route || openedRef.current.has(pendingOpen.turnId)) return;
    openedRef.current.add(pendingOpen.turnId);
    navigate(pendingOpen.route, { replace: pendingOpen.replace, state: pendingOpen.state });
  }, [pendingOpen, navigate]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!busy && text.trim()) send(text);
    }
  };

  const openFeature = (featureId) => {
    const route = registryRoute(featureId);          // the registry, never anything the reply contained
    if (route) navigate(route);
  };

  const confirmAction = (featureId, command) => {
    const route = registryRoute(featureId);
    if (!route) return;
    const prefill = PREFILLABLE[featureId];
    if (prefill) navigate(prefill, { state: { prompt: command } });
    else navigate(route);
  };

  const removeConversation = async (id) => {
    try {
      const res = await fetch(`/api/assistant/conversations/${id}`, { method: 'DELETE' });
      if (!alive.current) return;
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (conversationId === id) setConversationId(null);
      }
    } catch {
      /* leave the row in place; the lawyer can try again */
    } finally {
      if (alive.current) setConfirmDelete(null);
    }
  };

  const over = text.length > MAX_CHARS;

  return (
    <div className="lx-page lx-rise">
      <div className="ph">
        <span className="ph__eyebrow">Assistant</span>
        <h1 className="ph__title">Ask Lexamplify</h1>
        <p className="ph__sub">Tell me what you need in your own words. I will take you to the right place — and I will
          always ask before anything is changed.</p>
      </div>

      <div className="lx-assistant lx-mt-l">
        <aside className="lx-assistant-aside">
          <h2>Earlier</h2>
          {conversations.length === 0 ? (
            <p className="lx-assistant-empty">No history yet.</p>
          ) : conversations.map((c) => (
            <div className="lx-assistant-convo" key={c.id}>
              <div className="lx-assistant-convo__title" title={c.title}>{c.title}</div>
              <span className="lx-assistant-convo__when">{whenLabel(c.updatedAt)}</span>
              {confirmDelete === c.id ? (
                <>
                  <button type="button" className="lx-assistant-chip" onClick={() => removeConversation(c.id)}
                    aria-label={`Confirm deleting ${c.title}`}>Delete</button>
                  <button type="button" className="lx-assistant-chip" onClick={() => setConfirmDelete(null)}
                    aria-label="Keep this conversation">Keep</button>
                </>
              ) : (
                <button type="button" className="lx-assistant-chip" onClick={() => setConfirmDelete(c.id)}
                  aria-label={`Delete conversation ${c.title}`}>Remove</button>
              )}
            </div>
          ))}
        </aside>

        <div className="lx-assistant-main">
          <div className="lx-assistant-stream" aria-live="polite" aria-label="Conversation">
            {turns.length === 0 && !busy && (
              <p className="lx-assistant-empty">Try “show my hearings tomorrow”, “draft a legal notice for recovery of
                dues”, or “open legal forms”.</p>
            )}

            {turns.map((turn) => (turn.role === 'user' ? (
              <div className="lx-assistant-turn lx-assistant-turn--user" key={turn.id}>
                <div className="lx-assistant-said">{turn.text}</div>
              </div>
            ) : (
              <div className="lx-assistant-turn" key={turn.id}>
                <div className="lx-assistant-reply">
                  {turn.opening ? (
                    <div className="lx-assistant-card" role="status">
                      <p className="lx-assistant-card__what">Opening {featureName(turn.reply.feature)}…</p>
                    </div>
                  ) : turn.error ? (
                    <ErrorCard turn={turn} countdown={countdown} busy={busy}
                      onRetry={() => send(turn.command, { chip: turn.chip, typed: turn.typed })}
                      onDraft={() => navigate('/draft', { state: { prompt: turn.typed ?? turn.command } })}
                      onWorkspaces={() => navigate('/workspaces')} />
                  ) : (
                    <ReplyCard turn={turn} busy={busy} onOpen={openFeature}
                      onConfirm={() => confirmAction(turn.reply.feature, turn.typed ?? turn.command)}
                      onChoice={(choice) => send(choice, { conversationId: turn.reply.conversationId, chip: true, typed: turn.typed })} />
                  )}
                </div>
              </div>
            )))}

            {busy && (
              <div className="lx-assistant-turn" aria-label="Thinking">
                <div className="lx-assistant-reply lx-assistant-card">
                  <div className="lx-assistant-skeleton" />
                  <div className="lx-assistant-skeleton" />
                  <div className="lx-assistant-skeleton" />
                </div>
              </div>
            )}
            <div ref={streamRef} />
          </div>

          <form className="lx-assistant-composer" onSubmit={(e) => { e.preventDefault(); if (!busy && text.trim()) send(text); }}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS + 50))}
              onKeyDown={onKeyDown}
              placeholder="Ask Lexamplify, or begin a draft…"
              aria-label="Your command"
              disabled={busy}
              rows={2}
            />
            <div className="lx-assistant-composer__bar">
              <MicButton scope="form" spokenCommands={false} disabled={busy} />
              <span className={`lx-assistant-count ${over ? 'lx-assistant-count--over' : ''}`}>
                {text.length}/{MAX_CHARS}
              </span>
              <button type="submit" className="lx-btn lx-btn--primary lx-btn--sm" disabled={busy || over || !text.trim()}>
                <Ic.Arrow size={15} /> {busy ? 'Working…' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ReplyCard({ turn, busy, onOpen, onConfirm, onChoice }) {
  const reply = turn.reply || {};
  const { feature, action, intent, understood } = reply;
  const known = Boolean(registryRoute(feature)) && Boolean(getAction(feature, action));
  const write = known && isWrite(feature, action);
  const what = known ? whatWillHappen(feature, action) : null;
  const prefillable = Boolean(PREFILLABLE[feature]);

  return (
    <>
      {understood && (
        <>
          <div className="lx-assistant-understood">I understood</div>
          <p>{understood}</p>
        </>
      )}

      {intent === 'clarify' && reply.question && (
        <div className="lx-assistant-card">
          <p className="lx-assistant-card__what">{reply.question}</p>
          {Array.isArray(reply.choices) && reply.choices.length > 0 && (
            <div className="lx-assistant-row">
              {reply.choices.map((choice) => (
                <button type="button" className="lx-assistant-chip" key={choice} disabled={busy}
                  onClick={() => onChoice(choice)}>{choice}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {reply.answer && <Markdown text={reply.answer} sourceRefs={[]} />}

      {known && (
        <div className={`lx-assistant-card ${write ? 'lx-assistant-card--confirm' : ''}`}>
          <p className="lx-assistant-card__what">{what}</p>
          {write ? (
            <>
              <p className="lx-assistant-card__note">
                {prefillable
                  ? 'Nothing has changed yet. I will take you there with your words already filled in, so you can check it and finish.'
                  : 'Nothing has changed yet, and I will not change anything myself. I can open this page, but you will need to type the details yourself.'}
              </p>
              <div className="lx-assistant-row">
                <button type="button" className="lx-btn lx-btn--primary lx-btn--sm" onClick={onConfirm}>
                  Confirm and open
                </button>
              </div>
            </>
          ) : (
            <div className="lx-assistant-row">
              <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => onOpen(feature)}>
                Open
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ErrorCard({ turn, countdown, busy, onRetry, onDraft, onWorkspaces }) {
  const { code, message } = turn.error;
  const friendly = ERRORS[code] || ERRORS.ASSISTANT_UNAVAILABLE;
  const waiting = code === 'ASSISTANT_BUSY' && countdown > 0;

  return (
    <div className="lx-assistant-card lx-assistant-card--error" role="alert">
      <p className="lx-assistant-card__what">{friendly}</p>
      {code === 'ASSISTANT_BUSY' && (
        <p className="lx-assistant-card__note">
          {waiting ? `Trying again is possible in ${countdown}s.` : 'You can try again now.'}
        </p>
      )}
      {message && message !== friendly && <p className="lx-assistant-card__note">{message}</p>}
      <div className="lx-assistant-row">
        {WORKSPACE_CODES.has(code) ? (
          <button type="button" className="lx-btn lx-btn--primary lx-btn--sm" onClick={onWorkspaces}>
            Choose a workspace
          </button>
        ) : (
          <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" disabled={busy || waiting} onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={onDraft}>
          Open Auto-Draft with this text
        </button>
      </div>
    </div>
  );
}
