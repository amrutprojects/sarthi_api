/*
 * The shape every geography dropdown consumes: just enough to render an option and post back an id.
 *
 * Deliberately narrow. These rows are served to the public website without authentication, so they
 * must carry nothing beyond what a visitor filling in a form needs to see.
 */
export interface GeoOption {
  id: string;
  name: string;
  code: string | null;
}

export interface DistrictOption extends GeoOption {
  stateId: string;
}

export interface TalukaOption extends GeoOption {
  districtId: string;
}
