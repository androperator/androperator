import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading"
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"]
});

const shareImage = "https://static.clawperator.com/img/share/clawperator_share_image.png";

export const metadata = {
  metadataBase: new URL("https://clawperator.com"),
  title: "Clawperator",
  description: "Deterministic Android Automation for AI Agents",
  applicationName: "Clawperator",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.png", sizes: "16x16", type: "image/png" }
    ]
  },
  openGraph: {
    title: "Clawperator",
    description: "Deterministic Android Automation for AI Agents",
    siteName: "Clawperator",
    type: "website",
    images: [
      {
        url: shareImage,
        type: "image/png",
        width: 1200,
        height: 630,
        alt: "Clawperator share image"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "Clawperator",
    description: "Deterministic Android Automation for AI Agents",
    images: [shareImage]
  }
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://clawperator.com/#organization",
      name: "Clawperator",
      url: "https://clawperator.com/",
      description: "Deterministic Android automation for AI agents.",
      sameAs: ["https://github.com/clawperator/clawperator"]
    },
    {
      "@type": "WebSite",
      "@id": "https://clawperator.com/#website",
      url: "https://clawperator.com/",
      name: "Clawperator",
      description: "Deterministic Android automation for AI agents.",
      publisher: {
        "@id": "https://clawperator.com/#organization"
      },
      potentialAction: {
        "@type": "ReadAction",
        target: [
          "https://clawperator.com/agents",
          "https://clawperator.com/index.md",
          "https://docs.clawperator.com/"
        ]
      }
    }
  ]
};

export default function RootLayout({ children }) {
  const structuredDataJson = JSON.stringify(structuredData).replace(/</g, "\\u003c");

  return (
    <html lang="en">
      <head>
        <link rel="alternate" type="text/markdown" href="https://clawperator.com/index.md" />
        <link rel="image_src" href={shareImage} />
        <meta property="og:image:secure_url" content={shareImage} />
        <meta name="twitter:image:alt" content="Clawperator share image" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: structuredDataJson }}
        />
      </head>
      <body className={`${headingFont.variable} ${monoFont.variable}`}>{children}</body>
    </html>
  );
}
