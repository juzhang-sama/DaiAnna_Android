export type FinancialInstitutionKind =
  | 'policy-bank'
  | 'state-owned-bank'
  | 'joint-stock-bank'
  | 'city-commercial-bank'
  | 'rural-commercial-bank'
  | 'private-bank'
  | 'consumer-finance'
  | 'micro-loan'
  | 'auto-finance'
  | 'guarantee'
  | 'leasing'
  | 'trust'
  | 'finance-company'
  | 'other';

export interface FinancialInstitutionEntry {
  name: string;
  kind: FinancialInstitutionKind;
  aliases?: string[];
}

export const FINANCIAL_INSTITUTIONS: FinancialInstitutionEntry[] = [
  { name: '国家开发银行', kind: 'policy-bank', aliases: ['国开行'] },
  { name: '中国进出口银行', kind: 'policy-bank', aliases: ['进出口银行'] },
  { name: '中国农业发展银行', kind: 'policy-bank', aliases: ['农发行'] },

  { name: '中国工商银行股份有限公司', kind: 'state-owned-bank', aliases: ['中国工商银行', '工商银行', '工行', 'ICBC'] },
  { name: '中国农业银行股份有限公司', kind: 'state-owned-bank', aliases: ['中国农业银行', '农业银行', '农行', 'ABC'] },
  { name: '中国银行股份有限公司', kind: 'state-owned-bank', aliases: ['中国银行', '中行', 'BOC'] },
  { name: '中国建设银行股份有限公司', kind: 'state-owned-bank', aliases: ['中国建设银行', '建设银行', '建行', 'CCB'] },
  { name: '交通银行股份有限公司', kind: 'state-owned-bank', aliases: ['交通银行', '交行', 'BOCOM'] },
  { name: '中国邮政储蓄银行股份有限公司', kind: 'state-owned-bank', aliases: ['中国邮政储蓄银行', '邮储银行', '邮政储蓄银行'] },

  { name: '招商银行股份有限公司', kind: 'joint-stock-bank', aliases: ['招商银行', '招行', 'CMB'] },
  { name: '中信银行股份有限公司', kind: 'joint-stock-bank', aliases: ['中信银行'] },
  { name: '中国光大银行股份有限公司', kind: 'joint-stock-bank', aliases: ['中国光大银行', '光大银行'] },
  { name: '华夏银行股份有限公司', kind: 'joint-stock-bank', aliases: ['华夏银行'] },
  { name: '中国民生银行股份有限公司', kind: 'joint-stock-bank', aliases: ['中国民生银行', '民生银行'] },
  { name: '广发银行股份有限公司', kind: 'joint-stock-bank', aliases: ['广发银行', '广东发展银行'] },
  { name: '平安银行股份有限公司', kind: 'joint-stock-bank', aliases: ['平安银行'] },
  { name: '上海浦东发展银行股份有限公司', kind: 'joint-stock-bank', aliases: ['浦发银行', '上海浦东发展银行'] },
  { name: '兴业银行股份有限公司', kind: 'joint-stock-bank', aliases: ['兴业银行'] },
  { name: '浙商银行股份有限公司', kind: 'joint-stock-bank', aliases: ['浙商银行'] },
  { name: '恒丰银行股份有限公司', kind: 'joint-stock-bank', aliases: ['恒丰银行'] },
  { name: '渤海银行股份有限公司', kind: 'joint-stock-bank', aliases: ['渤海银行'] },

  { name: '北京银行股份有限公司', kind: 'city-commercial-bank', aliases: ['北京银行'] },
  { name: '上海银行股份有限公司', kind: 'city-commercial-bank', aliases: ['上海银行'] },
  { name: '江苏银行股份有限公司', kind: 'city-commercial-bank', aliases: ['江苏银行'] },
  { name: '南京银行股份有限公司', kind: 'city-commercial-bank', aliases: ['南京银行'] },
  { name: '宁波银行股份有限公司', kind: 'city-commercial-bank', aliases: ['宁波银行'] },
  { name: '杭州银行股份有限公司', kind: 'city-commercial-bank', aliases: ['杭州银行'] },
  { name: '徽商银行股份有限公司', kind: 'city-commercial-bank', aliases: ['徽商银行'] },
  { name: '成都银行股份有限公司', kind: 'city-commercial-bank', aliases: ['成都银行'] },
  { name: '重庆银行股份有限公司', kind: 'city-commercial-bank', aliases: ['重庆银行'] },
  { name: '广州银行股份有限公司', kind: 'city-commercial-bank', aliases: ['广州银行'] },
  { name: '长沙银行股份有限公司', kind: 'city-commercial-bank', aliases: ['长沙银行'] },
  { name: '天津银行股份有限公司', kind: 'city-commercial-bank', aliases: ['天津银行'] },
  { name: '威海银行股份有限公司', kind: 'city-commercial-bank', aliases: ['威海银行'] },
  { name: '盛京银行股份有限公司', kind: 'city-commercial-bank', aliases: ['盛京银行'] },
  { name: '承德银行股份有限公司', kind: 'city-commercial-bank', aliases: ['承德银行'] },
  { name: '齐鲁银行股份有限公司', kind: 'city-commercial-bank', aliases: ['齐鲁银行'] },
  { name: '龙江银行股份有限公司', kind: 'city-commercial-bank', aliases: ['龙江银行'] },
  { name: '廊坊银行股份有限公司', kind: 'city-commercial-bank', aliases: ['廊坊银行'] },

  { name: '北京农村商业银行股份有限公司', kind: 'rural-commercial-bank', aliases: ['北京农商银行'] },
  { name: '上海农村商业银行股份有限公司', kind: 'rural-commercial-bank', aliases: ['上海农商银行'] },
  { name: '广州农村商业银行股份有限公司', kind: 'rural-commercial-bank', aliases: ['广州农商银行'] },
  { name: '重庆农村商业银行股份有限公司', kind: 'rural-commercial-bank', aliases: ['重庆农商银行'] },
  { name: '深圳农村商业银行股份有限公司', kind: 'rural-commercial-bank', aliases: ['深圳农商银行'] },
  { name: '天津农村商业银行股份有限公司', kind: 'rural-commercial-bank', aliases: ['天津农商银行'] },
  { name: '菏泽农村商业银行股份有限公司', kind: 'rural-commercial-bank', aliases: ['菏泽农商银行'] },
  { name: '天津滨海农村商业银行股份有限公司', kind: 'rural-commercial-bank', aliases: ['天津滨海农商银行'] },
  { name: '天津滨海德商村镇银行股份有限公司', kind: 'rural-commercial-bank', aliases: ['天津滨海德商村镇银行'] },
  { name: '天津西青中银富登村镇银行股份有限公司', kind: 'rural-commercial-bank', aliases: ['天津西青中银富登村镇银行'] },

  { name: '微众银行股份有限公司', kind: 'private-bank', aliases: ['微众银行', '深圳前海微众银行', '深圳前海微众银行股份有限公司'] },
  { name: '浙江网商银行股份有限公司', kind: 'private-bank', aliases: ['网商银行', '浙江网商银行'] },
  { name: '四川新网银行股份有限公司', kind: 'private-bank', aliases: ['新网银行', '四川新网银行'] },
  { name: '武汉众邦银行股份有限公司', kind: 'private-bank', aliases: ['众邦银行', '武汉众邦银行'] },
  { name: '中信百信银行股份有限公司', kind: 'private-bank', aliases: ['百信银行', '中信百信银行'] },
  { name: '北京中关村银行股份有限公司', kind: 'private-bank', aliases: ['中关村银行', '北京中关村银行'] },

  { name: '招联消费金融有限公司', kind: 'consumer-finance', aliases: ['招联消费金融', '招联金融'] },
  { name: '马上消费金融股份有限公司', kind: 'consumer-finance', aliases: ['马上消费金融', '马上金融', '马上消费公司'] },
  { name: '中银消费金融有限公司', kind: 'consumer-finance', aliases: ['中银消费金融'] },
  { name: '兴业消费金融股份公司', kind: 'consumer-finance', aliases: ['兴业消费金融'] },
  { name: '捷信消费金融有限公司', kind: 'consumer-finance', aliases: ['捷信消费金融'] },
  { name: '苏银凯基消费金融有限公司', kind: 'consumer-finance', aliases: ['苏银凯基消费金融'] },
  { name: '杭银消费金融股份有限公司', kind: 'consumer-finance', aliases: ['杭银消费金融'] },
  { name: '海尔消费金融有限公司', kind: 'consumer-finance', aliases: ['海尔消费金融'] },
  { name: '湖北消费金融股份有限公司', kind: 'consumer-finance', aliases: ['湖北消费金融'] },
  { name: '北银消费金融有限公司', kind: 'consumer-finance', aliases: ['北银消费金融'] },
  { name: '平安消费金融有限公司', kind: 'consumer-finance', aliases: ['平安消费金融'] },
  { name: '蚂蚁消费金融有限公司', kind: 'consumer-finance', aliases: ['重庆蚂蚁消费金融', '蚂蚁消金'] },
  { name: '宁银消费金融股份有限公司', kind: 'consumer-finance', aliases: ['宁银消费金融'] },
  { name: '南银法巴消费金融有限公司', kind: 'consumer-finance', aliases: ['南银法巴消费金融'] },
  { name: '河南中原消费金融股份有限公司', kind: 'consumer-finance', aliases: ['中原消费金融'] },
  { name: '陕西长银消费金融有限公司', kind: 'consumer-finance', aliases: ['长银消费金融'] },

  { name: '重庆市蚂蚁商诚小额贷款有限公司', kind: 'micro-loan', aliases: ['蚂蚁商诚小贷', '重庆蚂蚁商诚小贷'] },
  { name: '重庆市蚂蚁小微小额贷款有限公司', kind: 'micro-loan', aliases: ['蚂蚁小微小贷', '重庆蚂蚁小微小贷'] },
  { name: '重庆度小满小额贷款有限公司', kind: 'micro-loan', aliases: ['度小满小贷', '重庆度小满小贷'] },
  { name: '重庆京东盛际小额贷款有限公司', kind: 'micro-loan', aliases: ['京东盛际小贷', '京东小贷'] },
  { name: '重庆美团三快小额贷款有限公司', kind: 'micro-loan', aliases: ['美团三快小贷', '美团小贷'] },
  { name: '深圳市腾讯微贷小额贷款有限公司', kind: 'micro-loan', aliases: ['腾讯微贷小贷', '腾讯微贷'] },
  { name: '深圳市财付通网络金融小额贷款有限公司', kind: 'micro-loan', aliases: ['财付通小贷', '财付通网络金融小贷'] },
  { name: '福州奇富网络小额贷款有限公司', kind: 'micro-loan', aliases: ['奇富小贷', '奇富网络小贷'] },
  { name: '深圳市分期乐网络科技有限公司', kind: 'micro-loan', aliases: ['分期乐'] },
  { name: '深圳市中融小额贷款有限公司', kind: 'micro-loan', aliases: ['中融小贷', '深圳中融小贷'] },

  { name: '上汽通用汽车金融有限责任公司', kind: 'auto-finance', aliases: ['上汽通用汽车金融'] },
  { name: '大众汽车金融中国有限公司', kind: 'auto-finance', aliases: ['大众汽车金融'] },
  { name: '丰田汽车金融中国有限公司', kind: 'auto-finance', aliases: ['丰田汽车金融'] },
  { name: '梅赛德斯-奔驰汽车金融有限公司', kind: 'auto-finance', aliases: ['奔驰汽车金融'] },
  { name: '宝马汽车金融中国有限公司', kind: 'auto-finance', aliases: ['宝马汽车金融'] },
  { name: '奇瑞徽银汽车金融股份有限公司', kind: 'auto-finance', aliases: ['奇瑞徽银汽车金融'] },

  { name: '深圳市乐信融资担保有限公司', kind: 'guarantee', aliases: ['乐信融资担保'] },
  { name: '平安融易（江苏）融资担保有限公司', kind: 'guarantee', aliases: ['平安融易江苏融资担保', '平安融易融资担保'] },
  { name: '海南信飞融资担保有限公司', kind: 'guarantee', aliases: ['信飞融资担保'] },
  { name: '重庆市与众融资担保有限公司', kind: 'guarantee', aliases: ['与众融资担保'] },
  { name: '中融信融资担保（大连）股份有限公司', kind: 'guarantee', aliases: ['中融信融资担保', '中融信大连融资担保'] },

  { name: '狮桥融资租赁（中国）有限公司', kind: 'leasing', aliases: ['狮桥融资租赁', '狮桥租赁'] },
  { name: '汇通信诚租赁有限公司', kind: 'leasing', aliases: ['汇通信诚租赁', '汇通信诚'] },

  { name: '五矿国际信托有限公司', kind: 'trust', aliases: ['五矿国际信托'] },
];
