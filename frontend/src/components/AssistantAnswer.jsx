import React, { useState } from 'react';
import * as Ic from '../icons.jsx';
import Markdown from './Markdown.jsx';

const BADGED_KINDS = new Set(['grounded', 'general_legal', 'general', 'unverified']);
const WARNING_NOTE_KINDS = new Set(['unverified', 'general_legal']);
// TODO: The non-grounded warning note below is English only; needs native Hindi/Tamil review later.
const NON_GROUNDED_WARNING = 'This answer may be wrong. Please check with a lawyer or an official source.';

/**
 * Strip Markdown images ![alt](url) and turn Markdown links [text](url) into plain text
 * before handing the text to Markdown.jsx (which itself never uses dangerouslySetInnerHTML).
 */
export function sanitizeAnswerMarkdown(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  let out = raw.replace(/!\[[^\]]*\]\((?:[^\s()]|\([^\s()]*\))*\)/g, '');
  out = out.replace(/\[([^\]\n]+)\]\((?:[^\s()]|\([^\s()]*\))*\)/g, '$1');
  return out;
}

/**
 * Allow only internal app routes starting with a single "/" and containing no scheme.
 */
export function isSafeInternalRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/')) return false;
  if (route.startsWith('//') || route.includes('://')) return false;
  return true;
}

export default function AssistantAnswer({ reply, onOpenSuggestion }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('idle');

  const answerText = typeof reply?.answer === 'string' ? reply.answer : '';
  const answerKind = reply?.answerKind || 'none';
  const badge = typeof reply?.badge === 'string' ? reply.badge.trim() : '';
  const showBadge = Boolean(badge) && BADGED_KINDS.has(answerKind);
  const showWarningNote = WARNING_NOTE_KINDS.has(answerKind);
  const sources = Array.isArray(reply?.sources) ? reply.sources : [];
  const currencyFlags = Array.isArray(reply?.currencyFlags) ? reply.currencyFlags : [];
  const suggestion = reply?.suggestion;
  const hasValidSuggestion = Boolean(
    suggestion &&
    typeof suggestion.name === 'string' &&
    suggestion.name.trim() &&
    isSafeInternalRoute(suggestion.route),
  );

  const sanitizedText = sanitizeAnswerMarkdown(answerText);

  async function handleCopy() {
    const payload = showBadge ? `${answerText}\n${badge}` : answerText;
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(payload);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
  }

  return (
    <div className="lx-assistant-card lx-assistant-card--answer">
      <div className="lx-assistant-answer__header">
        {showBadge && (
          <span
            className={`lx-assistant-badge lx-assistant-badge--${answerKind === 'grounded' ? 'grounded' : 'caution'}`}
          >
            {answerKind === 'grounded' ? (
              <Ic.Shield size={14} aria-hidden="true" />
            ) : (
              <Ic.Scale size={14} aria-hidden="true" />
            )}
            <span className="lx-assistant-badge__text">{badge}</span>
          </span>
        )}
        <div className="lx-assistant-answer__copy-wrap">
          <button
            type="button"
            className="lx-btn lx-btn--ghost lx-assistant-copy-btn"
            onClick={handleCopy}
          >
            <Ic.Copy size={14} aria-hidden="true" />
            <span>{copyStatus === 'copied' ? 'Copied' : 'Copy'}</span>
          </button>
          <span className="lx-assistant-copy-status" role="status" aria-live="polite">
            {copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Could not copy' : ''}
          </span>
        </div>
      </div>

      <Markdown text={sanitizedText} sourceRefs={[]} className="lx-assistant-answer__body" />

      {showWarningNote && (
        <p className="lx-assistant-warning-note">{NON_GROUNDED_WARNING}</p>
      )}

      {currencyFlags.length > 0 && (
        <div className="lx-assistant-currency-list">
          {currencyFlags.map((flag, idx) => (
            <div key={flag?.code || idx} className="lx-assistant-currency-note">
              {String(flag?.note || '')}
            </div>
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <div className="lx-assistant-sources">
          <button
            type="button"
            className="lx-btn lx-btn--ghost lx-assistant-sources__toggle"
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen((open) => !open)}
          >
            <Ic.Doc size={14} aria-hidden="true" />
            <span>{`Sources (${sources.length})`}</span>
          </button>
          {sourcesOpen && (
            <ul className="lx-assistant-sources__list">
              {sources.map((src, idx) => {
                const tag = src?.ref || (typeof src?.n === 'number' ? `S${src.n}` : `S${idx + 1}`);
                const title = typeof src?.title === 'string' ? sanitizeAnswerMarkdown(src.title) : '';
                const ref = typeof src?.ref === 'string' ? src.ref : '';
                const snippet = typeof src?.snippet === 'string' ? sanitizeAnswerMarkdown(src.snippet) : '';
                return (
                  <li key={`${tag}-${idx}`} className="lx-assistant-sources__item">
                    <div className="lx-assistant-sources__head">
                      <span className="lx-assistant-sources__tag">{tag}</span>
                      {title && <span className="lx-assistant-sources__title">{title}</span>}
                      {ref && ref !== tag && <span className="lx-assistant-sources__ref">{ref}</span>}
                    </div>
                    {snippet && <p className="lx-assistant-sources__snippet">{snippet}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {hasValidSuggestion && (
        <div className="lx-assistant-card__actions">
          <button
            type="button"
            className="lx-btn lx-btn--ghost lx-assistant-suggestion-btn"
            onClick={() => onOpenSuggestion(suggestion.route)}
          >
            {`Open ${suggestion.name}`} <Ic.Arrow size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
