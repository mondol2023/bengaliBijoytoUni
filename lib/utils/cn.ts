/** Joins class names, skipping falsy values. No dedup — components here don't need it. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
