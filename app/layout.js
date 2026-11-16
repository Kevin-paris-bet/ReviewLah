import './globals.css';

export const metadata = {
  title: { default: 'ReviewLah.my', template: '%s — ReviewLah.my' },
  robots: { index: false },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1555ef',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Same typefaces as the public site: Manrope for headings, DM Sans for text. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
