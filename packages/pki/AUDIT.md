# `@epass42/pki` specification audit

This document records the line-by-line audit of the code reused from
`reference/card42-perso-generator` and `reference/card42`, as required by
TODO.md T1.5.15 / T1.3.6, and the deviations that were corrected.

The audit is against the ICAO Doc 9303-10 (LDS), Doc 9303-11 (security
mechanisms) and Doc 9303-12 (PKI) requirements summarised in TODO.md Appendix B
and G.

## 1. X.509 certificate profile (Doc 9303-12 §7.1.1)

| Item                          | Requirement                                                                 | Implementation                                                                                | Status                                 |
| ----------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| version                       | v3                                                                          | `@peculiar/x509` emits v3 when extensions are present                                         | OK                                     |
| serial                        | positive, ≤20 bytes, minimal 2's-complement                                 | `randomSerial()` clears the sign bit, keeps ≥64 significant bits; `@peculiar` encodes minimal | OK                                     |
| validity                      | seconds present, `Z`; `<2050` UTCTime, `≥2050` GeneralizedTime              | `@peculiar` selects the type from the year and emits `YYMMDDHHMMSSZ`/`YYYYMMDDHHMMSSZ`        | OK (verified with `openssl asn1parse`) |
| issuer/subject                | `countryName` (PrintableString, uppercase) + `commonName`                   | `new Name('CN=..,C=XD')`; `@peculiar` encodes printable ASCII as PrintableString              | OK                                     |
| SKI                           | CSCA required (nc)                                                          | `SubjectKeyIdentifierExtension.create`                                                        | OK                                     |
| AKI                           | CSCA optional (nc, keyid for self-signed); DSC required (nc)                | `AuthorityKeyIdentifierExtension.create`; CRL reuses the issuer SKI                           | OK                                     |
| KeyUsage                      | CSCA critical `keyCertSign`+`cRLSign`; DSC critical `digitalSignature` only | `profile.keyUsage`                                                                            | OK                                     |
| PrivateKeyUsagePeriod         | required (nc), GeneralizedTime                                              | hand-built `SEQUENCE { [0] notBefore, [1] notAfter }` (`profile.privateKeyUsagePeriod`)       | OK                                     |
| BasicConstraints              | CSCA critical `cA=TRUE`, `pathLenConstraint=0`; DSC forbidden               | `profile.basicConstraints` / omitted for DSC                                                  | OK                                     |
| SubjectAltName                | required (nc), `directoryName` with `localityName=UDN`                      | hand-built GeneralNames (`profile.cscaAltNameValue`)                                          | OK                                     |
| IssuerAltName                 | required (nc), identical to SAN for self-signed                             | same value as SAN                                                                             | OK                                     |
| CRLDistributionPoints         | required (nc), ldap/http/https                                              | `CRLDistributionPointsExtension`                                                              | OK                                     |
| DocumentType                  | DSC required (nc), `SEQUENCE { 0, SET OF PrintableString(1..2) }`           | `profile.documentTypeExtension`                                                               | OK                                     |
| EKU / BasicConstraints on DSC | forbidden                                                                   | not emitted                                                                                   | OK                                     |

## 2. CRL profile (Doc 9303-12 §7.1.4)

- v2, `thisUpdate`/`nextUpdate` with seconds and `Z`: `@peculiar/x509`
  `X509CrlGenerator` — OK.
- `AuthorityKeyIdentifier` (nc) equivalent to the CSCA SKI: reused from the
  certificate's SKI extension (`crl.certificateKeyId`), so it is correct across
  key rollover — OK.
- `cRLNumber` (nc, non-negative, minimal): `derInteger` — OK.
- `revokedCertificates` with no entries: not emitted by `@peculiar` when the
  entry list is empty — OK.
- Forbidden: deltaCRLIndicator, issuingDistributionPoint, freshestCRL and the
  per-entry extensions (reasonCode, holdInstructionCode, invalidityDate,
  certificateIssuer): none are emitted because the entries only carry serial and
  revocation date — OK.

## 3. CMS SignedData / EF.SOD / EF.CardSecurity (Doc 9303-10 §4.6.2)

| Item                      | Requirement                                                                       | Implementation                                   | Status        |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ | ------------- |
| EF.SOD framing            | outer `77` around the CMS ContentInfo                                             | `buildSod` wraps `ContentInfo` in `derTlv(0x77)` | OK            |
| EF.CardSecurity framing   | bare ContentInfo (no `77`)                                                        | `buildCardSecurity`                              | OK            |
| signerInfo.sid            | IssuerAndSerialNumber                                                             | taken from the parsed DSC                        | OK            |
| signedAttrs               | `content-type` + `message-digest` (+ `signing-time` for ML)                       | `buildCms`                                       | OK            |
| LDS Security Object       | `SEQUENCE { 0, AlgId(SHA-256,NULL), SEQUENCE OF {n, OCTET STRING hash} }`, sorted | `ldsSecurityObject` with `asn1js`                | OK            |
| **eContent OCTET STRING** | **single primitive OCTET STRING**                                                 | **see §3.1**                                     | **corrected** |

### 3.1 eContent double-wrapping (deviation from the reused code)

`card42-perso-generator`'s `domain/emrtd/cms.ts` constructs
`EncapsulatedContentInfo` with `eContent: new asn1js.OctetString({ valueHex })`.
The `pkijs` `EncapsulatedContentInfo` constructor _rewrites_ a primitive OCTET
STRING into a **constructed** OCTET STRING (to support streaming), producing

```
[0] EXPLICIT { OCTET STRING (constructed) { OCTET STRING (primitive) <content> } }
```

`openssl cms -verify` and `pkijs` accept this BER, but card42's
`host/emrtd/lds/CmsSignedData.java` reads the first child of `[0]` and returns
its value — which is the embedded `04 <len> ...` TLV, not the LDS Security
Object — so passive authentication would fail.

`buildCms` therefore assigns a primitive `asn1js.OctetString` to
`encapContentInfo.eContent` **after** construction, yielding the canonical

```
[0] EXPLICIT { OCTET STRING (primitive) <content> }
```

`verifySod` reads {@link octetStringBytes} recursively so it still accepts
third-party SODs that use the constructed form.

## 4. Data groups (Doc 9303-10 §4.7; Appendix G)

| DG   | Structure                                                                                                    | Notes                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| DG1  | `61 { 5F1F MRZ }`                                                                                            | `mrz.buildMrzLines` + `buildDg1`; byte-identical to the card42 sample except for the composite check digit (see §4.1) |
| DG2  | `75 { 7F61 { 02 01 01, 7F60 { A1{SBH}, 5F2E ISO 19794-5 } } }`                                               | mirrors card42 `Dg2Builder`, including the 14/4-byte length fields                                                    |
| DG3  | `63 { <7F61 template> }`                                                                                     | service wraps the uploaded inner template; validates outer tag, count and BDB presence                                |
| DG4  | `76 { <7F61 template> }`                                                                                     | as DG3                                                                                                                |
| DG5  | `65 { 02 01 01, 5F40 JPEG }`                                                                                 |                                                                                                                       |
| DG7  | `67 { 02 01 01, 5F43 JPEG }`                                                                                 |                                                                                                                       |
| DG11 | `6B { 5C taglist, 5F0E, [A0{02,5F0F}], 5F10, 5F2B, 5F11, 5F42, 5F12, 5F13, 5F14, 5F15, [5F16], 5F17, 5F18 }` | `5C` computed from the fields present                                                                                 |
| DG12 | `6C { 5C, 5F19, 5F26, [A0{02,5F1A}], 5F1B, 5F1C, [5F1D], [5F1E], 5F55, 5F56 }`                               | `5F55`/`5F56` are server-filled                                                                                       |
| DG13 | `6D { … }`                                                                                                   | issuer-defined; text encoded as `6D { 5F0E text }`                                                                    |
| DG14 | `6E { SecurityInfos }`                                                                                       | identical content to EF.CardAccess                                                                                    |
| DG15 | `6F { SubjectPublicKeyInfo }`                                                                                | `buildDg15(spki)`                                                                                                     |
| DG16 | `70 { 02 count, A1{5F50,5F51,5F52,5F53}… }`                                                                  |                                                                                                                       |

### 4.1 Composite check digit

The card42 Java sample `perso/emrtd/sample.perso` hard-codes a composite check
digit of `0` for `L898902C<3UTO6908061F9406236ZE184226B<<<<<`. Per Doc 9303-3
§4.9 the composite is `4`; the JS generator documents this as a sample bug and
emits `…14`. ePass 42 follows the specification (`emrtd/mrz.spec.ts`).

### 4.2 TLV constructed-bit decoding

The reused `codec/der.ts` decoder computed `constructed` from the combined multi-byte
tag number (`tag & 0x20`). For a tag such as `5F2B` the low byte `0x2B` has bit
5 set, so it was mistakenly treated as constructed. ePass 42 tests bit 5 of the
**first tag byte** instead (`parseTlv`), which fixes DG11/DG12 parsing.

## 5. SecurityInfo / EF.CardAccess (Doc 9303-11 §9.2, BSI TR-03110-3)

- PACE ECDH-GM 3DES/AES-128 (`0.4.0.127.0.7.2.2.4.2.1` / `…4.2.2`) with
  parameter id 12 (P-256): `securityInfo.buildCardAccess` — OK.
- Chip Authentication ECDH 3DES/AES-128 with key id: OK.
- Active Authentication (`2.23.136.1.1.5`, version 1, signature algorithm): OK.
- EF.CardSecurity eContent (`id-SecurityObject`) = CardAccess set plus
  `ChipAuthenticationPublicKeyInfo`: OK.

## 6. Perso script (`card42.host.emrtd.perso.LdsScript`)

Verified against `host/emrtd/perso/LdsScript.java` and the sample:

- `@instance`, `@doc`, `@dob`, `@doe`, `@dg <n>`, `@sod`, `@aa <modLen‖modulus‖expLen‖exponent>`,
  `@ca <scalar>`, `@cardaccess`, `@cardsecurity`, `@record <fid>`, `@transparent <fid>`.
- `@aa` value layout matches the DGI `FF02` value built by
  `crypto.aaPrivateKeyValue` (2-byte big-endian lengths).
- EF.COM is generated by the card and is **not** emitted by ePass 42
  (Doc 9303-10 §4.6.1).

## 7. Not yet implemented (tracked in TODO.md)

- ECDSA (explicit ECParameters) certificate support: default remains RSA
  (TODO T1.1.5 / risk E5).
- DG8/DG9/DG10 and LDS2 record/transparent writers beyond the script directives
  (TODO T7.5, T1.5.15).
- `SecurityInfo` profile deviations other than the mechanisms above
  (e.g. DH variants) are not exposed in the UI yet.
