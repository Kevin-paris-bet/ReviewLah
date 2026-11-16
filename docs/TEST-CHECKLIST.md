# Checklist de test avec ta plaque

Prérequis : migrations 0001 à 0005 appliquées, variables du bloc 1 de `docs/ENVIRONMENT.md` créées, dernier déploiement Vercel au vert.

## A. La plaque (2 minutes)
- [ ] Tape la plaque (NFC) : la page d'avis Google s'ouvre immédiatement.
- [ ] Scanne le QR : même page.
- [ ] Retape dans les 5 secondes : la page s'ouvre, mais un seul scan de plus est compté.
- [ ] Attends 15 secondes et retape : un scan de plus.
- [ ] Ouvre `go.reviewlah.my/XXXXX` (code inconnu) : retour sur le site, aucune erreur.

## B. Dashboard Basic (compte client, lieu en Basic)
- [ ] `/login` : reçois le lien, connecte-toi. Essaie aussi le code à 6 chiffres.
- [ ] Overview : le lieu, la plaque et le total des scans correspondent à tes essais. Le texte dit bien « scans », jamais « reviews ».
- [ ] Ouvre le lieu, change le lien Google pour un autre lien Google valide : accepté. Tape la plaque : elle ouvre le nouveau lien (attendre jusqu'à 1 minute). Remets le bon lien.
- [ ] Essaie `https://example.com` : refusé avec un message clair.
- [ ] Compte : change nom et téléphone, enregistre.
- [ ] Aide : envoie un message. Il arrive sur `SUPPORT_EMAIL` et dans `/admin/support`.
- [ ] Analytics, Compare, Links : l'écran « ce que Pro ajoute » s'affiche, aucun chiffre détaillé.

## C. Admin
- [ ] `/admin` : crée un client de test (ton second email), un lieu, 2 plaques. La page suivante affiche les codes et les adresses NFC / QR.
- [ ] Fiche client : « Switch Pro on » avec une date de fin. Le badge passe à Pro.
- [ ] Mets une plaque en pause : `go.reviewlah.my/CODE` renvoie vers le site. Réactive-la.
- [ ] `/admin/system` : les variables créées apparaissent « SET », aucune valeur n'est visible.
- [ ] Connecte-toi avec un compte non admin et ouvre `/admin` : renvoi vers le dashboard.

## D. Dashboard Pro (lieu passé en Pro par l'admin)
- [ ] Analytics : périodes 7 / 30 / 90 jours, par jour / semaine / mois. Tes scans de test sont au bon jour et à la bonne heure **en heure de Malaisie** (essaie un scan entre minuit et 8 h : il doit être compté sur le jour malaisien).
- [ ] NFC / QR : la répartition correspond à tes essais.
- [ ] Compare : lieux et plaques côte à côte.
- [ ] Links : ajoute un lien menu et un lien WhatsApp, publie, ouvre la page publique sur ton téléphone. Le bouton d'avis Google est en premier.
- [ ] Export CSV : le fichier s'ouvre dans Excel, heures en heure de Malaisie.
- [ ] Fiche client admin : « Send me last month's summary (test) » : l'email arrive chez toi.
- [ ] Admin : « Switch Pro off ». Le dashboard revient en Basic, la plaque redirige toujours.

## E. Paiement (quand les clés Airwallex sont en place, d'abord avec `AIRWALLEX_ENV=sandbox`)
- [ ] Plan : « Get Pro monthly » ouvre la page Airwallex. Paie avec une carte de test.
- [ ] Retour sur le dashboard : le lieu est Pro, le paiement est listé avec sa facture. `/admin/system` montre les webhooks « applied ».
- [ ] « Cancel renewal » : la date de fin s'affiche, Pro reste actif jusque-là. « Keep Pro » annule l'annulation.
- [ ] Dans Airwallex, annule l'abonnement : le lieu repasse en Basic, la plaque fonctionne toujours.
- [ ] Simule un paiement échoué (carte de test refusée au renouvellement) : bandeau « payment did not go through », Pro maintenu pendant les relances.

## F. Google (quand l'accès API est accordé, `GBP_ENABLED=true`)
- [ ] Reviews > Google connection > « Connect Google » : écran Google, un seul scope demandé.
- [ ] Choisis la fiche du lieu : les avis sont importés.
- [ ] Laisse un avis de test sur la fiche depuis un autre compte : il apparaît en quelques minutes et l'email d'alerte arrive.
- [ ] Brouillon IA en anglais, malais, chinois. Modifie-le. Tant que tu n'appuies pas sur « Approve and publish », rien n'apparaît sur Google.
- [ ] « Approve and publish » : la réponse est visible sur Google Maps.
- [ ] « Disconnect Google and delete data » : plus aucun avis dans le dashboard, ReviewLah disparaît de `myaccount.google.com/permissions`.
