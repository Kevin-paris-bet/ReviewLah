# ReviewLah — avancement du logiciel (dashboard client)

Mis à jour à chaque étape. Pour reprendre dans une nouvelle conversation : « reprends depuis PROGRESS.md ».

Dernière mise à jour : 17 nov. 2026 — les 7 phases sont livrées côté code. Il reste des actions de ta part (migrations, variables, clés Airwallex, accès Google) : voir la fin du fichier.

## Où on en est

| Phase | Contenu | État |
| --- | --- | --- |
| 1 | Données et performances | Code livré. Migrations 0001–0004 à appliquer en production |
| 2 | Dashboard Basic | Livré |
| 3 | Dashboard Pro (hors Google) | Livré |
| 4 | Abonnement et paiement | Livré (adaptateur Airwallex prêt, en attente des clés) |
| 5 | Admin | Livré |
| 6 | Google Business Profile (GBP_ENABLED) | Livré, désactivé par défaut. À valider avec la vraie API quand Google donne l'accès |
| 7 | Finitions et checklist | Livré |

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

## Phase 5 — ce qui est fait

- `/admin` : chiffres clés et **un seul formulaire** pour créer entreprise + lieu + plaques (+ Pro manuel). Les codes et les deux adresses à programmer (NFC, QR) s'affichent sur la page suivante.
- `/admin/customers` et la fiche client : lieux, plaques (pause, nom, déplacement, suppression si jamais scannée, ajout), lien Google, **Pro manuel on / off avec date de fin**, arrêt ou reprise d'un abonnement payé, coordonnées, email de connexion, notes internes, paiements, demandes de support, historique.
- `/admin/plates`, `/admin/subscriptions`, `/admin/support`, `/admin/system` (quelles variables sont configurées, sans jamais afficher leur valeur ; derniers webhooks ; derniers emails).
- Un non-admin est renvoyé vers son dashboard ; chaque fonction SQL revérifie le rôle admin.

## Phase 6 — ce qui est fait (invisible tant que `GBP_ENABLED` n'est pas `true`)

- **Connect Google** (`/dashboard/google`) : OAuth web, scope `business.manage` uniquement, retour sur `/api/google/callback` avec contrôle du `state`, jeton chiffré (AES-256-GCM, clé `TOKEN_ENCRYPTION_KEY`) dans une table illisible par l'API. Jamais de mot de passe Google.
- **Choix des lieux** : le patron associe une fiche Google à chaque lieu Pro ; la fiche est revérifiée chez Google avant d'être liée.
- **Avis** (`/dashboard/reviews`) : import via l'API v4, note moyenne, répartition, filtres (à répondre, répondu, 1 à 3 étoiles).
- **Alertes** : Pub/Sub en push sur `/api/google/notifications`, jeton OIDC vérifié (signature Google, audience, compte de service) ; email au patron ; synchro de secours dans la tâche quotidienne.
- **Brouillons IA** en anglais, malais, chinois (API Claude). Seuls la note, le texte de l'avis et le nom du commerce sont envoyés, pas le nom de l'auteur. Le patron modifie puis appuie sur « Approve and publish » : c'est le seul chemin vers `reviews.updateReply`. **Aucune publication automatique** (testé).
- **Tendances des avis** dans le résumé mensuel, séparées des scans.
- **Disconnect Google and delete data** : révoque l'accès chez Google et supprime jetons, fiches liées, avis et brouillons. Les données Google d'un lieu sont aussi supprimées 30 jours après la fin du Pro.
- **`/privacy` et `/terms`** : pages publiques, liées depuis le pied de page du site.
- **Script de la vidéo de démo** : `docs/google-oauth-demo-video.md`.

Limite à connaître : le code Google et Airwallex suit la documentation publique et est couvert par des tests avec des réponses simulées, mais n'a jamais parlé aux vraies API (pas de clés). Prévoir une passe de validation à l'arrivée des accès.

## Phase 7 — finitions

- Next.js mis à jour en 16.4.6 (la version précédente était signalée comme vulnérable et bloquait le build).
- Contrôle dans un vrai navigateur (largeur mobile 390 px) : pages principales sans défilement horizontal, formulaires réels soumis (lien Google, brouillon, création admin, Pro manuel, pause de plaque).
- Deux liens du site modifiés : « Log in » pointe vers la vraie page `/login`, « Privacy » et « Terms » du pied de page vers `/privacy` et `/terms`. Rien d'autre n'a été touché sur le site.

## Migrations SQL

Dans `supabase/migrations/`, à lancer dans l'ordre. Toutes sont idempotentes (relançables) et compatibles avec les plaques déjà programmées.

| Fichier | Contenu | En production |
| --- | --- | --- |
| `0001_core.sql` | entreprises, lieux, abonnements, dédoublonnage, RLS, `record_scan` | Non |
| `0002_stats.sql` | statistiques en SQL, fuseau KL | Non |
| `0003_owner_features.sql` | lien Google modifiable, compte, page de liens, support | Non |
| `0004_billing_admin.sql` | paiements, webhooks, outils admin, maintenance | Non |
| `0005_google.sql` | connexion Google, fiches liées, avis, brouillons (inutilisé tant que `GBP_ENABLED` est éteint) | Non |

Sauvegarde avant migration : export complet des tables `plates`, `scans`, `admins` relu le 16 nov. 2026 (1 plaque, 5 scans, 1 admin), conservé dans le notebook Supabase « ReviewLah — table export before migration (read-only) ».

## Décisions prises

- **Entreprise et lieu sont deux tables.** `businesses` = un lieu, comme demandé ; `companies` porte le propriétaire (email de connexion), ce qui permet plusieurs lieux par entreprise sans dupliquer le compte.
- **Un lien Google par lieu**, appliqué à toutes les plaques du lieu. Seuls des liens Google (avis ou Maps, en https) sont acceptés, côté app et côté base.
- **Pas de review gating** : la plaque redirige tout le monde vers la même page Google, sans page intermédiaire.
- **Période de grâce** : 3 jours après la fin de période payée (retard de webhook), 8 jours si le paiement est en échec et en cours de relance. Aucun délai pour un Pro manuel.
- **Commits sans ligne `Co-Authored-By`** : sur Vercel, un co-auteur qui n'est pas membre du projet peut bloquer le déploiement.

## Actions attendues de ta part

1. **Appliquer les migrations** (priorité : tant que ce n'est pas fait, le dashboard affiche « We are updating your dashboard » ; la plaque, elle, redirige normalement). La demande de confirmation Supabase du 17 nov. est restée sans réponse. Deux façons :
   - dire à Claude « applique les migrations » et accepter la confirmation Supabase qui s'affiche ;
   - ou, dans Supabase > SQL Editor, lancer d'abord le notebook « ReviewLah — 00 backup before migration », puis coller et exécuter dans l'ordre `0001_core.sql`, `0002_stats.sql`, `0003_owner_features.sql`, `0004_billing_admin.sql`, `0005_google.sql`.
2. **Créer les variables d'environnement** du bloc 1 de `docs/ENVIRONMENT.md` dans Vercel, puis redéployer.
3. **Supabase > Authentication** : vérifier que `https://www.reviewlah.my/auth/callback` et `https://www.reviewlah.my/auth/confirm` sont dans les Redirect URLs, et que le modèle d'email « Magic Link » contient bien le code `{{ .Token }}` si tu veux la saisie du code à 6 chiffres.
4. **Dérouler `docs/TEST-CHECKLIST.md`** (parties A à D) avec ta plaque.
5. **Airwallex**, quand ils ont répondu : bloc 2 de `docs/ENVIRONMENT.md`, d'abord en sandbox, puis partie E de la checklist.
6. **Google**, quand l'accès est accordé : bloc 3 de `docs/ENVIRONMENT.md`, vidéo (`docs/google-oauth-demo-video.md`), partie F de la checklist.
7. **Faire relire `/privacy` et `/terms`** par un juriste et renseigner `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_ADDRESS`, `LEGAL_GOVERNING_LAW`. La loi PDPA demande aussi un avis en malais : à faire traduire.
8. Le site affiche encore le bandeau « Private preview · Orders not open yet » et un tunnel de commande de démonstration : à ouvrir quand tu vends.
