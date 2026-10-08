-- Unique document number within an issuing AS (BAC password uniqueness).
-- Kept as a hand-written migration because drizzle-kit cannot serialise an
-- expression index that mixes a column with a json_extract() call.
CREATE UNIQUE INDEX `ux_sign_request_mrz`
  ON `sign_request` (`asn`, json_extract(`payload_json`, '$.mrz.documentNumber'));
