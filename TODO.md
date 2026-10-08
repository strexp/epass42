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

| 里程碑 | 内容                                                                                     | 状态   |
| ------ | ---------------------------------------------------------------------------------------- | ------ |
| M0     | 仓库脚手架（pnpm workspace、ESLint/Prettier、CI、`packages/shared`）                     | 完成   |
| M1     | `packages/pki` 内核（X.509/CRL/CMS/SOD/CardSecurity/MasterList/DG1–DG16/MRZ/perso/验证） | 完成   |
| M2     | `scripts/gen-csca` + `scripts/verify`                                                    | 完成   |
| M3     | 后端骨架（Fastify + zod/OpenAPI + SQLite/Drizzle + 配置/日志/健康检查）                  | 完成   |
| M4     | 双 realm OAuth + 会话 + MNT 授权（含委派 AS 评审）                                       | 完成   |
| M5     | CSCA 角色（DSC 申请/审核/签发/吊销/轮换）                                                | 完成   |
| M6     | CRL 生成与调度                                                                           | 完成   |
| M7     | DSC Signing Service（结构化请求 → DG/AA/CA/SOD/perso）                                   | 完成   |
| M8     | 交付（masked 预览 / 一次性领取 / 邮件 / 历史 / 交付模式）                                | 完成   |
| M9     | PKD 角色（REST + LDIF + 只读 LDAP）                                                      | 完成   |
| M10    | CSCA Master List                                                                         | 完成   |
| M11    | 前端（Nuxt 4 + Naive UI）                                                                | 完成   |
| M12    | 单角色模式（各 AS 自建 DSC）                                                             | 待办   |
| M13    | 安全加固、审计、限流、加密落盘                                                           | 部分   |
| M14    | 测试与交叉验证                                                                           | 进行中 |
| M15    | 部署、文档、发布                                                                         | 待办   |

---

## 2. 已完成里程碑（M0–M11）摘要

> 详细过程见 git 提交；本节仅记录关键实现、验收方式与遗留项。未完成项集中在 M12–M15。

### M0 仓库脚手架

- pnpm workspace（`packages/*`、`backend`、`scripts`、`frontend`）、ESLint flat + Prettier、TS 5.9、CI（`pnpm check` = format + lint + typecheck + test）。
- `packages/shared`：`COUNTRY_ALPHA2='XD'`/`COUNTRY_ALPHA3='UDN'`、OID 表、错误码、zod schema（MRZ/DG/security/signRequest/claim 等）。

### M1 `packages/pki`

- X.509：`createCscaRoot`/`createDsc`/`createCscaLink`/`createMasterListSigner`，含 `PrivateKeyUsagePeriod`、`DocumentType`、`directoryName` SAN/IAN；RSA-PSS 与 PKCS#1 v1.5。**ECDSA 未实现**（默认 RSA）。
- CRL（v2、AKI、cRLNumber，无 delta/IDP/条目级扩展）、CMS SignedData / EF.SOD(`77`) / EF.CardSecurity、CSCA Master List。
- 数据组 DG1–DG16（DG3/DG4 外层包装）、TD3 MRZ、SecurityInfo/EF.CardAccess、perso 脚本、验证（`verifySod`/`verifyDscAgainstCsca`/`validateCertProfile`）。
- `AUDIT.md` 记录与 Doc 9303-10/11/12 的逐条对照；修正了 pkijs eContent 双重 OCTET STRING、多字节 TLV constructed 位、card42 样例复合校验位等问题。

### M2 脚本

- `gen-csca`（加密 PKCS#8、PEM/DER/JSON、CRL DP）、`verify`（cert/chain/crl/sod/ml）、`gen-csca-openssl.sh`；scripts 端到端签发 DSC 并 `openssl verify`。

### M3 后端骨架

- Fastify + `fastify-type-provider-zod` + OpenAPI；zod 校验的 `config.toml`（唯一配置来源，不读环境变量）；better-sqlite3（WAL/FK/busy_timeout）+ Drizzle 迁移；pino + request id；`/healthz`、`/readyz`；优雅关闭、自动迁移。

### M4 认证与授权

- 双 realm 完全隔离（cookie/session/CSRF）；`openid-client`（PKCE/state/nonce）；每个 provider 可配 `alias`，callback 路径带别名 `/auth/{realm}/callback/{alias}`；dn42 claim 映射与预填；`CSCA_ADMIN_MNTS`/`DSC_ADMIN_MNTS` 鉴权；CORS（分域部署）、防 CSRF/开放重定向/SSRF。
- 委派 AS 评审：`as_config.use_nia_dsc`（缺省即 NIA）+ `maintainer`(role=`as-admin`)；只能看/审本 AS 且委派 NIA 的申请，禁改全局设定；NIA 管理员全量。`GET/PUT /csca/settings/as` 查看与切换（无 active DSC 时禁止切到自有）。

### M5 CSCA 角色

- 在线 CSCA（私钥 KEK 信封加密；`<dataDir>/kek` 持久化 + 旧 KEK 回退）；DSC 申请/审核/在线签发（`nia_generated` / `user_uploaded` CSR/SPKI）/吊销/轮换+Link；证书 PEM/DER/指纹。
- **NIA 生成私钥仅可下载一次**（下载即删除，`key_mode` 区分上传/已消费）。

### M6 CRL

- 单调 `crlNumber`、调度（none/revocation/max-age/refresh）、每小时调度器、`GET /csca/crl.(pem|der)`；吊销即重生成。

### M7 DSC Signing Service

- 结构化请求（无裸 hex）；服务端权威 DG1（issuing state / nationality / 到期日由 settings 计算）。
- DG2 结构校验 + **16 KiB 上限**（`issuing.dg2MaxBytes`，超限 `413 dg2_too_large`）；DG3/DG4 包装；DG5/DG7；DG11/DG12（发证机构/签发日期/背书由服务端填充）/DG13/DG14/DG15/DG16。
- 安全机制（PACE/CA/AA）与 DSC 选择为**管理员默认 + 服务端推导**，申请者不配置；服务端生成 AA(RSA-2048)/CA(P-256)，EF.CardAccess/DG14、EF.CardSecurity；EF.SOD 自检；`.perso` 产物（AA/CA 私钥仅存在于产物）。
- 可选输出**默认空的 LDS2 应用**（`issuing.lds2`，默认关闭）：按 Travel/Visa/Additional Biometrics 生成空应用段，附 PACE+CA 的 EF.CardAccess/EF.CardSecurity 与 CA 标量；CardAccess/Security/CA 位于 Master File，各角色共享同一份。记录/透明 EF 仍为空，留待 M12+。
- 提交前按登录 ASN 或 IP 路由表（`jurisdiction.routes`）判定管辖；若该 AS 使用自有 DSC 则提示并引导（可忽略继续用 NIA）。

### M8 交付

- masked 非破坏预览、原子一次性领取（重复 `410`、`Cache-Control: no-store`）、交付模式 A/B + 待制作队列、重新生成。
- `/dsc/settings`：delivery mode、issuing profile、security 默认值、DG2 上限（仅 NIA 管理员）。
- 邮件两步链接（confirm token 非消费）；登录用户可按 id 查看状态/预览/领取。

### M9 / M10 PKD 与 Master List

- PKD REST（`/pkd/certificates|crls|masterlists|objects/:id.:format|ldif`）、LDIF、只读 LDAP（ldapjs，仅 Bind/Search）、OpenLDAP schema/slapd 示例。
- ML Signer（EKU `2.23.136.1.1.3`）、`POST /pkd/masterlists`、发布与 LDIF；pkijs 与 `openssl cms -verify` 双验证。

### M11 前端（Nuxt 4 SPA + Naive UI）

- Pinia、`@nuxtjs/i18n`（en，全部文案走 key）、暗色模式；跨源 API 客户端 + 错误码映射。
- 页面：CSCA（申请 / 我的与管理申请 / 证书与 CRL / AS 委派切换）；DSC（傻瓜化申请表单、状态查询 + masked 预览 + 一次性领取、管理审核 / 待制作 / 设置）；PKD 浏览 + LDIF。
- 多 provider 时下拉选择登录别名；按 realm 展示会话。
- 申请端：服务端填写项（issuing authority/date/endorsements、nationality、expiry、security、DSC 选择）不出现在表单；照片在浏览器裁切并无损压缩到 ~15 KB。

### 交叉验证（M14 部分）

- **card42 宿主侧**：pkd42 生成的 EF.SOD 通过 card42 `PassiveAuthentication`（DSC 链 + 签名 + DG 哈希），CardAccess/CardSecurity 解析正确。
- **card42 模拟器**：用 pkd42 构建器（card42 CSCA/DSC、样例 MRZ、合规 DG2）生成 perso，`make test-emrtd` 的 `EmrtdBacTest` + `EmrtdPaceIntegrationTest` 全绿（BAC/SM/AA/PA/PACE 3DES+AES）。
- **card42 LDS2**：启用 `issuing.lds2` 的产物被 card42 `EmrtdPersoExporter` 正确解析（FF03 CA 标量 + 011C/011D），Travel 应用可建 PACE、读出 CardAccess/CardSecurity。card42 `EmrtdLds2*` 套件按样例假定存在记录，对“默认空”不适用；其 `EmrtdChipAuthIntegrationTest` 在本机对样例 perso 亦不稳定（环境相关）。

### 已知遗留

- LDS2 记录/透明 EF 写入（空应用已实现；记录留待管理员/授权终端，见 M12+）。
- ECDSA（显式 ECParameters）证书。
- 真实 dn42 IP→AS 管辖自动同步（现为静态路由表）。

> 注：LDS1 仅 PACE + AA（card42 LDS1 不支持 CA），CA 只在 LDS2 上启用；该问题已按此约定实现。

## 14. M12 — 单角色模式（各 AS 自建）

- [ ] T12.1 配置 `ROLES=pkd,csca,dsc`（子集可启用）。
- [ ] T12.2 未启用角色不注册路由/不跑迁移/不在 UI 出现。
- [ ] T12.3 DSC-only 模式：配置 NIA 的 PKD/CSCA 端点、本 AS 的 DSC 证书凭据（自有 DSC）、本 AS OAuth。
- [ ] T12.4 文档：AS 自建流程（申请 DSC → 部署 DSC-only → 配置）。

---

## 15. M13 — 安全、审计、加密

- [ ] T13.1 私钥加密落盘：信封加密（KEK 来自 config.toml/文件，AES-256-GCM），`key_ref` 不落明文。
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
- [x] T14.10 LDS2 默认空测试；`issuing_profile` 默认值与审批覆盖测试。
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
  issuer TEXT NOT NULL, client_id TEXT NOT NULL,
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
  mnt TEXT NOT NULL, realm TEXT NOT NULL, role TEXT NOT NULL, asn INTEGER, note TEXT,
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
  source TEXT NOT NULL, cert_pem TEXT NOT NULL, key_ref TEXT,
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
  ip TEXT, dsc_selection TEXT NOT NULL, dsc_cert_id INTEGER REFERENCES dsc_cert(id),
  payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'submitted',
  delivery_mode TEXT NOT NULL DEFAULT 'applicant'
    CHECK(delivery_mode IN ('applicant','reviewer')),
  profile_overrides TEXT,
  result_artifact_id INTEGER, email TEXT,
  reviewed_by INTEGER, reviewed_at TEXT,
  consumed_at TEXT, consumed_by INTEGER, consumed_channel TEXT,
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
