import { legalEntity, supportEmail } from '../../lib/env';
import { PLATE_PRICE, PRO_PRICES } from '../../lib/plans';
import { LegalPage } from '../ui/legal';

export const metadata = {
  title: 'Terms of service',
  description: 'Terms for ReviewLah.my review plates, the Basic dashboard, the optional Pro subscription and the optional Google Business Profile connection.',
  robots: { index: true, follow: true },
};

export default function Terms() {
  const entity = legalEntity();
  const operator = entity.name || 'the operator of ReviewLah.my';
  const contact = entity.email || supportEmail();

  return (
    <LegalPage
      title="Terms of service"
      intro={<p>These terms apply to ReviewLah.my review plates, the dashboard that comes with them, the optional Pro subscription and the optional Google connection. By ordering a plate or using the dashboard you accept them.</p>}
    >
      <h2>1. Who we are</h2>
      <p>
        ReviewLah.my is operated by {operator}{entity.address ? `, ${entity.address}` : ''} (“ReviewLah”, “we”).
        {contact ? <> Contact: <a href={`mailto:${contact}`}>{contact}</a>.</> : null} ReviewLah is independent of Google and is not affiliated with, endorsed by or sponsored by Google.
      </p>

      <h2>2. What you get</h2>
      <ul>
        <li><strong>The plate (RM{PLATE_PRICE}, paid once):</strong> an NFC and QR plate configured for your business. When a customer taps or scans it, your Google review page opens.</li>
        <li><strong>Basic dashboard (included):</strong> the total number of scans of each plate and the ability to change your Google review link yourself. The plate and the Basic dashboard work without any subscription.</li>
        <li><strong>Pro (optional, {PRO_PRICES.month.label} or {PRO_PRICES.year.label}, per location):</strong> detailed scan statistics, comparison between locations and plates, a links page, CSV export, a monthly summary and, when available, the Google review tools.</li>
      </ul>
      <p>Delivery, returns and the plate warranty are described on the Shipping and returns page of the website and in your order confirmation.</p>

      <h2>3. Scans are not reviews</h2>
      <p>
        A scan means that someone tapped or scanned your plate and your Google review page opened. It does not prove that a review was written.
        We do not promise any number of reviews or any rating: what your customers write on Google is their own decision.
      </p>

      <h2>4. Fair use: no filtering of reviews</h2>
      <ul>
        <li>Every customer who uses your plate reaches the same Google review page, whatever their opinion. ReviewLah does not offer, and you may not build with it, any step that sends satisfied and dissatisfied customers to different places (“review gating”).</li>
        <li>You may only point a plate to the Google listing of a business you own or manage.</li>
        <li>You agree to follow Google’s policies for reviews: no fake reviews, no reviews from yourself or your staff, and no payment, discount or gift in exchange for a review or for changing one.</li>
        <li>You may not use the service for anything unlawful, or try to disrupt it or access other customers’ data.</li>
      </ul>
      <p>We may pause a plate or an account that breaks these rules, after contacting you where possible.</p>

      <h2>5. Pro subscription</h2>
      <ul>
        <li>Pro is billed per location, monthly or yearly, in advance, through our payment provider. Prices are in Malaysian ringgit.</li>
        <li>It renews automatically at the end of each period until you cancel the renewal, which you can do at any time in your dashboard (Plan and payments).</li>
        <li><strong>If you cancel:</strong> Pro stays on until the end of the period already paid, then stops. Your plate and your Basic dashboard keep working, and your scan history is kept.</li>
        <li>Payments already made are not refunded for the remaining time, unless the law requires it or we made a mistake.</li>
        <li>If a renewal payment fails, it is retried for a few days during which Pro stays on. If it still fails, Pro stops for that location.</li>
        <li>We may change Pro prices for future periods. You will be told by email at least 30 days before, and you can cancel before the new price applies.</li>
      </ul>

      <h2>6. Google connection (optional)</h2>
      <ul>
        <li>You may connect your Google Business Profile so that we can show your reviews and help you reply. You confirm that you are allowed to manage the listings you link.</li>
        <li>Replies are published on Google only when you approve them. You are responsible for the content of the replies you publish.</li>
        <li>AI drafts are suggestions. Read and correct them before approving: they can contain mistakes.</li>
        <li>You can disconnect Google and delete the imported data at any time. Our <a href="/privacy#google">privacy policy</a> explains what is read, stored and deleted.</li>
        <li>This feature depends on Google’s services and rules, which may change or become unavailable.</li>
      </ul>

      <h2>7. Your account</h2>
      <p>You log in with a link sent to your email address: keep access to that mailbox safe and tell us if it changes. You are responsible for what is done from your account.</p>

      <h2>8. Availability</h2>
      <p>
        We work to keep the plate redirect and the dashboard available at all times, and the redirect is built to keep working even when the dashboard is being updated.
        We cannot promise that the service will never be interrupted, in particular because it depends on mobile networks, phones, hosting providers and Google.
      </p>

      <h2>9. Liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect losses such as lost revenue, lost customers or the content or number of reviews on Google.
        Our total liability for a claim is limited to the amount you paid us in the 12 months before it. Nothing in these terms removes rights that the law does not allow to be removed.
      </p>

      <h2>10. Ending the service</h2>
      <p>You can stop using the dashboard at any time and ask us to delete your account. We may end an account that seriously or repeatedly breaks these terms. If we ever stop the service, we will give at least 60 days’ notice and refund any unused paid Pro period.</p>

      <h2>11. Changes and applicable law</h2>
      <p>
        We may update these terms. If a change matters, we will tell account holders by email before it applies.
        {entity.governingLaw ? ` These terms are governed by the laws of ${entity.governingLaw}.` : ''} Mandatory consumer and data protection laws of Malaysia continue to apply to customers in Malaysia.
      </p>
    </LegalPage>
  );
}
