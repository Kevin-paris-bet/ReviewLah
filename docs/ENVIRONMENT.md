# Variables d'environnement (Vercel > Settings > Environment Variables)

Aucun secret n'est dans le dépôt. Tu crées ces variables toi-même dans Vercel (environnement Production, et Preview si tu t'en sers), puis tu redéploies. La page `/admin/system` montre lesquelles sont en place, sans jamais afficher leur valeur.

## 1. À créer maintenant (le dashboard en a besoin)

| Variable | Valeur | Sert à |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | Supabase > Project Settings > API keys > clé secrète (`sb_secret_…`, ou l'ancienne `service_role`) | Webhooks de paiement, tâche quotidienne, emails, connexion Google. Jamais exposée au navigateur. |
| `CRON_SECRET` | Une chaîne aléatoire longue (`openssl rand -hex 32`) | Protège `/api/cron/daily`. Vercel l'envoie tout seul à la tâche planifiée. |
| `RESEND_API_KEY` | Resend > API Keys | Résumé mensuel, emails de facturation, alertes d'avis, transfert des messages de support. |
| `EMAIL_FROM` | `ReviewLah <hello@reviewlah.my>` (domaine vérifié dans Resend) | Expéditeur des emails. |
| `SUPPORT_EMAIL` | Ton adresse de support | Reçoit les messages du formulaire d'aide ; affichée sur la page d'aide. |
| `SUPPORT_WHATSAPP` | Numéro au format `+60…` (facultatif) | Bouton WhatsApp sur l'aide et la page Plan. |
| `LEGAL_ENTITY_NAME` | Nom légal de ta société | Affiché sur `/privacy`, `/terms` et en pied des emails. |
| `LEGAL_ENTITY_ADDRESS` | Adresse légale | Affichée sur `/privacy` et `/terms`. |
| `PRIVACY_EMAIL` | Adresse pour les demandes de données (facultatif, sinon `SUPPORT_EMAIL`) | `/privacy`. |
| `LEGAL_GOVERNING_LAW` | Par exemple `Malaysia` (facultatif) | Phrase « droit applicable » de `/terms`. |
| `SCAN_HASH_SECRET` | Chaîne aléatoire (facultatif) | Clé supplémentaire de l'empreinte de dédoublonnage. |

Déjà en place par défaut (clés publiques, rien à faire) : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL` (`https://www.reviewlah.my`), `NEXT_PUBLIC_GO_URL` (`https://go.reviewlah.my`).

## 2. Quand Airwallex a répondu

| Variable | Valeur |
| --- | --- |
| `PAYMENT_PROVIDER` | `airwallex` (tant qu'elle est vide, le Pro est manuel et la page Plan propose de nous écrire) |
| `AIRWALLEX_CLIENT_ID` | Airwallex > Developer > API keys |
| `AIRWALLEX_API_KEY` | idem |
| `AIRWALLEX_WEBHOOK_SECRET` | Airwallex > Developer > Webhooks, après avoir ajouté l'adresse `https://www.reviewlah.my/api/webhooks/airwallex` (événements `subscription.*` et `invoice.*`) |
| `AIRWALLEX_PRICE_MONTHLY` | Identifiant du prix RM29 / mois |
| `AIRWALLEX_PRICE_YEARLY` | Identifiant du prix RM290 / an |
| `AIRWALLEX_ENV` | `sandbox` pour tester, sinon ne pas la créer |
| `AIRWALLEX_LEGAL_ENTITY_ID`, `AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID`, `AIRWALLEX_API_VERSION` | Facultatives, seulement si Airwallex te les demande |

Les deux prix se créent à la main dans Airwallex (Products & Prices) ou avec `node scripts/airwallex-setup.mjs` (voir l'en-tête du fichier).

## 3. Quand Google a donné l'accès à l'API Business Profile

| Variable | Valeur |
| --- | --- |
| `GBP_ENABLED` | `true` (sinon tout ce qui touche Google reste invisible et fermé) |
| `GOOGLE_CLIENT_ID` | Google Cloud > APIs & Services > Credentials > OAuth client (type Web) |
| `GOOGLE_CLIENT_SECRET` | idem |
| `TOKEN_ENCRYPTION_KEY` | 32 octets aléatoires : `openssl rand -base64 32`. À ne jamais changer ensuite (sinon les connexions existantes deviennent illisibles). |
| `GOOGLE_PUBSUB_TOPIC` | `projects/<projet>/topics/<topic>` |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT` | Email du compte de service choisi pour l'authentification de l'abonnement push |
| `GOOGLE_PUBSUB_AUDIENCE` | Facultative. Par défaut `https://www.reviewlah.my/api/google/notifications` |
| `ANTHROPIC_API_KEY` | Console Anthropic > API keys (brouillons de réponse) |
| `ANTHROPIC_MODEL` | Facultative. Par défaut `claude-haiku-5-5` |

Réglages côté Google Cloud :
- Écran de consentement OAuth : un seul scope, `https://www.googleapis.com/auth/business.manage` ; page d'accueil `https://www.reviewlah.my`, politique de confidentialité `https://www.reviewlah.my/privacy`, conditions `https://www.reviewlah.my/terms`.
- Client OAuth : URI de redirection autorisée `https://www.reviewlah.my/api/google/callback`.
- APIs à activer : My Business Account Management, My Business Business Information, Google My Business API (v4, avis), My Business Notifications, Pub/Sub.
- Pub/Sub : créer le topic, donner le rôle « Pub/Sub Publisher » sur ce topic à `mybusiness-api-pubsub@system.gserviceaccount.com`, puis créer un abonnement **push** vers `https://www.reviewlah.my/api/google/notifications` avec « Enable authentication », le compte de service ci-dessus, et la même adresse comme audience.
