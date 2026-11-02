import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Markdown, { safeHref } from '../components/Markdown.jsx';

const html = (text, props = {}) => render(<Markdown text={text} {...props} />).container;

afterEach(() => { vi.restoreAllMocks(); });

describe('Markdown: formatting', () => {
  it('renders bold and italic without showing the markers', () => {
    const c = html('This is **bold**, *italic* and _also italic_.');
    expect(c.querySelector('strong').textContent).toBe('bold');
    expect(c.querySelectorAll('em')).toHaveLength(2);
    expect(c.textContent).toBe('This is bold, italic and also italic.');
    expect(c.textContent).not.toMatch(/[*_]/);
  });

  it('nests italic inside bold', () => {
    const c = html('**very *important* point**');
    expect(c.querySelector('strong em').textContent).toBe('important');
    expect(c.textContent).not.toContain('*');
  });

  it('renders paragraphs and keeps single line breaks', () => {
    const c = html('First paragraph.\n\nSecond line one\nsecond line two');
    const ps = c.querySelectorAll('p');
    expect(ps).toHaveLength(2);
    expect(ps[1].querySelector('br')).toBeTruthy();
  });

  it('renders bulleted and numbered lists', () => {
    const c = html('Intro\n\n- one\n- two\n* three\n\n1. first\n2. second\n3) third');
    expect(c.querySelectorAll('ul > li')).toHaveLength(3);
    const ol = c.querySelector('ol');
    expect([...ol.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['first', 'second', 'third']);
  });

  it('keeps the numbering start of a list', () => {
    expect(html('3. three\n4. four').querySelector('ol').getAttribute('start')).toBe('3');
  });

  it('shows a heading line as bold text without the # marks', () => {
    const c = html('## Holding\nThe court held.');
    expect(c.textContent).not.toContain('#');
    expect(c.querySelector('p').textContent).toBe('Holding');
  });

  it('copes with empty, null and non-string input', () => {
    expect(html('').textContent).toBe('');
    expect(html(null).textContent).toBe('');
    expect(html(undefined).textContent).toBe('');
  });
});

describe('Markdown: links', () => {
  it('makes an https link that opens safely', () => {
    const a = html('See [the Act](https://indiacode.nic.in/x?a=1&b=2).').querySelector('a');
    expect(a.getAttribute('href')).toBe('https://indiacode.nic.in/x?a=1&b=2');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it('allows http too', () => {
    expect(html('[x](http://example.com/a)').querySelector('a').getAttribute('href')).toBe('http://example.com/a');
  });

  it.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'vbscript:msgbox(1)',
    'file:///etc/passwd', '//evil.example/x', '/relative/path', 'ftp://example.com/x',
  ])('never turns %s into a link', (url) => {
    const c = html(`[click me](${url})`);
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toBe('click me');
  });

  it('safeHref only accepts http and https', () => {
    expect(safeHref('https://a.b/c')).toBe('https://a.b/c');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
  });
});

describe('Markdown: no raw HTML, ever (XSS)', () => {
  it.each([
    '<script>window.__pwned = 1</script>',
    '<img src=x onerror="window.__pwned = 1">',
    '<svg onload="window.__pwned = 1"></svg>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:alert(1)" onclick="window.__pwned = 1">x</a>',
    '<div style="background:url(javascript:alert(1))">x</div>',
    '**<b onmouseover="window.__pwned = 1">bold</b>**',
    '- <img src=x onerror="window.__pwned = 1">',
    '[<img src=x onerror="window.__pwned = 1">](https://ok.example)',
    '</p><script>window.__pwned = 1</script><p>',
  ])('shows %s as inert text', (payload) => {
    delete window.__pwned;
    const c = html(payload);
    expect(c.querySelector('script, img, svg, iframe, style, object, embed, form, input, b')).toBeNull();
    expect(c.innerHTML).not.toMatch(/<(script|img|svg|iframe|object|embed)\b/i);
    const attrs = [...c.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.name.toLowerCase()));
    expect(attrs.filter((n) => n.startsWith('on') || n === 'srcdoc')).toEqual([]);
    expect(window.__pwned).toBeUndefined();
    expect(c.textContent).toContain(payload.replace(/\*\*/g, '').replace(/^- /, '').replace(/^\[|\]\(.*\)$/g, '').slice(0, 6));
  });

  it('escapes HTML entities instead of decoding them', () => {
    const c = html('&lt;script&gt;alert(1)&lt;/script&gt; and <b>x</b>');
    expect(c.querySelector('script, b')).toBeNull();
    expect(c.textContent).toContain('<b>x</b>');
  });

  it('does not use dangerouslySetInnerHTML', async () => {
    const src = await import('../components/Markdown.jsx?raw');
    expect(src.default).not.toMatch(/dangerouslySetInnerHTML\s*=/);
  });
});

describe('Markdown: [S1] source tags', () => {
  it('turns a known tag into a button that jumps to its source card', () => {
    const scrollIntoView = vi.fn();
    const card = document.createElement('div');
    card.id = 'source-S1';
    card.tabIndex = -1;
    card.scrollIntoView = scrollIntoView;
    document.body.appendChild(card);
    html('Limitation is three years [S1].', { sourceRefs: ['S1'] });
    const btn = screen.getByRole('button', { name: 'Go to source S1' });
    fireEvent.click(btn);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(card);
    card.remove();
  });

  it('leaves a tag with no matching source as plain text', () => {
    const c = html('Cited [S1] and [S9].', { sourceRefs: new Set(['S1']) });
    expect(c.querySelectorAll('button')).toHaveLength(1);
    expect(c.textContent).toContain('[S9]');
  });

  it('shows tags as plain text when no sources are given', () => {
    const c = html('Cited [S1].');
    expect(c.querySelector('button')).toBeNull();
    expect(c.textContent).toContain('[S1]');
  });
});
