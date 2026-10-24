import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;

import javax.smartcardio.Card;
import javax.smartcardio.CardTerminal;

import card42.host.common.transport.Terminal;
import card42.host.common.transport.Terminals;
import card42.host.emrtd.access.ChipAuth;
import card42.host.emrtd.access.LdsReader;
import card42.host.emrtd.access.Pace;
import card42.host.emrtd.lds.common.CardAccess;
import card42.host.emrtd.lds.common.CardSecurity;
import card42.host.emrtd.lds.common.LdsFileUtil;
import card42.host.emrtd.lds.common.LdsSecurityObject;
import card42.host.emrtd.lds.common.Sod;
import card42.host.emrtd.lds.lds1.Dg1;
import card42.host.emrtd.pa.CscaKeyStore;
import card42.host.emrtd.pa.PassiveAuthentication;
import card42.host.emrtd.ta.CvCertificate;
import card42.host.emrtd.ta.CvCertificateCodec;
import card42.host.emrtd.ta.TerminalAuth;
import card42.host.emrtd.transport.EmrtdTerminal;

/** Reads every present LDS1 DG, verifies it against EF.SOD, and checks TA gating. */
public final class ReadAll {
    public static void main(String[] argv) throws Exception {
        String host = argv[0];
        String chainPath = argv[1];
        String keyHex = argv[2];
        String cscaPath = argv[3];
        String doc = argv[4];
        String dob = argv[5];
        String doe = argv[6];

        CardTerminal ct = Terminals.getTerminal(host.split(":"));
        if (ct == null || !ct.waitForCardPresent(10000)) {
            throw new IllegalStateException("cannot reach " + host);
        }
        Card card = ct.connect("*");
        try {
            EmrtdTerminal terminal = new EmrtdTerminal(new Terminal(card.getBasicChannel()));
            run(terminal, chainPath, keyHex, cscaPath, doc, dob, doe);
        } finally {
            card.disconnect(false);
        }
    }

    static void run(EmrtdTerminal terminal, String chainPath, String keyHex,
                    String cscaPath, String doc, String dob, String doe) throws Exception {
        check("SELECT LDS1", terminal.selectApplication("A0000002471001").getSW(), 0x9000);

        // Before PACE, the DG3/DG4 CHAT gate must reject the read.
        Integer beforePace = tryRead(terminal, LdsFileUtil.dgFid(3));
        System.out.println("DG3 before PACE: " + (beforePace == null ? "SW=9000 (!)" : "SW=" + String.format("%04X", beforePace)));

        Pace.Session pace = Pace.authenticate(terminal, doc, dob, doe);
        terminal.setSecureMessaging(pace.secureMessaging());
        System.out.println("PACE: OK");

        Integer beforeTa = tryRead(terminal, LdsFileUtil.dgFid(3));
        System.out.println("DG3 after PACE, before TA: "
                + (beforeTa == null ? "SW=9000 (!)" : "SW=" + String.format("%04X", beforeTa)));

        CardAccess cardAccess = CardAccess.parse(LdsReader.readMf(terminal, LdsFileUtil.FID_CARD_ACCESS));
        CardSecurity cardSecurity = CardSecurity.parse(
                LdsReader.readMf(terminal, LdsFileUtil.FID_CARD_SECURITY));
        ChipAuth.Result ca = ChipAuth.authenticateResult(terminal,
                cardSecurity.publicKeyInfos().get(0).rawPoint(),
                cardAccess.chipAuthenticationInfos().get(0));
        System.out.println("Chip Authentication: OK");

        List<CvCertificate> chain = CvCertificateCodec.parseChain(Files.readAllBytes(Paths.get(chainPath)));
        TerminalAuth.authenticate(terminal, chain, new BigInteger(keyHex, 16),
                TerminalAuth.chipIdentifier(pace.piccPublicKey),
                TerminalAuth.chipAuthenticationKeyHash(ca.terminalPublicKeyW),
                new SecureRandom());
        System.out.println("Terminal Authentication: OK");

        byte[] sodBytes = LdsReader.read(terminal, LdsFileUtil.FID_SOD);
        CscaKeyStore trust = CscaKeyStore.fromPath(new java.io.File(cscaPath));
        PassiveAuthentication.Result result = PassiveAuthentication.verifyResult(Sod.parse(sodBytes), trust);
        LdsSecurityObject so = result.securityObject;
        System.out.println("EF.SOD: OK, DSC=" + result.dsc.getSubjectX500Principal());

        byte[] dg1 = LdsReader.read(terminal, LdsFileUtil.dgFid(1));
        PassiveAuthentication.verifyDocumentType(result.dsc, Dg1.parse(dg1));

        List<Integer> present = new ArrayList<Integer>();
        List<Integer> absent = new ArrayList<Integer>();
        List<Integer> bad = new ArrayList<Integer>();
        for (int dg = 1; dg <= 16; dg++) {
            if (dg == 6) continue;
            byte[] bytes = tryReadBytes(terminal, LdsFileUtil.dgFid(dg));
            if (bytes == null || bytes.length == 0) {
                absent.add(dg);
                continue;
            }
            boolean ok = PassiveAuthentication.verifyDataGroup(so, dg, bytes);
            (ok ? present : bad).add(dg);
            System.out.println("DG" + dg + ": " + bytes.length + " B, hash=" + (ok ? "OK" : "MISMATCH"));
        }
        System.out.println("present=" + present + " absent=" + absent + " bad=" + bad);
        if (!bad.isEmpty()) {
            throw new IllegalStateException("DG hash verification failed: " + bad);
        }
    }

    static void check(String what, int actual, int expected) {
        System.out.println(what + ": " + String.format("%04X", actual));
        if (actual != expected) throw new IllegalStateException(what + " -> " + String.format("%04X", actual));
    }

    /** Reads a DG, returning its SW when the read fails at SELECT; null on success. */
    static Integer tryRead(EmrtdTerminal terminal, int fid) {
        try {
            LdsReader.read(terminal, fid);
            return null;
        } catch (Exception e) {
            String msg = e.getMessage();
            if (msg != null && msg.contains("failed: ")) {
                return Integer.parseInt(msg.substring(msg.lastIndexOf("failed: ") + 8).trim(), 16);
            }
            return -1;
        }
    }

    static byte[] tryReadBytes(EmrtdTerminal terminal, int fid) {
        try {
            return LdsReader.read(terminal, fid);
        } catch (Exception e) {
            return null;
        }
    }
}
