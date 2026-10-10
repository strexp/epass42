/**
 * The document types offered by the DSC application and PKD lookup forms.
 *
 * The values are the ICAO Doc 9303 document codes stored in the MRZ (`P` for
 * TD3 passports, `ID` for TD1 identity cards).  The array is left to inference
 * so it stays assignable to Naive UI's `SelectMixedOption[]`.
 */
export const documentTypeOptions = [
  { label: 'Passport', value: 'P' },
  { label: 'Identity card', value: 'ID' },
]
