import type { Express } from 'express';
import { API, auth, request } from '../helpers/test-app';

/* Every CMS permission code, for a Super-Admin-equivalent actor in the master tests. */
export const CMS_CODES = [
  'cms-states.view', 'cms-states.create', 'cms-states.update', 'cms-states.delete',
  'cms-districts.view', 'cms-districts.create', 'cms-districts.update', 'cms-districts.delete',
  'cms-talukas.view', 'cms-talukas.create', 'cms-talukas.update', 'cms-talukas.delete',
];

export const VIEW_ONLY_CODES = ['cms-states.view', 'cms-districts.view', 'cms-talukas.view'];

interface Created {
  id: string;
  name: string;
  code: string | null;
}

/* Creates a state through the API and returns it, failing loudly with the response body. */
export async function makeState(app: Express, token: string, name: string, code: string): Promise<Created> {
  const res = await request(app).post(`${API}/cms/states`).set(auth(token)).send({ name, code });
  if (res.status !== 201) throw new Error(`makeState(${name}) failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data as Created;
}

export async function makeDistrict(app: Express, token: string, stateId: string, name: string, code: string): Promise<Created> {
  const res = await request(app).post(`${API}/cms/districts`).set(auth(token)).send({ stateId, name, code });
  if (res.status !== 201) throw new Error(`makeDistrict(${name}) failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data as Created;
}

export async function makeTaluka(app: Express, token: string, districtId: string, name: string, code?: string): Promise<Created> {
  const res = await request(app).post(`${API}/cms/talukas`).set(auth(token)).send({ districtId, name, ...(code ? { code } : {}) });
  if (res.status !== 201) throw new Error(`makeTaluka(${name}) failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data as Created;
}

/* A uuid that is syntactically valid but matches no row. */
export const MISSING_ID = '00000000-0000-4000-8000-000000000000';
