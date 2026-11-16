'use client';
// The few interactive pieces. Everything else in the dashboard is server-rendered HTML.
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';
import { LINK_KINDS, MAX_LINKS } from '../../lib/validation';

export function NavLinks({ items, footer }) {
  const pathname = usePathname() || '';
  return (
    <nav className="nav" aria-label="Dashboard">
      {items.map((item) => {
        const active = pathname === item.href
          || (!item.exact && pathname.startsWith(`${item.href}/`))
          || (item.also || []).some((p) => pathname.startsWith(p));
        return (
          <a key={item.href} href={item.href} className={item.desk ? 'desk' : undefined} aria-current={active ? 'page' : undefined}>
            <Icon name={item.icon} />
            <span>{item.text}</span>
          </a>
        );
      })}
      {footer && <div className="nav-foot">{footer}</div>}
    </nav>
  );
}

/** Submit button that shows it is working and cannot be pressed twice. */
export function Submit({ children, pending = 'Saving…', className = 'btn', ...rest }) {
  const status = useFormStatus();
  return (
    <button type="submit" className={className} disabled={status.pending} {...rest}>
      {status.pending ? pending : children}
    </button>
  );
}

export function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button type="button" className="btn out small" onClick={copy} aria-live="polite">
      {copied ? 'Copied' : label}
    </button>
  );
}

/** Reloads the page with the chosen value in the address (location / plate pickers). */
export function SelectNav({ name, value, options, label, params = {} }) {
  function change(event) {
    const next = new URLSearchParams(params);
    if (event.target.value) next.set(name, event.target.value);
    else next.delete(name);
    window.location.assign(`${window.location.pathname}?${next.toString()}`);
  }
  return (
    <label style={{ margin: 0 }}>
      <span className="sr">{label}</span>
      <select value={value || ''} onChange={change} aria-label={label}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
      </select>
    </label>
  );
}

/** Editor of the links page: add, remove and reorder lines. Sent as one JSON field. */
export function LinksEditor({ initial }) {
  const [rows, setRows] = useState(() => (initial?.length ? initial.map((r, i) => ({ ...r, id: i })) : [{ id: 0, kind: 'menu', label: '', url: '' }]));
  const [nextId, setNextId] = useState(() => (initial?.length || 1) + 1);
  const update = (id, patch) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id) => setRows((list) => list.filter((r) => r.id !== id));
  const move = (index, by) => setRows((list) => {
    const to = index + by;
    if (to < 0 || to >= list.length) return list;
    const copy = [...list];
    [copy[index], copy[to]] = [copy[to], copy[index]];
    return copy;
  });
  function add() {
    setRows((list) => [...list, { id: nextId, kind: 'other', label: '', url: '' }]);
    setNextId((n) => n + 1);
  }
  const meta = (kind) => LINK_KINDS.find((k) => k.kind === kind) || LINK_KINDS.at(-1);

  return (
    <div>
      <input type="hidden" name="links" value={JSON.stringify(rows.map(({ kind, label, url }) => ({ kind, label, url })))} />
      {rows.map((row, index) => (
        <div className="linkrow" key={row.id}>
          <select aria-label={`Link ${index + 1}: type`} value={row.kind} onChange={(e) => update(row.id, { kind: e.target.value })}>
            {LINK_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.name}</option>)}
          </select>
          <input
            aria-label={`Link ${index + 1}: button text`}
            value={row.label}
            maxLength={40}
            placeholder={meta(row.kind).defaultLabel || 'Button text'}
            onChange={(e) => update(row.id, { label: e.target.value })}
          />
          <input
            aria-label={`Link ${index + 1}: link or number`}
            value={row.url}
            maxLength={500}
            inputMode={row.kind === 'whatsapp' || row.kind === 'phone' ? 'tel' : 'url'}
            placeholder={meta(row.kind).placeholder}
            onChange={(e) => update(row.id, { url: e.target.value })}
          />
          <div className="linkrow-actions">
            <button type="button" className="btn out small" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move link ${index + 1} up`}>↑</button>
            <button type="button" className="btn out small" onClick={() => move(index, 1)} disabled={index === rows.length - 1} aria-label={`Move link ${index + 1} down`}>↓</button>
            <button type="button" className="btn danger small" onClick={() => remove(row.id)} aria-label={`Remove link ${index + 1}`}>Remove</button>
          </div>
        </div>
      ))}
      {rows.length < MAX_LINKS ? (
        <button type="button" className="btn out small" onClick={add}>Add a link</button>
      ) : (
        <p className="muted">You can add up to {MAX_LINKS} links.</p>
      )}
    </div>
  );
}
