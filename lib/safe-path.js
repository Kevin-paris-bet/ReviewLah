/** Accepts only a path inside this site (used for ?next=… after login). */
export function safeNextPath(value, fallback = '/dashboard') {
  const path = String(value || '');
  if (!/^\/(dashboard|admin)(\/[A-Za-z0-9\-_/]*)?(\?[A-Za-z0-9\-_=&%.]*)?$/.test(path)) return fallback;
  return path;
}
