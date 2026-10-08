# pkd42 — Task & Implementation Plan (TODO)

> 本文把系统拆成里程碑（M0–M15），并给出每个
> 模块的任务、验收标准、规范依据与风险。
>
> **契约约定**
>
> - 代码注释、变量名、API 文档、提交信息使用**英文**；本文使用中文。
> - 前端 i18n 仅提供英语（`en`），但所有文案必须走 i18n key，不硬编码。
> - 国家码：MRZ/ICAO 三字母码 **`UDN`**；DN/PKD 路径 alpha-2 码 **`XD`**。
> - 数据库：**SQLite**（不用 PostgreSQL）。
> - CSCA 私钥：**在线签发**（后端持有并自动签 DSC/CRL）。
> - PKD 角色：**REST + LDIF + 只读 LDAP**（不实现 LDAP 写入协议，上传走应用 API）。
> - 复用 `card42` / `card42-perso-generator` 代码时，**必须逐条对照 Doc 9303-10/11/12
>   分析正确性**（见 M1/M7 的审计任务），许可证无障碍。
> - 申请者前端**只提交人性化结构化字段**，不出现裸 hex 输入框；图片类数据由**前端裁切/编码**
>   （DG2/DG5/DG7），生物特征模板（DG3/DG4）允许"已编码文件上传"。
> - AA（DG15/DGI FF02）与 CA（DGI FF03/EF.CardSecurity）由**服务端生成**；暂不处理密钥外泄风险。
> - 交付**一次性**：预览 mask 部分字段且非破坏；"领取"才消费并删除，领取前必须警告确认。
> - DSC 管理员可选**交付模式**：默认给申请人（自服务），可切换为给管理员/审核者（机构制卡）；
>   审批时可对单请求覆盖。
> - 申请者范围：**LDS1**；LDS2（Travel/Visa/Additional Biometrics）默认空、申请者不输入，记录由管理员/后续授权终端写入。
> - 服务端填写的字段（发证机构等）**可由管理员定制**：系统默认 + 审批时单请求覆盖。
> - 前端编码**不降级**：必须有安全上下文（HTTPS/localhost），否则不可用。

---

## 0. 角色、术语与信任链

### 0.1 角色

| 角色                    | 职责                             | 关键产物                                                                  |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| **PKD**                 | 证书目录（类比 ICAO PKD 只读区） | CSCA 证书、CRL、Master List 的 LDAP/REST/LDIF                             |
| **CSCA**                | NIA 的 Country Signing CA        | 签发/吊销 DSC；维护 CRL；支持密钥轮换                                     |
| **DSC Signing Service** | 用 DSC 私钥签护照数据并组卡      | card42 `.perso`（DG1–DG16 + EF.CardAccess/Security + EF.SOD）；一次性交付 |

> 术语区分：文中的 **DSC** 若指证书写 `DSC`（Document Signer Certificate），
> 若指服务写 `DSC Signing Service`。

### 0.2 信任链

```
CSCA (NIA, C=XD, CN=...)                       ← 在线私钥
   │ 签发 / 吊销
   ├── DSC #1 (NIA 默认)  ──┐
   ├── DSC #2 (AS 自带)   ──┤ 签名
   └── DSC #n             ──┘
                            ▼
                    EF.SOD ← perso → card42/eMRTD
                            ▲
              PKD 目录发布 CSCA / CRL / Master List
```

### 0.3 代码结构

```
pkd42/
├── packages/
│   ├── pki/            # 纯函数：X.509 / CMS / CRL / MasterList / SOD / perso
│   └── shared/         # zod schema、类型、错误码、常量（OID、国家码）
├── backend/            # Fastify + TypeScript，模块化
├── frontend/           # Nuxt 4 + Naive UI
├── scripts/            # gen-csca / gen-dsc / verify
├── deploy/             # docker-compose、OpenLDAP schema
└── TODO.md
```

---

## 1. 里程碑总表

| 里程碑 | 内容                                             | 依赖     |
| ------ | ------------------------------------------------ | -------- |
| M0     | 仓库脚手架、ESLint/Prettier、CI、常量            | —        |
| M1     | `packages/pki`（证书/CRL/CMS/SOD/perso 内核）    | M0       |
| M2     | `scripts/gen-csca` + `scripts/verify`            | M1       |
| M3     | 后端骨架 + SQLite + 迁移 + 配置                  | M0       |
| M4     | 双 realm 多 OAuth + 会话 + MNT 授权              | M3       |
| M5     | CSCA 角色：DSC 申请/审核/签发/吊销               | M1,M4    |
| M6     | CRL 生成与发布                                   | M1,M5    |
| M7     | DSC Signing Service（建 DG、生成 AA/CA、perso）  | M1,M4    |
| M8     | 交付：预览 / 一次性领取 / 邮件 / 历史 / 交付模式 | M7       |
| M9     | PKD 角色：REST + LDIF + 只读 LDAP                | M1,M5,M6 |
| M10    | Master List                                      | M1,M9    |
| M11    | 前端（表单/暗色/i18n/后台）                      | M4–M8    |
| M12    | 单角色模式（各 AS 自建 DSC）                     | M7,M11   |
| M13    | 安全加固、审计、限流、加密落盘                   | M3–M12   |
| M14    | 测试与交叉验证                                   | 贯穿     |
| M15    | 部署、文档、发布                                 | 全部     |

---

## 2. M0 — 仓库脚手架

- [x] T0.1 采用 pnpm workspace：`packages/*`、`backend`、`frontend`、`scripts`。
- [x] T0.2 根 `package.json` 增加脚本：`lint`、`format`、`typecheck`、`test`、`check`、`dev`、`build`。
- [x] T0.3 ESLint flat config（`@eslint/js` + `typescript-eslint` + `@vue/eslint-config-typescript` + `@vue/eslint-config-prettier` + `eslint-plugin-vue`），参考 `card42-perso-generator/eslint.config.ts`。
- [x] T0.4 Prettier 配置（`.prettierrc.json`）与 `.prettierignore`。
- [x] T0.5 TypeScript `~5.9.x`（注意：TS 7 原生编译器和 `vue-tsc` 尚不兼容，参考 generator 的 `docs/library-analysis.md`）。
- [x] T0.6 `packages/shared`：`COUNTRY_ALPHA2='XD'`、`COUNTRY_ALPHA3='UDN'`、OID 常量表（附录 A）、错误码 enum、zod 基础 schema。
- [x] T0.7 CI（GitHub Actions 或等价）：`pnpm check`（format + lint + typecheck + test）。
- [x] T0.8 `.gitignore` 补齐：`node_modules`、`*.db`、`*.sqlite*`、`build/`、`dist/`、`.env*`、`secrets/`。
- [x] T0.9 根 README：项目性质、架构图、快速开始。
- [x] T0.10 `pnpm install` 通过，`pnpm check` 全绿（空测试也可）。

**验收**：`pnpm check` 通过；目录结构建立。

---

## 3. M1 — `packages/pki`

> 目标：与 Doc 9303-12 §7 一致、可被 OpenSSL/JMRTD 验证的 PKI 内核；同时承载 perso/SOD。
> 优先实现 RSA（PKCS#1 v1.5 与 RSA-PSS），ECDSA 作为后续可选项。

### 3.1 X.509 证书

- [x] T1.1.1 基于 `@peculiar/x509`（或 `pkijs` + `asn1js`）封装 `createCscaRoot()`。
- [x] T1.1.2 实现通用 Profile 校验（§7.1.1 Table 5）：
  - [x] version v3；serial 正整数、≤20 字节、最小 2's complement。
  - [x] validity 秒必须存在；≤2049 `UTCTime` `YYMMDDHHMMSSZ`，≥2050 `GeneralizedTime`，均 `Z`。
  - [x] issuer/subject：`countryName` 必须存在且大写 PrintableString；`commonName` 必须存在；DirectoryString 用 PrintableString/UTF8String；issuer/subject 的 countryName 一致。
  - [x] 默认值扩展不得编码。
- [x] T1.1.3 CSCA Root 扩展（§7.1.1 Table 6）：
  - [x] `SubjectKeyIdentifier` 必须（nc）。
  - [x] `AuthorityKeyIdentifier` 可选（nc；自签含 keyid）。
  - [x] `KeyUsage` 必须 **critical**：`keyCertSign`、`cRLSign`。
  - [x] `PrivateKeyUsagePeriod` 必须（nc，GeneralizedTime）。
  - [x] `BasicConstraints` 必须 **critical**：`cA=TRUE`、`pathLenConstraint=0`。
  - [x] `SubjectAltName` 必须（nc）：`directoryName` 含 `localityName=UDN`；不唯一时用 `stateOrProvinceName`。
  - [x] `IssuerAltName` 必须（nc），自签时**与 SAN 完全相同**。
  - [x] `CRLDistributionPoints` 必须（nc），ldap/http/https。
  - [x] `CertificatePolicies` 可选；`NameChange` 可选（轮换时）。
- [x] T1.1.4 DSC 扩展（§7.1.1 Table 6）：
  - [x] `AuthorityKeyIdentifier` 必须（nc）。
  - [x] `SubjectKeyIdentifier` 可选（nc）。
  - [x] `KeyUsage` 必须 **critical**：仅 `digitalSignature`。
  - [x] `PrivateKeyUsagePeriod` 必须（nc）。
  - [x] `DocumentType` 必须 **nc**：`DocumentTypeListSyntax = SEQUENCE{version=0, SET OF PrintableString(1..2)}`，默认 `P`。
  - [x] `SubjectAltName`/`IssuerAltName` 必须（nc）。
  - [x] `CRLDistributionPoints` 必须（nc）。
  - [x] **不得**含 EKU、BasicConstraints（DSC 的 ExtKeyUsage 列为 `x`）。
- [ ] T1.1.5 ECDSA 支持：显式 ECParameters（**禁止 named curve/implicit，必须含 cofactor**），点非压缩（§4.1.6.3）。默认仍 RSA。
- [x] T1.1.6 算法：哈希仅 SHA-224/256/384/512；RSA 默认 RSASSA-PSS，同时支持 PKCS#1 v1.5；`signature` 字段与 `signatureAlgorithm` 一致。
- [x] T1.1.7 `parseCertificate()`：提取 serial、SKI、指纹、issuer/subject、扩展。
- [x] T1.1.8 serial 生成：≥64 bit 随机 + 唯一性约束（DB 层）。
- [x] T1.1.9 CSCA Link 证书（轮换）：issuer=旧 DN、subject=新 DN、签名用旧私钥、认证新公钥；含 `NameChange` 时置位。
- [x] T1.1.10 单测：固定向量 + 逐扩展存在性/临界性/编码断言；`openssl x509 -text` 对照。

### 3.2 CRL（§7.1.4）

- [x] T1.2.1 `createCrl()`：v2、issuer、thisUpdate/nextUpdate（秒+Z）。
- [x] T1.2.2 `revokedCertificates` 有则不空、无则不出现。
- [x] T1.2.3 crlExtensions：`AuthorityKeyIdentifier` 必须（nc，等于签证 SKI）、`cRLNumber` 必须（nc，非负、≤20 字节最小补码）。
- [x] T1.2.4 禁止：deltaCRLIndicator、issuingDistributionPoint、freshestCRL；条目级 reasonCode/holdInstructionCode/invalidityDate/certificateIssuer。
- [x] T1.2.5 签名用**最新** CSCA 私钥；支持包含旧 CSCA 签发的吊销项。
- [x] T1.2.6 `parseCrl()` / `isRevoked(cert, crl)`。
- [x] T1.2.7 单测：空 CRL、含吊销、CRL number 递增、`openssl crl -text` 对照。

### 3.3 CMS SignedData / LDS Security Object / EF.SOD（Doc 9303-10 §4.6.2）

- [x] T1.3.1 `ldsSecurityObject(hashes)`：`SEQUENCE{version=0, AlgorithmIdentifier(SHA-256), SEQUENCE{ {dgNumber, OCTET STRING hash}... }}`。
- [x] T1.3.2 `buildCms(eContentType, eContent, certPem, keyRef)`：`SignedData`，`signerInfos` 的 `sid` 用 IssuerAndSerialNumber；`signedAttrs` 含 `content-type` + `message-digest`。
- [x] T1.3.3 `buildSod(hashes, dsc)`：外层 `77` 包 CMS（contentType `2.23.136.1.1.1`）。
- [x] T1.3.4 `buildCardSecurity(securityObject, dsc)`：裸 SignedData（contentType `0.4.0.127.0.7.3.2.1`）。
- [x] T1.3.5 单测：`pkijs.verify` 自验 + `openssl cms -verify`（CI 允许则跑）。
- [x] T1.3.6 **审计 card42-perso-generator 的 `cms.ts`**：逐字段对照 RFC 5652 与 Doc 9303-10；特别核对 signedAttrs 的 DER SET OF 重编码、eContent OCTET STRING 包装、`77` 外层。

### 3.4 Master List（Doc 9303-12 §9）

- [x] T1.4.1 `buildMasterList(certs, signerCert, signerKey)`：`ContentInfo{SignedData}`，`eContentType=2.23.136.1.1.2`，`eContent=CscaMasterList{version=0, SET OF Certificate}`；`certificates` 必须含 ML Signer、应含 CSCA；`signedAttrs` 必须含 `signingTime`。
- [x] T1.4.2 `DigestAlgorithmIdentifiers` 省略 NULL，`SignatureAlgorithmIdentifier` 无参时含 NULL（§9 Note）。
- [x] T1.4.3 单测 + `openssl cms -verify`。

### 3.5 数据组 / perso（构建、校验与移植审计）

#### 3.5.1 DG 范围与生成方（Doc 9303-10 §4.7）

| DG       | 外层 tag   | 内容                         | 生成方                              | 申请者 UI      |
| -------- | ---------- | ---------------------------- | ----------------------------------- | -------------- |
| DG1      | `61`       | MRZ                          | 服务端（结构化字段）                | MRZ 表单       |
| DG2      | `75`       | 人脸 CBEFF/ISO 19794-5       | 前端编码，服务端校验                | 照片上传+裁切  |
| DG3      | `63`       | 指纹 CBEFF/ISO 19794-2/-4    | 用户上传已编码 BDB，服务端包装/校验 | 文件上传       |
| DG4      | `76`       | 虹膜 CBEFF/ISO 19794-6       | 同上                                | 文件上传       |
| DG5      | `65`       | 显示头像（JPEG `5F40`）      | 前端编码                            | 照片上传       |
| DG6      | `66`       | 保留                         | —                                   | —              |
| DG7      | `67`       | 显示签名/标记（JPEG `5F43`） | 前端编码                            | 签名图片上传   |
| DG8/9/10 | `68/69/6A` | 特征数据（未定义/专有）      | 暂不支持（高级可选）                | —              |
| DG11     | `6B`       | 附加个人信息                 | 服务端（结构化字段）                | 结构化表单     |
| DG12     | `6C`       | 附加证件信息                 | 服务端（结构化字段）                | 结构化表单     |
| DG13     | `6D`       | 可选项（发行国自定义）       | 用户提交自由文本/结构化 JSON        | 文本/JSON 表单 |
| DG14     | `6E`       | SecurityInfos（CA/PACE）     | 服务端（与 EF.CardAccess 一致）     | 机制开关       |
| DG15     | `6F`       | AA 公钥（SPKI）              | 服务端生成                          | 开关           |
| DG16     | `70`       | 通知人                       | 服务端（结构化列表）                | 结构化列表     |

- [x] T1.5.1 `buildDg1`（`61{5F1F MRZ}`）。
- [x] T1.5.2 `buildDg2`（`75{7F61{02 01 01,7F60{A1 SBH,5F2E ISO19794-5}}}`）+ `validateDg2()`。
- [x] T1.5.3 `wrapDg3()`/`validateDg3()`：外层 `63{7F61{…}}`，内层 `5F2E`/`7F2E` 的 BDB 原样透传，仅校验外层与实例数（§4.7.3）。
- [x] T1.5.4 `wrapDg4()`/`validateDg4()`（§4.7.4）。
- [x] T1.5.5 `buildDg5`（`65{02 01 01,5F40 JPEG}`）、`buildDg7`（`67{02 01 01,5F43 JPEG}`）。
- [x] T1.5.6 `buildDg11(fields)`：`6B{5C taglist, 5F0E, [A0{02 01 n,5F0F…}], 5F10, 5F2B(yyyymmdd), 5F11, 5F42, 5F12, 5F13, 5F14, 5F15, [5F16 公民证明图像], 5F17, 5F18}`；长度/字符集/`<` 填充校验（§4.7.11 Table 71/72）。
- [x] T1.5.7 `buildDg12(fields)`：`6C{5C, 5F19, 5F26(yyyymmdd), [A0{02 01 n,5F1A…}], 5F1B, 5F1C, [5F1D 正面], [5F1E 背面], 5F55(yyyymmddhhmmss), 5F56}`（§4.7.12 Table 73/74）。
- [x] T1.5.8 `buildDg13(data)`：`6D{…}`，发行国自定义；申请者提交自由文本/结构化 JSON，编码策略可配置（§4.7.13）。
- [x] T1.5.9 `buildDg14(securityInfo)` / `buildCardAccess(securityInfo)`：与 CA/PACE 选择一致（§4.7.14、Doc 9303-11）。
- [x] T1.5.10 `buildDg15(spki)`（§4.7.15、Doc 9303-11 §6.1.5）。
- [x] T1.5.11 `buildDg16(persons)`：`70{02 01 n, A1{5F50,5F51,5F52,5F53}, …}`（§4.7.16 Table 80/81）。
- [x] T1.5.12 `mrz.ts`：TD3 组装与 7-3-1 校验位（含复合校验位），供 DG1 复用。
- [x] T1.5.13 `buildSecurityObject`（EF.CardSecurity 的 eContent）。
- [x] T1.5.14 `renderEmrtdScript()`：`@instance/@doc/@dob/@doe/@dg n/@sod/@aa/@ca/@cardaccess/@cardsecurity/@record/@transparent`。
- [x] T1.5.15 **审计任务（逐条对照规范）**：
  - [x] DG1/DG2/DG3/DG4/DG5/DG7/DG11/DG12/DG13/DG14/DG15/DG16 的 tag/长度/编码/填充。
  - [x] `SecurityInfo` OID/版本/profile（Doc 9303-10 §3.11、Doc 9303-11 §9.2）。
  - [x] perso 指令语义与 `card42.host.emrtd.perso.LdsScript` 一致（含 `@aa` 的 `modLen‖modulus‖expLen‖exponent`）。
  - [x] EF.COM 由卡侧生成，不在本工具输出中伪造（Doc 9303-10 §4.6.1）。
  - [x] LDS2 记录/透明 EF 的 `fid`/内容编码（Doc 9303-10 §5）。
  - [x] 把每条审计结论记入 `packages/pki/AUDIT.md`。
- [x] T1.5.16 单测：MRZ 被 `mrz` parser 校验；各 DG 构建器有固定向量；DG/SOD 跨 card42 模拟器 PA 验证。

### 3.6 验证模块

- [x] T1.6.1 `verifyDscAgainstCsca(dsc, cscaList)`。
- [x] T1.6.2 `verifySod(sod, dgHashes)`。
- [x] T1.6.3 `validateCertProfile(cert, kind)`：返回 profile 偏差列表（供审核用）。

**M1 验收**：`packages/pki` 单测全绿；`openssl verify`/`cms -verify` 通过；`AUDIT.md` 完成对移植代码的规范对照。

> 说明：ECDSA（T1.1.5）暂未实现，默认 RSA；card42 模拟器 PA（T1.5.16）需要
> Java 工具链，改为在 `scripts` 端到端测试中对生成的 SOD 做 `openssl cms -verify`。

---

## 4. M2 — 生成与校验脚本

### 4.1 `scripts/gen-csca`

- [x] T2.1.1 CLI 参数：`--out`、`--cn`、`--country XD`、`--locality UDN`、`--validity-years`、`--key-rsa-bits 4096`、`--hash sha256`、`--pss`、`--private-key-usage-years`、`--crl-dp`。
- [x] T2.1.2 用 `packages/pki` 生成（保证扩展完整，尤其 `PrivateKeyUsagePeriod`，OpenSSL `req` 不支持）。
- [x] T2.1.3 输出：`csca.key`（加密 PKCS#8，口令交互）、`csca.crt`（DER+PEM）、`csca.json`（serial/SKI/SHA-256 指纹）。
- [x] T2.1.4 提供对比用 OpenSSL 脚本 `scripts/gen-csca-openssl.sh`（含 `-param_enc explicit` 的 ECDSA 变体）。
- [x] T2.1.5 文档说明离线生成流程与私钥保护。

### 4.2 `scripts/verify`

- [x] T2.2.1 校验单张证书是否符合 CSCA/DSC profile。
- [x] T2.2.2 `openssl verify -CAfile` 验 DSC 链。
- [x] T2.2.3 校验 CRL/ML/SOD。
- [x] T2.2.4 退出码：0 通过，非 0 输出 `error: <msg>`。

- [x] T2.3 CI 中跑 `scripts/verify` 针对生成的测试证书。

**M2 验收**：生成一张通过 `scripts/verify` 的 CSCA；DSC 由它签发并能 `openssl verify`。

---

## 5. M3 — 后端骨架（SQLite）

- [x] T3.1 Fastify + `fastify-type-provider-zod`，导出 OpenAPI。
- [x] T3.2 配置加载（`zod` 校验 env + 可选 `config.toml`）：端口、公开 URL、角色开关、国家码、SMTP、加密 KEK、限流、IP 判定策略。
- [x] T3.3 SQLite：`better-sqlite3`（或 `@libsql/client` 本地）；开启 `PRAGMA journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout`。
- [x] T3.4 Drizzle ORM + `drizzle-kit` 迁移；表结构见附录 C。
- [x] T3.5 模块目录：`src/modules/{auth,pkd,csca,dsc,directory}`、`src/db`、`src/crypto`、`src/jobs`、`src/mail`、`src/audit`。
- [x] T3.6 统一错误处理、请求 ID、`pino` 日志。
- [x] T3.7 健康检查 `/healthz`、`/readyz`。
- [x] T3.8 优雅关闭、迁移自动执行（可开关）。

**验收**：`pnpm --filter backend dev` 起服务；`/healthz` 200；迁移生成 `.db` 文件。

---

## 6. M4 — 认证与授权（双 realm 多 OAuth）

- [x] T4.1 抽象 `OAuthProviderConfig`：`realm`（csca|dsc）、`issuer`、`client_id/secret`、`scopes`、`claim_map`、`enabled`。
- [x] T4.2 `openid-client` 动态发现 + PKCE + state + nonce；`/auth/{realm}/login`、`/callback`、`/logout`。
- [x] T4.3 双 realm 完全隔离：独立 cookie 名（如 `pkd42_csca_sid` / `pkd42_dsc_sid`）、独立 session 表前缀、独立 CSRF scope。
- [x] T4.4 session 存储：SQLite 表；cookie `HttpOnly; Secure; SameSite=Lax`；滑动过期。
- [x] T4.5 dn42 claim 映射：`asn`、`active_mnt`、`mnt_by`、`route/route6`、`email`、`active_name`；只信任白名单 issuer；缺失时降级。
- [x] T4.6 预填：把 claim 暴露到前端表单默认值。
- [x] T4.7 授权：
  - [x] `CSCA_ADMIN_MNTS` / `DSC_ADMIN_MNTS` 配置（或表）。
  - [x] 判定 `active_mnt ∈ 清单`，可选 `mnt_by` 命中。
  - [x] 管理接口中间件 + 审计。
- [x] T4.8 匿名访问：DSC realm 允许匿名提交（见 M7/M8）。
- [x] T4.9 防 CSRF、防开放重定向、防 SSRF（issuer 白名单/预置 discovery 结果）。
- [x] T4.10 单测：mock OIDC 完成登录；越权被拒；两 realm 互不影响。
- [ ] T4.11 DSC realm 的**委派 AS 评审**范围：当某个 AS 的管理员在 CSCA realm 委派由 NIA
      DSC 签发（`as_config.use_nia_dsc = true`）时，该 AS 的管理员可用同一 ds 身份登录 DSC
      realm，作为**受委派 AS 评审**审核**本 AS**（且 `dsc_selection='nia'`）的申请：
  - [ ] 只能查看/审核 `asn == 自己 ASN` 且委派到 NIA DSC 的申请，**看不到其它 AS 的申请**。
  - [ ] 只能审批/拒绝（approve/reject），**不得修改全局设定**（交付模式、签发字段默认值等）。
  - [ ] 判定依据：DSC realm 身份 `asn` 对应 `as_config.use_nia_dsc = true`；非全局 NIA 管理员。
  - [ ] NIA 管理员（`DSC_ADMIN_MNTS`）仍可查看/审阅**所有** AS 的申请。

**验收**：两个 realm 可同时登录；非管理员访问管理接口返回 403。

---

## 7. M5 — CSCA 角色

### 7.1 数据与状态

- [x] T5.1.1 `csca_key`（在线私钥，信封加密；见 M13）。
- [x] T5.1.2 `dsc_application`：提交字段、自带 CSR/公钥或系统生成、发证策略、申请页 URL、申请人 account/asn/mnt。
- [x] T5.1.3 `dsc_cert`：序列号、subject、issuer、状态（active/revoked/expired）、私钥引用/来源。
- [x] T5.1.4 状态机：`submitted → approved|rejected`；证书 `active → revoked`。

### 7.2 申请与审核

- [x] T5.2.1 `POST /csca/applications`（登录 AS 管理员）：提交 DSC 申请。
  - [x] 支持 `key_mode=nia_generated`（系统生成）或 `user_uploaded`（上传 CSR/公钥；**不接收明文私钥**用于 CSCA 签发，签名服务另说）。
  - [x] 字段：subject CN（≤ 规范长度）、DocumentType、有效期、发证策略、申请页 URL、备注。
  - [x] oauth 预填 `asn`/`active_mnt`/`email`。
- [x] T5.2.2 `GET /csca/applications/:id`（申请人/管理员）。
- [x] T5.2.3 `GET /csca/applications`（管理员，过滤/分页）。
- [x] T5.2.4 `POST /csca/applications/:id/approve`（管理员）：在线签发 DSC。
  - [ ] 校验 CSR（若上传）与 profile 相关约束。
  - [x] 生成 DSC（§7.1.1），Subject `C=XD`，`CN`，嵌入 DocumentType。
  - [x] 保存证书 + 私钥引用（系统生成时）。
  - [x] 审计。
- [x] T5.2.5 `POST /csca/applications/:id/reject`（管理员，需理由）。
- [x] T5.2.6 列表/详情返回证书 PEM/DER/指纹。

### 7.3 吊销

- [x] T5.3.1 `POST /csca/certificates/:id/revoke`（管理员）。
- [x] T5.3.2 触发 CRL 重生成（M6）与 PKD 发布（M9）。
- [ ] T5.3.3 证书有效期到期自动置 `expired`（调度）。

### 7.4 公开查询

- [x] T5.4.1 `GET /csca/certificates`（公开列表：serial、subject、状态、指纹）。
- [x] T5.4.2 `GET /csca/certificates/:id.(pem|der)`。
- [x] T5.4.3 `GET /csca/crl.(pem|der)`。

### 7.5 密钥轮换

- [x] T5.5.1 `POST /csca/keys/rollover`（管理员，双人确认）：生成新 CSCA、签发 Link 证书、CRL 改用新键。
- [ ] T5.5.2 90 天前通知机制（站内公告/邮件，可选）。

**验收**：AS 管理员提交申请→管理员批准→得到可 `openssl verify` 的 DSC；吊销后 CRL 含该序列号。

---

## 8. M6 — CRL

- [x] T6.1 `createCrl()` 汇总所有 revoked DSC（当前 CSCA 键签发）。
- [x] T6.2 `crl_number` 单调递增（DB 原子自增）。
- [x] T6.3 调度：
  - [x] 至少每 90 天一张；
  - [x] 不低于每 48 小时一张；
  - [x] 吊销后 48 小时内立即出一张。
- [x] T6.4 存储 `crl` 表并写入 PKD。
- [x] T6.5 `nextUpdate` 合理设置。
- [x] T6.6 单测：空/非空、number 递增、时限逻辑（用可注入时钟）。

---

## 9. M7 — DSC Signing Service（perso 输出）

### 9.1 输入契约（申请者只提交结构化字段）

- [x] T7.1.1 `POST /dsc/requests` 接受结构化 JSON（**无裸 hex 输入**）：
  - [x] `mrz`：TD3 字段（documentCode、issuingState=`UDN`、surname、givenNames、documentNumber、nationality、dob、sex、doe、personalNumber、optionalData）。
  - [x] `dg2`（必填）：**前端裁切/编码**后的 DG2 字节（Base64）；服务端只做结构校验，不重编码。
  - [x] `dg3`/`dg4`（可选）：用户上传的**已编码 CBEFF/BDB**；服务端包 `63`/`76` 外层并校验。
  - [x] `dg5`/`dg7`（可选）：**前端编码**的显示头像/签名图像（`5F40`/`5F43`）。
  - [x] `dg11`（可选）：结构化字段（fullName、otherNames[]、personalNumber、fullDob、placeOfBirth、address、telephone、profession、title、personalSummary、citizenshipImage?、otherTdNumbers[]、custodyInfo）。
  - [x] `dg12`（可选）：结构化字段（issuingAuthority、dateOfIssue、otherPersons[]、endorsements、taxExit、frontImage?、rearImage?；`5F55`/`5F56` 由服务端填）。
  - [x] `dg13`（可选）：发行国自定义的自由文本/结构化 JSON（编码策略可配）。
  - [x] `dg16`（可选）：通知人列表（name、telephone、address、dateRecorded）。
  - [x] `security`：机制开关（PACE ECDH-GM 3DES/AES、CA 3DES/AES、AA）；服务端据此生成 EF.CardAccess（主）/可选 DG14、DG15、EF.CardSecurity。
  - [x] `lds2`：**默认空**，申请者不输入；不生成任何 LDS2 记录/透明 EF（是否创建空应用由配置决定）。
  - [x] `dscSelection`：`nia`（默认）或 `owned`（指定 `dsc_cert_id`，仅限申请人所有）。
  - [x] `email`（可选）、`notes`（可选）。
- [x] T7.1.2 zod schema（`packages/shared`，前后端共用）+ 大小限制（每图/总 payload）。
- [x] T7.1.3 校验：
  - [ ] MRZ 校验位/字符集/`<` 填充；`issuingState=UDN`；证件号在签发 AS 内唯一。
  - [ ] 文档类型与所选 DSC 的 `DocumentType` 授权一致。
  - [x] DG2/DG3/DG4/DG5/DG7 外层结构与图像魔数；DG11/DG12/DG16 字段长度/字符集。
  - [x] DG 编号范围与重复检测。
- [x] T7.1.4 已登录用户关联 `account`；匿名则仅生成 reference。

### 9.2 处理（服务端生成 AA/CA）

- [x] T7.2.1 服务端从 `mrz` 构建 **DG1**（权威，不信任前端）。
- [x] T7.2.2 服务端生成 **AA**（RSA-2048）→ 公钥进 `DG15`，私钥进 perso `@aa`（DGI FF02）。
- [x] T7.2.3 服务端生成 **CA**（P-256）→ 公钥进 `EF.CardSecurity`（DSC 签名）与 EF.CardAccess，标量进 `@ca`（DGI FF03）。
- [x] T7.2.4 构建 `EF.CardAccess`（主）与可选 `DG14`，二者内容一致。
- [x] T7.2.5 组装 DG2/DG3/DG4/DG5/DG7（校验）、DG11/DG12/DG13/DG16（服务端构建）。
- [x] T7.2.6 计算各 DG SHA-256 → `LdsSecurityObject` → 选定 DSC → `EF.SOD`。
- [x] T7.2.7 渲染 `perso` 文本（`renderEmrtdScript`），含 LDS1（与可选 LDS2 段）。
- [x] T7.2.8 加密落盘为 artifact，记录 SHA-256；构建完成后**删除原始 AA/CA 私钥**（perso 内已含）。

### 9.3 输出（一次性交付，见 M8）

- [ ] T7.3.1 `.perso` 通过一次性 `reveal` 交付（附可选 EF.SOD/DSC 证书）。
- [x] T7.3.2 头部注释含 reference ID、DG 清单、SOD 指纹。
- [x] T7.3.3 **perso 按设计包含 AA/CA 私钥**（`@aa`/`@ca`），UI 与文件均需显著警示；除这些外不回传任何密钥。

### 9.4 验证闭环

- [x] T7.4.1 内部 `verifySod` 自检。
- [ ] T7.4.2 集成测试：card42 模拟器导入 perso 跑 PA（CI 可用则跑，否则文档化手动步骤）。
- [ ] T7.4.3 单测：`openssl cms -verify` 对生成的 SOD；DG 结构向量。

### 9.5 LDS2（默认空，申请者不输入）

- [x] T7.5.1 初始 perso：LDS2（Travel/Visa/Additional Biometrics）默认不含记录/透明 EF；申请者表单不出现 LDS2 输入。
- [ ] T7.5.2 可选：为已启用 LDS2 的模式生成空应用（DF + EF.CardAccess/Security 角色一致性）。
- [x] T7.5.3 记录写入（state/date、visa、biometrics）由管理员或后续授权终端负责（结构保留在 `packages/pki`）。

### 9.6 服务端填写字段与管理员定制

- [x] T7.6.1 定义"服务端填写字段"清单：DG1 `issuingState=UDN`、DG12 `5F19` 发证机构、`5F26` 签发日期、`5F55` 个性化时间、`5F56` 个性化设备序列号、DG13 编码策略、DG11 `5F11` 出生地默认、DG12 `5F1B/5F1C` 默认文本等。
- [ ] T7.6.2 这些字段有**系统默认值**，存于 `issuing_profile`；DSC 管理员可编辑。
- [x] T7.6.3 审批时允许**对单请求覆盖**（快照进 `sign_request.profile_overrides`）。
- [ ] T7.6.4 审计默认值修改与单请求覆盖。

**验收**：提交样例护照数据→下载 `.perso`→card42 模拟器 PA 通过。

---

## 10. M8 — 交付（预览 / 一次性领取 / 邮件 / 历史 / 交付模式）

### 10.1 reference ID 与查询（非破坏）

- [ ] T8.1.1 提交成功返回高熵 `reference_id`（≥16 字节，base32/crockford；库内仅存哈希）。
- [ ] T8.1.2 `GET /dsc/requests/:reference`：仅回**元数据**（状态、时间、DSC、DG 清单、SOD 指纹、交付模式），可反复调用。
  - [ ] 常量时间比较 + 严格限流。
- [ ] T8.1.3 `GET /dsc/requests/:reference/preview`：**非破坏性**预览，服务端用结构化请求重建 DG1/DG2(+可选 DG) 示意。
  - [ ] **mask 规则**（可配）：证件号、个人号、完整出生日期、地址/电话/邮箱、DG16 通知人姓名；照片/签名/指纹用占位或模糊缩略图。
  - [ ] 预览展示"字段存在性 + 掩码值 + 图像占位"，不返回完整敏感字节。

### 10.2 一次性领取（破坏性）

- [ ] T8.2.1 `POST /dsc/requests/:reference/reveal`：原子消费
  - [ ] `UPDATE sign_request SET consumed_at=now, consumed_by=… WHERE consumed_at IS NULL`（单一事务）。
  - [ ] 首次成功返回 `.perso`（可选 EF.SOD/DSC 证书）；后续一律 `410 Gone`。
  - [ ] 响应 `Cache-Control: no-store`；不可缓存/不可代理。
- [ ] T8.2.2 **两步领取（防邮件预取）**：
  - [ ] 邮件链接只落到"确认页"，**不消费**。
  - [ ] 确认页展示元数据 + **警告确认弹窗**："数据仅可领取一次；确认后请立即保存/制作。"
  - [ ] 用户确认后前端才 `POST …/reveal`。
- [ ] T8.2.3 "查看"与"下载"**都算消费**；离开页面即失效。
- [ ] T8.2.4 未领取产物 TTL 到期清理；拒绝无产物。
- [ ] T8.2.5 消费后**不可原样重发**；仅管理员可 `POST /dsc/requests/:id/regenerate`（重新构建，AA/CA 换新，生成新卡），审计。
- [ ] T8.2.6 领取审计：who/when/channel/IP；不记内容。

### 10.3 邮件

- [ ] T8.3.1 `email` 可选；审批结果邮件；通过时附**两步链接**（见 T8.2.2）。
- [ ] T8.3.2 `mail_token`：HMAC 签名 + 过期 + 用途 scope + 一次性（确认页 token；消费用另一个短时 token）。
- [ ] T8.3.3 `nodemailer` + SMTP；job worker 重试。
- [ ] T8.3.4 SPF/DKIM/DMARC 文档化。
- [ ] T8.3.5 交付模式 B 下，申请人邮件为纯状态通知（无领取能力）。

### 10.4 交付模式（管理员配置）

- [ ] T8.4.1 系统级设置 `delivery_mode ∈ {applicant, reviewer}`（默认 `applicant`），仅 DSC 管理员可改。
- [ ] T8.4.2 审批时把当前模式**快照**到 `sign_request.delivery_mode`；审批表单允许**对单请求覆盖**。
- [ ] T8.4.3 模式 A（applicant）：申请人可领取。
- [ ] T8.4.4 模式 B（reviewer）：申请人**不可领取**（`reveal` 返回 `403`），reference/邮件仅用于查状态；管理员在"待制作"队列一次性领取。
- [ ] T8.4.5 管理员"待制作"视图：状态、筛选、领取、重新生成；领取同样一次性 + 审计。
- [ ] T8.4.6 通知：模式 B 下通知管理员（站内 queue + 可选邮件）。

### 10.5 历史与后台

- [ ] T8.5.1 登录用户历史：`GET /dsc/requests`（自己的，按 account 关联，元数据）。
- [ ] T8.5.2 `GET /dsc/requests`（管理员，过滤/分页；**委派 AS 评审仅见本 AS 且
      `dsc_selection='nia'` 的申请**，NIA 管理员见全部）。
- [ ] T8.5.3 `POST /dsc/requests/:id/approve|reject`（管理员；NIA 可带交付模式与签发字段覆盖，
      **委派 AS 评审不得修改全局设定，仅审批/拒绝本 AS 申请**）。
- [ ] T8.5.4 处理记录与审计。

**验收**：匿名提交→状态查询→预览（masked）→确认领取→下载；二次访问 `410`；模式 B 下申请人 `403`、管理员可领取；管理员可重新生成。

---

## 11. M9 — PKD 角色（REST + LDIF + 只读 LDAP）

- [ ] T9.1 数据聚合：CSCA 证书、CRL、Master List；DSC（可选发布）。
- [ ] T9.2 REST：
  - [ ] `GET /pkd/certificates`（CSCA，按 `C=XD`）。
  - [ ] `GET /pkd/crls`、`GET /pkd/masterlists`。
  - [ ] `GET /pkd/objects/:id.(der|pem)`。
- [ ] T9.3 LDIF：
  - [ ] `GET /pkd/ldif`（全量，供 OpenLDAP `slapadd`）。
  - [ ] 对象类与属性：
    - [ ] DS/证书用 `inetOrgPerson` + `userCertificate;binary`。
    - [ ] CRL 用 `cRLDistributionPoint` + `certificateRevocationList;binary`。
    - [ ] Master List 用自定义 schema：`attributeType 2.23.136.1.1.2 (CscaMasterListData)`、`objectClass 2.23.136.2 (CscaMasterList)` SUP person。
  - [ ] DN 路径（下载区）：`c=XD,dc=data,dc=download,dc=pkd,dc=icao,dc=int`。
- [ ] T9.4 只读 LDAP：
  - [ ] 用 `ldapjs` 实现只读 server，暴露同一 DIT；查询映射到 DB。
  - [ ] 支持查询：`(objectclass=inetOrgPerson)`、`(objectclass=cRLDistributionPoint)`、`(objectclass=pkdMasterList)`。
  - [ ] 只提供 Search/Bind（简单匿名或只读 bind），**不支持写**（上传走应用 API）。
  - [ ] 在 `deploy/` 提供 OpenLDAP schema/`slapd.conf` 示例。
- [ ] T9.5 可选：`deploy/docker-compose.yml` 跑 OpenLDAP 并用 LDIF 同步（作为兼容性验证）。
- [ ] T9.6 浏览 UI（M11 呈现）。

**验收**：JMRTD/OpenLDAP 能导入 LDIF；`ldapsearch` 能读到 CSCA/CRL/ML。

---

## 12. M10 — Master List

- [ ] T10.1 Master List Signer 证书（走 CSCA 签发，EKU `2.23.136.1.1.3`）。
- [ ] T10.2 `POST /pkd/masterlists`（管理员）生成：纳入 CSCA（含 Link），含 MLS 证书，`signingTime`。
- [ ] T10.3 发布到 PKD 目录与 LDIF。
- [ ] T10.4 单测 + `openssl cms -verify`。

---

## 13. M11 — 前端（Nuxt 4）

- [ ] T11.1 Nuxt 4 + Naive UI + `@lucide/vue` + Pinia。
- [ ] T11.2 `@nuxtjs/i18n`（en）+ `@nuxtjs/color-mode`（auto/light/dark，含切换）。
- [ ] T11.3 API client（`$fetch`/ofetch）+ zod 校验 + 错误提示。
- [ ] T11.4 表单组件库（对齐 generator 的 `components/common/*` 思路）：日期、文件上传、图片裁切、下拉、标签列表；**不提供 hex 输入框**。
- [ ] T11.5 申请者签名申请表单（**仅结构化字段**）：
  - [ ] MRZ 字段表单 + 实时 TD3 预览 + 校验位提示 + 转写规则。
  - [ ] 照片编辑器：裁切 4:5、预览、**客户端编码 DG2**（跑 `packages/pki` 的浏览器版）。
  - [ ] DG5/DG7 图像上传（客户端编码）。
  - [ ] DG3/DG4 已编码生物特征模板文件上传（校验提示）。
  - [ ] DG11/DG12/DG13/DG16 结构化子表单（可折叠分区）。
  - [ ] 安全机制开关（PACE/CA/AA）。
  - [ ] DSC 选择（NIA 默认 / 自有）、邮箱、备注。
  - [ ] 不出现 LDS2 输入（默认空）。
- [ ] T11.6 状态/预览/领取页：
  - [ ] reference 查询页（元数据）。
  - [ ] **masked 预览页**（非破坏）。
  - [ ] 警告确认弹窗 → 一次性领取/下载；二次访问提示已领取。
- [ ] T11.7 CSCA realm 页面：
  - [ ] 申请 DSC（预填 oauth）、我的申请、状态。
  - [ ] 管理后台：申请列表、审批、吊销、证书/CRL 列表。
- [ ] T11.8 DSC realm 管理后台：
  - [ ] 请求列表、审批/拒绝（含**交付模式与签发字段覆盖**）。
  - [ ] 交付模式设置页（系统级）。
  - [ ] 签发字段默认值页（`issuing_profile`：发证机构等）。
  - [ ] "待制作"队列（模式 B）：一次性领取、重新生成。
- [ ] T11.9 其余页面：登录用户历史；PKD 证书/CRL/ML 浏览与下载、LDIF 链接。
- [ ] T11.10 双 realm 登录入口清晰分离（视觉与路由）。
- [ ] T11.11 无障碍与响应式基本要求。
- [ ] T11.12 护照数据页 mock 预览（参考 generator 的 `EmrtdPreview`）。
- [ ] T11.13 单测（Vitest + `@vue/test-utils`）+ 冒烟测试。

---

## 14. M12 — 单角色模式（各 AS 自建）

- [ ] T12.1 配置 `ROLES=pkd,csca,dsc`（子集可启用）。
- [ ] T12.2 未启用角色不注册路由/不跑迁移/不在 UI 出现。
- [ ] T12.3 DSC-only 模式：配置 NIA 的 PKD/CSCA 端点、本 AS 的 DSC 证书凭据（自有 DSC）、本 AS OAuth。
- [ ] T12.4 文档：AS 自建流程（申请 DSC → 部署 DSC-only → 配置）。

---

## 15. M13 — 安全、审计、加密

- [ ] T13.1 私钥加密落盘：信封加密（KEK 来自 env/文件，AES-256-GCM），`key_ref` 不落明文。
- [ ] T13.2 CSCA 在线私钥保护：最小权限、操作二次确认、可选 PKCS#11/HSM 适配层（接口预留）。
- [ ] T13.3 审计日志：申请/审批/吊销/签发/签名/轮换/登录，含 actor、IP、UA、时间、对象。
- [ ] T13.4 限流：登录、提交、查询、下载（按 IP + reference）。
- [ ] T13.5 输入校验与上传加固：类型/大小/魔数、图像仅校验不重编码（DG2/DG5/DG7 由前端编码）、解压炸弹防护。
- [ ] T13.6 隐私：护照数据与产物加密、可配置保留期与清理任务、日志脱敏。
- [ ] T13.7 反代信任配置（`X-Forwarded-For` 白名单）。
- [ ] T13.8 依赖审计（`pnpm audit`）、锁文件提交。
- [ ] T13.9 一次性交付：原子消费、`Cache-Control: no-store`、消费后安全删除（文件 + DB 字节）。
- [ ] T13.10 AA/CA 私钥：生成即加密、构建后删除、不入日志；领取页显著警示。
- [ ] T13.11 预览 mask 策略可配（默认掩码：证件号/个人号/完整生日/地址电话邮箱/DG16 姓名；生物特征用占位）。
- [ ] T13.12 邮件预取防护：链接落地页不消费；消费需显式 `POST`。

---

## 16. M14 — 测试与交叉验证

- [ ] T14.1 单测覆盖：pki、CRL、CMS、SOD、ML、perso、DG1–DG16 构建器、校验位、profile 校验。
- [ ] T14.2 交叉工具链：`openssl verify/crl/cms`；JMRTD/OpenLDAP 导入 LDIF；card42 模拟器 PA。
- [ ] T14.3 集成测试：CSCA 签 DSC → CRL 吊销 → DSC 签名（含 AA/CA 生成）→ 验证。
- [ ] T14.4 认证测试：mock OIDC、双 realm、MNT 授权、匿名 reference。
- [ ] T14.5 IP 管辖判定测试（含 v4/v6、边界前缀）。
- [ ] T14.6 端到端：匿名/登录提交→预览(masked)→确认领取→下载；二次 `410`。
- [ ] T14.7 交付模式测试：模式 A 申请人领取；模式 B 申请人 `403`、管理员领取；审批覆盖快照。
- [ ] T14.8 一次性/预取测试：确认页不消费、`POST` 才消费、并发双请求只有一个成功。
- [ ] T14.9 mask 规则测试；重新生成测试。
- [ ] T14.10 LDS2 默认空测试；`issuing_profile` 默认值与审批覆盖测试。
- [ ] T14.11 CI 全绿；关键路径覆盖率目标（如 pki ≥ 85%）。

---

## 17. M15 — 部署与文档

- [ ] T15.1 `deploy/docker-compose.yml`：backend（挂载 SQLite 卷）、frontend、可选 OpenLDAP。
- [ ] T15.2 备份/恢复：SQLite 在线备份（`sqlite3 .backup`）+ 密钥备份说明。
- [ ] T15.3 配置参考文档、运维手册（轮换、吊销、ML、CRL 调度）。
- [ ] T15.4 开发者文档：架构、模块、pki 内核、审计结论。
- [ ] T15.5 发布流程与版本。

---

## 附录 A — OID 常量表

| 名称                                              | OID                          |
| ------------------------------------------------- | ---------------------------- |
| id-icao                                           | 2.23.136                     |
| id-icao-mrtd                                      | 2.23.136.1                   |
| id-icao-mrtd-security                             | 2.23.136.1.1                 |
| LDS Security Object                               | 2.23.136.1.1.1               |
| id-icao-cscaMasterList                            | 2.23.136.1.1.2               |
| id-icao-cscaMasterListSigningKey（ML Signer EKU） | 2.23.136.1.1.3               |
| id-icao-mrtd-security-extensions                  | 2.23.136.1.1.6               |
| NameChange                                        | 2.23.136.1.1.6.1             |
| DocumentTypeList                                  | 2.23.136.1.1.6.2             |
| id-icao-DeviationList                             | 2.23.136.1.1.7               |
| DeviationListSigningKey（DL Signer EKU）          | 2.23.136.1.1.8               |
| id-icao-lds2                                      | 2.23.136.1.1.9               |
| id-icao-lds2Signer                                | 2.23.136.1.1.9.8             |
| LDS2-TS / LDS2-V / LDS2-B Signer                  | 2.23.136.1.1.9.8.1 / .2 / .3 |
| id-icao-vds / vdsSigner                           | 2.23.136.1.1.11 / .11.1      |
| securityObject（EF.CardSecurity）                 | 0.4.0.127.0.7.3.2.1          |
| CMS signedData                                    | 1.2.840.113549.1.7.2         |
| CMS contentType / messageDigest                   | 1.2.840.113549.1.9.3 / .9.4  |
| SHA-256                                           | 2.16.840.1.101.3.4.2.1       |

---

## 附录 B — Profile 速查（必须项）

### B.1 CSCA Self-Signed Root（§7.1.1）

- 必须：v3；serial 唯一；UTCTime/GeneralizedTime+Z+秒；C 大写、CN；SKI(nc)、KeyUsage(c, keyCertSign+cRLSign)、PrivateKeyUsagePeriod(nc)、BasicConstraints(c, cA=TRUE, pathlen=0)、SAN(nc, locality=UDN)、IAN(nc, 同 SAN)、CRLDP(nc)。
- 可选：AKI(nc)、CertificatePolicies、NameChange。
- 禁止：EKU、其他 CA 扩展、Netscape、NameConstraints/PolicyConstraints/InhibitAnyPolicy/FreshestCRL。

### B.2 DSC

- 必须：AKI(nc)、KeyUsage(c, 仅 digitalSignature)、PrivateKeyUsagePeriod(nc)、DocumentType(nc)、SAN(nc)、IAN(nc)、CRLDP(nc)。
- 可选：SKI(nc)、CertificatePolicies。
- 禁止：EKU、BasicConstraints。
- Subject：C + CN。

### B.3 CRL

- v2；thisUpdate/nextUpdate 秒+Z；revokedCertificates 有则不空无则不出现；AKI(nc)、cRLNumber(nc)。
- 禁止：deltaCRLIndicator、IDP、freshestCRL、条目级四扩展。

### B.4 生命周期（Table 1，可配）

- CSCA 私钥 3–5 年；CSCA 证书 13–15 年。
- DSC 私钥 ≤ 3 个月；DSC 证书 ≈ 10 年（+私钥期）。
- CRL：≥90 天一张、≤48 小时一张、吊销后 48 小时内。
- CSCA 轮换：提前 90 天通知；Link 证书；新键 2 天内不签。

---

## 附录 C — SQLite 表结构（草案）

```sql
-- 认证
CREATE TABLE oauth_provider (
  id INTEGER PRIMARY KEY, realm TEXT NOT NULL CHECK(realm IN ('csca','dsc')),
  issuer TEXT NOT NULL, client_id TEXT NOT NULL, secret_ref TEXT,
  scopes TEXT, claim_map TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(realm, issuer, client_id));
CREATE TABLE account (
  id INTEGER PRIMARY KEY, realm TEXT NOT NULL, provider_id INTEGER REFERENCES oauth_provider(id),
  subject TEXT NOT NULL, asn INTEGER, active_mnt TEXT, email TEXT, name TEXT,
  raw_claims TEXT, created_at TEXT NOT NULL, UNIQUE(realm, provider_id, subject));
CREATE TABLE session (
  id TEXT PRIMARY KEY, realm TEXT NOT NULL, account_id INTEGER REFERENCES account(id),
  data TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE maintainer (
  mnt TEXT NOT NULL, realm TEXT NOT NULL, role TEXT NOT NULL, note TEXT,
  PRIMARY KEY (mnt, realm, role));

-- CSCA
CREATE TABLE csca_key (
  id INTEGER PRIMARY KEY, serial TEXT NOT NULL UNIQUE, subject_dn TEXT NOT NULL,
  key_algorithm TEXT NOT NULL, not_before TEXT, not_after TEXT,
  cert_pem TEXT NOT NULL, key_ref TEXT NOT NULL, is_current INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
CREATE TABLE dsc_application (
  id INTEGER PRIMARY KEY, asn INTEGER, mnt TEXT, applicant_account_id INTEGER REFERENCES account(id),
  key_mode TEXT NOT NULL, subject_cn TEXT, csr_pem TEXT, public_key_pem TEXT,
  document_type TEXT, validity_days INTEGER, issuance_policy TEXT, application_url TEXT,
  notes TEXT, status TEXT NOT NULL DEFAULT 'submitted',
  reviewed_by INTEGER, reviewed_at TEXT, reject_reason TEXT, created_at TEXT NOT NULL);
CREATE TABLE dsc_cert (
  id INTEGER PRIMARY KEY, csca_key_id INTEGER REFERENCES csca_key(id),
  serial TEXT NOT NULL UNIQUE, subject_dn TEXT NOT NULL, asn INTEGER, mnt TEXT,
  source TEXT NOT NULL, cert_pem TEXT NOT NULL, key_ref TEXT, private_key_pem_enc TEXT,
  issuance_policy TEXT, application_url TEXT,
  status TEXT NOT NULL DEFAULT 'active', not_before TEXT, not_after TEXT,
  revoked_at TEXT, revoke_reason TEXT, created_at TEXT NOT NULL);

-- CRL / ML
CREATE TABLE crl (
  id INTEGER PRIMARY KEY, csca_key_id INTEGER REFERENCES csca_key(id),
  crl_number INTEGER NOT NULL, this_update TEXT NOT NULL, next_update TEXT NOT NULL,
  der BLOB NOT NULL, published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE master_list (
  id INTEGER PRIMARY KEY, signer_dsc_id INTEGER, der BLOB NOT NULL,
  published_at TEXT, created_at TEXT NOT NULL);

-- DSC 签名
CREATE TABLE sign_request (
  id INTEGER PRIMARY KEY, reference_hash TEXT NOT NULL UNIQUE,
  requester_account_id INTEGER REFERENCES account(id), asn INTEGER,
  ip TEXT, ip_asn INTEGER, dsc_selection TEXT NOT NULL, dsc_cert_id INTEGER REFERENCES dsc_cert(id),
  payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'submitted',
  delivery_mode TEXT NOT NULL DEFAULT 'applicant'
    CHECK(delivery_mode IN ('applicant','reviewer')),
  delivery_override INTEGER NOT NULL DEFAULT 0,
  profile_overrides TEXT,
  result_artifact_id INTEGER, email TEXT, mail_token_hash TEXT,
  reviewed_by INTEGER, reviewed_at TEXT,
  released_to INTEGER, consumed_at TEXT, consumed_by INTEGER, consumed_channel TEXT,
  regenerated_from INTEGER,
  created_at TEXT NOT NULL, expires_at TEXT);
-- 同一签发 AS 内证件号唯一（BAC 口令唯一性）
CREATE UNIQUE INDEX ux_sign_request_mrz
  ON sign_request(asn, json_extract(payload_json, '$.mrz.documentNumber'));
CREATE TABLE artifact (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL,
  size INTEGER, enc INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);

-- AS 管辖配置
CREATE TABLE as_config (
  asn INTEGER PRIMARY KEY, use_nia_dsc INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER, updated_at TEXT NOT NULL);

-- 系统设置（例如 dsc.delivery_mode = applicant|reviewer）
CREATE TABLE system_setting (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by INTEGER REFERENCES account(id),
  updated_at TEXT NOT NULL);

-- 签发字段默认值（DSC 管理员可编辑；审批可单请求覆盖）
CREATE TABLE issuing_profile (
  id INTEGER PRIMARY KEY, issuing_state TEXT NOT NULL DEFAULT 'UDN',
  issuing_authority TEXT, personalization_device TEXT, dg13_policy TEXT,
  endorsements_json TEXT, defaults_json TEXT,
  updated_by INTEGER REFERENCES account(id), updated_at TEXT NOT NULL);

-- 运营
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY, actor_account_id INTEGER, realm TEXT, action TEXT NOT NULL,
  target_type TEXT, target_id TEXT, ip TEXT, user_agent TEXT, detail TEXT,
  created_at TEXT NOT NULL);
CREATE TABLE mail_token (
  id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL, purpose TEXT NOT NULL,
  sign_request_id INTEGER, expires_at TEXT NOT NULL, used_at TEXT);

-- 两步领取：确认页 token 与消费 token 分离，防邮件预取
CREATE TABLE reveal_token (
  id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('confirm','consume')),
  sign_request_id INTEGER REFERENCES sign_request(id),
  expires_at TEXT NOT NULL, used_at TEXT);
CREATE TABLE job (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT, run_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT, created_at TEXT NOT NULL);
```

> 全部时间列使用 `YYYY-MM-DDTHH:MM:SSZ`。私钥绝不进 `dsc_cert.cert_pem` 之类的明文字段。

---

## 附录 D — API 草案

### 认证

- `GET  /auth/{realm}/login`、`GET /auth/{realm}/callback`、`POST /auth/{realm}/logout`
- `GET  /auth/{realm}/me`

### CSCA

- `POST /csca/applications`、`GET /csca/applications`、`GET /csca/applications/:id`
- `POST /csca/applications/:id/approve`、`POST /csca/applications/:id/reject`
- `POST /csca/certificates/:id/revoke`
- `GET  /csca/certificates`、`GET /csca/certificates/:id.(pem|der)`
- `GET  /csca/crl.(pem|der)`
- `POST /csca/keys/rollover`

### DSC Signing

- `POST /dsc/requests`
- `GET  /dsc/requests/:reference`（元数据，非破坏）
- `GET  /dsc/requests/:reference/preview`（masked 预览，非破坏）
- `POST /dsc/requests/:reference/reveal`（一次性领取；模式 B 下申请人 403）
- `POST /dsc/reveal/:token`（两步领取：confirm / consume）
- `GET  /dsc/requests`（登录用户 / 管理员）
- `POST /dsc/requests/:id/approve`、`POST /dsc/requests/:id/reject`（可带 delivery_mode 与签发字段覆盖）
- `POST /dsc/requests/:id/regenerate`（管理员，消费后重发）
- `POST /dsc/admin/requests/:id/reveal`（模式 B 管理员领取）
- `POST /dsc/requests/:reference/email`
- `GET/PUT /dsc/settings/delivery-mode`（DSC 管理员）
- `GET/PUT /dsc/settings/issuing-profile`（DSC 管理员）

### PKD

- `GET /pkd/certificates`、`GET /pkd/crls`、`GET /pkd/masterlists`
- `GET /pkd/objects/:id.(der|pem)`
- `GET /pkd/ldif`

### 配置

- `GET /api/config`（角色开关、可用 oauth provider、国家码）

---

## 附录 E — 风险与未决项

| #   | 项                             | 状态   | 处理                                                                                               |
| --- | ------------------------------ | ------ | -------------------------------------------------------------------------------------------------- |
| E1  | DSC 签名输入契约               | 已定   | 结构化字段；前端编码 DG2/DG5/DG7；DG3/DG4 上传已编码 BLOB；AA/CA 服务端生成                        |
| E2  | `as_config` 由 AS 管理员配置   | 已定   | 前端提供配置页（DSC realm 登录后）                                                                 |
| E3  | 国家码 `UDN` / `XD`            | 已定   | 全局常量                                                                                           |
| E4  | CSCA 在线私钥                  | 已定   | 信封加密 + 二次确认 + 审计；预留 HSM 适配                                                          |
| E5  | ECDSA 显式参数                 | 待定   | 默认 RSA；需要时再实现                                                                             |
| E6  | LDAP 只读实现（ldapjs 维护度） | 待定   | 以 LDIF+OpenLDAP 为主，只读 LDAP 为兼容层                                                          |
| E7  | 复用 generator 代码正确性      | 进行中 | M1.5.5 审计并记录 `AUDIT.md`                                                                       |
| E8  | 邮件可达性                     | 待定   | SPF/DKIM/DMARC + 重试                                                                              |
| E9  | 隐私与保留期                   | 待定   | M13 落地                                                                                           |
| E10 | DG3/DG4 编码归属               | 已定   | 用户上传 ISO 19794 已编码数据，服务端仅包外层并校验                                                |
| E11 | 预览 mask 字段清单             | 已定   | 掩码证件号/个人号/完整生日/地址电话邮箱/DG16 姓名；生物特征用占位                                  |
| E12 | 前端编码需安全上下文           | 已定   | 必须有 HTTPS/localhost；**不降级**                                                                 |
| E13 | LDS2 具体范围                  | 已定   | 默认空、申请者不输入；记录由管理员/后续授权终端写入                                                |
| E14 | 一次性领取 UX 边界             | 已定   | 预览非破坏；领取破坏并删除；仅管理员可重新生成                                                     |
| E15 | AA/CA 私钥外泄风险             | 已接受 | 本轮忽略；仅保留加密落盘/构建后删除/审计                                                           |
| E16 | 服务端填写字段可定制           | 已定   | `issuing_profile` 系统默认 + 审批单请求覆盖 + 审计                                                 |
| E17 | 委派 AS 评审越权/串号          | 已定   | DSC realm 按 `asn` 作用域隔离；仅本 AS 且委派 NIA DSC 的申请；仅审批，禁改全局设定；NIA 管理员全量 |

---

## 附录 F — 参考来源

- `reference/9303_p12_cons_en.pdf`（Doc 9303-12，第八版 2021）
- `reference/card42`（eMRTD 实现、`perso/emrtd/` 夹具、`docs/specs/emrtd/emrtd.md`）
- `reference/card42-perso-generator`（`src/domain/emrtd/*`、`docs/library-analysis.md`）
- ICAO Doc 9303-10（LDS，数据组 §4.7；本仓库未附带，采用 ICAO 官网第八版）
- ICAO PKD LDAP 路径与 schema（Keyfactor NPKD 文档、JMRTD certificates 页）
- dn42：OAuth `dn42` claim（`oauth.dn42`）、registry `mntner`/`aut-num`/`route` 对象

---

## 附录 G — 数据组 tag 速查（Doc 9303-10 §4.7）

| DG       | 外层       | 主要内层 tag                                                                                                                                                                                                     |
| -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DG1      | `61`       | `5F1F` MRZ                                                                                                                                                                                                       |
| DG2      | `75`       | `7F61{ 7F60{ A1 SBH, 5F2E } }`                                                                                                                                                                                   |
| DG3      | `63`       | `7F61{ 7F60{ A1, 5F2E/7F2E } }`（ISO 19794-2/-4）                                                                                                                                                                |
| DG4      | `76`       | `7F61{ 7F60{ A1, 5F2E/7F2E } }`（ISO 19794-6）                                                                                                                                                                   |
| DG5      | `65`       | `02` 数量、`5F40` 图像                                                                                                                                                                                           |
| DG7      | `67`       | `02` 数量、`5F43` 图像                                                                                                                                                                                           |
| DG8/9/10 | `68/69/6A` | 未定义/专有（暂不支持）                                                                                                                                                                                          |
| DG11     | `6B`       | `5C`、`5F0E` 全名、`A0{02,5F0F}` 别名、`5F10` 个人号、`5F2B` 完整生日、`5F11` 出生地、`5F42` 地址、`5F12` 电话、`5F13` 职业、`5F14` 头衔、`5F15` 摘要、`5F16` 公民证明图像、`5F17` 其他旅行证件、`5F18` 监护信息 |
| DG12     | `6C`       | `5C`、`5F19` 签发机关、`5F26` 签发日期、`A0{02,5F1A}` 其他人、`5F1B` 备注、`5F1C` 税务/出境、`5F1D` 正面图像、`5F1E` 背面图像、`5F55` 个性化时间、`5F56` 个性化设备序列号                                        |
| DG13     | `6D`       | 发行国自定义                                                                                                                                                                                                     |
| DG14     | `6E`       | SecurityInfos（见 §4.7.14.2）                                                                                                                                                                                    |
| DG15     | `6F`       | SubjectPublicKeyInfo（Doc 9303-11 §6.1.5）                                                                                                                                                                       |
| DG16     | `70`       | `02` 数量、`A1…{5F50,5F51,5F52,5F53}`                                                                                                                                                                            |

> 以上 tag/结构在各 DG 构建器实现时**仍须逐条对照 Doc 9303-10 §4.7 对应小节**（记入 `AUDIT.md`）。
