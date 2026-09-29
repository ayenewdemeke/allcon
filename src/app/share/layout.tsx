import type { Metadata } from "next";

// Share links are public but private in spirit: keep them out of search engines, and don't
// leak the token to other sites through the Referer header.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function ShareLayout({ children }: LayoutProps<"/share">) {
  return children;
}
