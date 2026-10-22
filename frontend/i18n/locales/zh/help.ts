/**
 * 帮助页中文文案。按角色给出名称、一句话说明，以及贯穿本系统与周边 eMRTD
 * 工具链（applet 安装、个性化、自建签名、边检验证……）的端到端流程。
 */
export default {
  title: '使用指南',
  subtitle: '选择与您相符的角色，查看对应的端到端流程。',
  intro:
    'ePass 42 覆盖证件的完整生命周期：签名证书、个性化与边检验证。标注「在本系统」的步骤在本站完成，其余步骤使用您自己的工具完成。',
  related: '前往',
  notSureTitle: '不确定自己属于哪种角色？',
  notSureBody: '任何人都无需登录即可浏览公开的 PKD 目录，并查询某个证件是否已被吊销。',
  tag: {
    system: '在本系统',
    external: '系统外',
  },
  roles: {
    applicant: {
      name: '证件持有人',
      tagline: '申请用于制作您证件的个性化文件，审核通过后一次性领取。',
    },
    reviewer: {
      name: '审核人员',
      tagline: '审核并决定本机构的个性化申请。',
    },
    certApplicant: {
      name: '文档签名者',
      tagline: '为您的机构申请文档签名（DSC）证书，用于签署证件。',
    },
    certAdmin: {
      name: '证书管理员',
      tagline: '审批申请、签发与吊销证书，并发布吊销列表（CRL）。',
    },
    cvca: {
      name: '文档验证者',
      tagline: '为您的机构申请文档验证者证书。',
    },
    terminal: {
      name: '检查系统',
      tagline: '为检查系统申请终端证书，以读取或写入受保护的数据。',
    },
    cvcaAdmin: {
      name: 'LDS2 证书管理员',
      tagline: '审核文档验证者与终端申请、管理委派并发布证书。',
    },
    selfHosted: {
      name: '自建签名服务',
      tagline: '以 DSC-only 模式部署自有服务，使用本维护者自己的证书签署证件。',
    },
    personalization: {
      name: '个性化操作员',
      tagline: '在卡片上安装 eMRTD applet，并写入个性化数据。',
    },
    verifier: {
      name: '验证终端',
      tagline: '在边检使用 PKD 已发布的数据验证证件。',
    },
    public: {
      name: '公众查询者',
      tagline: '浏览已发布的内容，并查询证件是否已被吊销。',
    },
  },
  flows: {
    applicant: {
      summary: '您在本站申请用于制作证件的个性化文件。审核通过后，您仅可领取一次。',
      steps: {
        s1: {
          title: '登录',
          body: '使用 dn42 账号登录证件个性化业务。',
        },
        s2: {
          title: '填写证件信息',
          body: '请填写您的信息：姓名、证件号码、出生日期与性别。',
        },
        s3: {
          title: '上传照片',
          body: '请将近期照片裁剪为 4:5 的竖版人像。',
        },
        s4: {
          title: '补充可选信息',
          body: '可选填：证件访问密码、签名或显示图像、附加资料以及紧急联系人。',
        },
        s5: {
          title: '等待审核',
          body: '审核人员会核对您提交的内容，并批准或驳回。',
        },
        s6: {
          title: '一次性领取',
          body: '领取前可以先预览。领取不可撤销且只能进行一次，请妥善保存下载的文件。',
        },
      },
    },
    reviewer: {
      summary: '您负责决定本机构的个性化申请。详情页会展示未脱敏的提交数据。',
      steps: {
        s1: {
          title: '登录',
          body: '登录证件个性化业务。',
        },
        s2: {
          title: '打开审核队列',
          body: '审核队列列出您可以处理的申请。',
        },
        s3: {
          title: '打开申请',
          body: '详情页向审核员展示未脱敏的提交数据，并显示申请人与交付信息。',
        },
        s4: {
          title: '批准或驳回',
          body: '批准即放行制作，驳回需填写原因。您还可以针对这一条申请覆盖交付方式。',
        },
        s5: {
          title: '交付',
          body: '在「由工作人员制作」的交付方式下，从「待制作」队列生成文件并交付给申请人。',
        },
      },
    },
    certApplicant: {
      summary: '文档签名（DSC）证书用于机构签署证件数据。您在此申请，通过后证书会发布到 PKD。',
      steps: {
        s1: {
          title: '登录',
          body: '使用 dn42 账号登录证书业务。',
        },
        s2: {
          title: '填写申请',
          body: '先选择证书类型（文档签名者或 LDS2 签名者），再填写通用名（CN）；DSC 还需机构（O）与可选的部门（OU），以及证件类型或 LDS2 角色、有效期与签发策略，以及您申请页面的网址。',
        },
        s3: {
          title: '选择密钥模式',
          body: '可由 NIA 生成密钥对，或上传 CSR / 公钥（SPKI PEM）。上传模式下私钥始终留在您手中。',
        },
        s4: {
          title: '领取结果',
          body: '通过后证书可以 PEM/DER 下载。由 NIA 生成的私钥仅可下载一次，下载后立即删除。',
        },
        s5: {
          title: '签署证件',
          body: '使用 DSC（配合您的签名服务或自建的 DSC-only 部署）为每份证件生成 EF.SOD 与个性化文件；LDS2 签名者用于签署旅行盖章、签证或追加生物特征等 LDS2 数据对象。',
        },
        s6: {
          title: '发布',
          body: '证书、其吊销列表与主列表会出现在公开的 PKD 目录中，供验证终端构建信任链。',
        },
      },
    },
    certAdmin: {
      summary:
        '您负责证书颁发机构：审核申请、签发与吊销证书、刷新 CRL、轮换 CSCA 密钥并发布主列表。',
      steps: {
        s1: {
          title: '以管理员身份登录',
          body: '管理员权限来自配置的维护者名单，或身份自身的 MNT，并按业务域分别校验。',
        },
        s2: {
          title: '审核申请',
          body: '打开申请，核对其主体与密钥材料，然后批准（在线签发证书）或填写原因驳回。',
        },
        s3: {
          title: '管理证书',
          body: '可随时在证书登记中吊销证书；吊销会自动重新生成 CRL。',
        },
        s4: {
          title: '发布 CRL',
          body: 'CRL 以 PEM/DER 提供，按配置的调度刷新，并在证书被吊销时立即重生成。',
        },
        s5: {
          title: '轮换 CSCA 密钥',
          body: '以管理员身份轮换 CSCA 密钥；链接（Link）证书把新密钥与旧密钥相连，保证信任不中断。',
        },
        s6: {
          title: '发布主列表',
          body: '以管理员身份生成 CSCA 主列表；它会发布到 PKD。',
        },
      },
    },
    cvca: {
      summary:
        '文档验证者证书让您的机构可以读取或写入电子证件上的受保护数据。您在此申请，管理员批准后即签发。',
      steps: {
        s1: {
          title: '登录',
          body: '使用 dn42 账号登录验证业务。',
        },
        s2: {
          title: '申请证书',
          body: '填写名称、选择密钥方式，并选择机构需要读取或写入的数据。',
        },
        s3: {
          title: '审核',
          body: '管理员核对申请，并可在批准前进行调整。',
        },
        s4: {
          title: '领取证书',
          body: '批准后即签发证书。若密钥由服务端生成，请一次性下载并妥善保存。',
        },
        s5: {
          title: '发布',
          body: '证书会出现在 PKD 中，供终端核对其权限。',
        },
      },
    },
    terminal: {
      summary:
        '终端证书让检查系统可以读取或写入电子证件上的受保护数据。您为机构提出申请，管理员批准后即签发。',
      steps: {
        s1: {
          title: '登录',
          body: '使用 dn42 账号登录终端证书业务。',
        },
        s2: {
          title: '申请证书',
          body: '填写名称、选择密钥方式，并选择该系统需要读取或写入的数据。',
        },
        s3: {
          title: '审核',
          body: '管理员核对申请，并可在批准前进行调整。',
        },
        s4: {
          title: '领取结果',
          body: '批准后即签发证书；若密钥由服务端生成，请一次性下载并妥善保存。',
        },
        s5: {
          title: '安装使用',
          body: '把证书与密钥装入检查系统，它便能按机构被允许的范围读取或写入数据。',
        },
      },
    },
    cvcaAdmin: {
      summary:
        '您负责 LDS2 授权 PKI：CVCA 签发卡片可验证的 DV 证书，DV 再签发终端证书。您审核申请并维护已发布的授权链。',
      steps: {
        s1: {
          title: '以管理员身份登录',
          body: '管理员权限来自配置的维护者名单或身份自身的 MNT，并按业务域分别校验。',
        },
        s2: {
          title: '审核 DV 申请',
          body: '打开 DV 申请，核对主体与所申请的授权，必要时调整 DV 类别或权限，然后批准或驳回。',
        },
        s3: {
          title: '审核终端申请',
          body: '终端申请由终端业务的审核员处理；签发的授权会收敛到签发 DV 自身的授权。',
        },
        s4: {
          title: 'DV 委派',
          body: '每个机构自行选择其终端由 CVCA 默认 DV 签署，还是由自己的已批准 DV 签署。',
        },
        s5: {
          title: '轮换 CVCA 密钥',
          body: '以管理员身份轮换 CVCA 密钥；链接证书把新密钥与旧密钥相连，保证信任不中断。',
        },
        s6: {
          title: '发布',
          body: 'CVCA 与 DV 证书会出现在 PKD 中，供终端构建授权信任链。',
        },
      },
    },
    selfHosted: {
      summary:
        '维护者可以使用自己的文档签名证书运行自有签名服务，而 NIA 服务仍作为 PKD 与 CSCA 的权威。',
      steps: {
        s1: {
          title: '取得 DSC 证书',
          body: '在此申请证书，或用您自己的 CSCA 签发一张。请保留服务用于签署的私钥。',
        },
        s2: {
          title: '部署 DSC-only 实例',
          body: '只启用个性化角色，使该实例注册签名路由，而不运行证书或目录角色。',
        },
        s3: {
          title: '配置您的实例',
          body: '只启用个性化角色，并在 config.toml 中设置您自己的登录提供方与签发字段。PKD 与 CSCA 仍由 NIA 服务负责。',
        },
        s4: {
          title: '声明使用自有证书',
          body: '在 NIA 服务上将本维护者标记为使用自有证书。此后来自您网络的申请人会被引导到您的服务，但仍可选择使用 NIA 证书。',
        },
        s5: {
          title: '签署并发布',
          body: '处理个性化申请并交付，同时把您的证书与吊销列表发布到公开的 PKD，使验证终端能够构建信任链。',
        },
      },
    },
    personalization: {
      summary:
        '个性化文件只有在 eMRTD applet 安装到芯片、并写入数据组与安全对象之后，才会变成可用的证件。',
      steps: {
        s1: {
          title: '获取 applet',
          body: '构建 card42 eMRTD applet 及其共享 Java Card 库，得到可供加载的 CAP。',
        },
        s2: {
          title: '安装 applet',
          body: '用 GlobalPlatformPro 加载 CAP，并以 CardReset 权限创建 LDS1 实例，使其默认被选中，且其主文件（EF.CardAccess/CardSecurity）可被读取。',
        },
        s3: {
          title: '领取个性化文件',
          body: '从 ePass 42 领取个性化文件。它包含您提交的数据组，以及 EF.CardAccess、EF.CardSecurity 与 EF.SOD，且仅可领取一次。',
        },
        s4: {
          title: '个性化卡片',
          body: '通过 STORE DATA 下发 DGI 序列；applet 会逐块增量应用：BAC 种子、主动认证与芯片认证密钥、PACE 种子、CAN 以及各文件。',
        },
        s5: {
          title: '读回并验证',
          body: '用主机 CLI 读卡，并对照 PKD 数据执行被动认证、主动认证与芯片认证，验证通过后才能发证。',
        },
        s6: {
          title: '交付证件',
          body: '仅在验证通过后，才把实体证件交付给持有人。',
        },
      },
    },
    verifier: {
      summary:
        '只有签名链、数据组哈希与吊销状态都对照已发布的 PKD 数据校验通过，验证终端才会信任这张芯片。',
      steps: {
        s1: {
          title: '获取可信数据',
          body: '从 PKD 以 DER/PEM 下载 CSCA 证书、CRL 与主列表，或将 LDIF 导入 LDAP 服务器。',
        },
        s2: {
          title: '构建信任链',
          body: '验证主列表签名，然后将文档签名证书逐级校验到受信任的 CSCA，并确认其未被吊销。',
        },
        s3: {
          title: '读取芯片',
          body: '用基本访问控制（MRZ）或 PACE（MRZ 或 CAN）建立会话，随后读取 DG1、DG2 与 EF.SOD；若存在，也读取 EF.CardAccess / EF.CardSecurity。',
        },
        s4: {
          title: '被动认证',
          body: '用 DSC 验证 EF.SOD 的 CMS 签名，把其链接到 CSCA，并将读到的每个数据组与安全对象中存储的哈希逐一比对。',
        },
        s5: {
          title: '主动认证与芯片认证',
          body: '可选：用 DG15 进行主动认证挑战，并用 EF.CardSecurity 执行芯片认证，确认应答的是真实芯片而非复制品。',
        },
        s6: {
          title: '吊销查询',
          body: '对规范 MRZ 字段（证件类型、签发国、证件号码与出生日期）计算哈希，并与已发布的吊销证件哈希比对。',
        },
      },
    },
    public: {
      summary: '无需登录：浏览所有已发布的内容，并查询证件是否被吊销。',
      steps: {
        s1: {
          title: '浏览目录',
          body: 'PKD 目录列出已发布的签名与验证证书、其吊销列表与主列表。',
        },
        s2: {
          title: '下载与验证',
          body: '以 DER 或 PEM 下载任意对象，并使用标准 PKI 工具验证。',
        },
        s3: {
          title: '导入 LDAP',
          body: '如需将目录加载到自己的 LDAP 服务器，可下载 LDIF 导出。',
        },
        s4: {
          title: '查询证件',
          body: '输入证件类型、签发国、证件号码与出生日期，即可查询该证件是否已被吊销。',
        },
      },
    },
  },
  links: {
    applicant: {
      apply: '申请个性化文件',
      mine: '我的申请',
    },
    reviewer: {
      queue: '审核队列',
    },
    certApplicant: {
      apply: '申请证书',
      mine: '我的申请',
    },
    certAdmin: {
      certificates: '证书登记',
      audit: '审计日志',
    },
    cvca: {
      apply: '申请 DV 证书',
      certificates: 'DV 证书',
    },
    terminal: {
      apply: '申请终端证书',
      mine: '我的申请',
    },
    cvcaAdmin: {
      applications: 'CVCA 管理',
      terminal: '终端申请',
      audit: '审计日志',
    },
    selfHosted: {
      certApply: '申请 DSC 证书',
      settings: '签名设置',
    },
    personalization: {
      directory: 'PKD 目录',
    },
    verifier: {
      directory: 'PKD 目录',
    },
    public: {
      directory: 'PKD 目录',
    },
  },
} as const
