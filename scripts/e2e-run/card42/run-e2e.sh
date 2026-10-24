#!/usr/bin/env bash
# Cross-project e2e driver (manual harness, not part of `pnpm test`).
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CARD42="${CARD42:-/home/yukari/misc/card42}"
OUT="$DIR/out"
LOG="$DIR/logs"
CP="$CARD42/build/deliverables/card42-emrtd-cli.jar:$CARD42/build/deliverables/card42-emrtd.jar:$CARD42/build/deliverables/card42-common.jar:$CARD42/tools/java_card_devkit_simulator-linux-bin-v26.0-b_788-05-MAY-2026/client/COMService/socketprovider.jar"
MAIN=card42.host.emrtd.cli.Main
mkdir -p "$LOG"
: > "$LOG/summary.txt"

run() {
  local name=$1; local sub=$2; shift 2
  : > "$LOG/$name.log"
  {
    echo "### $name"
    echo "# java terminal emrtd $sub $*"
  } >> "$LOG/$name.log"
  ( cd "$CARD42" && java -cp "$CP" "$MAIN" terminal emrtd "$sub" "$@" >> "$LOG/$name.log" 2>&1 )
  local rc=$?
  echo "exit=$rc" >> "$LOG/$name.log"
  echo "$name exit=$rc" >> "$LOG/summary.txt"
  return $rc
}

base=(-host=socket:localhost:9025 '-doc=L898902C<' -dob=690806 -doe=361023 -pace -ca -csca="$OUT/csca.crt")
ta=(-ta -ta-chain="$OUT/ta-chain.der" -ta-key="$(cat "$OUT/ta-key.txt")")
ta_restricted=(-ta -ta-chain="$OUT/ta-chain-restricted.der" -ta-key="$(cat "$OUT/ta-key-restricted.txt")")
ta_epassport=(-ta -ta-chain="$OUT/ta-chain-epassport.der" -ta-key="$(cat "$OUT/ta-key-epassport.txt")")

run 01-read-lds1 read "${base[@]}" "${ta[@]}" -json=1
run 02-read-lds2-empty lds2 "${base[@]}" "${ta[@]}" -app=travel -record=all -json=1
run 03-append-cert-travel lds2 "${base[@]}" "${ta[@]}" -app=travel -append="$OUT/append-cert.json" -yes
run 04-append-travel lds2 "${base[@]}" "${ta[@]}" -app=travel -append="$OUT/append-entry.json" -ts-key="$OUT/lds2.key" -cert-ref=1 -yes
run 05-append-cert-visa lds2 "${base[@]}" "${ta[@]}" -app=visa -append="$OUT/append-cert.json" -yes
run 06-append-visa lds2 "${base[@]}" "${ta[@]}" -app=visa -append="$OUT/append-visa.json" -ts-key="$OUT/lds2.key" -cert-ref=1 -yes
run 07-append-cert-bio lds2 "${base[@]}" "${ta[@]}" -app=biometrics -append="$OUT/append-cert.json" -yes
run 08-append-bio lds2 "${base[@]}" "${ta[@]}" -app=biometrics -append="$OUT/append-biometrics.json" -ts-key="$OUT/lds2.key" -cert-ref=1 -yes
run 09-read-travel-verified lds2 "${base[@]}" "${ta[@]}" -app=travel -record=all -json=1
run 10-read-visa-verified lds2 "${base[@]}" "${ta[@]}" -app=visa -record=all -json=1
run 11-read-bio-verified lds2 "${base[@]}" "${ta[@]}" -app=biometrics -json=1

# Negative 1: an ePassport-only chain (no LDS2 extension at all) must not be
# able to append an LDS2 Travel record.  Observed: the append succeeds.
run 12-epassport-only-append lds2 "${base[@]}" "${ta_epassport[@]}" -app=travel -append="$OUT/append-entry.json" -ts-key="$OUT/lds2.key" -cert-ref=1 -yes
# Negative 2: a chain that only grants Travel read must not read Visa.  Observed:
# the read succeeds.
run 13-travel-read-only-visa lds2 "${base[@]}" "${ta_restricted[@]}" -app=visa -record=all -json=1
# Control: the same restricted chain still denies the Travel append (6982).
run 14-travel-read-only-append lds2 "${base[@]}" "${ta_restricted[@]}" -app=travel -append="$OUT/append-entry.json" -ts-key="$OUT/lds2.key" -cert-ref=1 -yes
# PACE-CAN path: the LDS2 sections inherit f(CAN) from the LDS1 section.
run 15-lds2-can-verified lds2 "${base[@]}" "${ta[@]}" -app=travel -can=123456 -record=all -json=1

cat "$LOG/summary.txt"
