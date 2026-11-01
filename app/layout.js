import './globals.css';

export const metadata = {
  title: 'ReviewLah.my',
  robots: { index: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
