/**
 * CMS helpers for the backend suite: inspect the CSCA Master List returned by
 * the API without trusting the backend.  Only `pkijs` and `@epass42/pki` are
 * used, exactly like a relying party would.
 */
import * as pkijs from 'pkijs'

import { CMS_OIDS, parseTlv, toArrayBuffer } from '@epass42/pki'

/** The parsed Master List envelope. */
export interface ParsedMasterList {
  contentType: string
  eContentType: string
  eContent: Uint8Array
  /** Number of certificates in the `CscaMasterList` SET. */
  certificateCount: number
  /** Number of CMS SignerInfo entries. */
  signerCount: number
  signatureValid: boolean
}

/** Extracts a (possibly constructed) CMS OCTET STRING. */
function octets(value: unknown): Uint8Array {
  const block = (
    value as {
      valueBlock?: {
        valueHexView?: Uint8Array
        value?: unknown[]
      }
    }
  ).valueBlock
  if (block?.valueHexView && block.valueHexView.byteLength > 0) {
    return new Uint8Array(block.valueHexView)
  }
  if (Array.isArray(block?.value)) {
    const parts = block.value.map((child) => octets(child))
    return new Uint8Array(parts.flatMap((part) => [...part]))
  }
  throw new Error('empty CMS eContent')
}

/**
 * Parses and verifies a CSCA Master List: the CMS signature is checked without
 * a chain, and the number of embedded CSCA certificates is counted from the
 * `CscaMasterList` eContent.
 */
export async function parseMasterList(der: Uint8Array): Promise<ParsedMasterList> {
  const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(der))
  if (contentInfo.contentType !== CMS_OIDS.signedData) {
    return {
      contentType: contentInfo.contentType,
      eContentType: '',
      eContent: new Uint8Array(),
      certificateCount: 0,
      signerCount: 0,
      signatureValid: false,
    }
  }
  const signedData = new pkijs.SignedData({ schema: contentInfo.content })
  const eContent = signedData.encapContentInfo.eContent
  if (!eContent) throw new Error('Master List has no eContent')
  const bytes = octets(eContent)
  const tree = parseTlv(bytes)
  const set = tree.children.find((child) => (child.tag & 0xff) === 0x31)
  return {
    contentType: contentInfo.contentType,
    eContentType: signedData.encapContentInfo.eContentType,
    eContent: bytes,
    certificateCount: set?.children.length ?? 0,
    signerCount: signedData.signerInfos.length,
    signatureValid: await signedData.verify({
      signer: 0,
      data: toArrayBuffer(bytes),
      checkChain: false,
    }),
  }
}
