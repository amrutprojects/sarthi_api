import type { DataSource } from 'typeorm';
import { ProgrammePageSettings } from '../../cms/programme/programme.model';

export interface ProgrammeSeedSummary {
  created: boolean;
}

/*
 * Initial Programme page content.
 *
 * Exactly what the public site displayed before the page became CMS-managed (amrut-kalash-web
 * public-site/content/kalash.ts: tagline, objectives, methodology, assessment, proctoring, certification), in both
 * languages, so seeding changes nothing a visitor sees. Idempotent: once the page exists, nothing is written, so
 * content edited in the admin panel is never overwritten.
 */
const PAGE = {
  introMr: 'कौशल्यातील तफावत भरून काढून युवकांची रोजगारक्षमता व स्वयंरोजगारक्षमता वाढविणे.',
  introEn: 'Bridging the skill deficit to enhance employability and self-employability of youth.',
  objectives: [
    { mr: 'आर्थिकदृष्ट्या दुर्बल युवकांमधील कौशल्यातील तफावत भरून काढणे', en: 'Bridge skill deficiencies among economically weaker youth' },
    { mr: 'रोजगार व स्वयंरोजगाराच्या संधी वाढविणे', en: 'Enhance employability and self-employment prospects' },
    { mr: '२१ व्या शतकातील रोजगारक्षमतेची कौशल्ये विकसित करणे', en: 'Develop 21st-century job-readiness competencies' },
    { mr: 'उत्पादकता, सर्जनशीलता व उद्योजकीय दृष्टिकोन रुजविणे', en: 'Foster productivity, creativity and an entrepreneurial mindset' },
    { mr: 'डिजिटल व गिग इकॉनॉमीतील संधींसाठी सज्ज करणे', en: 'Prepare candidates for digital and gig-economy opportunities' },
  ],
  methodology: [
    {
      label: { mr: 'शिकण्याची पद्धत', en: 'Delivery mode' },
      value: {
        mr: 'अधिकृत अध्ययन केंद्रांवर (ALC) इंटरनेट-सज्ज मल्टिमीडिया संगणक व हेडफोनसह ई-लर्निंग',
        en: 'eLearning at Authorized Learning Centres (ALCs) on internet-ready multimedia computers with headphones',
      },
    },
    {
      label: { mr: 'अध्यापन तत्त्व', en: 'Pedagogy' },
      value: {
        mr: 'कृतीतून शिक्षण - कौशल्यप्रभुत्व, क्षमता व आत्मविश्वासासाठी',
        en: 'Learning by Doing, for skill mastery with competence and confidence',
      },
    },
    {
      label: { mr: 'शिकण्याचा मार्ग', en: 'Learning path' },
      value: {
        mr: 'निश्चित-मार्ग ४०% + स्व-मार्ग ६०%, प्रत्येक तासाच्या सत्रात मूल्यमापन व उपचारात्मक मार्गदर्शन',
        en: 'Fixed-path 40% + self-path 60%, each one-hour session with assessment and remedial input',
      },
    },
    {
      label: { mr: 'आशय स्वरूप', en: 'Content' },
      value: {
        mr: 'सुमागो LMS मधील उच्च-गुणवत्तेचा मल्टिमीडिया आशय व सविस्तर व्हॉइस-ओव्हर',
        en: 'High-definition multimedia content with rich voice-over in the SUMAGO LMS',
      },
    },
    {
      label: { mr: 'प्रतिमान', en: 'Paradigm' },
      value: { mr: 'निश्चित-वेळ, परिवर्तनीय-कौशल्ये (fixed-time variable-skills)', en: 'Fixed-time, variable-skills' },
    },
  ],
  assessment: [
    { component: { mr: 'अंतर्गत अध्ययन प्रगती मूल्यमापन', en: 'Internal learning progression assessment' }, min: 10, max: 25 },
    {
      component: { mr: 'साप्ताहिक पर्यवेक्षित सलग ऑनलाइन मूल्यमापन', en: 'Weekly supervised continuous online assessment' },
      min: 10,
      max: 25,
    },
    { component: { mr: 'अंतिम ऑनलाइन परीक्षा', en: 'Final online examination' }, min: 20, max: 50 },
  ],
  assessmentNoteMr: 'स्वयंचलित व कृत्रिम बुद्धिमत्ता (AI) प्रॉक्टर्ड मूल्यमापन, वैयक्तिक विद्यार्थी लॉगिनद्वारे.',
  assessmentNoteEn: 'Automated and Artificial Intelligence (AI) proctored assessment through personalised student logins.',
  certification: [
    {
      mr: 'प्रत्येक मॉड्यूल पूर्ण करून अंतिम परीक्षा उत्तीर्ण झाल्यावर मॉड्यूलनिहाय प्रमाणपत्र मिळते.',
      en: 'A module-wise certificate is issued on completing each module and passing its final examination.',
    },
    {
      mr: 'चारही मॉड्यूल्स उत्तीर्ण झाल्यावर "अमृत कलश डिप्लोमा" प्रमाणपत्र मिळते.',
      en: 'On passing all four modules, the AMRUT-KALASH Diploma certificate is awarded.',
    },
    {
      mr: 'सर्व प्रमाणपत्रे अमृत व सुमागो इन्फोटेक यांच्याकडून संयुक्तरीत्या दिली जातात.',
      en: 'All certificates are jointly issued by AMRUT and SUMAGO INFOTECH PVT LTD',
    },
    {
      mr: 'प्रत्येक प्रमाणपत्र QR कोडद्वारे सार्वजनिकरीत्या पडताळता येते.',
      en: 'Every certificate carries a QR code for public verification.',
    },
    {
      mr: 'चौथे मॉड्यूल पूर्ण झाल्यावर अनामत रक्कम परत केली जाते.',
      en: 'The security deposit is refunded after the fourth module is completed.',
    },
  ],
  /* ProgrammeFacts.tsx on the website: the 'Two independent training modes' box. */
  trainingModes: {
    title: { mr: 'दोन स्वतंत्र प्रशिक्षण पद्धती', en: 'Two independent training modes' },
    modes: [
      {
        name: { mr: 'ऑफलाइन', en: 'OFFLINE' },
        description: {
          mr: 'मान्यताप्राप्त प्रशिक्षण केंद्रावर, केंद्र व्यवस्थापकाच्या देखरेखीखाली.',
          en: 'At an approved training centre, run by a Centre Manager.',
        },
      },
      {
        name: { mr: 'ऑनलाइन', en: 'ONLINE' },
        description: {
          mr: 'सुमागो ऑनलाइन ट्रेनिंग मॅनेजमेंट टीमद्वारे केंद्रीयरीत्या, सुमागो LMS वर.',
          en: 'Run centrally by the SUMAGO Online Training Management Team on the SUMAGO LMS.',
        },
      },
    ],
    note: {
      mr: 'उमेदवार यापैकी नेमक्या एकाच पद्धतीत नोंदविला जातो. एकत्रित पद्धत नाही.',
      en: 'A candidate is enrolled in exactly one mode. There is no combined track.',
    },
  },
  /*
   * The fact sheet's entered figures. Total hours, the module line and the elective count are NOT seeded: the site
   * sums them from the modules, so they cannot contradict them. The two durations are text: a number of months or a range
   * such as "4-6", in normalised form.
   */
  idealMonths: '6',
  validityMonths: '12',
  securityDeposit: 2000,
  applyLeadDays: 30,
  partnerName: 'SUMAGO INFOTECH PVT LTD',
};

export async function seedProgrammePage(ds: DataSource): Promise<ProgrammeSeedSummary> {
  return ds.transaction(async (m) => {
    const repo = m.getRepository(ProgrammePageSettings);
    if (await repo.exists({ where: { isDelete: false } })) return { created: false };
    await repo.save(repo.create({ ...PAGE, isPublished: true }));
    return { created: true };
  });
}
