# pkd42 × card42 端到端测试报告

日期：2026-10-23

> 说明（2026-10-24）：本报告记录当时的目录布局；card42 夹具与驱动已迁移到
> `scripts/e2e-run/card42/`，下文路径按迁移后的结构理解（`out/`、`logs/` 均在
> 该目录下）。本报告描述的手动 shell 套件仍保留用于调试；新增的自动化跨项目
> 套件见 `e2e-run/card42/e2e.test.ts`（`pnpm --filter @epass42/scripts test:card42`），
> 它由后端直接签发证书并生成 perso，再在临时模拟器上执行 LDS1/LDS2/TA 全流程。

测试对象：

- `pkd42` @ `7fed47a`（首轮未修改；本轮已按 card42 `d265c24` 对齐）
- `card42` @ `ab7ab6a`（首轮）；`d265c24`（本轮 PACE 卡级复用）
- Oracle Java Card Simulator v26.0（`../card42/tools/.../jcsl`，端口 9025）

> **2026-10-23 15:30 追加**：card42 `d265c24` 将 PACE 的 f(MRZ)（DGI FF04）/
> f(CAN)（DGI FF06）改为**包级共享**，LDS1 段写一次即可被三个 LDS2 DF 继承。
> pkd42 已对应修改：LDS2 section 不再输出 `@doc/@dob/@doe`，`@can` 继续只在 LDS1
> 段。本文 §3.2 描述的旧版 card42 下的 `6985` 已不再复现；最新回归见
> `logs/15-lds2-can-verified.log` 与 `logs/22-lds2-can-all-apps.log`。

## 1. 测试方法

在 `pkd42/scripts/e2e-run/` 下放置独立的测试夹具/驱动（不属于产品代码；首轮未改动受版本控制文件，本轮修改见 §5）：

- `gen.ts`：使用 pkd42 的 `@epass42/pki` 与生产用 `buildPersoSigning` 签发
  CSCA → DSC、CVCA → DV → IS、CSCA → LDS2 Signer，并生成 perso。
- `gen-rsa.ts`：同一流程的 RSA-PSS CSCA/DSC 变体（LDS2 Signer 仍为 ECDSA）。
- `gen-restricted.ts`：用同一 CVCA 私钥签发两张受限 DV/IS 链：
  - `ta-chain-restricted.der`：仅 Travel 读（无 Visa/Biometrics 扩展）；
  - `ta-chain-epassport.der`：仅 ePassport CHAT（无任何 LDS2 扩展）。
- `ReadAll.java`：直接使用 card42 host API 读取全部 LDS1 DG，并逐组校验 EF.SOD 哈希，
  同时检查 TA 前 DG3 的 6982。
- `run-e2e.sh`：card42 CLI 正/负向测试驱动，日志在 `logs/`。

测试覆盖：

- CSCA/DSC profile 与链验证（pkd42 `verify.ts` + `openssl verify`）。
- LDS1：PACE（MRZ / CAN）、BAC 不适用、CA、TA、AA、PA。
- LDS1 DG1–DG16（实际存在 DG1/2/3/4/11/12/13/14/15/16）。
- LDS2 Travel / Visa / Additional Biometrics：
  - PACE（MRZ / CAN）；
  - CA + TA；
  - 空应用读取；
  - EF.Certificates 写入 LDS2 Signer 证书（profile + CSCA 信任）；
  - Travel Entry / Visa / Biometrics 记录签名写入；
  - 读回并验签、验证证书 profile/trust；
  - 证书记录复用。
- 负向：无 TA、错误 CSCA、错误 LDS2 签名密钥、错误 LDS2 Signer 证书、
  受限授权链、仅 ePassport 授权链。
- 两种签名族：ECDSA P-256 与 RSA-PSS-2048（CSCA/DSC）。

## 2. 主链路结果（全部通过）

| 项目                                           | 结果                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| CSCA/DSC/LDS2 Signer profile + 链              | `ok`（pkd42 verify、openssl verify）                                  |
| perso 个性化（LDS1 + 3 个空 LDS2 应用）        | 通过（6755 B + 3×1336 B；ECDSA 变体）                                 |
| LDS1 PACE-MRZ + CA + TA + AA + PA              | 通过                                                                  |
| LDS1 PACE-CAN                                  | 通过                                                                  |
| 全部 DG 哈希                                   | DG1/2/3/4/11/12/13/14/15/16 全部 `hash=OK`                            |
| DG3 TA 门控                                    | PACE 前 6982；PACE 后 TA 前 6982；TA 后读取成功                       |
| LDS2 空应用读取                                | 通过                                                                  |
| LDS2 EF.Certificates 写入                      | 通过（406 B ECDSA / 696 B RSA-PSS LDS2 Signer，profile OK、trust OK） |
| LDS2 Travel 记录写入 + 读回验签                | 通过（`signatureValid=true`, `profileValid=true`, `trusted=true`）    |
| LDS2 Visa 记录写入 + 读回验签                  | 通过                                                                  |
| LDS2 Biometrics 记录写入 + 读回验签            | 通过                                                                  |
| LDS2 证书记录复用                              | 通过（`Reused certificate record #1`）                                |
| LDS2 PACE-CAN（LDS1 写入，LDS2 继承）          | 通过（三个应用）                                                      |
| RSA-PSS CSCA/DSC 变体（LDS1 + LDS2 写入/读回） | 通过                                                                  |

关键日志：

- `logs/01-read-lds1.log`
- `logs/20-read-all-groups.log`（ECDSA 全 DG）
- `logs/21-read-all-rsa.log`（RSA-PSS 全 DG）
- `logs/09-read-travel-verified.log` / `10-read-visa-verified.log` / `11-read-bio-verified.log`
- `logs/15-lds2-can-verified.log`

## 3. 问题清单

### 3.1 card42（高）：LDS2 授权在缺少扩展时 fail-open

**现象**：只含 ePassport CHAT、完全没有 LDS2 授权扩展的 DV/IS 链，仍可**追加**
LDS2 Travel 记录；只授予 Travel 读的链仍可**读取** Visa 记录。按 ICAO Doc 9303-10 §5.4 / BSI TR-03110 的相对授权语义（card42 主机侧
`CvChainVerifier` 也按“缺失即不授权”实现），缺少某应用的授权扩展应表示
“无该应用授权”，而不是“全部授权”，因此这两条路径都应被拒绝。

**证据**：

- `scripts/e2e-run/logs/12-epassport-only-append.log`
  - `Terminal Authentication: OK`
  - `Appended entry record (130 B) to 0101`
  - `exit=0`
- `scripts/e2e-run/logs/13-travel-read-only-visa.log`
  - Travel 已写入，Visa 记录未授权，但读回 `verification.valid=true`
- `scripts/e2e-run/logs/cvc-permissions.txt`
  - `ta-chain-epassport.der`：Travel/Visa/Biometrics 全部 `read=false, write=false`
- 对照：`logs/14-travel-read-only-append.log` 中 Travel 追加被正确拒绝（`6982`），
  说明授权位本身和 Travel 的 AND 逻辑是生效的，缺陷只在“扩展缺失”的默认值。

**根因**（card42）：

- `card/emrtd/ta/TaContext.java:353`
  `certAuth` 初始化为 `0xFF`；
- `card/emrtd/ta/TaContext.java:567-570`
  只对证书中**存在**的扩展做 AND；缺少的扩展保留 `0xFF`。
- `card/emrtd/ta/TaContext.java:415`
  再把 `certAuth` 与信任点 `effectiveAuth` 做 AND；因此信任点 `0x0F` 会把缺失
  扩展解释为“全权限”。
- 相关遗留默认：`card/emrtd/ta/TaTrustStore.java:83-88` 在信任点三个 LDS2 字节
  全为 0 时自动补 `0x0F`（legacy ePassport-only 兼容），同样会放大该问题。

**card42 侧为什么没测出来**：

- `host/emrtd/tools/TaChain.java:217-222` 的 `lds2Auth()` 在构造受限链时始终把
  Visa/Biometrics 设为 `0x0F`，只限制 Travel；现有负向测试（`EmrtdLds2OpsIntegrationTest`
  的 Travel b1-only）因此覆盖不到“扩展缺失”。
- 主机侧 `host/emrtd/ta/CvChainVerifier.java:18` 明确写着“missing extensions are not
  referenced”，且 `granted()` 对缺失项返回 `false`；主机侧是 deny-by-default，
  卡侧与主机侧行为不一致。

**建议**（未修改代码）：

- 卡侧改为 deny-by-default：`certAuth` 清零；`andChat` 用 CHAT 直接赋值 byte0；
  `andExtension` 用扩展值赋值对应 byte，而不是与 `0xFF` 做 AND；缺失扩展保持 0。
- 增加“完全无 LDS2 扩展”的卡侧/集成测试，以及“只授予 Travel 读”的 Visa 读/写负例。
- 重新评估 `TaTrustStore.seedAuthorization()` 的 legacy 全 `0x0F` 兜底；至少不要
  让它在证书链缺少扩展时扩大权限。

### 3.2 pkd42（已对齐）：LDS2 段不再重复卡级 PACE 凭据

**首轮现象（card42 `ab7ab6a`）**：同一个 perso 中 LDS1 的 PACE-CAN 正常，但
Travel/Visa/Biometrics 三个 LDS2 应用返回 `PACE MSE:Set AT failed: 6985`；改用
MRZ 正常。当时在每个 LDS2 section 手工补 `@can 123456` 后通过。

**card42 `d265c24` 后的语义**：f(MRZ)（DGI FF04）与 f(CAN)（DGI FF06）改为
包级共享，LDS1 段个性化一次即被三个 LDS2 DF 继承；LDS2 段**不应**再重复
`@doc/@dob/@doe/@can`，否则会覆盖全卡值。

**最新回归**（未改动的 LDS2 `@can` 缺失已不是问题）：

- `logs/15-lds2-can-verified.log`：Travel `PACE: OK (CAN)`，记录验签通过；
- `logs/22-lds2-can-all-apps.log`：Travel/Visa/Biometrics 全部 `PACE: OK (CAN)`，
  且读回记录/证书验签通过。

**pkd42 对应修改**：

- `packages/pki/src/emrtd/script.ts`：MRZ 字段改为可选；LDS1 段仍必须携带
  `@doc/@dob/@doe`，LDS2 段默认不输出；LDS2 段显式提供三个字段时仍可覆盖全卡值。
- `backend/src/modules/dsc/build.ts`：LDS2 section 不再传 `documentNumber`/
  `dateOfBirth`/`dateOfExpiry`，`@can` 继续只在 LDS1。
- 测试同步更新：`script.spec.ts` 与 `dsc.spec.ts` 断言 LDS2 段没有
  `@doc/@dob/@doe/@can`；`TODO.md`、`packages/pki/AUDIT.md` 记录卡级 PACE 语义。
- 首轮“旧版 card42 下 6985”的根因（card42 把 PACE 口令按实例存储、pkd42 未在
  LDS2 段重复 `@can`）已由 card42 `d265c24` 消除；旧日志 `16`–`18` 仅作为历史记录。

### 3.3 card42（低）：`-app=biometrics -record=all` 的 CLI 语义不一致

`terminal emrtd lds2` 的帮助/文档把 `-record` 列为通用选项，但对 biometrics 直接报
`lds2 -app=biometrics has no record EF (-record is only for travel/visa)`。
Biometrics 是透明 EF（0201），不带 `-record` 时读取正常。

- 证据：`logs/19-biometrics-record-option.log`
- 代码：`host/emrtd/cli/command/EmrtdLds2Command.java:286`
- 建议：帮助文本限定 `-record` 只适用于 travel/visa，或对 biometrics 忽略/解释
  `-record=all`，避免测试脚本误判。

### 3.4 观察（非缺陷）：card42 CLI 的 LDS1 验证范围有限

`terminal emrtd read` 只读取 DG1/DG2/DG15，PA 也只校验这三组；本次用自写的
`ReadAll.java` 才能验证 DG3/DG4/DG11–DG16 的 SOD 哈希。若“读取/验证”要求覆盖全
LDS1，建议 CLI 增加全 DG 读取/校验选项，或在文档中明确只做核心三组。

## 4. 复现

```bash
# 1) 生成夹具（工作区已带 out/、out-rsa/）
cd /home/yukari/misc/pkd42/scripts
./node_modules/.bin/tsx e2e-run/gen.ts
./node_modules/.bin/tsx e2e-run/gen-rsa.ts
./node_modules/.bin/tsx e2e-run/gen-restricted.ts

# 2) 模拟器安装/个性化（需要写 ../card42/build/sim）
cd /home/yukari/misc/card42
make sim-emrtd-install
make sim-emrtd-perso EMRTD_PERSO_SCRIPT=/home/yukari/misc/pkd42/scripts/e2e-run/out/perso.txt

# 3) 正向 + 负向 CLI 测试
cd /home/yukari/misc/pkd42
bash scripts/e2e-run/run-e2e.sh

# 4) 全 DG 读取/哈希校验
cd /home/yukari/misc/pkd42
CARD42=/home/yukari/misc/card42
OUT=scripts/e2e-run/out
CP="scripts/e2e-run/java/classes:$CARD42/build/deliverables/card42-emrtd.jar:$CARD42/build/deliverables/card42-common.jar:$CARD42/tools/java_card_devkit_simulator-linux-bin-v26.0-b_788-05-MAY-2026/client/COMService/socketprovider.jar"
javac -cp "$CP" -d scripts/e2e-run/java/classes scripts/e2e-run/java/ReadAll.java
java -cp "$CP" ReadAll socket:localhost:9025 "$OUT/ta-chain.der" "$(cat $OUT/ta-key.txt)" "$OUT/csca.crt" 'L898902C<' 690806 361023
```

## 5. 代码修改与工作区状态

- `pkd42`（本轮修改）：`packages/pki/src/emrtd/script.ts`、`backend/src/modules/dsc/build.ts`、
  两个对应测试、`TODO.md`、`packages/pki/AUDIT.md`；另有未跟踪的 `scripts/e2e-run/`
  测试夹具。`pnpm --filter @epass42/pki test`、`pnpm --filter @epass42/backend test`、
  两个 typecheck 与 ESLint 均通过。
- `card42`：未修改源码；按最新 `d265c24` 重新构建了 `build/`，`git status` 干净。
