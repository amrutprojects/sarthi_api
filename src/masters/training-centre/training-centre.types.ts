import type { ListQuery } from '../../shared/utils/pagination';

/* Columns a client may sort by (?sortBy=). districtName / centreTypeName sort on the joined parents. */
export type TrainingCentreSortField = 'name' | 'code' | 'districtName' | 'centreTypeName' | 'createdAt' | 'updatedAt';

export interface TrainingCentreListQuery extends ListQuery<TrainingCentreSortField> {
  /* Optional filters; they combine. ?centreTypeId= is the deep link from the Training Centre Type view. */
  centreTypeId?: string;
  /* Narrows through the district join (a centre stores no state of its own). */
  stateId?: string;
  districtId?: string;
}

/* GET /code-suggestions item: a student-import course centre (students.centreCode values), e.g. NAS / Nashik. */
export interface CentreCodeSuggestion {
  code: string;
  name: string;
}

/* What the detail page needs to explain why a centre cannot be deleted, or why its code is locked. */
export interface TrainingCentreRelated {
  hasLocation: boolean;
  hasInfrastructure: boolean;
  batchCount: number;
  documentCount: number;
}

/*
 * API shape of a training centre. Every parent is resolved to its name, code and active flag, so the
 * listing and the detail page never show a raw foreign key and the edit form can keep a deactivated
 * parent selectable. The state is derived through the district.
 */
export interface PublicTrainingCentreDetail {
  id: string;
  name: string;
  code: string;
  centreTypeId: string | null;
  centreTypeName: string | null;
  centreTypeCode: string | null;
  centreTypeIsActive: boolean | null;
  stateId: string;
  stateName: string;
  stateCode: string;
  stateIsActive: boolean;
  districtId: string;
  districtName: string;
  districtCode: string;
  districtIsActive: boolean;
  talukaId: string | null;
  talukaName: string | null;
  talukaCode: string | null;
  talukaIsActive: boolean | null;
  contactNumber: string | null;
  email: string | null;
  pocName: string | null;
  pocMobile: string | null;
  centreHead: string | null;
  alternativeContact: string | null;
  coordinator1: string | null;
  coordinator2: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /* Only on the single-record response. */
  related?: TrainingCentreRelated;
}

/* The optional columns of sections A–B: undefined = not sent, null = cleared. */
export interface TrainingCentreOptionalColumns {
  centreTypeId?: string | null;
  talukaId?: string | null;
  contactNumber?: string | null;
  email?: string | null;
  pocName?: string | null;
  pocMobile?: string | null;
  centreHead?: string | null;
  alternativeContact?: string | null;
  coordinator1?: string | null;
  coordinator2?: string | null;
}

export interface CreateTrainingCentreInput extends TrainingCentreOptionalColumns {
  /* Sent so the server can reject a district that does not belong to the selected state. Not stored. */
  stateId?: string;
  districtId: string;
  name: string;
  /* Blank or absent: generated as TC + 4 digits. */
  code?: string | null;
  isActive?: boolean;
}

export interface UpdateTrainingCentreInput extends TrainingCentreOptionalColumns {
  stateId?: string;
  districtId?: string;
  name?: string;
  code?: string;
}
