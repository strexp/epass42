/**
 * 帮助页中文文案。按当前已实现的业务域划分角色，并给出各角色在本系统及
 * 周边 eMRTD 工具链（applet 安装、个性化、终端认证、边检验证……）中的
 * 办事流程。
 */
export default {
  title: '使用指南',
  subtitle: '请选择与您相符的角色，查看对应的办事流程。',
  intro:
    'ePass 42 提供签名证书、验证证书、终端证书、证件个性化与公开目录等业务。标注「在本系统」的步骤在本站完成，其余步骤使用您自己的工具完成。',
  related: '前往',
  notSureTitle: '不确定自己属于哪种角色？',
  notSureBody:
    '任何人都无需登录即可浏览公开的 PKD 目录，并查询某个证件是否已被吊销；如需办理具体业务，请根据您所在的机构与业务域选择相应角色。',
  tag: {
    system: '在本系统',
    external: '系统外',
  },
  roles: {
    applicant: {
      name: '证件持有人',
      tagline: '为本人申请护照或身份证件的个性化文件，并在审核通过后一次性领取。',
    },
    reviewer: {
      name: '个性化审核人员',
      tagline: '审核本机构或本维护者的证件个性化申请，并按规定交付制作结果。',
    },
    dscAdmin: {
      name: '个性化系统管理员',
      tagline: '维护证件个性化业务的签发参数、交付方式与 NIA 文档签名证书。',
    },
    certApplicant: {
      name: '签名证书申请人',
      tagline: '为机构申请文档签名（DSC）或 LDS2 签名证书，用于签署证件或 LDS2 数据。',
    },
    certAdmin: {
      name: '签名证书管理员',
      tagline: '负责 CSCA 的申请审核、证书签发与吊销、CRL 发布及密钥轮换。',
    },
    cvca: {
      name: '验证证书申请人',
      tagline: '为机构申请文档验证者（DV）证书，用于签发终端证书并授权读取或写入证件数据。',
    },
    cvcaAdmin: {
      name: '验证证书管理员',
      tagline: '负责 CVCA 的 DV 申请审核、授权调整、委派设置及密钥轮换。',
    },
    terminal: {
      name: '终端证书申请人',
      tagline: '为检查系统申请终端证书，用于在终端认证中读取或写入受保护数据。',
    },
    dvAdmin: {
      name: '终端证书管理员',
      tagline: '审核本业务域的终端证书申请，并维护 NIA 文档验证者及其有效期。',
    },
    mlAdmin: {
      name: '主列表管理员',
      tagline: '管理主列表签名者并发布 CSCA 主列表。',
    },
    personalization: {
      name: '个性化操作员',
      tagline: '在芯片上安装 eMRTD applet，写入个性化数据并完成读回验证。',
    },
    verifier: {
      name: '验证终端',
      tagline: '在边检等场景验证证件签名链、数据完整性与吊销状态。',
    },
    public: {
      name: '公众查询者',
      tagline: '无需登录，浏览已发布证书与吊销列表，并查询证件是否被吊销。',
    },
  },
  flows: {
    applicant: {
      summary:
        '您在本站提交本人证件信息与照片，经审核通过后领取用于制证的个性化文件。同一时间仅保留一份有效证件；新申请获批后，原证件自动失效。',
      steps: {
        s1: {
          title: '登录',
          body: '使用 dn42 账号登录证件个性化业务。',
        },
        s2: {
          title: '填写证件信息',
          body: '按证件类型填写姓名、证件号码、出生日期、性别等必填项；签发国与国籍由系统按配置填写。',
        },
        s3: {
          title: '上传照片',
          body: '上传近期证件照，并在浏览器中裁剪为竖版人像；照片会按配置压缩。',
        },
        s4: {
          title: '补充信息',
          body: '可选填证件访问密码（CAN）、签名或显示图像、附加资料及紧急联系人。',
        },
        s5: {
          title: '等待审核',
          body: '审核人员核对提交内容后予以批准或驳回；驳回时将注明原因。',
        },
        s6: {
          title: '预览并领取',
          body: '批准后可先预览，再一次性领取个性化文件。领取不可撤销，请妥善保存。',
        },
      },
    },
    reviewer: {
      summary:
        '您负责本机构证件个性化申请的审核与交付。详情页展示未脱敏的申请信息；您可批准、驳回，或按需调整交付方式。',
      steps: {
        s1: {
          title: '登录',
          body: '使用 dn42 账号登录证件个性化业务。',
        },
        s2: {
          title: '打开审核队列',
          body: '审核队列列出您有权处理的申请；委派审核人员仅能看到本维护者的申请。',
        },
        s3: {
          title: '核对申请',
          body: '详情页展示未脱敏的证件信息、照片、联系方式与交付方式，请逐项核对。',
        },
        s4: {
          title: '批准或驳回',
          body: '批准后进入制作环节；驳回须填写原因。您可对单条申请调整交付方式。',
        },
        s5: {
          title: '交付',
          body: '在「由工作人员制作」模式下，从待制作队列生成文件并交付申请人；交付记录可在申请详情中查阅。',
        },
      },
    },
    dscAdmin: {
      summary:
        '您负责证件个性化业务的运行参数、交付方式与 NIA 文档签名证书。可调整签发档案、安全机制与 LDS2 应用，并在证书到期前轮换 NIA DSC。',
      steps: {
        s1: {
          title: '以管理员身份登录',
          body: '管理员权限来自配置的维护者名单，按业务域校验。',
        },
        s2: {
          title: '维护签发档案',
          body: '在设置页维护签发机构、个性化设备、DG13 策略、证件有效期与 DG2 大小上限。',
        },
        s3: {
          title: '配置安全选项',
          body: '按需启用 LDS2 应用，并设置 PACE、主动认证、芯片认证与终端认证等默认选项。',
        },
        s4: {
          title: '选择交付方式',
          body: '选择由申请人自助领取，或由工作人员统一制作交付。',
        },
        s5: {
          title: '管理 NIA DSC',
          body: '在首页底部的证书信息卡查看 NIA DSC 的证书与私钥有效期；到期前轮换 NIA DSC，必要时先轮换 CSCA。',
        },
        s6: {
          title: '查阅审计',
          body: '审计日志记录申请、审核、签发与轮换等操作，供追溯。',
        },
      },
    },
    certApplicant: {
      summary:
        '您在本站提交签名证书申请，经 CSCA 管理员审核后签发。DSC 的证书与私钥有效期分别管理；由服务端生成的私钥仅可下载一次。',
      steps: {
        s1: {
          title: '登录',
          body: '使用 dn42 账号登录签名证书业务。',
        },
        s2: {
          title: '填写申请',
          body: '选择证书类型：DSC 或 LDS2 签名者。DSC 需填写通用名、证件类型与有效期，并可填写机构与部门；LDS2 签名者需填写通用名、角色与有效期，并可填写签发策略与申请页面地址。',
        },
        s3: {
          title: '选择密钥方式',
          body: '可由服务端生成密钥对，或上传 CSR / 公钥（SPKI PEM）。上传方式下私钥始终由您保管。',
        },
        s4: {
          title: '等待审核',
          body: 'CSCA 管理员核对主体、密钥材料与授权范围后批准或驳回。',
        },
        s5: {
          title: '领取证书',
          body: '批准后可下载 PEM/DER 证书；服务端生成的私钥仅可下载一次，下载后即删除。证书会发布到公开 PKD。',
        },
        s6: {
          title: '使用证书',
          body: '使用 DSC 为证件生成 EF.SOD 与个性化文件；LDS2 签名者用于签署旅行盖章、电子签证或追加生物特征等 LDS2 数据。',
        },
      },
    },
    certAdmin: {
      summary:
        '您负责签名证书颁发机构的日常运行：审核申请、签发与吊销证书、发布 CRL、维护委派并轮换 CSCA 密钥。主列表由独立的主列表管理员发布。',
      steps: {
        s1: {
          title: '以管理员身份登录',
          body: '管理员权限来自配置的维护者名单，按业务域校验。',
        },
        s2: {
          title: '审核申请',
          body: '核对主体、密钥材料、证件类型或 LDS2 角色及有效期，批准后在线签发证书。',
        },
        s3: {
          title: '管理证书',
          body: '在证书登记中查看证书与私钥有效期，按需吊销；吊销后系统自动重新生成 CRL。',
        },
        s4: {
          title: '发布 CRL',
          body: 'CRL 以 PEM/DER 提供，按配置周期刷新，并在证书吊销后立即更新。',
        },
        s5: {
          title: '维护委派',
          body: '在首页设置维护者使用 NIA DSC 还是其自有证书；仅当自有证书有效时方可切换。',
        },
        s6: {
          title: '轮换 CSCA',
          body: '在首页底部的证书信息卡执行轮换。系统签发链接证书连接新旧密钥；证书或私钥到期后，签发与 CRL 签名将暂停。',
        },
      },
    },
    cvca: {
      summary:
        '您在本站提交文档验证者（DV）证书申请，经 CVCA 管理员审核后签发。证书有效期不超过 92 天；服务端生成的私钥仅可下载一次。',
      steps: {
        s1: {
          title: '登录',
          body: '使用 dn42 账号登录验证证书业务。',
        },
        s2: {
          title: '填写申请',
          body: '填写通用名与持有者助记符，选择 DV 类别（国内或国外）、授权范围与有效期，并可填写申请页面地址与备注。',
        },
        s3: {
          title: '选择密钥方式',
          body: '可由 CVCA 生成密钥对，或上传 CSR / 公钥（SPKI PEM）。',
        },
        s4: {
          title: '等待审核',
          body: 'CVCA 管理员核对主体与授权范围，可在批准前调整 DV 类别或权限。',
        },
        s5: {
          title: '领取证书',
          body: '批准后可下载 DER 证书；服务端生成的私钥仅可下载一次。证书会发布到 PKD，DV 可用其签发终端证书。',
        },
      },
    },
    cvcaAdmin: {
      summary:
        '您负责验证证书颁发机构：审核 DV 申请、调整授权、维护 DV 委派并轮换 CVCA 密钥。CVCA 或默认 DV 过期后，相关签发将暂停。',
      steps: {
        s1: {
          title: '以管理员身份登录',
          body: '管理员权限来自配置的维护者名单，按业务域校验。',
        },
        s2: {
          title: '审核 DV 申请',
          body: '核对主体、DV 类别与申请权限，必要时调整后批准或驳回。',
        },
        s3: {
          title: '维护 DV 委派',
          body: '在首页为各维护者选择使用 CVCA 默认 DV 或自有 DV；自有 DV 过期后需重新委派。',
        },
        s4: {
          title: '查看证书状态',
          body: '首页底部的证书信息卡显示 CVCA 与默认 DV 的有效期；CVCA 过期后 DV 与终端证书签发暂停。',
        },
        s5: {
          title: '轮换 CVCA',
          body: '在证书信息卡执行轮换；系统签发链接证书连接新旧密钥。',
        },
        s6: {
          title: '发布',
          body: 'CVCA 与 DV 证书发布到 PKD，供终端构建授权信任链。',
        },
      },
    },
    terminal: {
      summary:
        '您在本站提交终端证书申请，经终端证书管理员审核后签发。证书有效期不超过 92 天，且不会超过签发 DV 的有效期。',
      steps: {
        s1: {
          title: '登录',
          body: '使用 dn42 账号登录终端证书业务。',
        },
        s2: {
          title: '填写申请',
          body: '填写通用名与持有者助记符，选择申请权限与有效期，并可填写备注。',
        },
        s3: {
          title: '选择密钥方式',
          body: '可由服务端生成密钥对，或上传 CSR / 公钥（SPKI PEM）。',
        },
        s4: {
          title: '等待审核',
          body: '管理员核对申请，并在批准前将权限收敛到签发 DV 的授权范围。',
        },
        s5: {
          title: '领取证书',
          body: '批准后可下载 DER 证书；服务端生成的私钥仅可下载一次。证书有效期以签发 DV 与 CVCA 的剩余期限为上限。',
        },
        s6: {
          title: '安装使用',
          body: '将证书与私钥装入检查系统，按授权范围读取或写入证件数据。',
        },
      },
    },
    dvAdmin: {
      summary:
        '您负责任务域内的终端证书审核与 NIA DV 维护。可调整申请权限、批准或驳回，并在 CVCA 有效时轮换 NIA DV。',
      steps: {
        s1: {
          title: '以管理员身份登录',
          body: '管理员权限来自配置的维护者名单，按业务域校验。',
        },
        s2: {
          title: '审核终端申请',
          body: '核对主体、权限与有效期；批准前可将权限调整到签发 DV 的授权范围内。',
        },
        s3: {
          title: '查看证书状态',
          body: '首页底部的证书信息卡显示 NIA DV 与 CVCA 的有效期；任一过期都会暂停终端证书签发。',
        },
        s4: {
          title: '轮换 NIA DV',
          body: '在证书信息卡轮换 NIA DV；旧证书标记为已退役。CV 证书无吊销机制，已签发证书在到期前仍然有效。',
        },
        s5: {
          title: '查阅审计',
          body: '审计日志记录终端申请的提交、审批与拒绝。',
        },
      },
    },
    mlAdmin: {
      summary:
        '您负责 CSCA 主列表的签名者与发布。主列表由当前主列表签名者签署；签名者或 CSCA 过期时，生成与轮换将被暂停。',
      steps: {
        s1: {
          title: '以管理员身份登录',
          body: '仅配置的主列表管理员可访问主列表业务。',
        },
        s2: {
          title: '查看签名者',
          body: '签名者卡片显示序列号、主体、状态、证书有效期、密钥算法与指纹。',
        },
        s3: {
          title: '轮换签名者',
          body: '在 CSCA 有效时轮换签名者；旧签名者标记为已退役，已发布主列表仍可验证。',
        },
        s4: {
          title: '生成并发布主列表',
          body: '生成主列表并发布到 PKD；最新主列表显示对象标识、发布时间与签署者。',
        },
        s5: {
          title: '核对发布状态',
          body: '若最新主列表由已退役签名者签署，请重新生成；过期签名者无法生成主列表。',
        },
      },
    },
    personalization: {
      summary:
        '个性化文件只有在 eMRTD applet 安装到芯片并写入数据组与安全对象后，才会成为可用证件。您负责制卡与验证。',
      steps: {
        s1: {
          title: '获取 applet',
          body: '构建 card42 eMRTD applet 及其共享 Java Card 库，得到可加载的 CAP。',
        },
        s2: {
          title: '安装 applet',
          body: '使用 GlobalPlatformPro 加载 CAP，并以 CardReset 权限创建 LDS1 实例，使其默认选中且主文件可读。',
        },
        s3: {
          title: '领取个性化文件',
          body: '从 ePass 42 一次性领取个性化文件；文件包含提交的数据组、EF.CardAccess、EF.CardSecurity 与 EF.SOD。',
        },
        s4: {
          title: '写入卡片',
          body: '通过 STORE DATA 下发 DGI 序列，依次写入 BAC/PACE 种子、认证密钥、CAN、LDS1 数据组与 LDS2 应用。',
        },
        s5: {
          title: '读回并验证',
          body: '使用主机 CLI 读卡，并对照 PKD 数据执行被动认证、主动认证、芯片认证与终端认证。',
        },
        s6: {
          title: '交付证件',
          body: '仅在验证通过后，将实体证件交付持有人。',
        },
      },
    },
    verifier: {
      summary:
        '验证终端只有在签名链、数据组哈希与吊销状态均对照 PKD 数据校验通过后，才会信任该芯片；读取受保护数据时还需终端认证。',
      steps: {
        s1: {
          title: '获取可信数据',
          body: '从 PKD 下载 CSCA、CVCA、DV、DSC、CRL 与主列表，或将 LDIF 导入本地 LDAP。',
        },
        s2: {
          title: '构建签名信任链',
          body: '验证主列表签名，并将 DSC 逐级校验至受信任的 CSCA，确认其未被吊销。',
        },
        s3: {
          title: '构建授权信任链',
          body: '将 DV 校验至 CVCA，核对终端证书的授权范围；终端认证用于读取受保护数据。',
        },
        s4: {
          title: '读取芯片',
          body: '使用 BAC（MRZ）或 PACE（MRZ 或 CAN）建立会话，读取 DG1、DG2、EF.SOD，并按需读取 EF.CardAccess、EF.CardSecurity 与 LDS2 应用。',
        },
        s5: {
          title: '被动、主动与芯片认证',
          body: '验证 EF.SOD 的 CMS 签名与数据组哈希；按需执行主动认证与芯片认证。',
        },
        s6: {
          title: '吊销查询',
          body: '对规范 MRZ 字段（证件类型、签发国、证件号码与出生日期）计算哈希，并与 PKD 发布的吊销证件哈希比对。',
        },
      },
    },
    public: {
      summary:
        '公开目录无需登录即可访问。您可下载证书、CRL 与主列表，或导入 LDIF；也可按证件信息查询吊销状态。',
      steps: {
        s1: {
          title: '浏览目录',
          body: 'PKD 目录列出签名 CA、验证 CA、DV、DSC、主列表签名者、CRL 与主列表。',
        },
        s2: {
          title: '下载与验证',
          body: '以 DER 或 PEM 下载任意对象，并使用标准 PKI 工具验证。',
        },
        s3: {
          title: '导入 LDAP',
          body: '下载 LDIF 导出，导入自建 LDAP 目录。',
        },
        s4: {
          title: '查询吊销',
          body: '输入证件类型、签发国、证件号码与出生日期，查询该证件是否已被吊销。',
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
    dscAdmin: {
      settings: '个性化设置',
      audit: '审计日志',
      home: '个性化首页',
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
    cvcaAdmin: {
      applications: 'CVCA 管理',
      certificates: 'DV 证书',
      audit: '审计日志',
    },
    terminal: {
      apply: '申请终端证书',
      mine: '我的申请',
    },
    dvAdmin: {
      home: '终端证书首页',
      audit: '审计日志',
    },
    mlAdmin: {
      home: '主列表',
      audit: '审计日志',
      directory: 'PKD 目录',
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
