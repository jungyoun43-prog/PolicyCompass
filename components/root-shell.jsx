/**
 * Every route group renders its own <html> so each page keeps the body class
 * its stylesheet is scoped to, exactly as the static pages did.
 */
export function RootShell({ bodyClassName, children }) {
  return (
    <html lang="ko">
      <body className={bodyClassName}>{children}</body>
    </html>
  );
}
