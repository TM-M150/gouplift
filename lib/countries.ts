// Countries a fundraiser can say they live in (AML policy 4.3 geography factor,
// 5.8 non-residents). ISO 3166-1 alpha-2 codes; names come from the browser's
// own region names, so there is no second list to keep in step.

export const HOME_COUNTRY = "KE";

// Populated territories and countries, plus Kosovo (XK), which has no ISO code
// of its own but is widely used. Uninhabited territories are left out.
export const COUNTRY_CODES = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BW","BY","BZ",
  "CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ",
  "DE","DJ","DK","DM","DO","DZ",
  "EC","EE","EG","EH","ER","ES","ET",
  "FI","FJ","FK","FM","FO","FR",
  "GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GT","GU","GW","GY",
  "HK","HN","HR","HT","HU",
  "ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT",
  "JE","JM","JO","JP",
  "KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ",
  "LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY",
  "MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ",
  "NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ",
  "OM",
  "PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY",
  "QA",
  "RE","RO","RS","RU","RW",
  "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SY","SZ",
  "TC","TD","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ",
  "UA","UG","US","UY","UZ",
  "VA","VC","VE","VG","VI","VN","VU",
  "WF","WS",
  "XK",
  "YE","YT",
  "ZA","ZM","ZW",
] as const;

const KNOWN = new Set<string>(COUNTRY_CODES);

export function isCountryCode(value: string): boolean {
  return KNOWN.has(value);
}

let displayNames: Intl.DisplayNames | null | undefined;

/** "Kenya" for "KE". Falls back to the code if the runtime has no name for it. */
export function countryName(code: string): string {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      displayNames = null;
    }
  }
  try {
    return displayNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Every country as code and name, Kenya first, then A to Z. */
export function countryOptions(): Array<{ code: string; name: string }> {
  const rest = COUNTRY_CODES.filter((code) => code !== HOME_COUNTRY)
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return [{ code: HOME_COUNTRY, name: countryName(HOME_COUNTRY) }, ...rest];
}
