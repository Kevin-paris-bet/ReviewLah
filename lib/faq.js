// Questions shown on the dashboard help page. Same promises as the public site (public/js/content.js).
export const DASHBOARD_FAQ = [
  ['What exactly is a scan?', 'A scan is counted each time someone taps your plate with their phone (NFC) or scans its QR code, and your Google review page opens. It does not prove that a review was posted: scans and Google reviews are two separate numbers.'],
  ['Why is my scan count lower than I expected?', 'If the same phone taps the same plate again within a few seconds, we count it once. Link previews (for example when the address is pasted in WhatsApp) and search robots are not counted either.'],
  ['Can every customer leave a review?', 'Yes. Every customer opens the same Google review page and shares an honest experience, whatever their rating. We never filter or redirect customers depending on what they think.'],
  ['How do I change my Google review link?', 'Open Overview, choose Manage on the location, and paste the new link under “Google review link”. It applies to every plate of that location at once. You do not need a new plate.'],
  ['Where do I find my Google review link?', 'In Google Maps or Google Search, open your business profile while signed in as the owner, choose “Ask for reviews” (or “Share review form”) and copy the link. A link to your business in Google Maps also works.'],
  ['My plate does not open anything. What should I check?', 'For NFC: unlock the phone and hold its top edge (iPhone) or its back (Android) against the plate for a second; NFC must be on in the phone settings on Android. For QR: open the camera and point it at the code. The phone needs an internet connection. If it still fails, send us a message below with your plate code.'],
  ['What is the difference between Basic and Pro?', 'Basic comes with the plate: your total scan count and the ability to change your review link. Pro is optional and adds scans by day, week and month, NFC versus QR, busiest hours and days, comparison between locations and plates, a links page, CSV export and a monthly email summary.'],
  ['What happens if I cancel Pro?', 'Your plate and your Basic dashboard keep working. You keep Pro until the end of the period you paid for, then you only lose the optional Pro tools.'],
  ['Is Pro billed per account or per location?', 'Per location. If you have several locations, you choose which ones get Pro.'],
  ['Can I add a plate or a location?', 'Yes. Send us a message below: we program the new plate and link it to your account before dispatch.'],
  ['Do you need my Google password?', 'Never. The plate only needs your public review link. Features that read your reviews or publish replies use Google’s own secure sign-in, which you can revoke at any time.'],
  ['Which times are shown in the dashboard?', 'All dates and hours are in Malaysia time (Kuala Lumpur).'],
];

export const SUPPORT_TOPICS = ['Plate support', 'Change of Google listing', 'Add a plate or a location', 'Pro and billing', 'Something else'];
