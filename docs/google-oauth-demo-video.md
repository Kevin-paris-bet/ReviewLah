# Script de la vidéo de démo — vérification OAuth Google

À enregistrer en anglais (voix ou sous-titres), écran entier avec la barre d'adresse visible, 3 à 4 minutes, puis à publier sur YouTube en « non répertorié ». Google veut voir : l'application réelle sur son domaine, l'écran de consentement avec le nom de l'app et le scope demandé, et l'usage concret de chaque donnée. Utilise un compte Google qui gère une vraie fiche (ta fiche de test) et un lieu Pro.

Avant d'enregistrer : `GBP_ENABLED=true`, le lieu de test en Pro, Google non connecté, langue du compte Google en anglais.

| # | À l'écran | Ce que tu dis (anglais) |
| --- | --- | --- |
| 1 | `https://www.reviewlah.my` puis clic sur « Privacy » en bas de page ; faire défiler jusqu'à « Google user data » | “This is ReviewLah, a dashboard for small businesses in Malaysia that use our NFC review plates. Our privacy policy is linked from the home page and explains how we handle Google user data.” |
| 2 | `/login`, connexion par lien email, arrivée sur le dashboard | “A business owner signs in to their ReviewLah account with an email link.” |
| 3 | Onglet « Reviews » puis « Set up the Google connection ». Montrer le texte « What ReviewLah does with this access » | “To see and answer their Google reviews, the owner connects their Google Business Profile. Before leaving, we explain what we will read and that nothing is published without approval.” |
| 4 | Clic sur « Connect Google ». **Montrer l'adresse `accounts.google.com`, le nom de l'app, et dans l'URL `client_id=…` et `scope=…business.manage`.** Choisir le compte | “The owner is sent to Google’s own sign-in page. ReviewLah never sees the Google password. Here is our OAuth client ID in the address bar.” |
| 5 | Écran de consentement : s'arrêter 3 secondes sur la permission affichée | “We request a single scope: business.manage. It is the only scope that gives access to reviews and replies in the Google Business Profile APIs.” |
| 6 | Retour sur `/dashboard/google`, message « Google is connected » | “Google returns the owner to ReviewLah. The access token is encrypted before it is stored.” |
| 7 | Liste déroulante « Which Google listing is … ? », choisir la fiche, « Link and import reviews » | “We use the scope to list the business listings this account manages, so the owner can choose the one that matches their location. We only read the listings they link.” |
| 8 | `/dashboard/reviews` : note moyenne, liste des avis | “We then read the reviews of that listing: reviewer name, rating, text, date and existing replies, and show them to the owner. This is the main use of the data.” |
| 9 | Sur un avis sans réponse : clic sur un bouton « AI draft » (English), le brouillon apparaît ; le modifier à la main | “The owner can ask for a draft reply. It is only a draft: they edit it freely.” |
| 10 | Clic sur « Approve and publish on Google », puis ouvrir Google Maps sur la fiche et montrer la réponse publiée | “Only when the owner presses Approve and publish do we call reviews.updateReply. Nothing is ever posted automatically. Here is the reply on Google.” |
| 11 | (facultatif) Montrer l'email « New Google review » reçu | “When a new review arrives, Google notifies us through Pub/Sub and we email the owner.” |
| 12 | `/dashboard/google` > « Disconnect Google and delete data » > confirmer ; la page revient à « Connect your Google Business Profile » ; l'onglet Reviews n'affiche plus d'avis | “The owner can disconnect at any time. This revokes our access at Google and deletes the stored token, the linked listings and every imported review and draft.” |
| 13 | `https://myaccount.google.com/permissions` : ReviewLah n'y figure plus | “Access has been removed from the Google account as well. Thank you.” |

Texte à coller dans le formulaire de vérification (« How will the scopes be used? ») :

> ReviewLah lets a business owner connect their own Google Business Profile. We use https://www.googleapis.com/auth/business.manage to (1) list the accounts and locations the user manages so they can select which listing to link, (2) read the reviews of the linked listings and display them in the user’s dashboard, with email alerts and monthly trends, and (3) publish, update or delete the business’s reply to a review only after the user has reviewed and explicitly approved the text. We do not modify listing information. Tokens are encrypted at rest (AES-256-GCM). Users can disconnect and delete all imported data at any time from the dashboard. Data is not sold, not used for advertising, and review text is sent to our AI provider only when the user requests a reply draft; it is not used to train models.
