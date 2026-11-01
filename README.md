# ReviewLah.my

Site marketing (Classic, bleu et blanc) + adresses des plaques NFC/QR + espaces client et admin.

- `public/` : le site Classic (HTML/CSS/JS), servi sur `/`. Prototype : paiement non branché.
- `app/go/[code]` : `go.reviewlah.my/CODE?nfc` ou `?qr` enregistre un scan puis redirige vers la page d'avis Google.
- `app/login`, `app/dashboard`, `app/admin` : connexion par lien email, espace client (Basic : total des scans ; Pro : scans par jour et NFC/QR), espace admin (créer et gérer les plaques).
- `supabase/schema.sql` : tables, règles de sécurité (RLS) et fonctions. À lancer dans Supabase > SQL Editor.
- `proxy.js` : redirige `go.reviewlah.my/CODE` vers `/go/CODE` et rafraîchit la session de connexion.

## Variables d'environnement (optionnelles)
`NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` : par défaut ce sont celles du projet ReviewLah (clés publiques). Ne jamais mettre la clé `service_role` dans ce dépôt.

## Lancer en local
`npm install` puis `npm run dev`
