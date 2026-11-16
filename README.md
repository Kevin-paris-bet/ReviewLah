# ReviewLah.my

Site marketing (Classic, bleu et blanc) + adresses des plaques NFC/QR + espaces client et admin.

- `public/` : le site Classic (HTML/CSS/JS), servi sur `/`. Prototype : paiement non branché.
- `app/go/[code]` : `go.reviewlah.my/CODE?nfc` ou `?qr` enregistre un scan puis redirige vers la page d'avis Google.
- `app/login`, `app/dashboard`, `app/admin` : connexion par lien email, dashboard client (Basic et Pro), admin.
- `app/api` : webhooks de paiement, tâche quotidienne (cron Vercel), connexion Google Business Profile (derrière `GBP_ENABLED`).
- `app/privacy`, `app/terms` : pages légales publiques.
- `lib/payments` : couche paiement + adaptateur Airwallex. `lib/google`, `lib/ai` : Google Business Profile et brouillons de réponse.
- `supabase/migrations/` : migrations numérotées, idempotentes, à lancer dans l'ordre (`supabase/schema.sql` est l'ancien schéma, gardé pour référence).
- `proxy.js` : redirige `go.reviewlah.my/CODE` vers `/go/CODE` et rafraîchit la session de connexion.

## Documentation
- `PROGRESS.md` : ce qui est fait, ce qui reste, décisions, actions attendues.
- `docs/ENVIRONMENT.md` : liste exacte des variables d'environnement à créer dans Vercel.
- `docs/TEST-CHECKLIST.md` : tout tester avec la plaque de test.
- `docs/google-oauth-demo-video.md` : script de la vidéo pour la vérification OAuth de Google.

Ne jamais mettre de clé secrète dans ce dépôt : tout passe par les variables d'environnement Vercel.

## Lancer en local
`npm install` puis `npm run dev`. Tests : `npm test`. Toutes les pages contre une base locale (le vrai SQL, données de démo) : `npm run smoke:app`.
