/**
 * Words the English dictionary doesn't know but that are correct in the
 * documents this tool compares: Bengali land, court and banking vocabulary
 * written in Latin letters, plus a few common English abbreviations the
 * dictionary rejects. Lowercase; matching is case-insensitive and tolerant
 * of a plural / possessive (`khatians`, `mouza's`).
 *
 * This list errs toward *not* flagging: a missed typo in a rare term costs
 * less than a wall of false positives on every land deed.
 */
const ALLOWED_TERMS = [
  // Land records and survey
  "khatian", "khotian", "dag", "dags", "mouza", "mouja", "moja", "mauza", "dolil", "dalil", "deed",
  "jote", "jama", "jamabandi", "namjari", "porcha", "parcha", "bayna", "baina", "heba", "hebanama",
  "bigha", "katha", "kani", "decimal", "shotangsho", "satangsho", "tehsil", "tahsil", "tahshil",
  "sheet", "plot", "ejmali", "ejmal", "khas", "khash", "diara", "mutation", "holding", "kabala",
  "kobala", "bainama", "baynanama", "arpito", "onarpito", "ukil", "nagorik", "sub-registrar",
  "registrar", "registry", "sarker", "sarkar", "bhumi", "bhumo", "mahal", "taluk", "talukdar",
  "zamindar", "zaminder", "jomi", "jomir", "poitrik", "waris", "warish", "wasi", "ownerless",
  // Administrative geography
  "thana", "upazila", "upazilla", "upozila", "zila", "zilla", "jela", "union", "ward", "paurashava",
  "pourashava", "poura", "dhaka", "dacca", "chattogram", "chittagong", "ctg", "rajshahi", "khulna",
  "barisal", "barishal", "sylhet", "rangpur", "mymensingh", "comilla", "cumilla", "gazipur",
  "narayanganj", "bogura", "bogra", "tangail", "jessore", "jashore", "dinajpur", "faridpur",
  "bangladesh", "bengal", "bengali", "bangla",
  // Courts and procedure
  "plaintiff", "plaintiffs", "defendant", "defendants", "petitioner", "respondent", "appellant",
  "suo", "motu", "sub-judge", "adv", "advocate", "vakalatnama", "wakalatnama", "mokabela",
  "mokaddama", "mukaddama", "muhuri", "peshkar", "nazir", "serestadar", "sheristadar", "ejlas",
  "ejlash", "tamadi", "tamami", "sammon", "summon", "decree", "judgement", "judgment",
  // Banking and money
  "cheque", "cheques", "chq", "taka", "tk", "bdt", "paisa", "poisha", "lakh", "lakhs", "lac", "lacs",
  "crore", "crores", "koti", "neft", "rtgs", "eft", "swift", "iban", "bkash", "nagad", "rocket",
  "upay", "tap", "nid", "tin", "bin", "vat", "tds", "emi", "atm", "pos", "pin", "otp", "kyc",
  "overdraft", "debit", "credit", "ledger", "voucher", "challan", "chalan", "invoice", "receipt",
  "payee", "drawee", "drawer", "endorsee", "mudaraba", "murabaha", "musharaka", "ijara", "bai",
  // Common abbreviations and informal words the dictionary rejects
  "ok", "okay", "etc", "viz", "ibid", "esq", "vs", "ref", "refs", "info", "regd", "approx", "dept",
  "govt", "assn", "corp", "pvt", "ltd", "inc", "nos", "sl", "sr", "jr", "dob", "doc", "docs",
  "tel", "fax", "mob", "cell", "email", "emails", "online", "offline", "website", "login",
  "username", "password", "wifi", "pdf", "docx", "txt", "unicode", "bijoy", "sutonnymj",
  "sutonny", "ansi", "ascii", "utf", "html", "url", "urls", "gmail", "yahoo", "hotmail",
  // Honorifics and titles that appear before names
  "md", "mst", "mrs", "mr", "ms", "dr", "prof", "engr", "capt", "col", "gen", "lt", "maj", "hon",
  "sheikh", "sk", "begum", "bibi", "khatun", "akter", "akhter", "uddin", "ullah", "ahmed", "ahmad",
  "hossain", "hussain", "rahman", "islam", "haque", "huq", "mia", "miah", "mian", "sarkar", "das",
  "chowdhury", "chaudhury", "choudhury", "talukder", "mondal", "mandal", "bepari", "howlader",
] as const;

export const ALLOWED_WORDS: ReadonlySet<string> = new Set(ALLOWED_TERMS);

/**
 * Titles and abbreviations that end in a period without ending a sentence:
 * a Capitalized word after `Md.` or `Mr.` is a name, not a sentence opener.
 */
export const NON_TERMINAL_ABBREVIATIONS: ReadonlySet<string> = new Set([
  "mr", "mrs", "ms", "dr", "md", "mst", "prof", "engr", "capt", "col", "gen", "lt", "maj", "hon",
  "sr", "jr", "st", "rev", "adv", "no", "nos", "vs", "dist", "mouza", "etc", "viz", "ref", "regd",
]);

/** `khatians`, `mouza's`, `cheques` -> the listed base form, if any. */
export function isAllowedWord(word: string): boolean {
  const lower = word.toLowerCase().replace(/’/gu, "'");
  if (ALLOWED_WORDS.has(lower)) return true;
  const base = lower.replace(/'s$/u, "").replace(/s'$/u, "s");
  if (ALLOWED_WORDS.has(base)) return true;
  if (base.endsWith("es") && ALLOWED_WORDS.has(base.slice(0, -2))) return true;
  if (base.endsWith("s") && ALLOWED_WORDS.has(base.slice(0, -1))) return true;
  return false;
}
