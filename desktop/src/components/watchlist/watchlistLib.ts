/** ISIN shape the CLI accepts: 2 letters, 9 alphanumerics, 1 check digit. */
export const ISIN_PATTERN = /^[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]$/;

export function isValidIsin(value: string): boolean {
  return ISIN_PATTERN.test(value.trim());
}
