import type { DataSource, EntityManager } from 'typeorm';
import {
  ProgrammeElectiveDomain,
  ProgrammeModule,
  ProgrammeModuleSettings,
} from '../../cms/modules/modules.model';

export interface ModulesSeedSummary {
  created: boolean;
  modulesCreated: number;
  electivesCreated: number;
}

/*
 * Initial Modules page content.
 *
 * Extracted from public-site/content/kalash.ts rather than retyped, so the figures and certificate
 * names match the website exactly.
 *
 * Each module carries its OWN timetable — they all run the same 120 hours today, but they are
 * independent, so one can be changed without touching the others. Each also carries its own list
 * of the ten employment domains, naming the certificate THAT module awards in each: the first
 * elective gives the basic course, the second the advanced one, and a MAIN module gives its own
 * certificate, which is what a candidate earns there whichever domain they follow.
 *
 * Total hours and the domain count are NOT seeded. The site sums them from the modules, so they
 * cannot contradict them.
 *
 * Marathi first, as on the AMRUT portal. Course titles are published in English only.
 */
const SETTINGS = {
  pageTitleMr: 'मॉड्यूल्स — सारथी',
  pageTitleEn: 'Modules — SARTHI',
  pageSubtitleMr: 'चार मॉड्यूल्स, प्रत्येकी १२० तास. मॉड्यूल ३ व ४ मध्ये १० पैकी एक रोजगार क्षेत्र निवडावे लागते.',
  pageSubtitleEn:
    'Four modules of 120 hours each. In Modules 3 and 4 the candidate selects one of 10 employment domains.',
  sessionLengthMr: '1 hr',
  sessionLengthEn: '1 hr',
  sessionLabelMr: 'प्रति सत्र',
  sessionLabelEn: 'per session',
  fixedPathPct: 40,
  selfPathPct: 60,
  /* The headline district figure on the home page; the programme dataset draws 36 map tiles. */
  districtCount: 36,
};

const MODULES = [
  {
    no: 1,
    code: "ECS",
    kind: "MAIN" as const,
    nameMr: "इंग्रजी भाषा, संभाषण व सॉफ्ट स्किल्स",
    nameEn: "Certificate in English Language Skills, Communication Skills and Soft Skills",
    descriptionMr: "इंग्रजी भाषा कौशल्ये, प्रभावी संभाषण आणि कार्यस्थळावरील सॉफ्ट स्किल्स.",
    descriptionEn: "English language ability, effective communication and workplace soft skills.",
    moduleHours: 120,
    trainingHours: 99,
    assessmentHours: 21,
    weeksPerModule: 6,
    daysPerWeek: 6,
    hoursPerDay: 3,
    weeklyAssessmentHours: '3.5',
    displayOrder: 0,
    electives: [
      { no: 1, domainMr: "डेटा एन्ट्री व डेटा व्यवस्थापन", domainEn: "Data Entry & Data Management", certificate: "Certificate in English Language Skills, Communication Skills and Soft Skills", displayOrder: 0 },
      { no: 2, domainMr: "लेखाकाम", domainEn: "Accounting", certificate: "Certificate in English Language Skills, Communication Skills and Soft Skills", displayOrder: 1 },
      { no: 3, domainMr: "प्रगत लेखाकाम व प्रगत एक्सेल", domainEn: "Advanced Financial Accounting and Advanced Excel", certificate: "Certificate in English Language Skills, Communication Skills and Soft Skills", displayOrder: 2 },
      { no: 4, domainMr: "डिझायनिंग", domainEn: "Designing", certificate: "Certificate in English Language Skills, Communication Skills and Soft Skills", displayOrder: 3 },
      { no: 5, domainMr: "वेब डिझायनिंग", domainEn: "Web Designing", certificate: "Certificate in English Language Skills, Communication Skills and Soft Skills", displayOrder: 4 },
      { no: 6, domainMr: "हार्डवेअर व नेटवर्किंग", domainEn: "Hardware & Networking", certificate: "Certificate in English Language Skills, Communication Skills and Soft Skills", displayOrder: 5 },
      { no: 7, domainMr: "प्रोग्रामिंग", domainEn: "Programming", certificate: "Certificate in English Language Skills, Communication Skills and Soft Skills", displayOrder: 6 },
      { no: 8, domainMr: "व्यवस्थापन", domainEn: "Management", certificate: "Certificate in English Language Skills, Communication Skills and Soft Skills", displayOrder: 7 },
      { no: 9, domainMr: "बँकिंग, वित्तीय सेवा व विमा (BFSI)", domainEn: "Banking, Financial Services & Insurance (BFSI)", certificate: "Certificate in English Language Skills, Communication Skills and Soft Skills", displayOrder: 8 },
      { no: 10, domainMr: "डिजिटल मार्केटिंग", domainEn: "Digital Marketing", certificate: "Certificate in English Language Skills, Communication Skills and Soft Skills", displayOrder: 9 },
    ],
  },
  {
    no: 2,
    code: "ITS",
    kind: "MAIN" as const,
    nameMr: "मूलभूत माहिती तंत्रज्ञान कौशल्ये (रोजगारक्षमता वृद्धीसाठी)",
    nameEn: "Certificate in Basic Information Technology Skills (For Employability Enhancement)",
    descriptionMr: "संगणक हाताळणी, इंटरनेट, ई-सेवा व कार्यालयीन सॉफ्टवेअरची मूलभूत कौशल्ये.",
    descriptionEn: "Core computer, internet, e-services and office software skills.",
    moduleHours: 120,
    trainingHours: 99,
    assessmentHours: 21,
    weeksPerModule: 6,
    daysPerWeek: 6,
    hoursPerDay: 3,
    weeklyAssessmentHours: '3.5',
    displayOrder: 1,
    electives: [
      { no: 1, domainMr: "डेटा एन्ट्री व डेटा व्यवस्थापन", domainEn: "Data Entry & Data Management", certificate: "Certificate in Basic Information Technology Skills (For Employability Enhancement)", displayOrder: 0 },
      { no: 2, domainMr: "लेखाकाम", domainEn: "Accounting", certificate: "Certificate in Basic Information Technology Skills (For Employability Enhancement)", displayOrder: 1 },
      { no: 3, domainMr: "प्रगत लेखाकाम व प्रगत एक्सेल", domainEn: "Advanced Financial Accounting and Advanced Excel", certificate: "Certificate in Basic Information Technology Skills (For Employability Enhancement)", displayOrder: 2 },
      { no: 4, domainMr: "डिझायनिंग", domainEn: "Designing", certificate: "Certificate in Basic Information Technology Skills (For Employability Enhancement)", displayOrder: 3 },
      { no: 5, domainMr: "वेब डिझायनिंग", domainEn: "Web Designing", certificate: "Certificate in Basic Information Technology Skills (For Employability Enhancement)", displayOrder: 4 },
      { no: 6, domainMr: "हार्डवेअर व नेटवर्किंग", domainEn: "Hardware & Networking", certificate: "Certificate in Basic Information Technology Skills (For Employability Enhancement)", displayOrder: 5 },
      { no: 7, domainMr: "प्रोग्रामिंग", domainEn: "Programming", certificate: "Certificate in Basic Information Technology Skills (For Employability Enhancement)", displayOrder: 6 },
      { no: 8, domainMr: "व्यवस्थापन", domainEn: "Management", certificate: "Certificate in Basic Information Technology Skills (For Employability Enhancement)", displayOrder: 7 },
      { no: 9, domainMr: "बँकिंग, वित्तीय सेवा व विमा (BFSI)", domainEn: "Banking, Financial Services & Insurance (BFSI)", certificate: "Certificate in Basic Information Technology Skills (For Employability Enhancement)", displayOrder: 8 },
      { no: 10, domainMr: "डिजिटल मार्केटिंग", domainEn: "Digital Marketing", certificate: "Certificate in Basic Information Technology Skills (For Employability Enhancement)", displayOrder: 9 },
    ],
  },
  {
    no: 3,
    code: "DS-BDS",
    kind: "ELECTIVE" as const,
    nameMr: "क्षेत्रनिहाय मूलभूत डिजिटल कौशल्ये",
    nameEn: "Certificate in Domain Specific Basic Digital Skills",
    descriptionMr: "उमेदवार १० पैकी एक रोजगार क्षेत्र निवडतो व त्यातील मूलभूत डिजिटल कौशल्ये शिकतो.",
    descriptionEn: "The candidate selects one of 10 employment domains as an elective and learns its basic digital skills.",
    moduleHours: 120,
    trainingHours: 99,
    assessmentHours: 21,
    weeksPerModule: 6,
    daysPerWeek: 6,
    hoursPerDay: 3,
    weeklyAssessmentHours: '3.5',
    displayOrder: 2,
    electives: [
      { no: 1, domainMr: "डेटा एन्ट्री व डेटा व्यवस्थापन", domainEn: "Data Entry & Data Management", certificate: "Certificate in Data Management with Excel", displayOrder: 0 },
      { no: 2, domainMr: "लेखाकाम", domainEn: "Accounting", certificate: "Certificate in Foundation of Financial Accounting (with Tally and Excel)", displayOrder: 1 },
      { no: 3, domainMr: "प्रगत लेखाकाम व प्रगत एक्सेल", domainEn: "Advanced Financial Accounting and Advanced Excel", certificate: "Certificate in Advanced Accounting (with Tally and Excel)", displayOrder: 2 },
      { no: 4, domainMr: "डिझायनिंग", domainEn: "Designing", certificate: "Certificate in Desktop Publishing (DTP)", displayOrder: 3 },
      { no: 5, domainMr: "वेब डिझायनिंग", domainEn: "Web Designing", certificate: "Certificate in Web Designing", displayOrder: 4 },
      { no: 6, domainMr: "हार्डवेअर व नेटवर्किंग", domainEn: "Hardware & Networking", certificate: "Certificate in Hardware and Networking", displayOrder: 5 },
      { no: 7, domainMr: "प्रोग्रामिंग", domainEn: "Programming", certificate: "Certificate in Mobile App Development", displayOrder: 6 },
      { no: 8, domainMr: "व्यवस्थापन", domainEn: "Management", certificate: "Certificate in Retail Management", displayOrder: 7 },
      { no: 9, domainMr: "बँकिंग, वित्तीय सेवा व विमा (BFSI)", domainEn: "Banking, Financial Services & Insurance (BFSI)", certificate: "Certificate in Banking, Financial Services and Insurance (BFSI)", displayOrder: 8 },
      { no: 10, domainMr: "डिजिटल मार्केटिंग", domainEn: "Digital Marketing", certificate: "Certificate in Digital Marketing Essentials", displayOrder: 9 },
    ],
  },
  {
    no: 4,
    code: "DS-ADS",
    kind: "ELECTIVE" as const,
    nameMr: "क्षेत्रनिहाय प्रगत डिजिटल कौशल्ये",
    nameEn: "Certificate in Domain Specific Advanced Digital Skills",
    descriptionMr: "निवडलेल्या क्षेत्रातील प्रगत कौशल्ये व सिम्युलेटेड कार्यानुभव.",
    descriptionEn: "Advanced skills in the chosen domain, with simulated work experience.",
    moduleHours: 120,
    trainingHours: 99,
    assessmentHours: 21,
    weeksPerModule: 6,
    daysPerWeek: 6,
    hoursPerDay: 3,
    weeklyAssessmentHours: '3.5',
    displayOrder: 3,
    electives: [
      { no: 1, domainMr: "डेटा एन्ट्री व डेटा व्यवस्थापन", domainEn: "Data Entry & Data Management", certificate: "Certificate in Advanced Data Management with Excel", displayOrder: 0 },
      { no: 2, domainMr: "लेखाकाम", domainEn: "Accounting", certificate: "Certificate in Applied Financial Accounting (with Tally and Excel)", displayOrder: 1 },
      { no: 3, domainMr: "प्रगत लेखाकाम व प्रगत एक्सेल", domainEn: "Advanced Financial Accounting and Advanced Excel", certificate: "Certificate in Applied Advanced Accounting (with Tally and Excel)", displayOrder: 2 },
      { no: 4, domainMr: "डिझायनिंग", domainEn: "Designing", certificate: "Certificate in Advanced Desktop Publishing (DTP)", displayOrder: 3 },
      { no: 5, domainMr: "वेब डिझायनिंग", domainEn: "Web Designing", certificate: "Certificate in Advanced Web Designing", displayOrder: 4 },
      { no: 6, domainMr: "हार्डवेअर व नेटवर्किंग", domainEn: "Hardware & Networking", certificate: "Certificate in Advanced Hardware and Networking", displayOrder: 5 },
      { no: 7, domainMr: "प्रोग्रामिंग", domainEn: "Programming", certificate: "Certificate in Advanced Mobile App Development", displayOrder: 6 },
      { no: 8, domainMr: "व्यवस्थापन", domainEn: "Management", certificate: "Certificate in Advanced Retail Management", displayOrder: 7 },
      { no: 9, domainMr: "बँकिंग, वित्तीय सेवा व विमा (BFSI)", domainEn: "Banking, Financial Services & Insurance (BFSI)", certificate: "Certificate in Advanced Banking, Financial Services and Insurance (BFSI)", displayOrder: 8 },
      { no: 10, domainMr: "डिजिटल मार्केटिंग", domainEn: "Digital Marketing", certificate: "Certificate in Advanced Digital Marketing", displayOrder: 9 },
    ],
  },
];

/*
 * Idempotent, and deliberately all-or-nothing about it: if a configuration row already exists this
 * does NOTHING AT ALL. Seeding is a first-run step, and after that the content belongs to whoever
 * edits it in the admin panel. Re-running the seed on a live database must never undo that work.
 *
 * Runs in one transaction so a half-seeded page can never be committed.
 */
export async function seedModulesPage(ds: DataSource): Promise<ModulesSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const settingsRepo = m.getRepository(ProgrammeModuleSettings);

    const existing = await settingsRepo.findOne({ where: { isDelete: false } });
    if (existing) return { created: false, modulesCreated: 0, electivesCreated: 0 };

    /* No isPublished: the Modules page has no publish switch, and the column keeps its default. */
    const settings = await settingsRepo.save(settingsRepo.create(SETTINGS));

    const moduleRepo = m.getRepository(ProgrammeModule);
    const domainRepo = m.getRepository(ProgrammeElectiveDomain);
    let electivesCreated = 0;

    for (const { electives, ...card } of MODULES) {
      const saved = await moduleRepo.save(moduleRepo.create({ ...card, settingsId: settings.id }));
      if (electives.length > 0) {
        await domainRepo.insert(electives.map((e) => ({ ...e, moduleId: saved.id })));
        electivesCreated += electives.length;
      }
    }

    return { created: true, modulesCreated: MODULES.length, electivesCreated };
  });
}
