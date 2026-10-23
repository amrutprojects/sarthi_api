import type { DataSource, EntityManager } from 'typeorm';
import { BoardMember, BoardSection } from '../../cms/board/board.model';

export interface BoardSeedSummary {
  created: boolean;
  membersCreated: number;
}

/*
 * The Leadership & Governing Board section (मान्यवर व संचालक मंडळ), exactly as the website showed it.
 *
 * Taken VERBATIM from the website's former bundled copy — public-site/content/leadership.ts for the
 * cards, its TIER_LABEL map for the badges, and home/sections/Leadership.tsx for the heading,
 * subtitle and notice — so seeding changes nothing a visitor sees; it only moves the source of truth
 * into the database.
 *
 * The officeholders' names are deliberately NULL where the site left them blank: the offices are
 * public record, but current names must come from official AMRUT records, not be guessed. No photos
 * are seeded for the same reason; every card starts with the person icon.
 */
const SECTION = {
  headingMr: 'मान्यवर व संचालक मंडळ',
  headingEn: 'Leadership & Governing Board',
  subtitleMr: 'अमृत संस्थेचे नियामक मंडळ व कार्यक्रमाचे नेतृत्व.',
  subtitleEn: 'The AMRUT Governing Board and programme leadership.',
  noticeTitleMr: 'नावे व छायाचित्रे भरावयाची आहेत',
  noticeTitleEn: 'Names and photographs to be supplied',
  noticeBodyMr:
    'वरील पदनामे सार्वजनिक नोंदीनुसार आहेत. विद्यमान पदाधिकाऱ्यांची नावे व छायाचित्रे अमृतच्या अधिकृत नोंदीनुसार भरावीत — प्रात्यक्षिक आवृत्तीत ती जाणीवपूर्वक रिक्त ठेवली आहेत.',
  noticeBodyEn:
    'The offices listed above are from public record. Names and photographs of the current officeholders should be supplied from official AMRUT records — they are deliberately left blank in this demo rather than guessed.',
  showNotice: true,
};

const STATE = { categoryMr: 'राज्य शासन', categoryEn: 'State Government' };
const DEPT = { categoryMr: 'विभाग', categoryEn: 'Department' };
const BOARD = { categoryMr: 'नियामक मंडळ', categoryEn: 'Governing Board' };
const PARTNER = { categoryMr: 'अंमलबजावणी भागीदार', categoryEn: 'Implementation Partner' };
const TO_FILL = { descriptionMr: 'नाव अमृत नोंदीनुसार भरावे', descriptionEn: 'Name to be filled from AMRUT records' };

const MEMBERS = [
  {
    ...STATE,
    designationMr: 'मा. मुख्यमंत्री, महाराष्ट्र राज्य',
    designationEn: "Hon'ble Chief Minister, Maharashtra",
    name: null,
    ...TO_FILL,
  },
  {
    ...STATE,
    designationMr: 'मा. उपमुख्यमंत्री, महाराष्ट्र राज्य',
    designationEn: "Hon'ble Deputy Chief Minister, Maharashtra",
    name: null,
    ...TO_FILL,
  },
  {
    ...DEPT,
    designationMr: 'मा. मंत्री, इतर मागास बहुजन कल्याण विभाग',
    designationEn: "Hon'ble Minister, Other Backward Bahujan Welfare Department",
    name: null,
    ...TO_FILL,
  },
  {
    ...BOARD,
    designationMr: 'मा. प्रधान सचिव, इतर मागास बहुजन कल्याण विभाग - अध्यक्ष, नियामक मंडळ (अमृत)',
    designationEn: "Hon'ble Principal Secretary, OBC & Bahujan Welfare Dept. - Chairperson, AMRUT Governing Board",
    name: null,
    descriptionMr: 'अमृत नियामक मंडळाचे अध्यक्ष',
    descriptionEn: 'Chairperson of the AMRUT Governing Board',
  },
  {
    ...BOARD,
    designationMr: 'मा. व्यवस्थापकीय संचालक, अमृत',
    designationEn: "Hon'ble Managing Director, AMRUT",
    name: null,
    descriptionMr: 'योजना कार्यान्वयनाचे प्रमुख',
    descriptionEn: 'Heads scheme implementation',
  },
  {
    ...PARTNER,
    designationMr: 'प्रकल्प संचालक, सुमागो इन्फोटेक प्रा. लि. (SUMAGO INFOTECH PVT LTD)',
    designationEn: 'Project Director, SUMAGO INFOTECH PVT LTD',
    name: 'Rajendra Sumago',
    descriptionMr: 'अंमलबजावणी भागीदार',
    descriptionEn: 'Implementation partner',
  },
];

/*
 * Idempotent, and deliberately all-or-nothing about it: if the section's settings row already exists
 * this does NOTHING AT ALL. Seeding is a first-run step; after that the content belongs to whoever
 * edits it in the admin panel, and re-running the seed on a live database must never undo that work
 * or bring back a member someone deleted.
 *
 * Runs in one transaction so a half-seeded section can never be committed.
 */
export async function seedBoardMembers(ds: DataSource): Promise<BoardSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const sections = m.getRepository(BoardSection);
    if (await sections.findOne({ where: { isDelete: false } })) return { created: false, membersCreated: 0 };

    await sections.save(sections.create(SECTION));
    await m.getRepository(BoardMember).insert(MEMBERS.map((member, i) => ({ ...member, displayOrder: i + 1, photoKey: null })));
    return { created: true, membersCreated: MEMBERS.length };
  });
}
