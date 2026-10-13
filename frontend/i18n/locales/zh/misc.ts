/**
 * 审计日志、掩码、eMRTD 预览与共享错误目录的中文文案。
 */
export default {
  audit: {
    title: '审计日志',
    time: '时间',
    actor: '操作者',
    action: '操作',
    target: '对象',
    ip: 'IP',
    detail: '详情',
  },
  mask: {
    hidden: '已隐藏',
  },
  emrtd: {
    document: '证件',
    name: '姓名',
    nationality: '国籍',
    dob: '出生日期',
    sex: '性别',
    expiry: '有效期至',
  },
  errors: {
    generic: '出现问题，请重试。',
    unauthorized: '请先登录。',
    forbidden: '您没有执行该操作的权限。',
    not_found: '未找到相应记录。',
    validation_failed: '请修正标出的字段。',
    required: '此项为必填。',
    invalid_url: '请输入有效的 URL。',
    no_security_mechanism: '请至少选择一种安全机制。',
    pace_required: '请先启用 PACE 再启用芯片认证。',
    request_already_consumed: '该文件已被领取，无法再次获取。',
    reveal_not_allowed: '该文件由工作人员交付，申请人不能领取。',
    document_number_conflict: '该证件号码在您的机构中已存在。',
    no_active_dsc: '该机构尚无已批准的文档签名证书。',
    no_private_key: '该证书没有可下载的私钥。',
    private_key_consumed: '私钥已被下载并删除。',
    dv_key_unavailable: '本服务不再持有该文档验证者私钥，无法在此签发终端证书。',
    ta_requires_cvca:
      '终端认证需要 ECDSA 的 CVCA 密钥：请启用 CVCA 角色或设置 cvca.algorithm = "ecdsa"。',
    dg2_too_large: '照片过大，请更换更小的图片或降低质量。',
    passport_not_active: '该护照不是有效状态。',
  },
} as const
