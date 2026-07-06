// ── Simulated External Acts & Judgments Search ───────────────────────────────
// Mocks a live aggregator API (Indian Kanoon-style) for the Firm Library's
// "External Database" mode. Headnotes intentionally contain real citations so
// the citation parser has genuine body text to operate on.

const MOCK_JUDGMENTS = [
  {
    id: 'ext-1',
    title: 'Dashrath Rupsingh Rathod v. State of Maharashtra',
    court: 'Supreme Court of India',
    year: 2014,
    citation: '(2014) 9 SCC 129',
    headnote: 'The Supreme Court held that a complaint under Section 138 of the Negotiable Instruments Act, 1881 must be filed at the place where the cheque was dishonoured by the drawee bank, departing from the wider territorial jurisdiction rule laid down in AIR 1999 SC 3762. The decision was subsequently addressed by the 2015 Amendment to the Act; see also 2019 SCC OnLine SC 1521 on transitional application.',
    url: 'https://indiankanoon.org/doc/187514899/',
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
