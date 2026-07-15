import os
import sys
import json
import time
import requests
import dotenv
from tqdm import tqdm
from langchain_text_splitters import RecursiveCharacterTextSplitter

# Windows consoles default to cp1252, which can't encode characters like the
# status emoji below — force UTF-8 stdout so a long-running batch print never
# crashes partway through a real ingestion run.
sys.stdout.reconfigure(encoding="utf-8")

# 1. Load Environment Variables
dotenv.load_dotenv()

PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY")
PINECONE_HOST = os.environ.get("PINECONE_HOST")

if not PINECONE_API_KEY:
    raise ValueError("Missing PINECONE_API_KEY in .env — aborting.")
if not PINECONE_HOST:
    raise ValueError("Missing PINECONE_HOST in .env — aborting.")

DATA_PATH = os.path.join("data", "opennyai_cases.json")
UPSERT_URL = f"{PINECONE_HOST}/records/namespaces/legal-cases/upsert"
BATCH_SIZE = 50

# 2. Chunking configuration
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1200,
    chunk_overlap=200,
    length_function=len,
    is_separator_regex=False,
)


def batch_upsert_to_pinecone(chunks_batch):
    """POST one batch of flat {_id, text, source_case} records to Pinecone's
    Integrated Inference records endpoint. Pinecone embeds "text" server-side.
    Body must be newline-delimited JSON, not a JSON array — a wrapped
    {"records": [...]} body is silently rejected by this endpoint."""
    ndjson_data = "\n".join(json.dumps(chunk) for chunk in chunks_batch) + "\n"
    headers = {
        "Content-Type": "application/x-ndjson",
        "Api-Key": PINECONE_API_KEY,
    }
    response = requests.post(UPSERT_URL, headers=headers, data=ndjson_data.encode("utf-8"))
    return response


# 3. Dummy dataset generator — used only when data/opennyai_cases.json is
# missing, so the pipeline is exercisable end-to-end without a real OpenNyAI
# export on hand. Built around real, well-known landmark SC judgments so the
# text reads as plausible legal narrative rather than placeholder filler.
def build_dummy_dataset():
    return [
        {
            "case_id": "case_kesavananda_bharati",
            "source_case": "Kesavananda Bharati v. State of Kerala, (1973) 4 SCC 225",
            "text": (
                "The case of Kesavananda Bharati v. State of Kerala stands as one of the most significant constitutional "
                "pronouncements in the history of the Supreme Court of India. The matter arose out of a challenge to the "
                "Kerala Land Reforms Act, but its true significance lay in the broader constitutional question it raised: "
                "whether Parliament's power to amend the Constitution under Article 368 was unlimited, or whether it was "
                "subject to implied limitations. A specially constituted bench of thirteen judges, the largest ever assembled "
                "by the Supreme Court, heard arguments over sixty-eight working days, making it one of the longest hearings "
                "in the Court's history. The petitioners argued that certain amendments to the Constitution, including the "
                "Twenty-Fourth, Twenty-Fifth, and Twenty-Ninth Amendments, impermissibly curtailed fundamental rights and "
                "eroded the essential character of the constitutional scheme. The Union of India, by contrast, contended that "
                "the amending power under Article 368 was plenary and that Parliament, as the representative body of the "
                "people, was entitled to amend any part of the Constitution, including Part III on fundamental rights, "
                "without restriction. By a wafer-thin majority of seven to six, the Court propounded what has since become "
                "known as the basic structure doctrine. The majority held that while Parliament possessed wide powers to "
                "amend the Constitution, including fundamental rights, this power did not extend to altering or destroying "
                "the basic structure or framework of the Constitution. The judgment did not provide an exhaustive list of "
                "what constitutes the basic structure, but subsequent decisions have identified elements such as the "
                "supremacy of the Constitution, the republican and democratic form of government, the secular character of "
                "the Constitution, separation of powers between the legislature, executive, and judiciary, and the federal "
                "character of the Constitution as falling within its protective ambit. The ratio in Kesavananda Bharati has "
                "been invoked and applied in numerous subsequent decisions, most notably in Indira Nehru Gandhi v. Raj "
                "Narain, where the Court struck down a constitutional amendment that sought to place the election of the "
                "Prime Minister beyond judicial scrutiny, and in Minerva Mills v. Union of India, where the Court held that "
                "the harmonious balance between fundamental rights and directive principles was itself part of the basic "
                "structure. The doctrine has since served as a bulwark against attempts to subvert constitutional democracy "
                "through the amending process, and it continues to be cited in contemporary litigation concerning judicial "
                "independence, electoral integrity, and the separation of powers. Legal scholars have described the judgment "
                "as a triumph of constitutionalism over majoritarianism, ensuring that no transient parliamentary majority, "
                "however large, can dismantle the foundational values upon which the Republic of India was established in "
                "1950. The judgment remains a cornerstone of Indian constitutional law and is taught in every law school "
                "across the country as the definitive statement on the limits of the amending power. It is worth noting that "
                "the bench itself was deeply divided not only on the outcome but on the precise formulation of the doctrine, "
                "producing eleven separate opinions running to well over seven hundred pages in the official reporter, a "
                "reflection of the genuine intellectual difficulty of reconciling parliamentary sovereignty with constitutional "
                "supremacy. Chief Justice Sikri, who authored the lead opinion for the majority, was joined in substance by "
                "Justices Shelat, Grover, Hegde, Mukherjea, Jaganmohan Reddy, and Khanna, with Justice Khanna's separate "
                "opinion often regarded as the swing vote that ultimately determined the outcome, since his formulation of the "
                "basic structure concept differed subtly from that of the other six judges in the majority yet converged on "
                "the same result. The minority, led by Justice Ray, who would later become Chief Justice in controversial "
                "circumstances involving the supersession of three senior judges, took the view that Parliament's amending "
                "power was co-extensive with the Constitution itself and admitted of no implied limitations whatsoever. In the "
                "decades since, the basic structure doctrine has been relied upon to strike down attempts to curtail judicial "
                "review of election disputes, to protect the independence of the judiciary in the National Judicial "
                "Appointments Commission case, and to preserve free and fair elections as a facet of democracy, cementing its "
                "place as perhaps the single most consequential judicial innovation in the constitutional history of India."
            ),
        },
        {
            "case_id": "case_maneka_gandhi",
            "source_case": "Maneka Gandhi v. Union of India, (1978) 1 SCC 248",
            "text": (
                "Maneka Gandhi v. Union of India represents a watershed moment in the evolution of the right to personal "
                "liberty under Article 21 of the Constitution of India. The petitioner, a journalist, had her passport "
                "impounded by the Regional Passport Officer under the Passports Act, 1967, purportedly in the interest of "
                "the general public, without being furnished any reasons for the action. She challenged the impoundment as "
                "violative of Articles 14, 19, and 21 of the Constitution, arguing that the procedure prescribed by the Act "
                "was arbitrary and did not afford her a fair hearing before such a drastic action was taken against her. "
                "Prior to this decision, the Supreme Court's approach to Article 21 had been shaped by the earlier ruling in "
                "A.K. Gopalan v. State of Madras, which had adopted a narrow, compartmentalised view of fundamental rights, "
                "holding that as long as a law prescribed some procedure, however arbitrary, it would satisfy the "
                "requirement of Article 21. In Maneka Gandhi, a seven-judge bench decisively departed from this restrictive "
                "approach. The Court held that the procedure contemplated by Article 21 could not be any procedure, however "
                "fanciful or oppressive; it had to be fair, just, and reasonable. In doing so, the Court effectively read the "
                "due process requirement into Article 21, despite the deliberate omission of the phrase due process of law "
                "from the text of the Constitution by its framers, who had instead adopted the phrase procedure established "
                "by law. The judgment further held that Articles 14, 19, and 21 were not mutually exclusive silos but were "
                "interconnected, and any law depriving a person of personal liberty had to withstand scrutiny under all "
                "three articles. This inter-relationship test has since become a settled principle in constitutional "
                "adjudication. The Court also emphasized that the right to travel abroad fell within the scope of personal "
                "liberty under Article 21, and that the audi alteram partem principle, or the right to be heard, was a "
                "necessary concomitant of any fair procedure, even in matters concerning national security, subject to "
                "reasonable restrictions imposed by post-decisional hearings in exceptional cases. The ripple effects of "
                "this judgment have been profound and far-reaching, forming the doctrinal foundation for subsequent "
                "expansions of Article 21 to encompass the right to livelihood in Olga Tellis v. Bombay Municipal "
                "Corporation, the right to a clean environment in numerous environmental law cases, the right to privacy in "
                "Justice K.S. Puttaswamy v. Union of India, and the right to a speedy trial in Hussainara Khatoon v. State of "
                "Bihar. Maneka Gandhi is widely regarded as having transformed Article 21 from a narrow guarantee against "
                "arbitrary executive detention into an expansive reservoir of substantive rights, cementing the Supreme "
                "Court's role as the guardian of individual liberty against overreaching state action. Justice P.N. Bhagwati, "
                "who authored the leading opinion, drew heavily on comparative constitutional law, particularly the due "
                "process jurisprudence developed by the United States Supreme Court, while carefully noting that the Indian "
                "Constitution's framers had consciously rejected an identical due process clause during the Constituent "
                "Assembly debates out of concern that it would grant unelected judges excessive power to strike down social "
                "welfare legislation, a concern rooted in the American experience of the Lochner era. Bhagwati J. reconciled "
                "this historical choice with the demands of a mature constitutional democracy by holding that fairness was "
                "inherent even in the more modest phrase procedure established by law, so long as that procedure did not "
                "offend the rule of law. The Attorney General for India had argued that passport impoundment fell within the "
                "exclusive domain of executive discretion in matters of foreign affairs and could not be subjected to the "
                "same standard of natural justice applicable to ordinary administrative action, an argument the Court "
                "rejected as fundamentally incompatible with a constitutional order committed to limited government. The "
                "judgment also clarified that even where a statute is silent on the right to a hearing, such a right would "
                "ordinarily be read into the statute unless expressly or by necessary implication excluded, a principle that "
                "has since guided the interpretation of countless regulatory and licensing statutes across India. Decades "
                "later, the Maneka Gandhi framework was invoked directly in Justice K.S. Puttaswamy v. Union of India to "
                "justify treating privacy as an emanation of personal liberty, illustrating the doctrinal chain running from "
                "this single passport case to the furthest reaches of contemporary Indian rights jurisprudence."
            ),
        },
        {
            "case_id": "case_vishaka",
            "source_case": "Vishaka v. State of Rajasthan, (1997) 6 SCC 241",
            "text": (
                "Vishaka v. State of Rajasthan arose from the brutal gang rape of a social worker in rural Rajasthan, who "
                "had attempted to prevent a child marriage in the course of her employment under a government-sponsored "
                "programme. The incident starkly exposed the absence of any legal framework in India addressing sexual "
                "harassment of women at the workplace. A group of women's rights organisations and activists, collectively "
                "styled as Vishaka, filed a writ petition before the Supreme Court seeking enforcement of the fundamental "
                "rights of working women under Articles 14, 19, and 21 of the Constitution, contending that sexual "
                "harassment at the workplace constituted a clear violation of these guarantees as well as the right to "
                "practise any profession or to carry on any occupation, trade, or business under Article 19(1)(g). At the "
                "time the petition was filed, Indian law contained no specific civil or penal provision dealing with sexual "
                "harassment in employment, leaving victims with little recourse beyond the general and often inadequate "
                "provisions of the Indian Penal Code. Recognising this significant legislative vacuum, the Supreme Court "
                "invoked its power under Article 32 read with Article 141 of the Constitution to lay down binding guidelines, "
                "commonly referred to as the Vishaka Guidelines, which were to have the force of law until Parliament enacted "
                "appropriate legislation. The Court drew upon international conventions, including the Convention on the "
                "Elimination of All Forms of Discrimination Against Women, to which India was a signatory, invoking Article "
                "51(c) and Article 253 of the Constitution to justify the incorporation of international norms into domestic "
                "jurisprudence in the absence of domestic law. The guidelines mandated that all employers, whether in the "
                "public or private sector, take appropriate steps to prevent sexual harassment, including the constitution of "
                "a Complaints Committee headed by a woman, with not less than half its members being women, to receive and "
                "adjudicate complaints in a time-bound and confidential manner. The judgment also provided an expansive "
                "definition of sexual harassment, encompassing unwelcome sexually determined behaviour, whether directly or "
                "by implication, including physical contact, demands for sexual favours, sexually coloured remarks, and the "
                "display of pornography. The Vishaka Guidelines remained the operative law on the subject for sixteen years, "
                "until Parliament finally enacted the Sexual Harassment of Women at Workplace (Prevention, Prohibition and "
                "Redressal) Act, 2013, which substantially codified and expanded upon the framework laid down by the Court. "
                "Vishaka is frequently cited as a paradigmatic example of judicial law-making to fill a legislative vacuum "
                "and remains foundational to the jurisprudence of workplace gender justice in India. The bench, led by Chief "
                "Justice J.S. Verma along with Justices Sujata Manohar and B.N. Kirpal, expressly invoked the doctrine that "
                "in the absence of enacted domestic law occupying the field, international conventions consistent with the "
                "fundamental rights guaranteed under the Constitution must be read into those provisions to enlarge their "
                "meaning and content, a technique of interpretation that has since been applied in fields as varied as "
                "environmental protection, child labour, and disability rights. The Court was careful to note that the "
                "guidelines were intended to be a stop-gap arrangement, binding until such time as suitable legislation was "
                "enacted, thereby respecting the constitutional separation of powers while still ensuring that working women "
                "were not left entirely without remedy in the interim. In the years following Vishaka, the Supreme Court "
                "revisited and refined the framework in Apparel Export Promotion Council v. A.K. Chopra and later in Medha "
                "Kotwal Lele v. Union of India, where the Court expressed concern over the inconsistent implementation of the "
                "guidelines across states and directed state governments to file compliance affidavits confirming the "
                "constitution of Complaints Committees in all government departments and institutions. The eventual 2013 "
                "legislation retained the core architecture devised by the Court, including the Internal Complaints "
                "Committee mechanism, while adding provisions for Local Complaints Committees to cover the unorganised "
                "sector and domestic workers, extending the protective umbrella first conceived in this judgment to millions "
                "of women who fell outside the scope of formal employment altogether."
            ),
        },
        {
            "case_id": "case_minerva_mills",
            "source_case": "Minerva Mills Ltd. v. Union of India, AIR 1980 SC 1789",
            "text": (
                "Minerva Mills Ltd. v. Union of India is a landmark decision of the Supreme Court of India that further "
                "refined and reinforced the basic structure doctrine first articulated in Kesavananda Bharati v. State of "
                "Kerala. The case arose from a challenge to the nationalisation of Minerva Mills, a textile undertaking, "
                "under the Sick Textile Undertakings (Nationalisation) Act, 1974, but the constitutional questions before the "
                "Court extended far beyond the specific facts of the nationalisation to encompass the validity of the "
                "Forty-Second Amendment to the Constitution, enacted during the period of Emergency in 1976. The Forty-Second "
                "Amendment had inserted clauses into Article 368 declaring that there would be no limitation whatsoever on "
                "the constituent power of Parliament to amend the Constitution, and further provided that no constitutional "
                "amendment could be questioned in any court on any ground whatsoever. The amendment also sought to grant "
                "primacy to the Directive Principles of State Policy under Part IV of the Constitution over the fundamental "
                "rights guaranteed under Part III, particularly Articles 14, 19, and 31. A five-judge bench of the Supreme "
                "Court struck down both these provisions as unconstitutional, holding that the guarantee of a limited amending "
                "power was itself a part of the basic structure of the Constitution, since a limitation on that power was one "
                "of its foundational features; an unlimited power, by definition, could not be a limited power at all. The "
                "Court reasoned that if Parliament could grant itself an unlimited power to amend the Constitution, it could "
                "in effect destroy the very document from which its own authority to amend was derived, an inherently "
                "self-contradictory proposition. The Court also held that the harmonious balance and interdependence between "
                "the fundamental rights enshrined in Part III and the Directive Principles enshrined in Part IV was itself an "
                "essential feature of the basic structure, and that according absolute primacy to one over the other would "
                "disturb this delicate constitutional equilibrium. Chief Justice Y.V. Chandrachud, writing for the majority, "
                "observed that the Indian Constitution was founded on the bedrock of the balance between these two parts, and "
                "that to give absolute primacy to one over the other would be to destroy the harmony that the framers had so "
                "carefully constructed. The judgment in Minerva Mills is widely regarded as having preserved the essential "
                "character of judicial review in India and as having decisively rejected the notion of parliamentary "
                "supremacy over the Constitution itself, reaffirming that constitutional supremacy, not parliamentary "
                "supremacy, is the governing principle of Indian constitutional democracy. The decision also struck down "
                "the amendment to Article 31C, which had sought to immunise any law giving effect to the Directive "
                "Principles from challenge under Articles 14 and 19, on the ground that judicial review itself was part of "
                "the basic structure and could not be excluded even for laws professedly enacted to further socio-economic "
                "justice. Justice P.N. Bhagwati, dissenting in part, expressed concern that the majority's approach might "
                "unduly constrain Parliament's ability to pursue egalitarian reform, foreshadowing a tension between "
                "redistributive economic policy and individual rights protection that continues to animate Indian "
                "constitutional debate to this day. The case is frequently read alongside Kesavananda Bharati and Indira "
                "Nehru Gandhi v. Raj Narain as forming a trilogy of decisions through which the Supreme Court progressively "
                "entrenched the basic structure doctrine against successive attempts at legislative and executive "
                "erosion, particularly during and immediately after the Emergency period when many of India's democratic "
                "institutions faced unprecedented strain. Contemporary constitutional scholars regard Minerva Mills as the "
                "decision that most clearly establishes limited government, rather than unchecked majoritarian will, as the "
                "organising principle of the Indian constitutional order, a proposition that has since been invoked in "
                "challenges to legislation touching on federalism, the independence of statutory tribunals, and the "
                "insulation of election machinery from executive interference."
            ),
        },
        {
            "case_id": "case_puttaswamy",
            "source_case": "Justice K.S. Puttaswamy v. Union of India, (2017) 10 SCC 1",
            "text": (
                "Justice K.S. Puttaswamy v. Union of India is the landmark decision in which a nine-judge bench of the "
                "Supreme Court of India unanimously held that the right to privacy is a fundamental right protected under "
                "the Constitution of India, intrinsic to the guarantee of life and personal liberty under Article 21 and as "
                "part of the freedoms guaranteed by Part III of the Constitution. The litigation originated from a challenge "
                "to the constitutional validity of the Aadhaar scheme, a biometric identification programme introduced by "
                "the Government of India, on the ground that its mandatory linkage to the delivery of government welfare "
                "benefits violated the right to privacy of citizens. During the course of the proceedings, the Union of "
                "India relied on two earlier decisions of the Supreme Court, M.P. Sharma v. Satish Chandra and Kharak Singh "
                "v. State of Uttar Pradesh, both of which had held that the right to privacy was not a guaranteed right under "
                "the Constitution. Given the significance of the question and the need to authoritatively settle the "
                "conflicting jurisprudence on the subject, the matter was referred to a nine-judge bench, the first such "
                "bench to be constituted specifically to consider the question of privacy since the framing of the "
                "Constitution. The Court, in a set of six concurring opinions, unanimously overruled the earlier decisions in "
                "M.P. Sharma and Kharak Singh to the extent they held that privacy was not a fundamental right, and held that "
                "privacy is a natural right that inheres in every individual by virtue of their existence, and that it is not "
                "conferred by the Constitution but merely recognised and protected by it. The Court identified privacy as "
                "encompassing several distinct facets, including bodily autonomy, informational self-determination, and "
                "decisional autonomy in matters of intimate personal choice such as marriage, procreation, and sexual "
                "orientation. The judgment expressly held that any restriction on the right to privacy would have to satisfy "
                "the threefold test of legality, requiring the existence of a law; legitimate state aim; and proportionality, "
                "requiring a rational nexus between the objects sought to be achieved and the means adopted to achieve them, "
                "with the least restrictive alternative being preferred. The ramifications of the Puttaswamy judgment have "
                "been extensive, providing the doctrinal foundation for the subsequent decision in Navtej Singh Johar v. "
                "Union of India, which decriminalised consensual homosexual conduct by reading down Section 377 of the "
                "Indian Penal Code, as well as for the ongoing jurisprudence concerning data protection legislation, digital "
                "surveillance, and the permissible boundaries of the Aadhaar scheme itself, which was substantially upheld in "
                "a subsequent five-judge bench decision, albeit with important restrictions on its mandatory use by private "
                "entities. Puttaswamy is now considered a foundational text of Indian constitutional privacy law. The "
                "judgment was delivered through six separate opinions, authored by Justices Chandrachud, Chelameswar, Bobde, "
                "Nariman, Sapre, and Kaul, each approaching the question from a distinct doctrinal vantage point yet "
                "converging unanimously on the central holding, a rare instance of complete consensus on a constitutional "
                "question of such magnitude before the Supreme Court. Justice Chandrachud's plurality opinion, the longest "
                "of the six, traced the historical evolution of privacy jurisprudence from the earliest common law "
                "recognition of a right to be let alone through to its modern constitutional articulation, while Justice "
                "Chelameswar's concurring opinion placed particular emphasis on decisional autonomy as a distinct facet of "
                "liberty. Justice Kaul's opinion notably anticipated the challenges posed by big data and algorithmic "
                "profiling, observing that informational privacy in the digital age required constitutional protection "
                "commensurate with the scale of contemporary data collection by both state and private actors. The judgment "
                "has since been cited extensively in litigation concerning the constitutionality of data protection "
                "legislation, facial recognition technology deployed by law enforcement, and the permissible scope of "
                "government surveillance programmes, cementing its status as the single most cited privacy precedent in "
                "Indian constitutional law and a frequent point of reference for courts across the Commonwealth grappling "
                "with similar questions of digital-age privacy protection."
            ),
        },
    ]


def load_or_create_dataset():
    if os.path.exists(DATA_PATH):
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f)

    os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
    dataset = build_dummy_dataset()
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(dataset, f, indent=2, ensure_ascii=False)
    print(f"No dataset found — generated dummy dataset at {DATA_PATH} ({len(dataset)} cases).")
    return dataset


def main():
    cases = load_or_create_dataset()

    # Chunk every case and flatten into one global pool of records.
    all_chunks = []
    for case in cases:
        case_id = case["case_id"]
        source_case = case["source_case"]
        text_chunks = text_splitter.split_text(case["text"])
        for i, chunk_text in enumerate(text_chunks):
            all_chunks.append({
                "_id": f"{case_id}_chunk_{i}",
                "text": chunk_text,
                "source_case": source_case,
            })

    print(f"Chunked {len(cases)} cases into {len(all_chunks)} total records.")

    # Split the global pool into batches of exactly BATCH_SIZE.
    batches = [all_chunks[i:i + BATCH_SIZE] for i in range(0, len(all_chunks), BATCH_SIZE)]

    failures = 0
    for batch in tqdm(batches, desc="Upserting batches to Pinecone"):
        response = batch_upsert_to_pinecone(batch)
        if 200 <= response.status_code < 300:
            time.sleep(1)  # gentle pacing to stay under API rate limit thresholds
        else:
            failures += 1
            print(f"\n❌ Batch failed — status {response.status_code}: {response.text}")

    if failures == 0:
        print(f"✅ Success! {len(all_chunks)} records across {len(batches)} batches seeded into 'legal-cases'.")
    else:
        print(f"⚠️ Completed with {failures}/{len(batches)} batch failures — see errors above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
