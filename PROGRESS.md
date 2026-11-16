# ReviewLah — avancement du logiciel (dashboard client)

Mis à jour à chaque étape. Pour reprendre dans une nouvelle conversation : « reprends depuis PROGRESS.md ».

Dernière mise à jour : 17 nov. 2026 — phases 1 à 4 livrées côté code. Suite : admin (5), Google (6), finitions (7).

## Où on en est

| Phase | Contenu | État |
| --- | --- | --- |
| 1 | Données et performances | Code livré. Migrations 0001–0004 à appliquer en production |
| 2 | Dashboard Basic | Livré |
| 3 | Dashboard Pro (hors Google) | Livré |
| 4 | Abonnement et paiement | Livré (adaptateur Airwallex prêt, en attente des clés) |
| 5 | Admin | SQL prêt, interface à faire |
| 6 | Google Business Profile (`GBP_ENABLED`) | À faire |
| 7 | Finitions et checklist | À faire |

## Phase 1 — ce qui est fait

- **Modèle** : `companies` (l'entreprise cliente, un login) → `businesses` (un lieu) → `plates`. `subscriptions` par lieu. Les colonnes historiques de `plates` (`business_name`, `owner_email`, `owner_id`, `plan`) restent en place pendant la transition et sont tenues à jour.
- **Pro** : lu depuis `subscriptions` par `business_is_pro(lieu)`. `plates.plan` n'est plus lu. La plaque existante en `plan = 'pro'` reçoit un abonnement manuel à la migration.
- **Statistiques en SQL** : `dashboard_bootstrap()` (toute la page d'accueil en un appel), `scan_stats()`, `scan_compare()`, `export_scans()`, `monthly_summary_data()`. Compteurs `total_scans` / `last_scan_at` sur la plaque : le Basic ne lit jamais la table `scans`.
- **Fuseau** : tous les découpages jour / heure / jour de semaine / mois se font en `Asia/Kuala_Lumpur`.
- **Dédoublonnage** : un même appareil qui retape la même plaque dans les 15 secondes ne compte qu'une fois. Aucune IP n'est envoyée ni stockée : le serveur envoie une empreinte (hash de IP + navigateur + plaque + jour), la base la re-hache avec un sel qui ne sort jamais de la base, et l'efface après 2 jours.
- **Route `/go`** : un seul appel base, délai max 2 s. Si la base ne connaît pas encore la nouvelle fonction (migration pas appliquée), repli sur l'ancienne. Si la base ne répond pas, redirection immédiate vers la dernière destination connue (mémoire du serveur + cache partagé) et nouvel essai d'enregistrement après la réponse. Aperçus de liens, robots et préchargements : redirigés, jamais comptés.
- **RLS** : aucun accès direct aux tables pour les visiteurs anonymes ; un patron ne lit que ses lignes ; toute écriture passe par des fonctions qui vérifient le propriétaire ; les lignes de scans ne sont lisibles que pour un lieu Pro.
- **Tests** (`npm test`) : 111 tests. Les migrations tournent telles quelles sur un vrai PostgreSQL en mémoire (PGlite) : migration des données existantes, idempotence, compatibilité avec l'ancienne version de l'app, RLS, fuseau horaire, dédoublonnage, événements de paiement, admin.
- **Test de bout en bout de `/go`** (`npm run smoke:go`) : contre une fausse API de base, y compris base en panne et serveur à froid.

## Phases 2 et 3 — ce qui est fait

- **Overview** (`/dashboard`) : tous les lieux et toutes les plaques, total des scans, dernier scan. Rappel permanent : un scan n'est pas un avis.
- **Lieu** (`/dashboard/locations/<id>`) : le patron change lui-même le lien Google (validé côté app et côté base, appliqué à toutes les plaques du lieu), renomme ses plaques, modifie nom et adresse.
- **Compte** (`/dashboard/account`) : nom, contact, téléphone, WhatsApp, préférences d'emails, changement d'email de connexion (confirmé par lien).
- **Aide** (`/dashboard/help`) : FAQ, formulaire de support (enregistré en base et transmis à `SUPPORT_EMAIL`), WhatsApp.
- **Upsell Pro** : un seul encart discret sur l'overview et un écran « ce que Pro ajoute » à la place des écrans Pro. Aucun chiffre Pro n'est calculé ni envoyé pour un lieu Basic.
- **Analytics** (`/dashboard/analytics`) : 7 / 30 / 90 jours, par jour / semaine / mois, comparaison avec la période précédente, NFC / QR, heures et jours de pointe, par plaque.
- **Comparaison** (`/dashboard/compare`) : lieux et plaques côte à côte.
- **Page de liens** (`/dashboard/links`, publique sur `/l/<slug>`) : le bouton d'avis Google est toujours le premier, identique pour tout le monde.
- **Export CSV** (`/dashboard/export`) : en flux, heure de Malaisie.
- **Connexion** : lien email, plus saisie du code à 6 chiffres si l'email est ouvert sur un autre appareil.
- **Vérification des pages** (`npm run smoke:app`) : toutes les pages sont rendues contre une base locale (le vrai SQL), pour le patron, un second client, un nouveau login, l'admin et un visiteur.

- **Résumé mensuel par email** (Resend) : envoyé le 1er du mois à 9 h (heure de Malaisie) aux clients qui ont au moins un lieu Pro. Scans, évolution par rapport au mois précédent, NFC / QR, meilleur jour, heure et jour de pointe, par plaque. Un client ne le reçoit qu'une fois par mois même si la tâche tourne plusieurs fois (`email_log`). Désactivable dans Compte.
- **Cron Vercel** (`vercel.json`, une seule tâche par jour, compatible offre Hobby) : `/api/cron/daily` ferme les abonnements arrivés à échéance, efface les empreintes de dédoublonnage, envoie le résumé mensuel les premiers jours du mois. Protégé par `CRON_SECRET`.

## Phase 4 — ce qui est fait

- **Couche paiement** (`lib/payments/index.js`) : l'app ne connaît qu'une interface (ouvrir un paiement, vérifier un webhook, traduire un événement, arrêter / reprendre le renouvellement). Changer de fournisseur = écrire un adaptateur et changer `PAYMENT_PROVIDER`.
- **Adaptateur Airwallex Billing** (`lib/payments/airwallex.js`) : page de paiement hébergée (mode abonnement), webhooks signés (HMAC-SHA256 sur horodatage + corps, refus au-delà de 5 minutes), renouvellement, échec de paiement (Pro maintenu pendant les relances), annulation, factures. Écrit d'après la documentation publique d'Airwallex Billing ; **à valider en sandbox dès que tu as les clés**.
- **Webhook** : `/api/webhooks/airwallex`. Le Pro n'est accordé que par un événement signé (ou par la relecture serveur à serveur au retour du paiement), jamais par le navigateur. Un événement livré deux fois n'est appliqué qu'une fois ; un événement ancien n'écrase jamais un état plus récent.
- **Page « Plan and payments »** (`/dashboard/billing`) : par lieu, passer en Pro mensuel ou annuel, annuler le renouvellement, le reprendre, voir les paiements et les factures. Tant que le paiement en ligne n'est pas ouvert, la page propose de nous écrire.
- **Promesse du site respectée** : l'annulation ou la fin du Pro ne touche ni la plaque ni le Basic (testé).
- **Emails de facturation** : Pro activé, paiement échoué (avec lien de la facture), Pro terminé.
- `scripts/airwallex-setup.mjs` : crée le produit et les deux prix (RM29 / mois, RM290 / an) dans ton compte Airwallex et affiche les deux identifiants à mettre dans Vercel.

## Migrations SQL

Dans `supabase/migrations/`, à lancer dans l'ordre. Toutes sont idempotentes (relançables) et compatibles avec les plaques déjà programmées.

| Fichier | Contenu | En production |
| --- | --- | --- |
| `0001_core.sql` | entreprises, lieux, abonnements, dédoublonnage, RLS, `record_scan` | Non |
| `0002_stats.sql` | statistiques en SQL, fuseau KL | Non |
| `0003_owner_features.sql` | lien Google modifiable, compte, page de liens, support | Non |
| `0004_billing_admin.sql` | paiements, webhooks, outils admin, maintenance | Non |

Sauvegarde avant migration : export complet des tables `plates`, `scans`, `admins` relu le 16 nov. 2026 (1 plaque, 5 scans, 1 admin), conservé dans le notebook Supabase « ReviewLah — table export before migration (read-only) ».

## Décisions prises

- **Entreprise et lieu sont deux tables.** `businesses` = un lieu, comme demandé ; `companies` porte le propriétaire (email de connexion), ce qui permet plusieurs lieux par entreprise sans dupliquer le compte.
- **Un lien Google par lieu**, appliqué à toutes les plaques du lieu. Seuls des liens Google (avis ou Maps, en https) sont acceptés, côté app et côté base.
- **Pas de review gating** : la plaque redirige tout le monde vers la même page Google, sans page intermédiaire.
- **Période de grâce** : 3 jours après la fin de période payée (retard de webhook), 8 jours si le paiement est en échec et en cours de relance. Aucun délai pour un Pro manuel.
- **Commits sans ligne `Co-Authored-By`** : sur Vercel, un co-auteur qui n'est pas membre du projet peut bloquer le déploiement.

## Actions attendues de ta part

(Complété au fil des phases. Liste finale en fin de projet.)
