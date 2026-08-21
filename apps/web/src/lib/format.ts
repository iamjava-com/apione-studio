/** A timestamp as the locale's short date — list rows and cards all render dates this way. */
export function formatDate(ts: number, locale: string): string {
  return new Date(ts).toLocaleDateString(locale);
}
