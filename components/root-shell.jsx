import { headers } from "next/headers";

import "../app/globals.css";

/**
 * Every route group renders its own <html> so each page keeps the body class
 * its stylesheet is scoped to, exactly as the static pages did. Reading the
 * request nonce here lets Next stamp it onto its bootstrap scripts, which is
 * what allows the strict CSP in middleware.js.
 */
/** Every page is a private workspace, so its metadata never invites indexing. */
export function pageMetadata({ title, description }) {
  return { title, description, robots: { index: false, follow: false } };
}


export async function RootShell({ bodyClassName, children }) {
  await headers();
  return (
    <html lang="ko">
      <body className={bodyClassName}>{children}</body>
    </html>
  );
}
