/*
 * M3 attendance reports (docs/m3-attendance-reports.md).
 *
 * Who may open the reports (any one code): the Attendance screen's and the Reports & MIS screen's `.view` codes, plus
 * `lms.view` (LMS Integration). Existing codes only, so no migration. CSV export on the screen is gated by the existing
 * `reports.export` code in the Panel; the API returns the same rows either way.
 */
export const ATTENDANCE_REPORT_PERMISSIONS = ['attendance.view', 'reports.view', 'lms.view'] as const;

/* The LMS's own buckets for a batch whose centre has no district, or a district with no division row. */
export const LMS_DISTRICT_NOT_SET = 'NOT_SET';
export const LMS_DIVISION_NOT_MAPPED = 'NOT_MAPPED';

/* The longest range the LMS accepts (tenant-api.md §2b: at most 366 days). */
export const MAX_RANGE_DAYS = 366;

/* Batch level: LMS batch pages read to place batches under their centre (page size × pages = batches covered). */
export const BATCH_PAGE_SIZE = 100;
export const BATCH_MAX_PAGES = 50;

export interface DivisionDistrict {
  /* Upper-case key as the LMS's district_division table uses it (e.g. AHILYANAGAR). */
  key: string;
  nameEn: string;
  nameMr: string;
  /* Former names / spellings the LMS also accepts for this district (e.g. AHMEDNAGAR). */
  aliases: readonly string[];
}

export interface Division {
  code: string;
  nameEn: string;
  nameMr: string;
  districts: readonly DivisionDistrict[];
}

const d = (key: string, nameEn: string, nameMr: string, aliases: string[] = []): DivisionDistrict => ({ key, nameEn, nameMr, aliases });

/*
 * Maharashtra's 6 revenue divisions and 36 districts, the same codes and keys as the LMS's platform rows of
 * `district_division` (lms-api migration 20260101026000, AT-10). Amrut's District Master has no division column, so
 * this table places Amrut's districts (matched by code or by name) under their division, and gives the Marathi names.
 * It is geography reference data, not an Amrut link value: nothing here is sent to the LMS.
 */
export const MAHARASHTRA_DIVISIONS: readonly Division[] = [
  {
    code: 'KONKAN',
    nameEn: 'Konkan',
    nameMr: 'कोकण',
    districts: [
      d('MUMBAI_CITY', 'Mumbai City', 'मुंबई शहर'),
      d('MUMBAI_SUBURBAN', 'Mumbai Suburban', 'मुंबई उपनगर'),
      d('THANE', 'Thane', 'ठाणे'),
      d('PALGHAR', 'Palghar', 'पालघर'),
      d('RAIGAD', 'Raigad', 'रायगड'),
      d('RATNAGIRI', 'Ratnagiri', 'रत्नागिरी'),
      d('SINDHUDURG', 'Sindhudurg', 'सिंधुदुर्ग'),
    ],
  },
  {
    code: 'PUNE',
    nameEn: 'Pune',
    nameMr: 'पुणे',
    districts: [
      d('PUNE', 'Pune', 'पुणे'),
      d('SATARA', 'Satara', 'सातारा'),
      d('SANGLI', 'Sangli', 'सांगली'),
      d('KOLHAPUR', 'Kolhapur', 'कोल्हापूर'),
      d('SOLAPUR', 'Solapur', 'सोलापूर'),
    ],
  },
  {
    code: 'NASHIK',
    nameEn: 'Nashik',
    nameMr: 'नाशिक',
    districts: [
      d('NASHIK', 'Nashik', 'नाशिक', ['NASIK']),
      d('DHULE', 'Dhule', 'धुळे'),
      d('NANDURBAR', 'Nandurbar', 'नंदुरबार'),
      d('JALGAON', 'Jalgaon', 'जळगाव'),
      d('AHILYANAGAR', 'Ahilyanagar', 'अहिल्यानगर', ['AHMEDNAGAR']),
    ],
  },
  {
    code: 'CHHATRAPATI_SAMBHAJINAGAR',
    nameEn: 'Chhatrapati Sambhajinagar',
    nameMr: 'छत्रपती संभाजीनगर',
    districts: [
      d('CHHATRAPATI_SAMBHAJINAGAR', 'Chhatrapati Sambhajinagar', 'छत्रपती संभाजीनगर', ['AURANGABAD']),
      d('JALNA', 'Jalna', 'जालना'),
      d('BEED', 'Beed', 'बीड', ['BID']),
      d('DHARASHIV', 'Dharashiv', 'धाराशिव', ['OSMANABAD']),
      d('LATUR', 'Latur', 'लातूर'),
      d('NANDED', 'Nanded', 'नांदेड'),
      d('PARBHANI', 'Parbhani', 'परभणी'),
      d('HINGOLI', 'Hingoli', 'हिंगोली'),
    ],
  },
  {
    code: 'AMRAVATI',
    nameEn: 'Amravati',
    nameMr: 'अमरावती',
    districts: [
      d('AMRAVATI', 'Amravati', 'अमरावती'),
      d('AKOLA', 'Akola', 'अकोला'),
      d('WASHIM', 'Washim', 'वाशिम'),
      d('BULDHANA', 'Buldhana', 'बुलढाणा', ['BULDANA']),
      d('YAVATMAL', 'Yavatmal', 'यवतमाळ'),
    ],
  },
  {
    code: 'NAGPUR',
    nameEn: 'Nagpur',
    nameMr: 'नागपूर',
    districts: [
      d('NAGPUR', 'Nagpur', 'नागपूर'),
      d('WARDHA', 'Wardha', 'वर्धा'),
      d('BHANDARA', 'Bhandara', 'भंडारा'),
      d('GONDIA', 'Gondia', 'गोंदिया'),
      d('CHANDRAPUR', 'Chandrapur', 'चंद्रपूर'),
      d('GADCHIROLI', 'Gadchiroli', 'गडचिरोली'),
    ],
  },
];
