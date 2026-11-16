import { legalEntity, supportEmail } from '../../lib/env';
import { LegalPage } from '../ui/legal';

export const metadata = {
  title: 'Privacy policy',
  description: 'What ReviewLah.my collects, why, where it is stored, for how long, and how to delete it, including data read from Google Business Profile.',
  robots: { index: true, follow: true },
};

export default function Privacy() {
  const entity = legalEntity();
  const operator = entity.name || 'the operator of ReviewLah.my';
  const contact = entity.email || supportEmail();
  const Mail = () => (contact ? <a href={`mailto:${contact}`}>{contact}</a> : <>the contact form in your dashboard (Help)</>);

  return (
    <LegalPage
      title="Privacy policy"
      intro={(
        <p>
          ReviewLah.my sells NFC and QR review plates to businesses in Malaysia and provides a dashboard to see how the plates are used.
          This page explains what personal data we handle, why, where it is kept, for how long, and how to have it deleted.
          It also describes exactly what we do with data from Google when a business owner connects a Google Business Profile.
        </p>
      )}
    >
      <h2>1. Who is responsible</h2>
      <p>
        ReviewLah.my is operated by {operator}{entity.address ? `, ${entity.address}` : ''}. For any privacy question or request, write to <Mail />.
        ReviewLah is an independent service. It is not affiliated with, endorsed by or sponsored by Google.
      </p>

      <h2>2. People who tap or scan a plate</h2>
      <p>
        When a customer of a business taps a ReviewLah plate or scans its QR code, their phone opens a ReviewLah address that immediately redirects
        to the Google review page of that business. Every customer is sent to the same page, whatever their opinion.
      </p>
      <ul>
        <li><strong>What we record:</strong> one “scan” line: which plate, the date and time, and whether it was an NFC tap or a QR scan.</li>
        <li><strong>What we do not record:</strong> no name, no email, no phone number, no Google account, no precise location, and no cookie is placed on the phone.</li>
        <li>
          <strong>Duplicate protection:</strong> to avoid counting the same tap twice, our server computes a short one-way fingerprint from the network address and browser type of the phone.
          The network address itself is never stored. The fingerprint is salted again in the database, is valid for one plate and one day, and is erased after 2 days.
        </li>
      </ul>
      <p>What the customer then writes on Google is between them and Google. A scan is not a review, and we cannot see who posted a review from a scan.</p>

      <h2>3. Business owners with a ReviewLah account</h2>
      <table>
        <thead><tr><th>Data</th><th>Why we use it</th></tr></thead>
        <tbody>
          <tr><td>Login email</td><td>To send your login link and service emails (no password is ever created).</td></tr>
          <tr><td>Business and location names, address, Google review link</td><td>To configure your plate and show your dashboard.</td></tr>
          <tr><td>Contact name, phone and WhatsApp number (optional)</td><td>To reach you about your order or a support request.</td></tr>
          <tr><td>Scan statistics of your plates</td><td>To show your dashboard and, for Pro, your monthly summary.</td></tr>
          <tr><td>Links you add to your links page (Pro)</td><td>To display the public page you asked for.</td></tr>
          <tr><td>Support messages you send us</td><td>To answer you.</td></tr>
          <tr><td>Subscription status and payment history</td><td>To provide Pro and show your invoices. Card details are entered on our payment provider’s page: we never receive or store them.</td></tr>
        </tbody>
      </table>
      <p>
        We use one essential cookie to keep you logged in, and a short-lived cookie while you connect Google. We do not use advertising or tracking cookies in the dashboard.
      </p>

      <h2 id="google">4. Google user data (Google Business Profile connection)</h2>
      <p>
        Connecting Google is optional and only happens when a business owner presses “Connect Google” in the dashboard and gives consent on Google’s own sign-in page.
        We request a single permission (OAuth scope): <code>https://www.googleapis.com/auth/business.manage</code>. We never see or store your Google password.
      </p>
      <h3>What we access</h3>
      <ul>
        <li>The list of Google Business Profile accounts and business listings you manage (name and address of each listing), so that you can choose which listing belongs to each of your locations.</li>
        <li>For the listings you choose to link: their reviews, meaning the reviewer’s public display name, the star rating, the review text, its dates, and your business’s replies, together with the listing’s review count and average rating.</li>
        <li>Notifications from Google that a new or updated review exists for a linked listing.</li>
      </ul>
      <h3>How we use it</h3>
      <ul>
        <li>To show your reviews in your dashboard, and to email you an alert when a new review arrives (you can turn alerts off).</li>
        <li>To show review trends (number of new reviews, average rating, replies pending) in your dashboard and in your monthly summary.</li>
        <li>To prepare reply drafts at your request, and to publish, update or delete a reply on Google <strong>only after you have read it and approved it</strong>. Nothing is ever published automatically.</li>
      </ul>
      <p>We do not edit your listing, photos, opening hours or any other business information, even though the Google permission technically covers managing a profile.</p>
      <h3>How it is stored and protected</h3>
      <ul>
        <li>The access keys Google gives us (OAuth tokens) are encrypted with AES-256-GCM before they are stored. The encryption key is kept separately from the database.</li>
        <li>Imported reviews and drafts are stored in our database, where each business owner can only read the data of their own locations.</li>
        <li>All transfers use encrypted connections (HTTPS).</li>
      </ul>
      <h3>Who it is shared with</h3>
      <ul>
        <li>We do not sell Google user data, we do not use it for advertising, and we do not use it to build profiles of reviewers.</li>
        <li>
          <strong>AI reply drafts:</strong> when you ask for a draft, the star rating, the text of that review and your business name are sent to our AI provider
          (Anthropic, Claude API) to write a suggestion in English, Bahasa Malaysia or Chinese. The reviewer’s name is not sent. The provider processes this on our behalf
          and does not use it to train its models. If you never ask for a draft, nothing is sent.
        </li>
        <li>Our hosting, database and email providers (section 6) process the data only to run the service.</li>
        <li>Our staff do not read your reviews or drafts unless you ask us for help, or where needed for security or to comply with the law.</li>
      </ul>
      <p>
        ReviewLah’s use and transfer of information received from Google APIs to any other app adheres to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.
      </p>
      <h3>How long we keep it, and how to delete it</h3>
      <ul>
        <li><strong>Disconnect and delete, at any time:</strong> in the dashboard, “Disconnect Google and delete data” withdraws our access at Google and immediately deletes the stored tokens, the linked listings, every imported review and every draft.</li>
        <li><strong>Unlink one listing:</strong> deletes the reviews and drafts imported for that location immediately.</li>
        <li><strong>End of Pro:</strong> reviews are no longer updated, and the imported Google data of that location is deleted 30 days after Pro ends.</li>
        <li>You can also remove ReviewLah’s access from your Google account at <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">myaccount.google.com/permissions</a>. We then stop reading your data; use the button above or write to us to delete what was already imported.</li>
        <li>Your reviews and replies on Google itself are never deleted by these actions.</li>
      </ul>

      <h2>5. How long we keep other data</h2>
      <ul>
        <li>Account, locations, plates and scan statistics: for as long as your account exists. On request we delete your account and its data within 30 days, except what the law requires us to keep (for example invoices).</li>
        <li>Duplicate-protection fingerprints: 2 days.</li>
        <li>Support messages: up to 24 months after they are closed.</li>
        <li>Payment records: as long as accounting and tax rules require.</li>
      </ul>

      <h2>6. Service providers and where data is processed</h2>
      <p>We rely on a small number of providers that process data on our behalf:</p>
      <ul>
        <li>Supabase: database and login.</li>
        <li>Vercel: hosting of the website, the dashboard and the plate redirect.</li>
        <li>Resend: sending emails (login links are sent through our login provider; summaries, alerts and billing notices through Resend).</li>
        <li>Our payment provider (Airwallex), once online payment is enabled: checkout, subscriptions and invoices.</li>
        <li>Anthropic (Claude API): reply drafts, only when you ask for one.</li>
        <li>Google: the Google Business Profile APIs, only if you connect Google.</li>
      </ul>
      <p>These providers may store or process data on servers outside Malaysia. By using the service you agree to this transfer, which is needed to provide it.</p>

      <h2>7. Your rights (Personal Data Protection Act 2010, Malaysia)</h2>
      <p>If the Malaysian Personal Data Protection Act 2010 (PDPA) applies to you, you have the right to:</p>
      <ul>
        <li>ask what personal data we hold about you and receive a copy;</li>
        <li>ask us to correct data that is inaccurate, incomplete or out of date (most of it can be edited directly in your dashboard);</li>
        <li>withdraw your consent, limit how we use your data, or ask us to delete it;</li>
        <li>refuse marketing messages. We only send service emails, and each optional email can be switched off in your account.</li>
      </ul>
      <p>
        Write to <Mail /> and we will answer within 21 days. Providing your data is voluntary, but without a login email and your business details we cannot provide the dashboard.
        If you are a customer who tapped a plate, we hold no data that identifies you.
      </p>

      <h2>8. Security</h2>
      <p>
        Access to data is restricted per account in the database itself, secrets are kept outside the code, Google tokens are encrypted at rest, and all traffic is encrypted in transit.
        No system is perfectly secure; if a breach affects your data we will inform you and the authorities as the law requires.
      </p>

      <h2>9. Children</h2>
      <p>The dashboard is intended for businesses. We do not knowingly collect personal data from children.</p>

      <h2>10. Changes</h2>
      <p>If this policy changes in a way that matters, we will update the date at the top and inform account holders by email before the change applies.</p>
    </LegalPage>
  );
}
