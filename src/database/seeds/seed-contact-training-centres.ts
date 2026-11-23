import type { DataSource, EntityManager } from 'typeorm';
import { ContactPageSettings, ContactTrainingCentre } from '../../cms/contact/contact.model';
import { District } from '../../cms/masters/district/district.model';
import { LOCAL_SEED_OPTIONS, type SeedOptions } from './seed-profile';

export interface ContactTrainingCentresSeedSummary {
  centresCreated: number;
  /* Centres whose district is not in the master (seedContactDirectory creates them). */
  districtsMissing: string[];
}

/*
 * Initial content of the District Office pages' "Approved training centres" card: the ten centres the
 * website printed from its bundled dataset, in both languages, so seeding changes nothing a visitor
 * sees. The placeholder ".demo" e-mail addresses are not copied (an empty e-mail is not printed), and
 * phone numbers stay masked exactly as the site shows them, for an administrator to replace.
 *
 * Existing databases get the same rows from migration 1798300000000-ContactTrainingCentres.
 */
const CENTRES: { district: string; code: string; name: [string, string]; address: [string, string]; manager: [string, string]; phone: string }[] = [
  { district: 'Ahilyanagar', code: 'AHL', name: ['संगमनेर ग्रामीण कौशल्य केंद्र', 'Sangamner Rural Skill Centre'], address: ['नगर, अहिल्यानगर, महाराष्ट्र', 'Nagar, Ahilyanagar, Maharashtra'], manager: ['कविता चव्हाण', 'Kavita Chavan'], phone: '+91 98XXX 51203' },
  { district: 'Beed', code: 'BEE', name: ['अंबाजोगाई कौशल्य अकादमी', 'Ambajogai Skill Academy'], address: ['बीड, बीड, महाराष्ट्र', 'Beed, Beed, Maharashtra'], manager: ['गणेश सावंत', 'Ganesh Sawant'], phone: '+91 98XXX 51204' },
  { district: 'Chhatrapati Sambhajinagar', code: 'CSN', name: ['पैठण कौशल्य विकास संस्था', 'Paithan Skill Development Institute'], address: ['छ. संभाजीनगर, छत्रपती संभाजीनगर, महाराष्ट्र', 'Chh. Sambhajinagar, Chhatrapati Sambhajinagar, Maharashtra'], manager: ['अंजली गायकवाड', 'Anjali Gaikwad'], phone: '+91 98XXX 51206' },
  { district: 'Jalgaon', code: 'JAL', name: ['भुसावळ औद्योगिक प्रशिक्षण केंद्र', 'Bhusawal Industrial Training Centre'], address: ['जळगाव, जळगाव, महाराष्ट्र', 'Jalgaon, Jalgaon, Maharashtra'], manager: ['नितीन वाघ', 'Nitin Wagh'], phone: '+91 98XXX 51208' },
  { district: 'Kolhapur', code: 'KOL', name: ['करवीर कौशल्य उत्कृष्टता केंद्र', 'Karvir Skill Excellence Centre'], address: ['करवीर, कोल्हापूर, महाराष्ट्र', 'Karvir, Kolhapur, Maharashtra'], manager: ['रेखा माने', 'Rekha Mane'], phone: '+91 98XXX 51209' },
  { district: 'Nanded', code: 'NAN', name: ['नांदेड डिजिटल कौशल्य केंद्र', 'Nanded Digital Skills Centre'], address: ['नांदेड, नांदेड, महाराष्ट्र', 'Nanded, Nanded, Maharashtra'], manager: ['प्रकाश साळुंखे', 'Prakash Salunkhe'], phone: '+91 98XXX 51207' },
  { district: 'Nashik', code: 'NAS', name: ['नाशिक तांत्रिक प्रशिक्षण संस्था', 'Nashik Institute of Technical Training'], address: ['नाशिक, नाशिक, महाराष्ट्र', 'Nashik, Nashik, Maharashtra'], manager: ['मनीषा जोशी', 'Manisha Joshi'], phone: '+91 98XXX 51201' },
  { district: 'Pune', code: 'PUN', name: ['हवेली कौशल्य विकास केंद्र', 'Haveli Skill Development Centre'], address: ['हवेली, पुणे, महाराष्ट्र', 'Haveli, Pune, Maharashtra'], manager: ['सुनील पवार', 'Sunil Pawar'], phone: '+91 98XXX 51200' },
  { district: 'Satara', code: 'SAT', name: ['कराड तांत्रिक प्रशिक्षण संस्था', 'Karad Technical Training Institute'], address: ['सातारा, सातारा, महाराष्ट्र', 'Satara, Satara, Maharashtra'], manager: ['दीपक भोसले', 'Deepak Bhosale'], phone: '+91 98XXX 51205' },
  { district: 'Thane', code: 'THA', name: ['कल्याण व्यावसायिक प्रशिक्षण केंद्र', 'Kalyan Vocational Training Centre'], address: ['ठाणे, ठाणे, महाराष्ट्र', 'Thane, Thane, Maharashtra'], manager: ['रवींद्र मोरे', 'Ravindra More'], phone: '+91 98XXX 51202' },
];

/*
 * Idempotent, and it never undoes an administrator's work: it seeds only if the configuration has NEVER
 * had a centre (soft-deleted rows included), so a list an administrator deliberately emptied stays empty.
 * Needs the Contact page settings row and the districts (seedContactPage, seedContactDirectory); one transaction.
 */
/* Not on a hosted install (`options.demoContent` false, see seed-profile.ts): the centres are the demo dataset's. */
export async function seedContactTrainingCentres(
  ds: DataSource,
  options: SeedOptions = LOCAL_SEED_OPTIONS,
): Promise<ContactTrainingCentresSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const summary: ContactTrainingCentresSeedSummary = { centresCreated: 0, districtsMissing: [] };
    if (!options.demoContent) return summary;
    const settings = await m.getRepository(ContactPageSettings).findOne({ where: { isDelete: false } });
    if (!settings) return summary;

    const repo = m.getRepository(ContactTrainingCentre);
    if ((await repo.count({ where: { settingsId: settings.id } })) > 0) return summary;

    const districts = await m.getRepository(District).find({ where: { isDelete: false } });
    for (const c of CENTRES) {
      /* By name first, as seedContactDirectory links districts, else by the site's code. */
      const district =
        districts.find((d) => d.name.toLowerCase() === c.district.toLowerCase()) ?? districts.find((d) => d.code === c.code);
      if (!district) {
        summary.districtsMissing.push(c.district);
        continue;
      }
      await repo.save(
        repo.create({
          settingsId: settings.id,
          districtId: district.id,
          nameMr: c.name[0],
          nameEn: c.name[1],
          addressMr: c.address[0],
          addressEn: c.address[1],
          managerNameMr: c.manager[0],
          managerNameEn: c.manager[1],
          phone: c.phone,
          email: null,
          displayOrder: 0,
        }),
      );
      summary.centresCreated++;
    }
    return summary;
  });
}
