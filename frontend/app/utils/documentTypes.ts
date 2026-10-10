/**
 * The document types offered by the DSC application and PKD lookup forms.
 *
 * The values are the ICAO Doc 9303 document codes stored in the MRZ (`P` for
 * TD3 passports, `ID` for TD1 identity cards); the labels come from i18n so
 * they follow the selected locale.
 */
export const documentTypeValues = [
  { labelKey: 'common.documentType.passport', value: 'P' },
  { labelKey: 'common.documentType.identityCard', value: 'ID' },
] as const
