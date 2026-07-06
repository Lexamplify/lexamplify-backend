// ── Simulated External Acts & Judgments Search ───────────────────────────────
// Mocks a live aggregator API (Indian Kanoon-style) for the Firm Library's
// "External Database" mode. Headnotes intentionally contain real citations so
// the citation parser has genuine body text to operate on. Years span 1973 to
// 2024 to exercise the year-descending + court-hierarchy sort.

const MOCK_JUDGMENTS = [
  {
    id: 'ext-adr',
    title: 'Association for Democratic Reforms v. Union of India',
    court: 'Supreme Court of India',
    year: 2024,
    citation: '2024 INSC 113',
    headnote: 'A five-judge Constitution Bench unanimously struck down the Electoral Bonds Scheme as unconstitutional, holding it violative of the right to information under Article 19(1)(a), and directed the State Bank of India to disclose bond details to the Election Commission.',
    url: 'https://indiankanoon.org/doc/163382408/',
  },
  {
    id: 'ext-3',
    title: 'Vidya Drolia v. Durga Trading Corporation',
    court: 'Supreme Court of India',
    year: 2020,
    citation: '(2021) 2 SCC 1',
    headnote: 'The Court clarified the test for arbitrability of disputes and the scope of judicial review at the reference stage under Section 11 of the Arbitration and Conciliation Act, 1996, discussing 2019 SCC OnLine SC 1521 and the neutral citation 2020 INSC 385.',
    url: 'https://indiankanoon.org/doc/74595896/',
  },
  {
    id: 'ext-2',
    title: 'K.S. Puttaswamy v. Union of India',
    court: 'Supreme Court of India',
    year: 2017,
    citation: '(2017) 10 SCC 1',
    headnote: 'A nine-judge bench unanimously held that the right to privacy is a fundamental right protected under Article 21 of the Constitution, overruling the contrary observations in AIR 1954 SC 300 and AIR 1963 SC 1295 to the extent they held otherwise.',
    url: 'https://indiankanoon.org/doc/91938676/',
  },
  // ── Dashrath Rupsingh Rathod progression — real 2014/2015/2016 timeline,
  // plus two clearly-labeled illustrative entries (2025/2026) added only to
  // stress-test the chronological sort. Never present the illustrative
  // entries as real case law — titles/headnotes say so explicitly.
  {
    id: 'ext-1-2014',
    title: 'Dashrath Rupsingh Rathod v. State of Maharashtra',
    court: 'Supreme Court of India',
    year: 2014,
    citation: '(2014) 9 SCC 129',
    headnote: 'The Supreme Court held that a complaint under Section 138 of the Negotiable Instruments Act, 1881 must be filed at the place where the cheque was dishonoured by the drawee bank, departing from the wider territorial jurisdiction rule laid down in AIR 1999 SC 3762. The ruling was criticised as impractical and directly prompted Parliament to legislate a correction the following year.',
    url: 'https://indiankanoon.org/doc/187514899/',
  },
  {
    id: 'ext-1-2015',
    title: 'The Negotiable Instruments (Amendment) Act, 2015',
    court: 'Parliament of India',
    year: 2015,
    citation: 'Act No. 26 of 2015',
    headnote: "Enacted specifically to reverse the territorial-jurisdiction rule laid down in Dashrath Rupsingh Rathod v. State of Maharashtra, (2014) 9 SCC 129, this amendment inserted Section 142(2) into the Negotiable Instruments Act, 1881, restoring the complainant's right to file at the place where the cheque was presented for collection or where the payee/holder maintains an account.",
    url: 'https://indiankanoon.org/doc/166750929/',
  },
  {
    id: 'ext-1-2016',
    title: 'Bridgestone India Pvt. Ltd. v. Inderpal Singh',
    court: 'Supreme Court of India',
    year: 2016,
    citation: '(2016) 2 SCC 75',
    headnote: 'Clarifying the retrospective reach of the 2015 Amendment, the Supreme Court held that Section 142(2) applies even to complaints pending on the date the amendment came into force, confirming that the jurisdictional bar imposed in Dashrath Rupsingh Rathod v. State of Maharashtra, (2014) 9 SCC 129, no longer survives for such matters.',
    url: 'https://indiankanoon.org/doc/558956/',
  },
  {
    id: 'ext-1-2025-illustrative',
    title: '[Illustrative Citing Case] Meridian Textiles v. Coastal Bank Ltd.',
    court: 'Supreme Court of India',
    year: 2025,
    citation: 'Illustrative — not a real citation',
    headnote: "[Illustrative entry, not a real judgment — included only to demonstrate this UI's multi-year chronological sorting.] A hypothetical matter applying the jurisdiction principle from Dashrath Rupsingh Rathod v. State of Maharashtra, (2014) 9 SCC 129, as restored by the 2015 Amendment and confirmed in (2016) 2 SCC 75.",
    url: '#',
  },
  {
    id: 'ext-1-2026-illustrative',
    title: '[Illustrative Citing Case] Precision Components Ltd. v. Northern Traders Association',
    court: 'Supreme Court of India',
    year: 2026,
    citation: 'Illustrative — not a real citation',
    headnote: '[Illustrative entry, not a real judgment — included only to demonstrate this UI\'s multi-year chronological sorting.] A hypothetical later citation of Dashrath Rupsingh Rathod v. State of Maharashtra for stress-testing purposes only.',
    url: '#',
  },
  {
    id: 'ext-naz',
    title: 'Naz Foundation v. Government of NCT of Delhi',
    court: 'Delhi High Court',
    year: 2009,
    citation: '160 (2009) DLT 277',
    headnote: "The Delhi High Court read down Section 377 of the Indian Penal Code to decriminalise consensual homosexual conduct between adults, holding it violated Articles 14, 15, and 21. The judgment was set aside by the Supreme Court in Suresh Kumar Koushal, AIR 2014 SC 563, and the position was later restored in Navtej Singh Johar, (2018) 10 SCC 1.",
    url: 'https://indiankanoon.org/doc/100472805/',
  },
  {
    id: 'ext-kesavananda',
    title: 'Kesavananda Bharati v. State of Kerala',
    court: 'Supreme Court of India',
    year: 1973,
    citation: '(1973) 4 SCC 225',
    headnote: "A thirteen-judge bench, by a wafer-thin majority, propounded the basic structure doctrine, holding that Parliament's power to amend the Constitution under Article 368 does not extend to altering its basic structure. The ratio has been consistently applied, including in Indira Nehru Gandhi v. Raj Narain, AIR 1975 SC 2299, and Minerva Mills v. Union of India, AIR 1980 SC 1789.",
    url: 'https://indiankanoon.org/doc/257876/',
  },
  {
    id: 'ext-4',
    title: 'Bhaskaran v. Sankaran Vaidhyan Balan',
    court: 'Supreme Court of India',
    year: 1999,
    citation: 'AIR 1999 SC 3762',
    headnote: 'The Court laid down five alternative jurisdictional facts under which a complaint under Section 138 of the Negotiable Instruments Act, 1881 could be filed, a position later overruled in relevant part by (2014) 9 SCC 129.',
    url: 'https://indiankanoon.org/doc/1517600/',
  },
];

function normalize(s) {
  return (s || '').toLowerCase();
}

/**
 * Simulates a live external database search over Acts and Judgments.
 * Async with artificial latency to mirror a real network round-trip.
 * Returns unsorted matches — display ordering is enforced by the presentation
 * layer (ExternalResultsTable) so it stays correct even if this mock is
 * later swapped for a real API with its own relevance ordering.
 */
export async function searchExternalDatabase(query) {
  await new Promise((resolve) => setTimeout(resolve, 450 + Math.random() * 350));

  const q = normalize(query).trim();
  if (!q) return [];

  return MOCK_JUDGMENTS.filter((j) =>
    normalize(j.title).includes(q) ||
    normalize(j.headnote).includes(q) ||
    normalize(j.citation).includes(q) ||
    normalize(j.court).includes(q)
  );
}
