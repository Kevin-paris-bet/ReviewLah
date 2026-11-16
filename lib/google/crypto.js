// Encryption of Google OAuth tokens before they are stored (AES-256-GCM).
// The key lives only in the TOKEN_ENCRYPTION_KEY environment variable: 32 random bytes, written
// as 64 hex characters or as base64 (generate one with: openssl rand -base64 32).
// A stored value looks like  v1.<iv>.<tag>.<ciphertext>  (base64url parts).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function parseKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    try {
      key = Buffer.from(raw, 'base64');
    } catch {
      key = null;
    }
  }
  return key && key.length === 32 ? key : null;
}

export function encryptToken(plain, keyValue) {
  const key = parseKey(keyValue);
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** Returns the token, or throws when the value was altered or the key is not the right one. */
export function decryptToken(stored, keyValue) {
  const key = parseKey(keyValue);
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)');
  const [version, iv, tag, data] = String(stored || '').split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('unreadable token');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
