const EASTMONEY_TOKEN = "fa5fd1943c7b386f172d6893dbfba10b";
const EASTMONEY_FIELDS = "f1,f2,f3,f4,f6,f12,f13,f14,f152";
const UPDATE_INTERVAL_MS = 15000;
const INDEX_UPDATE_INTERVAL_MS = 5000;
const US10Y_UPDATE_INTERVAL_MS = 30_000;
const AUCTION_UPDATE_INTERVAL_MS = 3000;
const BOND_UPDATE_INTERVAL_MS = 5000;
const NEW_BOND_STATUS_INTERVAL_MS = 60_000;
const SIGNAL_UPDATE_INTERVAL_MS = 2000;
const AUCTION_SIGNAL_UPDATE_INTERVAL_MS = 3000;
const SIGNAL_EVENT_LIMIT = 80;
const SIGNAL_SPARKLINE_LIMIT = 24;
const STOCK_LIST_STORAGE_KEY = "finance-board-stock-list-v1";
const STOCK_LIST_VERSION_STORAGE_KEY = "finance-board-stock-list-version-v1";
const STACK_GROUP_STORAGE_KEY = "finance-board-stack-groups-v1";
const LOCAL_BACKUP_STORAGE_KEY = "finance-board-local-backup-v1";
const SPARKLINE_STORAGE_KEY = "finance-board-show-sparklines-v1";
const BOARD_VIEW_STATE_STORAGE_KEY = "finance-board-view-state-v1";
const ACTIVE_BOARD_STORAGE_KEY = "finance-board-active-view-v1";
const MARKET_SPLIT_STORAGE_KEY = "finance-board-market-split-v1";
const MARKET_SPLIT_DEFAULT = 0.49;
const MARKET_SPLIT_MIN_SIGNAL_PX = 560;
const MARKET_SPLIT_MIN_MARKET_PX = 440;
const MARKET_HEIGHT_STORAGE_KEY = "finance-board-market-height-v1";
const MARKET_HEIGHT_DEFAULT = 176;
const MARKET_HEIGHT_MIN = 120;
const MARKET_HEIGHT_MAX = 520;
const SPARKLINE_BATCH_SIZE = 100;
// QMT full_tick is sampled by the existing quote refresh. Ten seconds
// matches the live-sample bucket while keeping the spark endpoint read-only.
const SPARKLINE_REFRESH_MS = 10 * 1000;
const AUCTION_SERIES_BATCH_SIZE = 120;
const AUCTION_SERIES_MAX_POINTS = 80;
const AUCTION_SPARK_WIDTH = 60;
const AUCTION_SPARK_HEIGHT = 18;
const AUCTION_PRICE_HEIGHT = 12;
const ADD_SEARCH_DEBOUNCE_MS = 220;
const ACTIVE_DEFAULT_SECTOR_VERSION = "screenshot-2026-05-18-v1";
const SIGNAL_EVENT_LABELS = {
  accelerate_up: "涨速加速",
  accelerate_down: "跌速加速",
  urgent_up: "急速拉升",
  urgent_down: "急速下跌",
  sudden_rise: "快速拉升",
  sudden_fall: "快速下跌",
  suspected_large_buy: "疑似连续大单买入",
  suspected_large_sell: "疑似连续大单卖出",
  visible_bid_large_order: "五档大买单",
  visible_ask_large_order: "五档大卖单",
  visible_book_support: "五档买盘支撑",
  visible_book_pressure: "五档卖盘压制",
  macd_underwater_golden_cross: "MACD水下金叉",
  macd_above_water_golden_cross: "MACD水上金叉",
  underwater_golden_cross_purple_confirmed: "水下金叉·紫线确认",
  purple_line_pullback_reclaim: "回踩紫线后收回",
  intraday_average_pullback_reclaim: "回踩均线后收回",
  dark_funds_inflow_start: "暗盘资金转入",
  dark_funds_outflow_start: "暗盘资金转出",
  dark_funds_inflow_accelerating: "暗盘流入增强",
  dark_funds_outflow_accelerating: "暗盘流出增强",
  visible_funds_inflow_start: "明盘资金转入",
  visible_funds_strong_inflow: "明盘资金强流入",
  visible_funds_inflow_weakening: "明盘流入减弱",
  visible_funds_outflow: "明盘资金流出",
  visible_funds_strong_exit: "明盘资金强流出",
  high_pullback: "高位回落",
  low_rebound: "低位反弹",
  interval_volume: "区间放量",
  strong_interval_volume: "区间强放量",
  new_high_acceleration: "创新高加速",
  new_low_acceleration: "创新低加速",
  platform_dive: "平台跳水",
  pole_jump: "旱地拔葱",
  near_up_limit: "接近涨停",
  at_up_limit: "触及涨停",
  open_high: "高开",
  open_low: "低开",
  volume_surge: "分钟放量",
};
const AUCTION_SIGNAL_LABELS = {
  stock_lead: "正股领先",
  stock_watch: "正股金额突出",
  paired_confirmed: "股债量价同步",
  bond_spike: "转债金额突出",
  price_paired: "股债价格走强",
  price_stock_lead: "正股价格领先",
  price_bond: "转债价格走强",
  price_fading: "竞价走弱",
};
// Kept as a broad starter-pool reference; the active default is rebuilt from the screenshot text below.
const LEGACY_DEFAULT_SECTORS = [
  {
    name: "可转债",
    stocks: [
      ["起帆转债", "1.111000"],
      ["韦尔转债", "1.113616"],
      ["蓝天转债", "1.111017"],
      ["立高转债", "0.123179"],
      ["牧原转债", "0.127045"],
      ["晶能转债", "1.118034"],
      ["立讯转债", "0.128136"],
      ["家联转债", "0.123236"],
      ["常银转债", "1.113062"],
      ["奥维转债", "1.118042"],
      ["晶澳转债", "0.127089"],
    ],
  },
  {
    name: "光模块",
    stocks: [
      ["中际旭创", "0.300308"],
      ["新易盛", "0.300502"],
      ["天孚通信", "0.300394"],
      ["光迅科技", "0.002281"],
      ["华工科技", "0.000988"],
      ["联特科技", "0.301205"],
      ["德科立", "1.688205"],
      ["源杰科技", "1.688498"],
      ["太辰光", "0.300570"],
      ["剑桥科技", "1.603083"],
      ["长芯博创", "0.300548"],
      ["仕佳光子", "1.688313"],
      ["永鼎股份", "1.600105"],
      ["华西股份", "0.000936"],
    ],
  },
  {
    name: "CPO",
    stocks: [
      ["中际旭创", "0.300308"],
      ["新易盛", "0.300502"],
      ["天孚通信", "0.300394"],
      ["罗博特科", "0.300757"],
      ["长光华芯", "1.688048"],
      ["源杰科技", "1.688498"],
      ["铭普光磁", "0.002902"],
      ["长芯博创", "0.300548"],
      ["震有科技", "1.688418"],
    ],
  },
  {
    name: "铜缆高速连接",
    stocks: [
      ["沃尔核材", "0.002130"],
      ["神宇股份", "0.300563"],
      ["兆龙互连", "0.300913"],
      ["胜蓝股份", "0.300843"],
      ["鼎通科技", "1.688668"],
    ],
  },
  {
    name: "算力芯片",
    stocks: [
      ["寒武纪", "1.688256"],
      ["海光信息", "1.688041"],
      ["龙芯中科", "1.688047"],
      ["景嘉微", "0.300474"],
      ["紫光国微", "0.002049"],
      ["复旦微电", "1.688385"],
      ["瑞芯微", "1.603893"],
      ["国科微", "0.300672"],
    ],
  },
  {
    name: "存储芯片",
    stocks: [
      ["兆易创新", "1.603986"],
      ["北京君正", "0.300223"],
      ["普冉股份", "1.688766"],
      ["澜起科技", "1.688008"],
      ["聚辰股份", "1.688123"],
      ["江波龙", "0.301308"],
      ["东芯股份", "1.688110"],
      ["德明利", "0.001309"],
      ["佰维存储", "1.688525"],
    ],
  },
  {
    name: "芯片测试",
    stocks: [
      ["长川科技", "0.300604"],
      ["联动科技", "0.301369"],
      ["精测电子", "0.300567"],
      ["利扬芯片", "1.688135"],
      ["伟测科技", "1.688372"],
      ["思科瑞", "1.688053"],
    ],
  },
  {
    name: "半导体材料",
    stocks: [
      ["雅克科技", "0.002409"],
      ["南大光电", "0.300346"],
      ["安集科技", "1.688019"],
      ["沪硅产业", "1.688126"],
      ["鼎龙股份", "0.300054"],
    ],
  },
  {
    name: "PCB",
    stocks: [
      ["胜宏科技", "0.300476"],
      ["沪电股份", "0.002463"],
      ["深南电路", "0.002916"],
      ["景旺电子", "1.603228"],
      ["生益电子", "1.688183"],
      ["东山精密", "0.002384"],
      ["世运电路", "1.603920"],
    ],
  },
  {
    name: "AI应用",
    stocks: [
      ["三六零", "1.601360"],
      ["昆仑万维", "0.300418"],
      ["拓尔思", "0.300229"],
      ["万兴科技", "0.300624"],
      ["汤姆猫", "0.300459"],
      ["中文在线", "0.300364"],
      ["科大讯飞", "0.002230"],
      ["金山办公", "1.688111"],
      ["掌阅科技", "1.603533"],
    ],
  },
  {
    name: "服务器",
    stocks: [
      ["工业富联", "1.601138"],
      ["浪潮信息", "0.000977"],
      ["中科曙光", "1.603019"],
      ["紫光股份", "0.000938"],
      ["神州数码", "0.000034"],
    ],
  },
  {
    name: "液冷服务器",
    stocks: [
      ["中科曙光", "1.603019"],
      ["浪潮信息", "0.000977"],
      ["英维克", "0.002837"],
      ["申菱环境", "0.301018"],
      ["高澜股份", "0.300499"],
    ],
  },
  {
    name: "机器人",
    stocks: [
      ["机器人", "0.300024"],
      ["埃斯顿", "0.002747"],
      ["汇川技术", "0.300124"],
      ["绿的谐波", "1.688017"],
      ["拓斯达", "0.300607"],
      ["鸣志电器", "1.603728"],
      ["中大力德", "0.002896"],
      ["双环传动", "0.002472"],
    ],
  },
  {
    name: "低空经济",
    stocks: [
      ["万丰奥威", "0.002085"],
      ["中信海直", "0.000099"],
      ["宗申动力", "0.001696"],
      ["深城交", "0.301091"],
      ["苏交科", "0.300284"],
      ["莱斯信息", "1.688631"],
    ],
  },
  {
    name: "商业航天",
    stocks: [
      ["航天智装", "0.300455"],
      ["上海沪工", "1.603131"],
      ["天银机电", "0.300342"],
      ["星网宇达", "0.002829"],
      ["航天环宇", "1.688523"],
    ],
  },
  {
    name: "军工",
    stocks: [
      ["中航沈飞", "1.600760"],
      ["中航西飞", "0.000768"],
      ["中无人机", "1.688297"],
      ["航发动力", "1.600893"],
      ["航天电子", "1.600879"],
      ["中船防务", "1.600685"],
    ],
  },
  {
    name: "电力",
    stocks: [
      ["华电国际", "1.600027"],
      ["华能国际", "1.600011"],
      ["大唐发电", "1.601991"],
      ["浙能电力", "1.600023"],
      ["申能股份", "1.600642"],
      ["国电电力", "1.600795"],
      ["三峡能源", "1.600905"],
      ["长江电力", "1.600900"],
    ],
  },
  {
    name: "电网设备",
    stocks: [
      ["特变电工", "1.600089"],
      ["国电南瑞", "1.600406"],
      ["许继电气", "0.000400"],
      ["平高电气", "1.600312"],
      ["思源电气", "0.002028"],
      ["金盘科技", "1.688676"],
    ],
  },
  {
    name: "核电",
    stocks: [
      ["中国核电", "1.601985"],
      ["江苏神通", "0.002438"],
      ["纽威股份", "1.603699"],
      ["东方电气", "1.600875"],
      ["上海电气", "1.601727"],
    ],
  },
  {
    name: "锂电",
    stocks: [
      ["宁德时代", "0.300750"],
      ["亿纬锂能", "0.300014"],
      ["天赐材料", "0.002709"],
      ["恩捷股份", "0.002812"],
      ["赣锋锂业", "0.002460"],
      ["天齐锂业", "0.002466"],
    ],
  },
  {
    name: "汽车整车",
    stocks: [
      ["比亚迪", "0.002594"],
      ["赛力斯", "1.601127"],
      ["长安汽车", "0.000625"],
      ["江淮汽车", "1.600418"],
      ["长城汽车", "1.601633"],
      ["江铃汽车", "0.000550"],
    ],
  },
  {
    name: "光伏",
    stocks: [
      ["阳光电源", "0.300274"],
      ["通威股份", "1.600438"],
      ["隆基绿能", "1.601012"],
      ["晶澳科技", "0.002459"],
      ["TCL中环", "0.002129"],
      ["迈为股份", "0.300751"],
    ],
  },
  {
    name: "化工",
    stocks: [
      ["万华化学", "1.600309"],
      ["华鲁恒升", "1.600426"],
      ["卫星化学", "0.002648"],
      ["宝丰能源", "1.600989"],
      ["荣盛石化", "0.002493"],
    ],
  },
  {
    name: "煤炭",
    stocks: [
      ["中国神华", "1.601088"],
      ["陕西煤业", "1.601225"],
      ["中煤能源", "1.601898"],
      ["兖矿能源", "1.600188"],
    ],
  },
  {
    name: "白酒",
    stocks: [
      ["贵州茅台", "1.600519"],
      ["五粮液", "0.000858"],
      ["泸州老窖", "0.000568"],
      ["山西汾酒", "1.600809"],
      ["舍得酒业", "1.600702"],
    ],
  },
  {
    name: "银行",
    stocks: [
      ["招商银行", "1.600036"],
      ["工商银行", "1.601398"],
      ["建设银行", "1.601939"],
      ["农业银行", "1.601288"],
      ["中国银行", "1.601988"],
      ["宁波银行", "0.002142"],
    ],
  },
  {
    name: "券商",
    stocks: [
      ["中信证券", "1.600030"],
      ["东方财富", "0.300059"],
      ["华泰证券", "1.601688"],
      ["国泰海通", "1.601211"],
      ["广发证券", "0.000776"],
    ],
  },
  {
    name: "游戏",
    stocks: [
      ["恺英网络", "0.002517"],
      ["三七互娱", "0.002555"],
      ["完美世界", "0.002624"],
      ["巨人网络", "0.002558"],
      ["世纪华通", "0.002602"],
    ],
  },
].map((sector, index) => ({
  ...sector,
  index,
  stocks: sector.stocks.map(([name, secid]) => ({ name, secid })),
}));

const SCREENSHOT_SECTOR_TEXT = `
光模块|中际旭创|300308
光模块|新易盛|300502
光模块|天孚通信|300394
光模块|汇绿生态|001267
光模块|华工科技|000988
光模块|立讯精密|002475
光模块|剑桥科技|603083
光模块|可川科技|603052
光模块|长芯博创|300548
光模块|张小泉|301055
光模块|联特科技|301205
光模块|兆驰股份|002429
光模块|瑞斯康达|603803
光模块|环旭电子|601231
光模块|青山纸业|600103
光模块设备|华盛昌|002980
光模块设备|华兴源创|688001
光模块设备|罗博特科|300757
光模块设备|快克智能|603203
光模块设备|燕麦科技|688312
光模块设备|智立方|301312
光模块设备|凯格精机|301338
光模块设备|优利德|688628
光模块设备|埃科光电|688610
光模块设备|鼎阳科技|688112
光模块设备|科瑞技术|002957
光模块设备|博众精工|688097
光模块设备|普源精电|688337
光模块设备|奥特维|688516
光模块设备|易天股份|300812
光模块零件|泰晶科技|603738
光模块零件|中润光学|688307
光模块零件|沃格光电|603773
光模块零件|九州一轨|688485
光模块零件|太辰光|300570
光模块零件|炬光科技|688167
光模块零件|中瓷电子|003031
光模块零件|卓胜微|300782
光模块零件|优迅股份|688807
光模块零件|致尚科技|301486
光模块零件|开勒股份|301070
光模块零件|瑞松科技|688090
光模块零件|宇瞳光学|300790
磷化铟|云南锗业|002428
磷化铟|天通股份|600330
磷化铟|博杰股份|002975
磷化铟|三安光电|600703
磷化铟|衢州发展|600208
磷化铟|先导智能|300450
磷化铟|众合科技|000925
磷化铟|株冶集团|600961
磷化铟|锡业股份|000960
磷化铟|华锡有色|600301
光纤|中天科技|600522
光纤|亨通光电|600487
光纤|通鼎互联|002491
光纤|杭电股份|603618
光纤|长飞光纤|601869
光纤|烽火通信|600498
光纤|远东股份|600869
光纤|长江通信|600345
光纤|特发信息|000070
光纤|新能泰山|000720
光芯片|光迅科技|002281
光芯片|东山精密|002384
光芯片|长光华芯|688048
光芯片|仕佳光子|688313
光芯片|永鼎股份|600105
光芯片|源杰科技|688498
光芯片|苏州高新|600736
光芯片|威腾电气|688226
OCS光交换机|海泰新光|688677
OCS光交换机|德科立|688205
OCS光交换机|光库科技|300620
OCS光交换机|杰普特|688025
OCS光交换机|英唐智控|300131
OCS光交换机|腾景科技|688195
OCS光交换机|赛微电子|300456
OCS光交换机|君逸数码|301172
法拉第旋光片|东田微|301183
法拉第旋光片|福晶科技|002222
法拉第旋光片|光电股份|600184
存储芯片|澜起科技|688008
存储芯片|江波龙|301308
存储芯片|德明利|001309
存储芯片|佰维存储|688525
存储芯片|兆易创新|603986
存储芯片|普冉股份|688766
存储芯片|香农芯创|300475
存储芯片|朗科科技|300042
存储芯片|斯迪克|300806
存储芯片|高乐股份|002348
存储芯片|大为股份|002213
存储芯片|恒烁股份|688416
存储芯片|商络电子|300975
存储芯片|华新科技|301265
芯片测试|长川科技|300604
芯片测试|联动科技|301369
芯片测试|华峰测控|688200
芯片测试|金海通|603061
芯片测试|精智达|688627
芯片测试|伟测科技|688372
芯片测试|强一股份|688809
算力芯片|寒武纪|688256
算力芯片|盛视科技|002990
算力芯片|芯原股份|688521
算力芯片|信测标准|300938
算力芯片|拓维信息|002261
算力芯片|沐曦股份|688802
算力芯片|晶品特装|688084
芯片氮气涨价|中船特气|688146
芯片氮气涨价|华特气体|688268
芯片氮气涨价|金宏气体|688106
芯片氮气涨价|广钢气体|688548
芯片氮气涨价|蜀道装备|300540
CPU|海光信息|688041
CPU|中国长城|000066
CPU|禾盛新材|002290
CPU|振芯科技|300101
CPU|龙芯中科|688047
芯片封装|长电科技|600584
芯片封装|通富微电|002156
芯片封装|光力科技|300480
芯片封装|商络电子|300975
芯片封装|华天科技|002185
半导体材料|安集科技|688019
半导体材料|南大光电|300346
半导体材料|三孚股份|603938
半导体材料|江丰电子|300666
芯片设备|华海清科|688120
芯片设备|富创精密|688409
芯片设备|北方华创|002371
芯片设备|精测电子|300567
电力|华电能源|600726
电力|华能国际|600011
电力|大唐发电|601991
电力|协鑫能科|002015
电力|节能风电|601016
电力|甘肃能源|000791
电力|皖能电力|000543
电力|金开新能|600821
电力|国电电力|600795
电力|百川畅银|300614
电力|大连热电|600719
电力|浙江新能|600032
电力|电投产融|000958
电力|宁波能源|600982
电力|广西能源|600310
电力|中闽能源|600163
电网设备|福达合金|603045
电网设备|汉缆股份|002498
电网设备|国电南瑞|600406
电网设备|中国西电|601179
电网设备|特变电工|600089
电网设备|新宏泰|603016
电网设备|大连电瓷|002606
燃气轮机|杰瑞股份|002353
燃气轮机|东方电气|600875
燃气轮机|中国动力|600482
燃气轮机|威孚高科|000581
燃气轮机|福鞍股份|603315
燃气轮机|万泽股份|000534
碳化硅SiC|天岳先进|688234
碳化硅SiC|露笑科技|002617
碳化硅SiC|晶瑞电材|300655
碳化硅SiC|天富能源|600509
碳化硅SiC|派瑞股份|300831
液冷|冰轮环境|000811
液冷|金富科技|003018
液冷|圣阳股份|002580
液冷|英可瑞|300713
液冷|高澜股份|300499
液冷|飞荣达|300602
液冷|申菱环境|301018
液冷|川润股份|002272
算力租赁|拓维信息|002261
算力租赁|利欧股份|002131
算力租赁|云赛智联|600602
算力租赁|协创数据|300857
算力租赁|润建股份|002929
算力租赁|东方国信|300166
算力租赁|恒为科技|603496
算力租赁|直真科技|003007
算力租赁|水发燃气|603318
算力租赁|迅游科技|300467
算力租赁|岭南股份|002717
算力租赁|电光科技|002730
算力租赁|润和软件|300339
算力租赁|光环新网|300383
算力租赁|铜牛信息|300895
算力租赁|奥飞数据|300738
算力租赁|恒润股份|603985
算力租赁|优刻得|688158
算力租赁|姚记科技|002605
算力租赁|中贝通信|603220
算力租赁|奥瑞德|600666
算力租赁|兴民智通|002355
算力租赁|中科曙光|603019
服务器|工业富联|601138
服务器|台基股份|300046
服务器|紫光股份|000938
服务器|浪潮信息|000977
服务器|中科曙光|603019
服务器|华勤技术|603296
数据中心电源|欧陆通|300870
数据中心电源|中恒电气|002364
数据中心电源|科华数据|002335
商业航天|光智科技|300489
商业航天|信维通信|300136
商业航天|霍莱沃|688682
商业航天|博实股份|002698
商业航天|西部材料|002149
商业航天|中科海讯|300810
商业航天|天银机电|300342
商业航天|巨力索具|002342
商业航天|神剑股份|002361
商业航天|新天科技|300259
商业航天|中国卫星|600118
商业航天|天箭科技|002977
商业航天|航天发展|000547
商业航天|旋极信息|300324
商业航天|航天智装|300455
商业航天|中航电测|300114
商业航天|航天动力|600343
商业航天|通宇通讯|002792
商业航天|铭普光磁|002902
商业航天|航天电器|002025
商业航天V|英洛华|000795
商业航天V|达华智能|002512
商业航天V|德迈仕|301007
商业航天V|天银机电|300342
商业航天V|水发燃气|603318
商业航天V|大庆华科|000985
商业航天V|国恩科技|002768
华为星闪|深圳华强|000062
华为星闪|拓维信息|002261
华为星闪|华胜天成|600410
AI应用|蓝色光标|300058
AI应用|九安医疗|002432
锂矿|天齐锂业|002466
锂矿|东睦股份|600114
锂矿|联创股份|300343
锂矿|江特电机|002176
锂矿|德新科技|603032
锂矿|盛新锂能|002240
锂矿|国城矿业|000688
锂矿|西藏珠峰|600338
锂矿|永兴材料|002756
锂矿|盐湖股份|000792
锂矿|大中矿业|001203
锂矿|西藏矿业|000762
锂矿|西藏城投|600773
化工|瑞华技术|920099
化工|丰山集团|603810
化工|赤天化|600227
化工|金牛化工|600722
化工|得润股份|002055
化工|金正大|002470
化工|亚星化学|600319
化工|诚志股份|000990
固态电池|宁德时代|300750
固态电池|鹏辉能源|300438
固态电池|容百科技|688005
固态电池|万润新能|688275
固态电池|湖南裕能|301358
固态电池|龙蟠科技|603906
稀土|北方稀土|600111
稀土|华宏科技|002645
稀土|龙磁科技|300835
稀土|万润股份|002643
稀土|中科电气|300035
稀土|新莱福|301323
电池产业链|鹏辉能源|300438
电池产业链|恩捷股份|002812
电池产业链|德邦科技|688035
电池产业链|信雅达|600571
电池产业链|先惠技术|688155
电池产业链|道明光学|002632
电池产业链|大为股份|002213
电池产业链|德宏股份|603701
电池产业链|高乐股份|002348
六氟磷酸锂|天赐材料|002709
六氟磷酸锂|宏柏新材|605366
六氟磷酸锂|多氟多|002407
六氟磷酸锂|天际股份|002759
六氟磷酸锂|万盛股份|603010
PCB|科翔股份|300903
PCB|迅捷兴|688655
PCB|胜宏科技|300476
PCB|沪电股份|002463
PCB|博敏电子|603936
PCB|鹏鼎控股|002938
PCB|光华科技|002741
PCB|广合科技|001389
PCB|中富电路|300814
PCB|深南电路|002916
PCB|依顿电子|603328
PCB|强力新材|300429
PCB|崇达技术|002815
PCB|明阳电路|300739
PCB电子布|宏和科技|603256
PCB电子布|泰坦股份|003036
PCB电子布|国际复材|301526
PCB电子布|铜冠铜箔|301217
PCB电子布|金安国纪|002636
PCB电子布|中英科技|300936
PCB电子布|生益科技|600183
PCB电子布|石英股份|603688
PCB电子布|中国巨石|600176
PCB电子布|东材科技|601208
PCB覆铜板|宝鼎科技|002552
PCB覆铜板|南亚新材|688519
PCB覆铜板|生益科技|600183
PCB覆铜板|华正新材|603186
PCB覆铜板|金安国纪|002636
PCB覆铜板|中英科技|300936
PCB覆铜板|宏昌电子|603002
PCB钻针|欧科亿|688308
PCB钻针|中钨高新|000657
PCB钻针|沃尔德|688028
PCB钻针|新锐股份|688257
PCB钻针|鼎泰高科|301377
PCB钻针|四方达|300179
PCB设备|大族数控|301200
PCB设备|东威科技|688700
PCB设备|民德电子|300656
PCB设备|芯碁微装|688630
PCB设备|大族激光|002008
PCB设备|泰豪科技|600590
PCB树脂|宏昌电子|603002
PCB树脂|东材科技|601208
PCB树脂|长阳科技|688299
PCB树脂|派特尔|836871
PCB树脂|圣泉集团|605589
PCB树脂|同宇新材|301630
PCB铜箔|德福科技|301511
PCB铜箔|铜冠铜箔|301217
PCB铜箔|三孚新科|688359
PCB铜箔|诺德股份|600110
PCB铜箔|洪田股份|603800
串皮电阻|三环集团|300408
串皮电阻|江海股份|002484
串皮电阻|博迁新材|605376
串皮电阻|东方锆业|002167
光伏|帝尔激光|300776
光伏|固德威|688390
光伏|协鑫集成|002506
光伏|拓日新能|002218
光伏|欧晶科技|001269
光伏|安彩高科|600207
AI手机深入|安诺其|300067
AI手机深入|长盈精密|300115
AI手机深入|田中精机|300461
驱动发电机|长源东谷|603950
驱动发电机|迪森股份|300335
驱动发电机|天和防务|300397
世界杯|舒华体育|605299
世界杯|腾信股份|300392
世界杯|中体产业|600158
`.trim();

const ACTIVE_DEFAULT_SECTORS = parseSeedSectorText(SCREENSHOT_SECTOR_TEXT);

function parseSeedSectorText(text) {
  const sectorByName = new Map();

  text.split(/\r?\n/).forEach((line) => {
    const [sectorName, stockName, code] = line.split("|").map((part) => part.trim());
    if (!sectorName || !stockName || !code) return;

    if (!sectorByName.has(sectorName)) {
      sectorByName.set(sectorName, { name: sectorName, stocks: [] });
    }

    sectorByName.get(sectorName).stocks.push([stockName, code]);
  });

  return [...sectorByName.values()];
}

const initialSectors = loadSectors();

const state = {
  sectors: initialSectors,
  stackGroups: loadStackGroups(initialSectors),
  quotes: new Map(),
  quoteCacheNote: "",
  marketSwitching: false,
  hydrated: [],
  indices: [],
  sparklines: new Map(),
  sparkPending: new Set(),
  sparkCacheDate: localDateKey(),
  auctionSeries: new Map(),
  auctionSeriesDate: "",
  auctionCursor: 0,
  auctionLoading: false,
  auctionLastFetchAt: 0,
  auctionPresentationActive: null,
  source: "连接中",
  marketFeed: {
    active: "unknown",
    configured: "unknown",
    fallbackActive: false,
    switchCount: 0,
    transport: "",
    previousCloseReference: "",
    previousCloseAuditReference: "",
    previousCloseValidatedCodes: 0,
    previousCloseNativeCodes: 0,
    previousCloseMismatchedCodes: 0,
    previousCloseCorrectedCodes: 0,
    previousCloseValidationError: "",
    previousCloseAuditPending: 0,
    previousCloseBackfillPending: 0,
    requested: 0,
    returned: 0,
  },
  lastUpdated: null,
  loading: false,
  quoteRequestId: 0,
  bondQuoteRequestId: 0,
  bondLoading: false,
  editMode: false,
  needsRenderAfterRename: false,
  showSparklines: localStorage.getItem(SPARKLINE_STORAGE_KEY) === "1",
  addTargetSector: "",
  addSelectedStock: null,
  addSearchTimer: 0,
  addSearchRequestId: 0,
  renamingSectorName: "",
  renamingStackName: "",
  query: "",
  sort: "hot",
  range: "all",
  boardStateUpdatedAt: "",
  nextRefreshAt: Date.now() + UPDATE_INTERVAL_MS,
  nextIndexRefreshAt: Date.now() + INDEX_UPDATE_INTERVAL_MS,
  mainRefreshTimer: 0,
  indexRefreshTimer: 0,
  us10yQuote: null,
  us10yLoading: false,
  us10yError: false,
  bondRefreshTimer: 0,
  signalEvents: [],
  signalMode: "intraday",
  auctionSignals: [],
  auctionSignalDate: "",
  auctionSignalPayload: null,
  auctionSignalSignature: "",
  auctionAutoSwitchDate: "",
  auctionSignalNewIds: new Set(),
  signalSparklines: new Map(),
  signalSparkPending: new Set(),
  signalLatestId: 0,
  signalTradingDate: "",
  signalScope: "focus",
  signalTypes: new Set(),
  signalMinDailyAmount: 0,
  signalMinDailyAmplitude: 0,
  signalPaused: false,
  signalLoading: false,
  signalRequestGeneration: 0,
  signalStatusPayload: null,
  signalHealth: null,
  signalTimer: 0,
  newBondStatus: null,
  newBondStatusTimer: 0,
  signalFilterTimer: 0,
  signalCodeSignature: "",
  signalCodeCount: 0,
  activeView: localStorage.getItem(ACTIVE_BOARD_STORAGE_KEY) === "themes" ? "themes" : "main",
  themeRows: [],
  themeTagOrder: [],
  themeQuotes: new Map(),
  themeLoading: false,
  themeLoaded: false,
  themeUpdatedAt: null,
  activeThemeTag: "all",
  themeExpandedTags: new Set(),
  bondPreviewCode: "",
  bondPreviewUrl: "",
  boardUpdatesPaused: false,
  boardRenderPending: false,
};
let serverPersistTimer = 0;
let boardPersistInFlight = 0;
let boardPersistFailed = false;
let temporaryStatusTimer = 0;
let marketResizeTimer = 0;
let marketResizePointerId = null;
let marketSplitRatio = MARKET_SPLIT_DEFAULT;
let marketHeightPointerId = null;
let marketHeightDragStartY = 0;
let marketHeightDragStartValue = MARKET_HEIGHT_DEFAULT;
let marketPanelBodyHeight = MARKET_HEIGHT_DEFAULT;

const grid = document.querySelector("#boardGrid");
const boardTitle = document.querySelector("#boardTitle");
const mainViewButton = document.querySelector("#mainViewButton");
const themeViewButton = document.querySelector("#themeViewButton");
const themeBondBoard = document.querySelector("#themeBondBoard");
const themeBondGrid = document.querySelector("#themeBondGrid");
const themeBoardSummary = document.querySelector("#themeBoardSummary");
const themeTagFilters = document.querySelector("#themeTagFilters");
const statusNode = document.querySelector("#marketStatus");
const globalIndicesNode = document.querySelector("#globalIndices");
const kospiMarketChart = document.querySelector("#kospiMarketChart");
const us10yMarketChart = document.querySelector("#us10yMarketChart");
const marketMonitorRow = document.querySelector(".market-monitor-row");
const marketMonitorResizer = document.querySelector("#marketMonitorResizer");
const marketMonitorHeightResizer = document.querySelector("#marketMonitorHeightResizer");
const tvMarketPanel = document.querySelector(".tv-market-panel");
const marketPanelTitle = document.querySelector("#marketPanelTitle");
const marketPanelSubtitle = document.querySelector("#marketPanelSubtitle");
const externalMarketGrid = document.querySelector("#externalMarketGrid");
const bondMarketPreview = document.querySelector("#bondMarketPreview");
const bondMarketPreviewFrame = document.querySelector("#bondMarketPreviewFrame");
const bondPreviewLoading = document.querySelector("#bondPreviewLoading");
const bondPreviewLoadingTitle = document.querySelector("#bondPreviewLoadingTitle");
const bondPreviewLoadingHint = bondPreviewLoading.querySelector("small");
const bondPreviewReset = document.querySelector("#bondPreviewReset");
const searchInput = document.querySelector("#searchInput");
const sortSelect = document.querySelector("#sortSelect");
const rangeSelect = document.querySelector("#rangeSelect");
const sparkToggle = document.querySelector("#sparkToggle");
const refreshButton = document.querySelector("#refreshButton");
const signalMonitor = document.querySelector(".signal-monitor");
const signalMonitorTitle = document.querySelector("#signalMonitorTitle");
const signalMonitorStatus = document.querySelector("#signalMonitorStatus");
const signalMode = document.querySelector("#signalMode");
const signalScope = document.querySelector("#signalScope");
const signalAmountFilter = document.querySelector("#signalAmountFilter");
const signalAmplitudeFilter = document.querySelector("#signalAmplitudeFilter");
const signalTypeFilter = document.querySelector("#signalTypeFilter");
const signalTypeSummary = document.querySelector("#signalTypeSummary");
const signalTypeOptions = document.querySelector("#signalTypeOptions");
const signalTypeClear = document.querySelector("#signalTypeClear");
const signalTypeSelectAll = document.querySelector("#signalTypeSelectAll");
const signalPauseButton = document.querySelector("#signalPauseButton");
const signalFeed = document.querySelector("#signalFeed");
const editListButton = document.querySelector("#editListButton");
const addSectorButton = document.querySelector("#addSectorButton");
const addStackButton = document.querySelector("#addStackButton");
const bulkEditButton = document.querySelector("#bulkEditButton");
const editorDialog = document.querySelector("#editorDialog");
const editorForm = document.querySelector("#editorForm");
const stockListEditor = document.querySelector("#stockListEditor");
const editorMessage = document.querySelector("#editorMessage");
const closeEditorButton = document.querySelector("#closeEditorButton");
const cancelEditorButton = document.querySelector("#cancelEditorButton");
const resetListButton = document.querySelector("#resetListButton");
const addStockDialog = document.querySelector("#addStockDialog");
const addStockForm = document.querySelector("#addStockForm");
const addStockTitle = document.querySelector("#addStockTitle");
const addStockInput = document.querySelector("#addStockInput");
const addStockSuggestions = document.querySelector("#addStockSuggestions");
const addStockMessage = document.querySelector("#addStockMessage");
const closeAddStockButton = document.querySelector("#closeAddStockButton");
const cancelAddStockButton = document.querySelector("#cancelAddStockButton");
const cardTemplate = document.querySelector("#cardTemplate");
const bondOverlay = document.querySelector("#bondOverlay");
const bondOverlayFrame = document.querySelector("#bondOverlayFrame");

function marketSplitBounds() {
  const width = marketMonitorRow.clientWidth;
  const dividerWidth = marketMonitorResizer.offsetWidth || 10;
  if (!(width > dividerWidth)) return { min: 0.35, max: 0.7 };
  const min = Math.min(0.5, MARKET_SPLIT_MIN_SIGNAL_PX / width);
  const max = Math.max(min, (width - dividerWidth - MARKET_SPLIT_MIN_MARKET_PX) / width);
  return { min, max: Math.min(0.7, max) };
}

function setMarketSplitRatio(value, persist = false) {
  const bounds = marketSplitBounds();
  const ratio = clamp(Number(value) || MARKET_SPLIT_DEFAULT, bounds.min, bounds.max);
  marketSplitRatio = ratio;
  marketMonitorRow.style.setProperty("--signal-panel-width", `${(ratio * 100).toFixed(2)}%`);
  marketMonitorResizer.setAttribute("aria-valuemin", String(Math.round(bounds.min * 100)));
  marketMonitorResizer.setAttribute("aria-valuemax", String(Math.round(bounds.max * 100)));
  marketMonitorResizer.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  if (persist) {
    localStorage.setItem(MARKET_SPLIT_STORAGE_KEY, ratio.toFixed(4));
  }
  return ratio;
}

function restoreMarketSplit() {
  const saved = Number(localStorage.getItem(MARKET_SPLIT_STORAGE_KEY));
  setMarketSplitRatio(Number.isFinite(saved) && saved > 0 ? saved : MARKET_SPLIT_DEFAULT);
}

function finishMarketResize(event) {
  if (marketResizePointerId === null || event.pointerId !== marketResizePointerId) return;
  marketResizePointerId = null;
  marketMonitorResizer.classList.remove("is-dragging");
  document.body.classList.remove("is-resizing-market-panels");
  setMarketSplitRatio(marketSplitRatio, true);
}

function setMarketPanelHeight(value, persist = false) {
  const height = Math.round(clamp(Number(value) || MARKET_HEIGHT_DEFAULT, MARKET_HEIGHT_MIN, MARKET_HEIGHT_MAX));
  marketPanelBodyHeight = height;
  marketMonitorRow.style.setProperty("--market-panel-body-height", `${height}px`);
  marketMonitorHeightResizer.setAttribute("aria-valuenow", String(height));
  if (persist) {
    localStorage.setItem(MARKET_HEIGHT_STORAGE_KEY, String(height));
  }
  return height;
}

function restoreMarketPanelHeight() {
  const saved = Number(localStorage.getItem(MARKET_HEIGHT_STORAGE_KEY));
  setMarketPanelHeight(Number.isFinite(saved) && saved > 0 ? saved : MARKET_HEIGHT_DEFAULT);
}

function finishMarketHeightResize(event) {
  if (marketHeightPointerId === null || event.pointerId !== marketHeightPointerId) return;
  marketHeightPointerId = null;
  marketMonitorHeightResizer.classList.remove("is-dragging");
  document.body.classList.remove("is-resizing-market-height");
  setMarketPanelHeight(marketPanelBodyHeight, true);
}

function embeddedBondUrl(url) {
  const target = new URL(url, window.location.href);
  target.searchParams.delete("panel");
  target.searchParams.set("embedded", "1");
  return target.href;
}

function panelBondUrl(url) {
  const target = new URL(url, window.location.href);
  target.searchParams.delete("view");
  target.searchParams.delete("date");
  target.searchParams.delete("days");
  target.searchParams.set("embedded", "1");
  target.searchParams.set("panel", "1");
  return target.href;
}

function hasActiveBoardPause() {
  return !bondOverlay.hidden;
}

function setBondPreviewActive(active) {
  const frameWindow = bondMarketPreviewFrame.contentWindow;
  if (!frameWindow) return;
  frameWindow.postMessage(
    { type: "finance:bond-panel-active", active: Boolean(active) },
    window.location.origin,
  );
}

function handleBondPreviewLoad() {
  const loadedUrl = bondMarketPreviewFrame.getAttribute("src") || "";
  if (!loadedUrl || loadedUrl !== bondMarketPreviewFrame.dataset.requestedUrl) return;
  bondMarketPreviewFrame.dataset.loadedUrl = loadedUrl;
  bondPreviewLoading.hidden = true;
  setBondPreviewActive(!bondMarketPreview.hidden && !document.hidden);
}

function handleBondPreviewError() {
  const failedUrl = bondMarketPreviewFrame.getAttribute("src") || "";
  if (!failedUrl || failedUrl !== bondMarketPreviewFrame.dataset.requestedUrl) return;
  delete bondMarketPreviewFrame.dataset.loadedUrl;
  bondPreviewLoadingTitle.textContent = "转债分时暂时无法打开";
  bondPreviewLoadingHint.textContent = "请再次点击该转债重试";
  bondPreviewLoading.hidden = false;
  setBondPreviewActive(false);
}

function pauseBoardUpdates() {
  if (state.boardUpdatesPaused) return;
  state.boardUpdatesPaused = true;
  state.boardRenderPending = false;

  // Invalidate requests that started before the detail panel opened. Their
  // responses may still arrive, but must not rebuild the large board behind it.
  state.quoteRequestId += 1;
  state.bondQuoteRequestId += 1;
  state.loading = false;
  state.bondLoading = false;
  refreshButton.disabled = false;
  window.clearTimeout(state.mainRefreshTimer);
  window.clearTimeout(state.bondRefreshTimer);
  state.mainRefreshTimer = 0;
  state.bondRefreshTimer = 0;
  updateStatus();
}

function resumeBoardUpdatesIfIdle() {
  if (hasActiveBoardPause() || !state.boardUpdatesPaused) return;
  const hadPendingRender = state.boardRenderPending;
  state.boardUpdatesPaused = false;
  state.boardRenderPending = false;
  scheduleMainRefresh();
  scheduleBondRefresh();

  // One fresh all-board request is enough: refreshQuotes already includes
  // stocks and convertible bonds. A separate bond request would duplicate it.
  void refreshQuotes({ force: true }).catch((error) => {
    console.warn("Board refresh after closing bond detail failed.", error);
    if (hadPendingRender) renderAfterBackgroundUpdate();
  });
}

function showBondMarketPreview(url) {
  const target = new URL(url, window.location.href);
  target.searchParams.delete("embedded");
  target.searchParams.delete("panel");
  const code = String(target.searchParams.get("code") || "").replace(/\D/g, "");
  if (!code) return;
  const name = target.searchParams.get("name") || "可转债";
  const previewUrl = panelBondUrl(target.href);
  state.bondPreviewCode = code;
  state.bondPreviewUrl = target.href;
  tvMarketPanel.open = true;
  marketPanelTitle.textContent = name;
  marketPanelSubtitle.textContent = `${code} · 分时与指标`;
  externalMarketGrid.hidden = true;
  bondMarketPreview.hidden = false;
  bondPreviewReset.hidden = false;
  marketMonitorRow.classList.add("is-bond-preview");
  bondMarketPreviewFrame.title = `${name} ${code} 分时与指标预览`;
  const loadedUrl = bondMarketPreviewFrame.dataset.loadedUrl || "";
  const currentUrl = bondMarketPreviewFrame.getAttribute("src") || "";
  const canReuse = currentUrl === previewUrl && loadedUrl === previewUrl;
  bondPreviewLoadingTitle.textContent = `${name} ${code}`;
  bondPreviewLoadingHint.textContent = "正在读取 QMT，价格与图表马上显示";
  bondPreviewLoading.hidden = canReuse;
  bondMarketPreviewFrame.dataset.requestedUrl = previewUrl;
  if (!canReuse) {
    // Let the newly-visible shell paint before starting iframe parsing/charting.
    window.requestAnimationFrame(() => {
      if (
        bondMarketPreview.hidden
        || bondMarketPreviewFrame.dataset.requestedUrl !== previewUrl
      ) return;
      bondMarketPreviewFrame.setAttribute("src", previewUrl);
    });
  } else {
    setBondPreviewActive(true);
  }
}

function showExternalMarkets() {
  state.bondPreviewCode = "";
  state.bondPreviewUrl = "";
  marketPanelTitle.textContent = "外围分时";
  marketPanelSubtitle.textContent = "TradingView / Yahoo";
  externalMarketGrid.hidden = false;
  bondMarketPreview.hidden = true;
  bondPreviewLoading.hidden = true;
  bondPreviewReset.hidden = true;
  marketMonitorRow.classList.remove("is-bond-preview");
  setBondPreviewActive(false);
  resumeBoardUpdatesIfIdle();
}

function showBondOverlay(url, updateHistory = true) {
  const target = new URL(url, window.location.href);
  target.searchParams.delete("embedded");
  target.searchParams.delete("panel");
  const targetPath = `${target.pathname}${target.search}`;
  const embeddedTarget = embeddedBondUrl(target.href);
  saveBoardViewState();
  if (bondOverlayFrame.src !== embeddedTarget) {
    bondOverlayFrame.src = embeddedTarget;
  }
  bondOverlay.hidden = false;
  document.body.classList.add("has-bond-overlay");
  pauseBoardUpdates();
  if (updateHistory) {
    const currentState = window.history.state || {};
    const returnUrl = currentState.bondOverlay
      ? currentState.bondOverlayReturnUrl || "/"
      : `${window.location.pathname}${window.location.search}`;
    const nextState = {
      ...currentState,
      bondOverlay: true,
      bondOverlayTarget: targetPath,
      bondOverlayReturnUrl: returnUrl,
    };
    if (currentState.bondOverlay) {
      window.history.replaceState(nextState, "", targetPath);
    } else {
      window.history.pushState(nextState, "", targetPath);
    }
  }
}

function hideBondOverlay() {
  bondOverlay.hidden = true;
  document.body.classList.remove("has-bond-overlay");
  bondOverlayFrame.removeAttribute("src");
  resumeBoardUpdatesIfIdle();
}

function closeBondOverlay() {
  const currentState = { ...(window.history.state || {}) };
  const returnUrl = currentState.bondOverlayReturnUrl || "/";
  delete currentState.bondOverlay;
  delete currentState.bondOverlayTarget;
  delete currentState.bondOverlayReturnUrl;
  window.history.replaceState(currentState, "", returnUrl);
  hideBondOverlay();
  restoreBoardViewport(restoreBoardViewState());
}

function saveBoardViewState() {
  try {
    sessionStorage.setItem(
      BOARD_VIEW_STATE_STORAGE_KEY,
      JSON.stringify({
        query: state.query,
        sort: state.sort,
        range: state.range,
        signalMode: state.signalMode,
        signalScope: state.signalScope,
        signalTypes: [...state.signalTypes],
        signalMinDailyAmount: state.signalMinDailyAmount,
        signalMinDailyAmplitude: state.signalMinDailyAmplitude,
        signalPaused: state.signalPaused,
        activeView: state.activeView,
        activeThemeTag: state.activeThemeTag,
        scrollY: window.scrollY,
        signalScrollTop: signalFeed.scrollTop,
        savedAt: Date.now(),
      }),
    );
  } catch (error) {
    console.warn("Failed to save board view state.", error);
  }
}

function restoreBoardViewState() {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(BOARD_VIEW_STATE_STORAGE_KEY) || "null",
    );
    if (!saved || typeof saved !== "object") return null;
    state.query = String(saved.query || "");
    state.sort = ["hot", "change", "name"].includes(saved.sort) ? saved.sort : "hot";
    state.range = ["all", "up", "down"].includes(saved.range) ? saved.range : "all";
    state.signalMode = saved.signalMode === "auction" ? "auction" : "intraday";
    state.signalScope = saved.signalScope === "all" ? "all" : "focus";
    state.signalTypes = new Set(
      Array.isArray(saved.signalTypes)
        ? saved.signalTypes.filter((type) => SIGNAL_EVENT_LABELS[type])
        : [],
    );
    state.signalMinDailyAmount = [0, 100_000_000, 200_000_000].includes(
      Number(saved.signalMinDailyAmount),
    )
      ? Number(saved.signalMinDailyAmount)
      : 0;
    state.signalMinDailyAmplitude = [0, 0.01, 0.02].includes(
      Number(saved.signalMinDailyAmplitude),
    )
      ? Number(saved.signalMinDailyAmplitude)
      : 0;
    state.signalPaused = Boolean(saved.signalPaused);
    state.activeView = ["main", "themes"].includes(saved.activeView)
      ? saved.activeView
      : state.activeView;
    state.activeThemeTag = String(saved.activeThemeTag || "all");
    searchInput.value = state.query;
    sortSelect.value = state.sort;
    rangeSelect.value = state.range;
    signalMode.value = state.signalMode;
    signalScope.value = state.signalScope;
    signalAmountFilter.value = String(state.signalMinDailyAmount);
    signalAmplitudeFilter.value = String(state.signalMinDailyAmplitude);
    syncSignalPauseButton();
    return {
      scrollY: Math.max(0, Number(saved.scrollY) || 0),
      signalScrollTop: Math.max(0, Number(saved.signalScrollTop) || 0),
    };
  } catch (error) {
    console.warn("Failed to restore board view state.", error);
    return null;
  }
}

function syncSignalPauseButton() {
  signalPauseButton.classList.toggle("is-paused", state.signalPaused);
  signalPauseButton.textContent = state.signalPaused ? "恢复更新" : "暂停更新";
}

function restoreBoardViewport(viewState) {
  if (!viewState) return;
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: viewState.scrollY, left: 0, behavior: "auto" });
    signalFeed.scrollTop = viewState.signalScrollTop;
  });
}

function normalizeSectors(sectors, options = {}) {
  const allowMissingSecid = Boolean(options.allowMissingSecid);
  const allowEmptySectors = options.allowEmptySectors !== false;
  const source = Array.isArray(sectors) ? sectors : [];

  return source
    .map((sector, index) => {
      const stocks = Array.isArray(sector?.stocks)
        ? sector.stocks
            .map((stock) => normalizeStock(stock))
            .filter((stock) => stock.name && (allowMissingSecid || stock.secid))
        : [];

      return {
        name: String(sector?.name || "").trim(),
        index,
        stocks,
      };
    })
    .filter((sector) => sector.name && (allowEmptySectors || sector.stocks.length > 0));
}

function normalizeStock(stock) {
  if (Array.isArray(stock)) {
    return {
      name: String(stock[0] || "").trim(),
      secid: normalizeSecidInput(stock[1]),
    };
  }

  return {
    name: String(stock?.name || "").trim(),
    secid: normalizeSecidInput(stock?.secid),
  };
}

function normalizeSecidInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const hkPrefixed = text.replace(/^rt_hk/i, "116.").replace(/^hk/i, "116.");
  if (/^116\.\d{1,5}$/.test(hkPrefixed)) {
    const code = hkPrefixed.split(".")[1].padStart(5, "0");
    return `116.${code}`;
  }
  if (/^\d{5}$/.test(hkPrefixed)) return `116.${hkPrefixed}`;

  const prefixed = hkPrefixed.replace(/^sh/i, "1.").replace(/^(sz|bj)/i, "0.");
  if (/^[01]\.\d{6}$/.test(prefixed)) return prefixed;
  if (/^\d{6}$/.test(prefixed)) return `${marketFromCode(prefixed)}.${prefixed}`;
  return prefixed;
}

function marketFromCode(code) {
  if (/^(5|6|110|111|113|118)/.test(code)) return "1";
  return "0";
}

function loadSectors() {
  try {
    const saved = localStorage.getItem(STOCK_LIST_STORAGE_KEY);
    const savedVersion = localStorage.getItem(STOCK_LIST_VERSION_STORAGE_KEY);
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (savedVersion !== ACTIVE_DEFAULT_SECTOR_VERSION) {
        localStorage.setItem(STOCK_LIST_VERSION_STORAGE_KEY, ACTIVE_DEFAULT_SECTOR_VERSION);
      }
      return normalizeSectors(parsed);
    }
  } catch (error) {
    console.warn("Saved stock list is invalid, using defaults.", error);
    backupCurrentLocalState("invalid-stock-list");
    clearOutdatedStockList();
  }

  return normalizeSectors(ACTIVE_DEFAULT_SECTORS);
}

function backupCurrentLocalState(reason) {
  try {
    const stockList = localStorage.getItem(STOCK_LIST_STORAGE_KEY);
    const stackGroups = localStorage.getItem(STACK_GROUP_STORAGE_KEY);
    if (stockList === null && stackGroups === null) return;

    const backups = JSON.parse(localStorage.getItem(LOCAL_BACKUP_STORAGE_KEY) || "[]");
    const nextBackups = [
      {
        time: new Date().toISOString(),
        reason,
        version: localStorage.getItem(STOCK_LIST_VERSION_STORAGE_KEY),
        stockList,
        stackGroups,
      },
      ...(Array.isArray(backups) ? backups : []),
    ].slice(0, 10);
    localStorage.setItem(LOCAL_BACKUP_STORAGE_KEY, JSON.stringify(nextBackups));
  } catch (error) {
    console.warn("Failed to back up local state.", error);
  }
}

function clearOutdatedStockList() {
  localStorage.removeItem(STOCK_LIST_STORAGE_KEY);
  localStorage.removeItem(STACK_GROUP_STORAGE_KEY);
  localStorage.setItem(STOCK_LIST_VERSION_STORAGE_KEY, ACTIVE_DEFAULT_SECTOR_VERSION);
}

function normalizeStackGroups(groups, sectors) {
  const sectorNames = new Set(sectors.map((sector) => sector.name));
  const usedSectors = new Set();
  const usedGroupNames = new Set();
  const source = Array.isArray(groups) ? groups : [];

  return source
    .map((group) => {
      const name = uniqueStackName(String(group?.name || "").trim(), usedGroupNames);
      const groupSectors = new Set();
      const memberNames = Array.isArray(group?.sectorNames)
        ? group.sectorNames
            .map((value) => String(value || "").trim())
            .filter((value) => {
              if (!sectorNames.has(value) || usedSectors.has(value) || groupSectors.has(value)) {
                return false;
              }
              groupSectors.add(value);
              return true;
            })
        : [];
      memberNames.forEach((value) => usedSectors.add(value));
      const savedExpandedNames = Array.isArray(group?.expandedSectorNames)
        ? group.expandedSectorNames.map((value) => String(value || "").trim())
        : null;
      const legacyExpandedNames = memberNames.includes(group?.activeSectorName)
        ? [group.activeSectorName]
        : memberNames.slice(0, 1);
      const expandedSectorNames = (savedExpandedNames ?? legacyExpandedNames).filter((value) =>
        memberNames.includes(value),
      );

      return {
        name,
        sectorNames: memberNames,
        expandedSectorNames,
      };
    })
    .filter((group) => group.name);
}

function uniqueStackName(name, usedGroupNames) {
  const baseName = name || "新叠组";
  if (!usedGroupNames.has(baseName)) {
    usedGroupNames.add(baseName);
    return baseName;
  }

  let index = 2;
  while (usedGroupNames.has(`${baseName}${index}`)) {
    index += 1;
  }
  const nextName = `${baseName}${index}`;
  usedGroupNames.add(nextName);
  return nextName;
}

function loadStackGroups(sectors) {
  try {
    const saved = localStorage.getItem(STACK_GROUP_STORAGE_KEY);
    if (saved !== null) {
      return normalizeStackGroups(JSON.parse(saved), sectors);
    }
  } catch (error) {
    console.warn("Saved stack groups are invalid, ignoring.", error);
  }

  return [];
}

async function loadServerBoardState({ background = false } = {}) {
  try {
    const json = await fetchJson("/api/state", 4000);
    if (!json?.exists) return false;

    const sectors = normalizeSectors(json.sectors);
    if (sectors.length === 0) return false;

    const stackGroups = normalizeStackGroups(json.stackGroups, sectors);
    if (background && (state.editMode || serverPersistTimer || boardPersistInFlight || boardPersistFailed)) return false;
    state.sectors = sectors;
    state.stackGroups = stackGroups;
    state.boardStateUpdatedAt = json.updatedAt || "";
    state.limitLadder = json.limitLadder || null;
    writeLocalBoardState(sectors, stackGroups);
    return true;
  } catch (error) {
    console.warn("Server board state unavailable, using browser/local defaults.", error);
    return false;
  }
}

async function refreshBoardLadderState() {
  if (document.hidden) return;
  try {
    const json = await fetchJson("/api/limit-ladder/board", 4000);
    const previous = JSON.stringify(state.limitLadder);
    state.limitLadder = json;
    if (json.boardUpdatedAt && json.boardUpdatedAt !== state.boardStateUpdatedAt
        && !state.editMode && !serverPersistTimer && !boardPersistInFlight && !boardPersistFailed) {
      if (await loadServerBoardState({ background: true })) {
        retainQuotesForStocks(getAllStocks(state.sectors));
        state.hydrated = hydrateSectors(state.quotes);
        render();
        void refreshQuotes({ force: true });
      }
    } else if (previous !== JSON.stringify(json)) {
      updateLadderCaption();
    }
  } catch (error) {
    if (state.limitLadder) state.limitLadder = { ...state.limitLadder, lastError: "自动归组状态暂不可用" };
    updateLadderCaption();
    console.warn("Board ladder status unavailable.", error);
  }
}

function ladderCaption() {
  const status = state.limitLadder;
  if (!status?.ready) return "连板池准备中";
  const date = status.baseDate.slice(5).replace("-", "/");
  const phase = status.grouping === "today" ? status.phase === "close" ? "收盘" : "盘中" : "底表";
  const updated = status.grouping === "today" && status.fetchedAt
    ? new Date(status.fetchedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false })
    : "每日自动";
  return `${date} ${phase} · ${status.count}只 · ${status.stale || status.lastError ? "更新待重试" : status.coveragePending ? "北交待核" : status.fallback ? "备用源" : updated}`;
}

function updateLadderCaption() {
  const caption = document.getElementById("boardLadderCaption");
  if (!caption) return;
  caption.textContent = ladderCaption();
  caption.classList.toggle("is-stale", Boolean(state.limitLadder?.stale || state.limitLadder?.lastError || state.limitLadder?.coveragePending));
  caption.title = `${state.limitLadder?.source || "同花顺 Agent 涨停池"}：${state.limitLadder?.scope || ""}。${state.limitLadder?.grouping === "today" ? "按当日涨停池连板数归组，每分钟更新；盘中封板可能打开。" : "按上一交易日底表归组。"}当前价格与竞价复用主看板行情。${state.limitLadder?.lastError || state.limitLadder?.sourceWarning || ""}`;
}

async function refreshNewBondSecondDayState() {
  try {
    const json = await fetchJson("/api/new-bond-second-day", 30000);
    const boardChanged = Boolean(
      json?.boardUpdatedAt
      && state.boardStateUpdatedAt
      && json.boardUpdatedAt !== state.boardStateUpdatedAt,
    );
    state.newBondStatus = json;
    if (boardChanged && !state.editMode && !serverPersistTimer && !boardPersistInFlight && !boardPersistFailed) {
      const loaded = await loadServerBoardState({ background: true });
      if (loaded) {
        const stocks = getAllStocks(state.sectors);
        retainQuotesForStocks(stocks);
        state.hydrated = hydrateSectors(state.quotes);
        render();
        await refreshQuotes({ force: true });
      }
    }
    updateStatus();
  } catch (error) {
    console.warn("New-bond second-day scan unavailable.", error);
  }
}

function getAllStocks(sectors) {
  return Array.from(
    new Map(
      sectors
        .flatMap((sector) => sector.stocks)
        .filter((stock) => stock.secid)
        .map((stock) => [stock.secid, stock]),
    ).values(),
  );
}

function getConvertibleBondStocks(sectors) {
  return getAllStocks(sectors).filter((stock) => isConvertibleBondSecid(stock.secid));
}

function serializeSectors(sectors) {
  return sectors.map((sector) => ({
    name: sector.name,
    stocks: sector.stocks.map((stock) => ({
      name: stock.name,
      secid: stock.secid,
    })),
  }));
}

function saveSectors(sectors) {
  localStorage.setItem(STOCK_LIST_STORAGE_KEY, JSON.stringify(serializeSectors(sectors)));
  localStorage.setItem(STOCK_LIST_VERSION_STORAGE_KEY, ACTIVE_DEFAULT_SECTOR_VERSION);
  persistBoardStateSoon();
}

function serializeStackGroups(groups) {
  return groups.map((group) => ({
    name: group.name,
    sectorNames: [...group.sectorNames],
    expandedSectorNames: [...group.expandedSectorNames],
  }));
}

function writeLocalBoardState(sectors, groups = state.stackGroups) {
  localStorage.setItem(STOCK_LIST_STORAGE_KEY, JSON.stringify(serializeSectors(sectors)));
  localStorage.setItem(STOCK_LIST_VERSION_STORAGE_KEY, ACTIVE_DEFAULT_SECTOR_VERSION);
  localStorage.setItem(STACK_GROUP_STORAGE_KEY, JSON.stringify(serializeStackGroups(groups)));
}

function saveStackGroups(groups = state.stackGroups) {
  localStorage.setItem(STACK_GROUP_STORAGE_KEY, JSON.stringify(serializeStackGroups(groups)));
  persistBoardStateSoon();
}

function persistBoardStateSoon() {
  window.clearTimeout(serverPersistTimer);
  serverPersistTimer = window.setTimeout(() => {
    serverPersistTimer = 0;
    void persistBoardState();
  }, 250);
}

async function persistBoardState() {
  boardPersistInFlight += 1;
  try {
    const result = await postJson("/api/state", {
      version: ACTIVE_DEFAULT_SECTOR_VERSION,
      baseUpdatedAt: state.boardStateUpdatedAt,
      sectors: serializeSectors(state.sectors),
      stackGroups: serializeStackGroups(state.stackGroups),
    });
    state.boardStateUpdatedAt = result.updatedAt || state.boardStateUpdatedAt;
    boardPersistFailed = false;
  } catch (error) {
    boardPersistFailed = true;
    console.warn("Failed to persist board state to local file.", error);
  } finally {
    boardPersistInFlight -= 1;
  }
}

function syncStackGroupsWithSectors() {
  state.stackGroups = normalizeStackGroups(state.stackGroups, state.sectors);
  saveStackGroups();
}

function sectorExists(name, exceptName = "") {
  return state.sectors.some((sector) => sector.name === name && sector.name !== exceptName);
}

function nextSectorName(baseName = "新板块") {
  if (!sectorExists(baseName)) return baseName;

  let index = 2;
  while (sectorExists(`${baseName}${index}`)) {
    index += 1;
  }
  return `${baseName}${index}`;
}

function stackExists(name, exceptName = "") {
  return state.stackGroups.some((group) => group.name === name && group.name !== exceptName);
}

function nextStackName(baseName = "新叠组") {
  if (!stackExists(baseName)) return baseName;

  let index = 2;
  while (stackExists(`${baseName}${index}`)) {
    index += 1;
  }
  return `${baseName}${index}`;
}

function addStackGroup() {
  const name = nextStackName();
  state.stackGroups = [
    ...state.stackGroups,
    {
      name,
      sectorNames: [],
      expandedSectorNames: [],
    },
  ];
  state.renamingSectorName = "";
  state.renamingStackName = name;
  saveStackGroups();
  render();
}

function addSector() {
  const name = nextSectorName();
  state.sectors = normalizeSectors([
    ...state.sectors,
    {
      name,
      stocks: [],
    },
  ]);
  state.renamingSectorName = name;
  state.renamingStackName = "";
  saveSectors(state.sectors);
  state.hydrated = hydrateSectors(state.quotes);
  render();
}

function renameSector(oldName, nextName) {
  const name = nextName.trim();
  if (!name) {
    throw new Error("板块名不能为空");
  }
  if (name === oldName) {
    state.renamingSectorName = "";
    render();
    return;
  }
  if (sectorExists(name, oldName)) {
    throw new Error(`已经有「${name}」板块`);
  }

  state.sectors = normalizeSectors(
    state.sectors.map((sector) => (sector.name === oldName ? { ...sector, name } : sector)),
  );
  state.stackGroups = state.stackGroups.map((group) => ({
    ...group,
    sectorNames: group.sectorNames.map((sectorName) => (sectorName === oldName ? name : sectorName)),
    expandedSectorNames: group.expandedSectorNames.map((sectorName) =>
      sectorName === oldName ? name : sectorName,
    ),
  }));
  state.renamingSectorName = "";
  saveSectors(state.sectors);
  saveStackGroups();
  state.hydrated = hydrateSectors(state.quotes);
  render();
}

function renameStackGroup(oldName, nextName) {
  const name = nextName.trim();
  if (!name) {
    throw new Error("叠组名不能为空");
  }
  if (name === oldName) {
    state.renamingStackName = "";
    render();
    return;
  }
  if (stackExists(name, oldName)) {
    throw new Error(`已经有「${name}」叠组`);
  }

  state.stackGroups = state.stackGroups.map((group) =>
    group.name === oldName ? { ...group, name } : group,
  );
  state.renamingStackName = "";
  saveStackGroups();
  render();
}

function startRenameSector(sectorName) {
  if (!state.editMode) return;
  state.renamingSectorName = sectorName;
  state.renamingStackName = "";
  render();
}

function startRenameStack(stackName) {
  if (!state.editMode) return;
  state.renamingSectorName = "";
  state.renamingStackName = stackName;
  render();
}

function isRenaming() {
  return Boolean(state.renamingSectorName || state.renamingStackName);
}

function renderAfterBackgroundUpdate() {
  if (state.boardUpdatesPaused) {
    state.boardRenderPending = true;
    return;
  }
  if (isRenaming()) {
    state.needsRenderAfterRename = true;
    return;
  }
  render();
}

function removeSector(sectorName) {
  preserveViewportAnchor(boardItemSelector(sectorName), () => {
    state.sectors = normalizeSectors(state.sectors.filter((sector) => sector.name !== sectorName));
    if (state.renamingSectorName === sectorName) {
      state.renamingSectorName = "";
    }
    state.stackGroups = state.stackGroups.map((group) => {
      const sectorNames = group.sectorNames.filter((name) => name !== sectorName);
      return {
        ...group,
        sectorNames,
        expandedSectorNames: group.expandedSectorNames.filter((name) => name !== sectorName),
      };
    });
    state.sectors.forEach((sector, index) => {
      sector.index = index;
    });
    saveSectors(state.sectors);
    saveStackGroups();
    state.hydrated = hydrateSectors(state.quotes);
    render();
  });
  updateStatus();
}

function removeStock(sectorName, secid) {
  preserveViewportAnchor(sectorCardSelector(sectorName), () => {
    state.sectors = normalizeSectors(
      state.sectors.map((sector) =>
        sector.name === sectorName
          ? { ...sector, stocks: sector.stocks.filter((stock) => stock.secid !== secid) }
          : sector,
      ),
    );
    state.sectors.forEach((sector, index) => {
      sector.index = index;
    });
    saveSectors(state.sectors);
    state.hydrated = hydrateSectors(state.quotes);
    render();
  });
  updateStatus();
}

function addStockToSector(sectorName, stock) {
  const normalized = normalizeStock(stock);
  if (!normalized.name || !normalized.secid) {
    throw new Error("请选择或输入有效标的");
  }

  const sector = state.sectors.find((item) => item.name === sectorName);
  if (!sector) {
    throw new Error(`没有找到板块：${sectorName}`);
  }

  if (sector.stocks.some((item) => item.secid === normalized.secid)) {
    throw new Error(`${normalized.name} 已在 ${sectorName}`);
  }

  sector.stocks.push(normalized);
  saveSectors(state.sectors);
  state.hydrated = hydrateSectors(state.quotes);
  render();
}

function moveSector(sourceName, targetName, placeAfter = false) {
  if (!sourceName || !targetName || sourceName === targetName) return;

  const sectors = [...state.sectors];
  const sourceIndex = sectors.findIndex((sector) => sector.name === sourceName);
  const targetIndex = sectors.findIndex((sector) => sector.name === targetName);
  if (sourceIndex < 0 || targetIndex < 0) return;

  preserveViewportAnchor(boardItemSelector(targetName), () => {
    const [source] = sectors.splice(sourceIndex, 1);
    const adjustedTargetIndex = sectors.findIndex((sector) => sector.name === targetName);
    sectors.splice(adjustedTargetIndex + (placeAfter ? 1 : 0), 0, source);
    state.sectors = normalizeSectors(sectors);
    saveSectors(state.sectors);
    state.hydrated = hydrateSectors(state.quotes);
    render();
  });
}

function moveSectorToEdge(sectorName, edge) {
  if (!sectorName || !["top", "bottom"].includes(edge)) return;

  const sectors = [...state.sectors];
  const sourceIndex = sectors.findIndex((sector) => sector.name === sectorName);
  if (sourceIndex < 0) return;

  preserveViewportAnchor(sectorCardSelector(sectorName), () => {
    const [source] = sectors.splice(sourceIndex, 1);
    if (edge === "top") {
      sectors.unshift(source);
    } else {
      sectors.push(source);
    }
    state.sectors = normalizeSectors(sectors);
    saveSectors(state.sectors);
    state.hydrated = hydrateSectors(state.quotes);
    render();
  });
}

function moveStack(sourceStackName, targetName, targetType, placeAfter = false) {
  if (!sourceStackName || !targetName) return;

  const sourceGroup = state.stackGroups.find((group) => group.name === sourceStackName);
  if (!sourceGroup || sourceGroup.sectorNames.length === 0) return;
  if (targetType === "stack" && sourceStackName === targetName) return;

  const sourceNames = new Set(sourceGroup.sectorNames);
  const sourceBlock = state.sectors.filter((sector) => sourceNames.has(sector.name));
  const remaining = state.sectors.filter((sector) => !sourceNames.has(sector.name));
  if (sourceBlock.length === 0) return;

  let insertIndex = -1;
  if (targetType === "sector") {
    if (sourceNames.has(targetName)) return;
    const targetIndex = remaining.findIndex((sector) => sector.name === targetName);
    insertIndex = targetIndex < 0 ? -1 : targetIndex + (placeAfter ? 1 : 0);
  } else if (targetType === "stack") {
    const targetGroup = state.stackGroups.find((group) => group.name === targetName);
    if (!targetGroup) return;
    const targetNames = new Set(targetGroup.sectorNames);
    const targetIndices = remaining
      .map((sector, index) => (targetNames.has(sector.name) ? index : -1))
      .filter((index) => index >= 0);
    if (targetIndices.length === 0) return;
    insertIndex = placeAfter
      ? Math.max(...targetIndices) + 1
      : Math.min(...targetIndices);
  }

  if (insertIndex < 0) return;

  preserveViewportAnchor(boardItemSelector(targetName), () => {
    state.sectors = normalizeSectors([
      ...remaining.slice(0, insertIndex),
      ...sourceBlock,
      ...remaining.slice(insertIndex),
    ]);
    saveSectors(state.sectors);
    state.hydrated = hydrateSectors(state.quotes);
    render();
  });
}

function moveStackToEdge(stackName, edge) {
  if (!stackName || !["top", "bottom"].includes(edge)) return;

  const group = state.stackGroups.find((item) => item.name === stackName);
  if (!group || group.sectorNames.length === 0) return;

  const stackNames = new Set(group.sectorNames);
  const stackBlock = state.sectors.filter((sector) => stackNames.has(sector.name));
  if (stackBlock.length === 0) return;

  preserveViewportAnchor(stackCardSelector(stackName), () => {
    const remaining = state.sectors.filter((sector) => !stackNames.has(sector.name));
    state.sectors = normalizeSectors(
      edge === "top" ? [...stackBlock, ...remaining] : [...remaining, ...stackBlock],
    );
    saveSectors(state.sectors);
    state.hydrated = hydrateSectors(state.quotes);
    render();
  });
}

function moveStock(sourceSectorName, secid, targetSectorName, targetSecid, placeAfter = false) {
  if (!sourceSectorName || !targetSectorName || !secid || !targetSecid) return;
  if (sourceSectorName === targetSectorName && secid === targetSecid) return;

  const sectors = state.sectors.map((sector) => ({
    ...sector,
    stocks: [...sector.stocks],
  }));
  const sourceSector = sectors.find((sector) => sector.name === sourceSectorName);
  const targetSector = sectors.find((sector) => sector.name === targetSectorName);
  if (!sourceSector || !targetSector) return;

  const sourceIndex = sourceSector.stocks.findIndex((stock) => stock.secid === secid);
  if (sourceIndex < 0) return;

  const [stock] = sourceSector.stocks.splice(sourceIndex, 1);
  const targetIndex = targetSector.stocks.findIndex((item) => item.secid === targetSecid);
  if (targetIndex < 0) return;

  let insertIndex = targetIndex + (placeAfter ? 1 : 0);
  if (sourceSector === targetSector && sourceIndex < targetIndex) {
    insertIndex -= 1;
  }
  targetSector.stocks.splice(insertIndex, 0, stock);

  preserveViewportAnchor(boardItemSelector(targetSectorName), () => {
    state.sectors = normalizeSectors(sectors);
    saveSectors(state.sectors);
    state.hydrated = hydrateSectors(state.quotes);
    render();
  });
}

function findStackBySector(sectorName) {
  return state.stackGroups.find((group) => group.sectorNames.includes(sectorName)) || null;
}

function addSectorToStack(sectorName, stackName) {
  if (!state.sectors.some((sector) => sector.name === sectorName)) return;

  preserveViewportAnchor(stackCardSelector(stackName), () => {
    state.stackGroups = state.stackGroups.map((group) => {
      if (group.name === stackName) return group;
      const sectorNames = group.sectorNames.filter((name) => name !== sectorName);
      return {
        ...group,
        sectorNames,
        expandedSectorNames: group.expandedSectorNames.filter((name) => name !== sectorName),
      };
    });

    state.stackGroups = state.stackGroups.map((group) => {
      if (group.name !== stackName) return group;
      const sectorNames = group.sectorNames.includes(sectorName)
        ? group.sectorNames
        : [...group.sectorNames, sectorName];
      return {
        ...group,
        sectorNames,
        expandedSectorNames: group.expandedSectorNames.includes(sectorName)
          ? group.expandedSectorNames
          : [...group.expandedSectorNames, sectorName],
      };
    });
    saveStackGroups();
    render();
  });
}

function removeSectorFromStack(sectorName, stackName) {
  preserveViewportAnchor(stackCardSelector(stackName), () => {
    state.stackGroups = state.stackGroups.map((group) => {
      if (group.name !== stackName) return group;
      const sectorNames = group.sectorNames.filter((name) => name !== sectorName);
      return {
        ...group,
        sectorNames,
        expandedSectorNames: group.expandedSectorNames.filter((name) => name !== sectorName),
      };
    });
    saveStackGroups();
    render();
  });
}

function moveStackMember(stackName, sectorName, direction) {
  if (!["up", "down"].includes(direction)) return;

  const group = state.stackGroups.find((item) => item.name === stackName);
  if (!group) return;
  const index = group.sectorNames.indexOf(sectorName);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= group.sectorNames.length) return;

  preserveViewportAnchor(stackCardSelector(stackName), () => {
    state.stackGroups = state.stackGroups.map((item) => {
      if (item.name !== stackName) return item;
      const sectorNames = [...item.sectorNames];
      [sectorNames[index], sectorNames[nextIndex]] = [sectorNames[nextIndex], sectorNames[index]];
      return {
        ...item,
        sectorNames,
      };
    });
    saveStackGroups();
    render();
  });
}

function removeStackGroup(stackName) {
  state.stackGroups = state.stackGroups.filter((group) => group.name !== stackName);
  if (state.renamingStackName === stackName) {
    state.renamingStackName = "";
  }
  saveStackGroups();
  render();
}

function toggleStackSector(stackName, sectorName) {
  preserveViewportAnchor(stackCardSelector(stackName), () => {
    state.stackGroups = state.stackGroups.map((group) => {
      if (group.name !== stackName) return group;
      const isExpanded = group.expandedSectorNames.includes(sectorName);
      return {
        ...group,
        expandedSectorNames: isExpanded
          ? group.expandedSectorNames.filter((name) => name !== sectorName)
          : [...group.expandedSectorNames, sectorName],
      };
    });
    saveStackGroups();
    render();
  });
}

function preserveViewportAnchor(selector, action) {
  const anchor = document.querySelector(selector);
  const previousTop = anchor?.getBoundingClientRect().top;
  const previousScrollX = window.scrollX;
  const previousScrollY = window.scrollY;

  action();

  window.requestAnimationFrame(() => {
    const nextAnchor = document.querySelector(selector);
    if (nextAnchor && Number.isFinite(previousTop)) {
      window.scrollBy(0, nextAnchor.getBoundingClientRect().top - previousTop);
      return;
    }

    window.scrollTo(previousScrollX, previousScrollY);
  });
}

function stackCardSelector(stackName) {
  return `.stack-card${attrSelector("data-stack-name", stackName)}`;
}

function sectorCardSelector(sectorName) {
  return `.sector-card${attrSelector("data-sector-name", sectorName)}`;
}

function boardItemSelector(name) {
  return `${sectorCardSelector(name)}, ${stackCardSelector(name)}`;
}

function attrSelector(name, value) {
  return `[${name}="${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

function updateEditModeControls() {
  editListButton.textContent = state.editMode ? "完成" : "编辑";
  editListButton.classList.toggle("is-active", state.editMode);
  editListButton.setAttribute("aria-pressed", String(state.editMode));
  addSectorButton.classList.toggle("is-visible", state.editMode);
  addStackButton.classList.toggle("is-visible", state.editMode);
}

function sectorsToEditorText(sectors) {
  return sectors
    .flatMap((sector) =>
      sector.stocks.map((stock) => `${sector.name}|${stock.name}|${codeForEditor(stock.secid)}`),
    )
    .join("\n");
}

function codeForEditor(secid) {
  return String(secid || "").split(".").pop() || "";
}

function parseEditorText(text) {
  const sectorByName = new Map();
  const lines = text.split(/\r?\n/);

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const parts = splitEditorLine(trimmed);
    if (parts.length < 2 || parts.length > 3) {
      throw new Error(`第 ${lineIndex + 1} 行格式不对，请使用：板块|名称|代码`);
    }

    const [sectorName, stockName, secid = ""] = parts;
    if (!sectorName || !stockName) {
      throw new Error(`第 ${lineIndex + 1} 行缺少板块或股票名`);
    }

    if (!sectorByName.has(sectorName)) {
      sectorByName.set(sectorName, { name: sectorName, stocks: [] });
    }

    sectorByName.get(sectorName).stocks.push({ name: stockName, secid });
  });

  const sectors = normalizeSectors([...sectorByName.values()], { allowMissingSecid: true });
  if (sectors.length === 0) {
    throw new Error("监控列表不能为空");
  }

  return sectors;
}

function splitEditorLine(line) {
  if (line.includes("|")) return line.split("|").map((part) => part.trim());
  if (line.includes("\t")) return line.split(/\t+/).map((part) => part.trim());
  return line.split(/[,，]/).map((part) => part.trim());
}

async function resolveMissingSecids(sectors) {
  const resolved = [];

  for (const sector of sectors) {
    const stocks = [];

    for (const stock of sector.stocks) {
      if (stock.secid) {
        stocks.push(stock);
        continue;
      }

      const match = await resolveStock(stock.name);
      stocks.push({
        name: stock.name,
        secid: match.secid,
      });
    }

    resolved.push({ name: sector.name, stocks });
  }

  return normalizeSectors(resolved);
}

async function resolveStock(name) {
  let json;
  try {
    json = await fetchJson(`/api/resolve?name=${encodeURIComponent(name)}`, 10000);
  } catch {
    throw new Error(`没有找到「${name}」的代码`);
  }

  if (!json?.secid) {
    throw new Error(`没有找到「${name}」的代码`);
  }
  return json;
}

async function searchStocks(keyword) {
  try {
    const json = await fetchJson(`/api/search?q=${encodeURIComponent(keyword)}`, 10000);
    return Array.isArray(json?.results) ? json.results : [];
  } catch {
    throw new Error("搜索服务临时不可用，可以直接输入代码添加");
  }
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function scaleValue(value, decimal) {
  const number = Number(value);
  const places = Number(decimal);
  if (!Number.isFinite(number)) return null;
  if (!Number.isFinite(places) || places <= 0) return number;
  return number / 10 ** places;
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(errorMessageFromResponse(response.status, text));
    }

    if (!text.trim()) {
      throw new Error("empty response");
    }

    const jsonText = text.trim().replace(/^[^(]*\((.*)\);?$/, "$1");
    return JSON.parse(jsonText);
  } finally {
    window.clearTimeout(timer);
  }
}

async function postJson(url, payload, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(errorMessageFromResponse(response.status, text));
    }

    return text.trim() ? JSON.parse(text) : {};
  } finally {
    window.clearTimeout(timer);
  }
}

function errorMessageFromResponse(status, text) {
  const trimmed = text.trim();
  if (!trimmed) return `HTTP ${status}`;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.error) return String(parsed.error);
  } catch {
    // Fall through to a compact plain-text message.
  }

  return trimmed.slice(0, 160) || `HTTP ${status}`;
}

function parseEastmoneyQuote(item) {
  const secid = `${item.f13}.${item.f12}`;
  return {
    secid,
    code: item.f12,
    name: item.f14,
    price: scaleValue(item.f2, item.f1),
    change: scaleValue(item.f3, item.f152),
    amount: Number(item.f6) || 0,
  };
}

async function fetchEastmoneyQuotes(stocks) {
  const quoteMap = new Map();
  const secids = stocks.map((stock) => stock.secid);

  for (const group of chunk(secids, 70)) {
    const url =
      "https://push2.eastmoney.com/api/qt/ulist.np/get" +
      `?fields=${EASTMONEY_FIELDS}` +
      "&invt=2&fltt=1" +
      `&secids=${group.join(",")}` +
      `&ut=${EASTMONEY_TOKEN}` +
      `&_=${Date.now()}`;

    const json = await fetchJson(url);
    const rows = json?.data?.diff;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("东方财富行情为空");
    }

    rows.map(parseEastmoneyQuote).forEach((quote) => quoteMap.set(quote.secid, quote));
  }

  return quoteMap;
}

async function fetchLocalQuotes(stocks) {
  const quoteMap = new Map();
  const secids = stocks.map((stock) => stock.secid);

  for (const group of chunk(secids, 100)) {
    const json = await fetchJson(`/api/quotes?secids=${group.join(",")}`);
    const rows = json?.quotes;
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      if (!secids.includes(row.secid) || !Number.isFinite(Number(row.price)) || Number(row.price) <= 0) continue;
      quoteMap.set(row.secid, {
        secid: row.secid,
        code: row.secid.split(".")[1],
        price: Number(row.price),
        change: row.change == null ? null : Number(row.change),
        amount: Number(row.amount) || 0,
        date: row.date || "",
        time: row.time || "",
        previousClose: Number(row.previousClose),
        source: row.source || json.source || "新浪港股",
      });
    }
  }

  if (quoteMap.size === 0) {
    throw new Error("本地行情代理为空");
  }

  return quoteMap;
}

function miniQmtMarketCode(secid) {
  const match = String(secid || "").match(/^([01])\.(\d{6})$/);
  if (!match) return "";
  if (/^[489]/.test(match[2])) return `${match[2]}.BJ`;
  return `${match[2]}.${match[1] === "1" ? "SH" : "SZ"}`;
}

function quoteBackendFromPayload(payload) {
  const raw = payload?.quote_backend || {};
  const active = ["bigqmt", "miniqmt"].includes(String(raw.active || "").toLowerCase())
    ? String(raw.active).toLowerCase()
    : "unknown";
  const configured = ["auto", "bigqmt", "miniqmt"].includes(
    String(raw.configured || "").toLowerCase(),
  )
    ? String(raw.configured).toLowerCase()
    : "unknown";
  return {
    active,
    configured,
    fallbackActive: Boolean(raw.fallback_active),
    switchCount: Math.max(0, Number(raw.switch_count) || 0),
    transport: String(raw.transport || ""),
    previousCloseReference: String(raw.previous_close_reference || ""),
    previousCloseAuditReference: String(raw.previous_close_audit_reference || ""),
    previousCloseValidatedCodes: Math.max(
      0,
      Number(raw.previous_close_validated_codes) || 0,
    ),
    previousCloseNativeCodes: Math.max(
      0,
      Number(raw.previous_close_native_codes) || 0,
    ),
    previousCloseMismatchedCodes: Math.max(
      0,
      Number(raw.previous_close_mismatched_codes) || 0,
    ),
    previousCloseCorrectedCodes: Math.max(
      0,
      Number(raw.previous_close_corrected_codes) || 0,
    ),
    previousCloseValidationError: String(raw.previous_close_validation_error || ""),
    previousCloseAuditPending: Math.max(
      0,
      Number(raw.previous_close_audit_pending) || 0,
    ),
    previousCloseBackfillPending: Math.max(
      0,
      Number(raw.previous_close_backfill_pending) || 0,
    ),
    bigQmtReferenceStatus: String(raw.bigqmt_reference_status || "unknown").toLowerCase(),
    bigQmtReferenceCheckedCodes: Math.max(
      0,
      Number(raw.bigqmt_reference_checked_codes) || 0,
    ),
    bigQmtReferenceMismatchedCodes: Math.max(
      0,
      Number(raw.bigqmt_reference_mismatched_codes) || 0,
    ),
    bigQmtReferenceMismatchRatio: Math.max(
      0,
      Number(raw.bigqmt_reference_mismatch_ratio) || 0,
    ),
    bigQmtRestartRecommended: Boolean(raw.bigqmt_restart_recommended),
  };
}

async function fetchMiniQmtQuotes(stocks) {
  const quoteMap = new Map();
  let backend = quoteBackendFromPayload(null);
  const marketCodes = Array.from(
    new Set(stocks.map((stock) => miniQmtMarketCode(stock.secid)).filter(Boolean)),
  );

  // Smaller batches reduce cold daily-reference work. Bound the whole refresh
  // as well, so a disconnected backend cannot cost 35s for every batch.
  const deadline = Date.now() + 45_000;
  const failedBatches = [];
  for (const group of chunk(marketCodes, 50)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const query = new URLSearchParams({ codes: group.join(",") });
    let json;
    try {
      json = await fetchJson(`/api/miniqmt/quotes?${query}`, Math.min(35_000, remaining));
    } catch (error) {
      failedBatches.push({ codes: group, error: String(error?.message || error) });
      continue;
    }
    const responseBackend = quoteBackendFromPayload(json);
    if (responseBackend.active !== "unknown" || backend.active === "unknown") {
      backend = responseBackend;
    }
    const rows = Array.isArray(json?.quotes) ? json.quotes : [];
    for (const row of rows) {
      const price = Number(row.price);
      if (!row.secid || !Number.isFinite(price) || price <= 0) continue;
      quoteMap.set(row.secid, {
        secid: row.secid,
        code: row.code || row.secid.split(".")[1],
        price,
        change: row.change == null ? null : Number(row.change),
        amount: Number(row.amount) || 0,
        date: row.date || "",
        time: row.time || "",
        previousClose: Number(row.previousClose),
        source: row.source || "QMT full_tick",
        fetchedAt: Date.now(),
        cached: false,
      });
    }
  }

  if (marketCodes.length > 0 && quoteMap.size === 0) {
    throw new Error("QMT行情为空");
  }
  const failedSecids = stocks
    .filter((stock) => miniQmtMarketCode(stock.secid) && !quoteMap.has(stock.secid))
    .map((stock) => stock.secid);
  return { quotes: quoteMap, requested: marketCodes.length, backend, failedSecids, failedBatches };
}

async function fetchPreferredQuotes(stocks) {
  const hongKongStocks = stocks.filter((stock) => /^116\.\d{5}$/.test(stock.secid));
  const qmtStocks = stocks.filter((stock) => miniQmtMarketCode(stock.secid));
  const [qmtResult, hongKongResult] = await Promise.allSettled([
    fetchMiniQmtQuotes(qmtStocks),
    hongKongStocks.length > 0 ? fetchLocalQuotes(hongKongStocks) : Promise.resolve(new Map()),
  ]);
  const miniQmt = qmtResult.status === "fulfilled" ? qmtResult.value : {
    quotes: new Map(),
    backend: { ...quoteBackendFromPayload(null), active: "unavailable" },
    failedSecids: qmtStocks.map((stock) => stock.secid),
  };
  const hongKongQuotes = hongKongResult.status === "fulfilled" ? hongKongResult.value : new Map();
  const quotes = new Map([...miniQmt.quotes, ...hongKongQuotes]);
  if (quotes.size === 0 && (qmtStocks.length > 0 || hongKongStocks.length > 0)) {
    throw new Error("行情源未返回有效报价");
  }
  const qmtRequested = new Set(qmtStocks.map((stock) => stock.secid)).size;
  const qmtReturned = miniQmt.quotes.size;
  const feed = {
    ...miniQmt.backend,
    requested: qmtRequested,
    returned: qmtReturned,
    partial: qmtReturned > 0 && qmtReturned < qmtRequested,
    failedSecids: [...new Set(miniQmt.failedSecids || [])],
    hongKongRequested: new Set(hongKongStocks.map((stock) => stock.secid)).size,
    hongKongReturned: hongKongQuotes.size,
  };
  const unsupported = new Set(
    stocks
      .filter((stock) => !miniQmtMarketCode(stock.secid) && !/^116\.\d{5}$/.test(stock.secid))
      .map((stock) => stock.secid),
  );
  const unsupportedBeijing = [...unsupported].filter((secid) => /^[01]\.[89]\d{5}$/.test(secid)).length;
  const unsupportedOther = Math.max(
    0,
    unsupported.size - unsupportedBeijing,
  );
  const unsupportedParts = [
    unsupportedBeijing > 0 ? `北交所${unsupportedBeijing}只` : "",
    unsupportedOther > 0 ? `其他${unsupportedOther}只` : "",
  ].filter(Boolean);
  const unsupportedNote = unsupportedParts.length > 0
    ? ` · ${unsupportedParts.join("/")}未接入`
    : "";
  const feedName = miniQmt.backend.active === "bigqmt"
    ? "大 QMT"
    : "QMT";
  const qmtSource = qmtRequested > 0
    ? qmtResult.status === "rejected" ? "QMT行情不可用" : `${feedName}实时 ${qmtReturned}/${qmtRequested}${feed.partial ? ` · ${qmtRequested - qmtReturned}只报价缺失` : ""}`
    : "";
  return {
    quotes,
    source: [qmtSource, hongKongQuoteStatus(feed)].filter(Boolean).join(" · ") + unsupportedNote,
    feed,
    qmtRequested,
    qmtReturned,
  };
}

function hongKongQuoteStatus(feed) {
  if (!feed?.hongKongRequested) return "";
  return `新浪港股 ${feed.hongKongReturned}/${feed.hongKongRequested}${feed.hongKongReturned === 0 ? " 暂不可用" : ""}`;
}

async function fetchLocalSparklines(secids) {
  const sparkMap = new Map();
  const fetchedAt = Date.now();
  const cacheDate = localDateKey();

  for (const group of chunk(secids, SPARKLINE_BATCH_SIZE)) {
    const json = await fetchJson(`/api/sparks?secids=${group.join(",")}`, 20000);
    const rows = json?.sparks;
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      if (row?.secid && Array.isArray(row.points) && row.points.length > 1) {
        sparkMap.set(row.secid, { ...row, fetchedAt, cacheDate });
      }
    }
  }

  return sparkMap;
}

async function fetchAuctionSeries(secids, after = 0) {
  const query = new URLSearchParams({ secids: secids.join(",") });
  if (after > 0) query.set("after", String(after));
  return fetchJson(`/api/auction/series?${query}`, 12000);
}

async function ensureAuctionSeriesFor(sectors) {
  if (!state.showSparklines || state.auctionLoading) return;
  if (Date.now() - state.auctionLastFetchAt < 2000) return;
  const secids = Array.from(
    new Set(
      sectors
        .flatMap((sector) => sector.stocks)
        .map((stock) => stock.secid)
        .filter((secid) => /^[01]\.\d{6}$/.test(String(secid || ""))),
    ),
  );
  if (secids.length === 0) return;

  state.auctionLoading = true;
  state.auctionLastFetchAt = Date.now();
  const requestCursor = state.auctionCursor;
  let nextCursor = requestCursor;
  try {
    for (const group of chunk(secids, AUCTION_SERIES_BATCH_SIZE)) {
      const needsHistory = group.some((secid) => !state.auctionSeries.has(secid));
      const after = needsHistory ? 0 : requestCursor;
      const payload = await fetchAuctionSeries(group, after);
      if (
        state.auctionSeriesDate &&
        payload.date &&
        state.auctionSeriesDate !== payload.date
      ) {
        state.auctionSeries.clear();
        state.auctionCursor = 0;
      }
      state.auctionSeriesDate = payload.date || state.auctionSeriesDate;
      nextCursor = Math.max(nextCursor, Number(payload.cursor) || 0);
      for (const item of Array.isArray(payload.series) ? payload.series : []) {
        const existing = after > 0 ? state.auctionSeries.get(item.secid) : null;
        const samples = [...(existing?.samples || []), ...(item.samples || [])];
        const deduplicated = [];
        const sampleKeys = new Set();
        for (const sample of samples) {
          const key = `${sample.capturedAt || 0}:${sample.timestamp || 0}`;
          if (sampleKeys.has(key)) continue;
          sampleKeys.add(key);
          deduplicated.push(sample);
        }
        state.auctionSeries.set(item.secid, {
          ...item,
          samples: deduplicated
            .sort((left, right) => Number(left.capturedAt) - Number(right.capturedAt))
            .slice(-AUCTION_SERIES_MAX_POINTS),
        });
      }
    }
    state.auctionCursor = nextCursor;
  } catch (error) {
    console.warn("Auction series request failed.", error);
  } finally {
    state.auctionLoading = false;
    renderAfterBackgroundUpdate();
  }
}

async function ensureSparklinesFor(sectors) {
  if (!state.showSparklines) return;
  if (isRenaming()) return;
  if (isAuctionDisplaySession()) {
    void ensureAuctionSeriesFor(sectors);
    return;
  }
  resetSparklinesIfNewDay();

  const secids = Array.from(
    new Set(
      sectors
        .flatMap((sector) => sector.stocks)
        .map((stock) => stock.secid)
        .filter(
          (secid) =>
            secid &&
            !state.sparkPending.has(secid) &&
            shouldFetchSparkline(state.sparklines.get(secid)),
        ),
    ),
  );

  if (secids.length === 0) return;

  secids.forEach((secid) => state.sparkPending.add(secid));
  render();

  for (const group of chunk(secids, SPARKLINE_BATCH_SIZE)) {
    try {
      const sparks = await fetchLocalSparklines(group);
      for (const [secid, spark] of sparks) {
        state.sparklines.set(secid, spark);
      }
      for (const secid of group) {
        if (!sparks.has(secid)) {
          state.sparklines.set(secid, {
            secid,
            points: [],
            fetchedAt: Date.now(),
            cacheDate: localDateKey(),
          });
        }
      }
    } catch (error) {
      console.warn("Sparkline request failed.", error);
      for (const secid of group) {
        state.sparklines.set(secid, {
          secid,
          points: [],
          fetchedAt: Date.now(),
          cacheDate: localDateKey(),
        });
      }
    } finally {
      group.forEach((secid) => state.sparkPending.delete(secid));
      renderAfterBackgroundUpdate();
    }
  }
}

function resetSparklinesIfNewDay() {
  const today = localDateKey();
  if (state.sparkCacheDate === today) return;

  state.sparkCacheDate = today;
  state.sparklines.clear();
  state.sparkPending.clear();
  state.signalSparklines.clear();
  state.signalSparkPending.clear();
}

function shouldFetchSparkline(spark) {
  if (!spark) return true;
  if (spark.cacheDate !== localDateKey()) return true;

  const fetchedAt = Number(spark.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return true;
  return Date.now() - fetchedAt > SPARKLINE_REFRESH_MS;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function marketSession(now = new Date(), includeHongKong = state.sectors.some(
  (sector) => sector.stocks.some((stock) => /^116\.\d{5}$/.test(stock.secid)),
)) {
  const day = now.getDay();
  const isWeekday = day >= 1 && day <= 5;
  const minute = now.getHours() * 60 + now.getMinutes();
  const second = minute * 60 + now.getSeconds();

  if (!isWeekday) {
    return closedSession("休市", nextWeekdayAt(now, 9, 15));
  }
  if (minute < 9 * 60 + 15) {
    return closedSession("等待集合竞价", todayAt(now, 9, 15));
  }
  if (second < (9 * 60 + 25) * 60 + 30) {
    return openSession("集合竞价", "auction", AUCTION_UPDATE_INTERVAL_MS);
  }
  if (minute < 9 * 60 + 30) {
    return closedSession("竞价撮合中", todayAt(now, 9, 30));
  }
  if (minute < 11 * 60 + 30) {
    return openSession("连续竞价", "trading", UPDATE_INTERVAL_MS);
  }
  if (minute < 13 * 60) {
    if (includeHongKong && minute < 12 * 60) {
      return openSession("港股交易中", "hongkong", UPDATE_INTERVAL_MS);
    }
    return closedSession("午间休市", todayAt(now, 13, 0));
  }
  if (minute < 15 * 60) {
    return openSession("连续竞价", "trading", UPDATE_INTERVAL_MS);
  }
  if (includeHongKong && minute <= 16 * 60 + 10) {
    return openSession(minute < 16 * 60 ? "港股交易中" : "港股收盘竞价", "hongkong", UPDATE_INTERVAL_MS);
  }

  return closedSession("已收盘", nextWeekdayAt(now, 9, 15));

  function openSession(label, phase, intervalMs) {
    return {
      label,
      phase,
      canAutoRefresh: true,
      intervalMs,
      nextAt: new Date(now.getTime() + intervalMs),
    };
  }
}

function isAuctionDisplaySession(now = new Date()) {
  const day = now.getDay();
  if (day < 1 || day > 5) return false;
  const second = (now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds();
  return second >= (9 * 60 + 15) * 60 && second < (9 * 60 + 30) * 60;
}

function closedSession(label, nextAt) {
  return {
    label,
    phase: "closed",
    canAutoRefresh: false,
    intervalMs: 0,
    nextAt,
  };
}

function todayAt(base, hour, minute) {
  const next = new Date(base);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function nextWeekdayAt(base, hour, minute) {
  const next = todayAt(base, hour, minute);
  next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function updateNextRefreshAt() {
  const session = marketSession();
  state.nextRefreshAt = session.canAutoRefresh ? Date.now() + session.intervalMs : session.nextAt.getTime();
  return session;
}

function formatScheduleTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "--:--";
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return localDateKey(date) === localDateKey() ? time : `${localDateKey(date)} ${time}`;
}

function scheduleMainRefresh() {
  window.clearTimeout(state.mainRefreshTimer);
  if (state.boardUpdatesPaused) {
    state.mainRefreshTimer = 0;
    updateStatus();
    return;
  }
  const session = updateNextRefreshAt();
  const delay = Math.max(1000, state.nextRefreshAt - Date.now());
  state.mainRefreshTimer = window.setTimeout(async () => {
    if (!document.hidden && marketSession().canAutoRefresh) {
      await refreshQuotes();
    }
    scheduleMainRefresh();
  }, delay);
  updateStatus();
}

function refreshVisibleDataImmediately() {
  if (
    document.hidden
    || state.boardUpdatesPaused
    || !marketSession().canAutoRefresh
  ) {
    return false;
  }
  void refreshQuotes({ force: true });
  void refreshIndices({ force: true });
  if (!state.signalPaused) void refreshSignalFeed();
  return true;
}

function scheduleIndexRefresh() {
  window.clearTimeout(state.indexRefreshTimer);
  const session = marketSession();
  state.nextIndexRefreshAt = session.canAutoRefresh
    ? Date.now() + INDEX_UPDATE_INTERVAL_MS
    : session.nextAt.getTime();
  const delay = Math.max(1000, state.nextIndexRefreshAt - Date.now());
  state.indexRefreshTimer = window.setTimeout(async () => {
    if (!document.hidden && marketSession().canAutoRefresh) {
      await refreshIndices();
    }
    scheduleIndexRefresh();
  }, delay);
}

function scheduleBondRefresh() {
  window.clearTimeout(state.bondRefreshTimer);
  if (state.boardUpdatesPaused) {
    state.bondRefreshTimer = 0;
    return;
  }
  const session = marketSession();
  const canFastRefreshBonds = session.canAutoRefresh && session.phase === "trading";
  const delay = canFastRefreshBonds
    ? BOND_UPDATE_INTERVAL_MS
    : Math.max(1000, session.nextAt.getTime() - Date.now());
  state.bondRefreshTimer = window.setTimeout(async () => {
    const currentSession = marketSession();
    if (!document.hidden && currentSession.canAutoRefresh && currentSession.phase === "trading") {
      await refreshBondQuotes();
    }
    scheduleBondRefresh();
  }, delay);
}

function syncAuctionSignalMode() {
  if (marketSession().phase !== "auction") return;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  if (state.auctionAutoSwitchDate === today) return;
  state.auctionAutoSwitchDate = today;
  state.signalMode = "auction";
  state.signalRequestGeneration += 1;
  state.signalLoading = false;
  signalMode.value = "auction";
  updateSignalModeView();
}

function scheduleSignalRefresh(delayMs = null) {
  window.clearTimeout(state.signalTimer);
  const session = marketSession();
  const activeInterval = state.signalMode === "auction"
    ? AUCTION_SIGNAL_UPDATE_INTERVAL_MS
    : SIGNAL_UPDATE_INTERVAL_MS;
  const delay = delayMs ?? (session.canAutoRefresh ? activeInterval : 30000);
  state.signalTimer = window.setTimeout(async () => {
    if (!document.hidden && !state.signalPaused) {
      syncAuctionSignalMode();
      await refreshSignalFeed();
    }
    scheduleSignalRefresh();
  }, Math.max(500, delay));
}

function signalMetric(event) {
  const speed = event.speed_1m === null || event.speed_1m === undefined
    ? Number.NaN
    : Number(event.speed_1m);
  if (Number.isFinite(speed)) {
    const percent = speed * 100;
    return `1分钟 ${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
  }
  const amount = event.amount_1m === null || event.amount_1m === undefined
    ? Number.NaN
    : Number(event.amount_1m);
  if (!Number.isFinite(amount)) return `评分 ${Number(event.score || 0).toFixed(1)}`;
  if (Math.abs(amount) >= 1e8) return `${(amount / 1e8).toFixed(2)}亿`;
  if (Math.abs(amount) >= 1e4) return `${(amount / 1e4).toFixed(1)}万`;
  return `${amount.toFixed(0)}元`;
}

function signalTierLabel(tier) {
  return {
    high: "高活跃",
    mid: "中活跃",
    low: "低活跃",
  }[tier] || tier || "-";
}

function updateSignalTypeSummary() {
  const selected = state.signalTypes.size;
  signalTypeSummary.textContent = selected
    ? `类型：${selected}项`
    : "类型：不限";
  signalScope.disabled = selected > 0;
  signalScope.title = selected > 0
    ? "已启用指定信号类型筛选"
    : "";
}

function renderSignalTypeOptions() {
  signalTypeOptions.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const [type, label] of Object.entries(SIGNAL_EVENT_LABELS)) {
    const option = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = type;
    checkbox.checked = state.signalTypes.has(type);
    const text = document.createElement("span");
    text.textContent = label;
    text.title = type;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.signalTypes.add(type);
      else state.signalTypes.delete(type);
      updateSignalTypeSummary();
      saveBoardViewState();
      scheduleSignalTypeRefresh();
    });
    option.append(checkbox, text);
    fragment.append(option);
  }
  signalTypeOptions.append(fragment);
  updateSignalTypeSummary();
}

function scheduleSignalTypeRefresh() {
  window.clearTimeout(state.signalFilterTimer);
  state.signalFilterTimer = window.setTimeout(async () => {
    await refreshSignalFeed({ reset: true });
    scheduleSignalRefresh();
  }, 120);
}

function signalEventSecid(event) {
  return normalizeSecidInput(event?.code);
}

function renderSignalSupport(event) {
  const support = document.createElement("span");
  support.className = "signal-support";
  const entries = [
    {
      label: "紫",
      count: Math.max(0, Number(event.purple_support_count) || 0),
      className: "is-purple",
      title: "紫线回踩确认",
    },
    {
      label: "均",
      count: Math.max(0, Number(event.intraday_average_support_count) || 0),
      className: "is-average",
      title: "分时均线回踩确认",
    },
  ];
  for (const entry of entries) {
    const chip = document.createElement("span");
    chip.className = `signal-support-chip ${entry.className}${
      entry.count >= 3 ? " is-strong" : ""
    }`;
    chip.title = `${entry.title} ${entry.count} 次`;
    const icon = document.createElement("span");
    icon.className = "signal-support-icon";
    icon.textContent = entry.label;
    const count = document.createElement("span");
    count.className = "signal-support-count";
    count.textContent = String(entry.count);
    chip.append(icon, count);
    support.append(chip);
  }
  return support;
}

function renderSignalSparkline(event) {
  const secid = signalEventSecid(event);
  const spark = state.signalSparklines.get(secid) || state.sparklines.get(secid);
  const pending = state.signalSparkPending.has(secid);
  const speed = Number(event.speed_1m);
  const tone = quoteClass(
    Number.isFinite(Number(spark?.change))
      ? Number(spark.change)
      : Number.isFinite(speed)
        ? speed * 100
        : event.direction === "up"
          ? 1
          : event.direction === "down"
            ? -1
            : 0,
  );
  const box = document.createElement("span");
  box.className = `signal-sparkline is-${tone}${pending ? " is-loading" : ""}`;
  box.title = spark?.time ? `今日分时：${spark.time}` : "今日分时";
  const points = Array.isArray(spark?.points) ? spark.points : [];
  if (points.length < 2) return box;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 76 22");
  svg.setAttribute("aria-hidden", "true");
  const baseline = document.createElementNS("http://www.w3.org/2000/svg", "line");
  baseline.setAttribute("class", "signal-spark-baseline");
  baseline.setAttribute("x1", "0");
  baseline.setAttribute("x2", "76");
  baseline.setAttribute("y1", "11");
  baseline.setAttribute("y2", "11");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("class", `spark-${tone}`);
  path.setAttribute("d", sparklinePath(points, 76, 22));
  svg.append(baseline, path);
  box.append(svg);
  return box;
}

function auctionSignalLabel(signalType) {
  return AUCTION_SIGNAL_LABELS[signalType] || signalType || "竞价联动";
}

function auctionSignalMetric(snapshot) {
  if (!snapshot) return "暂无采样";
  const change = Number.isFinite(snapshot.change) ? formatSignedPercent(snapshot.change) : "--";
  const amount = snapshot.amountStatus === "final"
    ? `成交额 ${formatAuctionAmount(snapshot.amount, false)}`
    : snapshot.amountStatus === "pending" ? "成交额待撮合" : "成交额暂缺";
  return `${change} · ${amount}`;
}

function auctionVolumeComparisonText(snapshot, phase) {
  if (Number.isFinite(snapshot?.auctionVolumePct)) {
    const pct = snapshot.auctionVolumePct;
    return `竞价昨比 ${pct > 0 && pct < 0.01 ? "<0.01" : pct.toFixed(2)}%`;
  }
  return snapshot?.stage === "indicative" && phase === "collecting" ? "竞价昨比待撮合" : "竞价昨比暂缺";
}

function auctionChartGeometry(points, width, height) {
  const valid = (Array.isArray(points) ? points : []).filter((point) =>
    Number.isFinite(point.change) && /^09:(?:1[5-9]|2[0-5]):\d{2}$/.test(point.time));
  if (!valid.length) return null;
  const values = valid.map((point) => point.change);
  const low = Math.min(-0.25, ...values);
  const high = Math.max(0.25, ...values);
  const y = (value) => 2 + (high - value) / (high - low) * (height - 4);
  const x = (time) => {
    const [, minute, second] = time.split(":").map(Number);
    return Math.max(0, Math.min(width, ((minute - 15) * 60 + second) / 630 * width));
  };
  const path = valid.map((point, index) => {
    const gap = index > 0 && point.timestamp - valid[index - 1].timestamp > 120000;
    return `${index === 0 || gap ? "M" : "L"}${x(point.time).toFixed(2)} ${y(point.change).toFixed(2)}`;
  }).join(" ");
  const last = valid.at(-1);
  return { path, baseline: y(0), phaseX: x("09:20:00"), lastX: x(last.time), lastY: y(last.change) };
}

function renderAuctionSignalSparkline(snapshot, leg = "stock") {
  const box = document.createElement("span");
  box.className = `auction-signal-curve is-${leg}`;
  const geometry = auctionChartGeometry(snapshot?.points, 180, 32);
  if (!geometry) {
    box.textContent = "暂无竞价轨迹";
    return box;
  }
  box.title = `竞价实采轨迹 · 横轴09:15—09:25:30 · 虚线为昨收；间隔超过120秒断线 · ${snapshot.sampleCount}个点 · 源时间${snapshot.time}`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 180 32");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const baseline = document.createElementNS("http://www.w3.org/2000/svg", "line");
  baseline.setAttribute("x1", "0"); baseline.setAttribute("x2", "180");
  baseline.setAttribute("y1", geometry.baseline); baseline.setAttribute("y2", geometry.baseline);
  baseline.setAttribute("class", "auction-zero-line");
  const phase = document.createElementNS("http://www.w3.org/2000/svg", "line");
  phase.setAttribute("x1", geometry.phaseX); phase.setAttribute("x2", geometry.phaseX);
  phase.setAttribute("y1", "0"); phase.setAttribute("y2", "32");
  phase.setAttribute("class", "auction-phase-line");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", geometry.path);
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("cx", geometry.lastX); dot.setAttribute("cy", geometry.lastY); dot.setAttribute("r", "1.8");
  svg.append(baseline, phase, path, dot);
  box.append(svg);
  return box;
}

function renderAuctionSignalLeg(snapshot, label, leg) {
  const box = document.createElement("span");
  box.className = `auction-signal-leg is-${leg}${snapshot?.stale ? " is-stale" : ""}`;
  const metric = document.createElement("strong");
  metric.className = "auction-signal-amount";
  metric.textContent = `${label} ${auctionSignalMetric(snapshot)}`;
  metric.title = snapshot?.amountStatus === "final"
    ? `${label}竞价成交额 ${snapshot.amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}元 · 源时间 ${snapshot.time}`
    : "当前行情源未提供撮合前的虚拟匹配金额";
  const trend = document.createElement("small");
  trend.className = `auction-signal-trend${snapshot?.trajectory?.weakening ? " is-weakening" : ""}`;
  const trajectory = snapshot?.trajectory;
  trend.textContent = trajectory
    ? `${trajectory.window} ${trajectory.label}${trajectory.sufficient ? ` ${formatSignedPercent(trajectory.firstChange)}→${formatSignedPercent(trajectory.lastChange)}` : ""}${trajectory.sparse ? " · 采样稀疏" : ""}${snapshot.stale ? " · 报价滞后" : ""}`
    : "等待行情";
  trend.title = trajectory
    ? `${trend.textContent} · ${trajectory.sampleCount}点 / ${trajectory.spanSeconds}秒 · 最长采样间隔 ${trajectory.maxGapSeconds}秒`
    : "等待有效竞价采样";
  const comparison = document.createElement("small");
  comparison.className = "auction-signal-trend";
  comparison.textContent = auctionVolumeComparisonText(snapshot, state.auctionSignalPayload?.phase);
  comparison.title = "今日开盘竞价成交量 ÷ 上一交易日全天成交量 × 100%";
  if (Number.isFinite(snapshot?.auctionVolumePct)) {
    comparison.title += ` · ${snapshot.auctionVolume.toLocaleString("zh-CN")} ÷ ${snapshot.previousDayVolume.toLocaleString("zh-CN")}（${snapshot.previousVolumeDate}）`;
  }
  box.append(metric, comparison, renderAuctionSignalSparkline(snapshot, leg), trend);
  return box;
}

function renderAuctionSignalFeed() {
  const scrollTop = signalFeed.scrollTop;
  signalFeed.replaceChildren();
  if (state.auctionSignals.length === 0) {
    const empty = document.createElement("div");
    empty.className = "signal-empty";
    if (state.signalLoading) {
      empty.textContent = "正在读取竞价信号…";
    } else if (state.auctionSignalPayload?.phase === "collecting") {
      empty.textContent = "竞价价格采集中 · 尚无满足条件的价格预警 · 成交额待撮合";
    } else {
      empty.textContent = "暂无当日竞价信号 · 09:15起采集价格，09:25后补充成交额";
    }
    signalFeed.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const signal of state.auctionSignals) {
    const query = new URLSearchParams({
      code: signal.bondCode || String(signal.bondSecid || "").split(".")[1],
      name: signal.bondName || "可转债",
    });
    const row = document.createElement("a");
    row.className = `signal-row auction-signal-row is-auction-${signal.status || "watch"}${state.auctionSignalNewIds.has(signal.id) ? " is-new" : ""}`;
    row.href = `./bond.html?${query}`;
    row.title = `${signal.reason || "竞价联动"} · ${signal.source || "QMT"}`;

    const time = document.createElement("span");
    time.className = "signal-time";
    time.textContent = String(signal.eventTime || "").slice(0, 8) || "--:--:--";
    time.title = `行情源时间；采集时间 ${new Date(signal.capturedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`;

    const pair = document.createElement("span");
    pair.className = "signal-bond auction-signal-pair";
    const stockName = document.createElement("span");
    stockName.className = "signal-bond-name";
    stockName.textContent = `${signal.stockName || signal.stockCode} →`;
    stockName.title = `${signal.stockName || signal.stockCode} ${signal.stockCode || ""}`;
    const bondName = document.createElement("span");
    bondName.className = "signal-bond-name";
    bondName.textContent = signal.bondName || signal.bondCode;
    bondName.title = `${bondName.textContent} ${signal.bondCode || ""}`;
    const type = document.createElement("small");
    type.className = "auction-signal-type";
    type.textContent = auctionSignalLabel(signal.signalType);
    const stage = document.createElement("small");
    stage.className = "auction-signal-stage";
    stage.textContent = signal.stage === "indicative" ? "9:25前价格预警"
      : signal.stage === "final" ? "撮合后观察" : "撮合数据待补齐";
    pair.append(stockName, bondName, type, stage);

    const detail = document.createElement("span");
    detail.className = "signal-detail auction-signal-detail";
    detail.append(renderAuctionSignalLeg(signal.stock, "正股", "stock"), renderAuctionSignalLeg(signal.bond, "转债", "bond"));
    const reason = document.createElement("span");
    reason.className = "auction-signal-reason";
    reason.textContent = signal.reason || "竞价异动";
    reason.title = `${signal.reason || ""} · 图示09:15—09:25:30，竖线09:20，横虚线昨收`;
    row.append(time, pair, detail, reason);
    fragment.append(row);
  }
  signalFeed.append(fragment);
  signalFeed.scrollTop = scrollTop;
}

function updateSignalModeView() {
  const auction = state.signalMode === "auction";
  signalMonitor.classList.toggle("is-auction-mode", auction);
  if (signalMonitorTitle) {
    signalMonitorTitle.textContent = auction ? "竞价量价与走势" : "QMT 主力监控精灵";
  }
  const intradayControls = [
    signalScope?.closest("label"),
    signalAmountFilter?.closest("label"),
    signalAmplitudeFilter?.closest("label"),
    signalTypeFilter,
  ];
  intradayControls.forEach((node) => {
    if (node) node.hidden = auction;
  });
}

function updateAuctionMonitorStatus(payload = null, error = null) {
  signalMonitor.classList.toggle("is-live", !error && Boolean(payload));
  signalMonitor.classList.toggle("is-error", Boolean(error));
  if (state.signalPaused) {
    signalMonitorStatus.textContent = `已暂停自动更新 · 保留 ${state.auctionSignals.length} 条`;
    return;
  }
  if (error) {
    signalMonitorStatus.textContent = "竞价联动读取失败 · 将自动重试";
    return;
  }
  if (!payload) {
    signalMonitorStatus.textContent = "正在读取竞价联动";
    return;
  }
  const phaseLabels = { collecting: "竞价采集中", frozen: "竞价已冻结", closed: "非竞价时段" };
  const requested = Number(payload.requestedPairs) || 0;
  const sampled = Number(payload.sampledPairs) || 0;
  const coverage = requested ? `${sampled}/${requested}对` : "暂无配对";
  const partial = payload.coverage?.partial ? ` · 单边${payload.coverage.partial}对` : "";
  const stale = payload.coverage?.stale ? ` · 滞后${payload.coverage.stale}对` : "";
  const amountNote = payload.amountReady ? "成交额已返回"
    : payload.phase === "collecting" ? "价格预警 · 金额待撮合" : "成交额覆盖不足";
  const quoteTime = payload.latestQuoteTime ? ` · 源时间${payload.latestQuoteTime}` : "";
  const count = payload.totalSignals > state.auctionSignals.length
    ? `前${state.auctionSignals.length}/${payload.totalSignals}条` : `${state.auctionSignals.length}条`;
  signalMonitorStatus.textContent = `${phaseLabels[payload.phase] || "竞价状态未知"} · ${amountNote} · ${coverage}${partial}${stale}${quoteTime} · ${count}`;
  signalMonitorStatus.title = "每3秒刷新；曲线横轴09:15—09:25:30，竖线09:20，横虚线昨收。走势至少3点且跨度30秒，优先看09:20后。成交额观察门槛：正股500万元、转债50万元。";
}

async function refreshAuctionSignalFeed(options = {}) {
  if (state.signalLoading && !options.reset) return;
  if (options.reset) {
    state.signalRequestGeneration += 1;
    state.auctionSignals = [];
    state.auctionSignalDate = "";
    state.auctionSignalPayload = null;
    state.auctionSignalNewIds = new Set();
  }
  const requestGeneration = state.signalRequestGeneration;
  state.signalLoading = true;
  if (!state.auctionSignals.length) renderAuctionSignalFeed();
  try {
    const payload = await fetchJson("/api/auction/signals", 8000);
    if (requestGeneration !== state.signalRequestGeneration || state.signalMode !== "auction") return;
    const previousKeys = new Set(
      state.auctionSignals.map((signal) => `${signal.bondSecid}:${signal.signalType}`),
    );
    state.auctionSignals = Array.isArray(payload.signals) ? payload.signals : [];
    state.auctionSignalNewIds = new Set(
      state.auctionSignals
        .filter((signal) => !previousKeys.has(`${signal.bondSecid}:${signal.signalType}`))
        .map((signal) => signal.id),
    );
    state.auctionSignalDate = String(payload.date || "");
    state.auctionSignalPayload = payload;
    if (!options.reset && state.auctionSignalNewIds.size > 0) {
      const top = state.auctionSignals.find((signal) => state.auctionSignalNewIds.has(signal.id));
      if (top) {
        flashStatus(
          `竞价联动：${top.stockName || top.stockCode} → ${top.bondName || top.bondCode} · ${auctionSignalLabel(top.signalType)}`,
          3500,
        );
      }
    }
    renderAuctionSignalFeed();
    updateAuctionMonitorStatus(payload);
  } catch (error) {
    if (requestGeneration !== state.signalRequestGeneration || state.signalMode !== "auction") return;
    console.warn("Auction signal request failed.", error);
    updateAuctionMonitorStatus(null, error);
  } finally {
    if (requestGeneration === state.signalRequestGeneration) {
      state.signalLoading = false;
      if (state.signalMode === "auction") renderAuctionSignalFeed();
    }
  }
}

async function ensureSignalSparklines() {
  resetSparklinesIfNewDay();
  const secids = Array.from(
    new Set(
      state.signalEvents
        .slice(0, SIGNAL_SPARKLINE_LIMIT)
        .map(signalEventSecid)
        .filter(
          (secid) =>
            secid &&
            !state.signalSparkPending.has(secid) &&
            shouldFetchSparkline(
              state.signalSparklines.get(secid) || state.sparklines.get(secid),
            ),
        ),
    ),
  );
  if (secids.length === 0) return;
  secids.forEach((secid) => state.signalSparkPending.add(secid));
  renderSignalFeed();

  for (const group of chunk(secids, SPARKLINE_BATCH_SIZE)) {
    try {
      const sparks = await fetchLocalSparklines(group);
      for (const [secid, spark] of sparks) {
        state.signalSparklines.set(secid, spark);
      }
      for (const secid of group) {
        if (!sparks.has(secid)) {
          state.signalSparklines.set(secid, {
            secid,
            points: [],
            fetchedAt: Date.now(),
            cacheDate: localDateKey(),
          });
        }
      }
    } catch (error) {
      console.warn("Signal sparkline request failed.", error);
    } finally {
      group.forEach((secid) => state.signalSparkPending.delete(secid));
      renderSignalFeed();
    }
  }
}

function renderSignalFeed(newIds = new Set()) {
  if (state.signalMode === "auction") {
    renderAuctionSignalFeed();
    return;
  }
  signalFeed.replaceChildren();
  if (state.signalEvents.length === 0) {
    const empty = document.createElement("div");
    empty.className = "signal-empty";
    empty.textContent = state.signalLoading
      ? "正在读取QMT盘中信号…"
      : state.signalTypes.size
        ? "当前勾选的信号类型暂无记录"
        : "当前筛选范围内暂无信号";
    signalFeed.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const event of state.signalEvents) {
    const query = new URLSearchParams({
      code: event.code,
      name: event.name || "可转债",
    });
    const row = document.createElement("a");
    row.className = `signal-row ${
      event.direction === "up" ? "is-up" : event.direction === "down" ? "is-down" : ""
    }${newIds.has(event.id) ? " is-new" : ""}`;
    row.href = `./bond.html?${query}`;
    row.title = [
      SIGNAL_EVENT_LABELS[event.event_type] || event.event_type,
      event.confidence,
      event.source_bar_time ? `来源分钟 ${event.source_bar_time}` : "",
    ].filter(Boolean).join(" · ");

    const time = document.createElement("span");
    time.className = "signal-time";
    time.textContent = String(event.event_time || "").slice(11, 19);

    const bond = document.createElement("span");
    bond.className = "signal-bond";
    const bondName = document.createElement("span");
    bondName.className = "signal-bond-name";
    bondName.textContent = event.name || event.code;
    bondName.title = event.name || event.code;
    const code = document.createElement("small");
    code.className = "signal-code";
    code.textContent = event.code;
    const tier = document.createElement("small");
    tier.className = "signal-tier";
    tier.textContent = signalTierLabel(event.tier);
    const tags = document.createElement("span");
    tags.className = "signal-tags";
    for (const tag of (event.tags || []).slice(0, 2)) {
      const chip = document.createElement("small");
      chip.textContent = tag;
      tags.append(chip);
    }
    bond.append(bondName, code, tier, tags);

    const type = document.createElement("span");
    type.className = "signal-type";
    type.textContent = SIGNAL_EVENT_LABELS[event.event_type] || event.event_type;

    const price = document.createElement("span");
    price.className = "signal-price";
    price.textContent = Number(event.price).toFixed(3);

    const metric = document.createElement("span");
    metric.className = "signal-metric";
    metric.textContent = signalMetric(event);

    const detail = document.createElement("span");
    detail.className = "signal-detail";
    detail.append(type, renderSignalSparkline(event), price, metric);

    row.append(
      time,
      bond,
      detail,
      renderSignalSupport(event),
    );
    fragment.append(row);
  }
  signalFeed.append(fragment);
}

function signalHealthState(payload, health) {
  const status = health?.status && typeof health.status === "object" ? health.status : {};
  const updatedAt = Date.parse(String(status.updated_at || health?.status_updated_at || health?.database_updated_at || ""));
  const ageMs = Number.isFinite(updatedAt) ? Math.max(0, Date.now() - updatedAt) : Number.POSITIVE_INFINITY;
  const statusAgeSeconds = Number(health?.status_age_seconds);
  const statusMaxAgeSeconds = Number(health?.status_max_age_seconds);
  const returnedCodes = Math.max(
    0,
    Number(health?.last_returned_codes ?? status.last_returned_codes) || 0,
  );
  const requestedCodes = Math.max(
    0,
    Number(status.indicator_warmup?.requested_codes)
      || Number(payload?.active_monitor_code_count)
      || 0,
  );
  const tradingDate = String(status.trading_date || health?.latest_trading_date || payload?.trading_date || "");
  const calendarDate = String(health?.calendar_date || "");
  const processAlive = Boolean(health?.monitor_alive);
  const statusFresh = Number.isFinite(statusAgeSeconds) && Number.isFinite(statusMaxAgeSeconds)
    ? statusAgeSeconds <= statusMaxAgeSeconds
    : ageMs <= 30_000;
  const currentTradingDate = !calendarDate || !tradingDate || tradingDate === calendarDate;
  return {
    processAlive,
    statusFresh,
    currentTradingDate,
    returnedCodes,
    requestedCodes,
    tradingDate,
    reason: String(health?.reason || ""),
    updatedTime: Number.isFinite(updatedAt)
      ? new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false })
      : "--:--:--",
  };
}

function signalHealthReasonLabel(reason) {
  const labels = {
    database_missing: "QMT数据库缺失",
    monitor_process_not_running: "监控进程已停止",
    monitor_status_missing: "监控状态缺失",
    monitor_status_timestamp_missing: "监控时间缺失",
    monitor_status_stale: "监控状态已过期",
    today_database_missing: "今日数据库缺失",
    monitor_trading_date_mismatch: "监控数据日不一致",
    miniqmt_returned_zero_quotes: "QMT未返回有效行情",
    quote_timestamp_missing: "行情时间缺失",
    quote_data_stale: "QMT行情已过期",
  };
  if (labels[reason]) return labels[reason];
  if (reason.startsWith("monitor_status_")) return "监控状态异常";
  return reason;
}

function updateSignalMonitorStatus(
  payload = state.signalStatusPayload,
  health = state.signalHealth,
  error = null,
) {
  if (state.signalMode === "auction") {
    updateAuctionMonitorStatus(state.auctionSignalPayload, error);
    return;
  }
  const healthState = signalHealthState(payload, health);
  const hasHealthVerdict = typeof health?.ok === "boolean"
    || typeof health?.degraded === "boolean";
  const healthFailed = Boolean(health) && (
    hasHealthVerdict
      ? health.degraded === true || health.ok === false
      : !healthState.processAlive || !healthState.statusFresh
  );
  const isLive = healthState.processAlive
    && !healthFailed
    && healthState.statusFresh
    && healthState.currentTradingDate
    && healthState.returnedCodes > 0;
  signalMonitor.classList.toggle("is-live", isLive && !state.signalPaused);
  signalMonitor.classList.toggle("is-error", Boolean(error) || healthFailed);
  if (state.signalPaused) {
    signalMonitorStatus.textContent = `已暂停自动更新 · 保留 ${state.signalEvents.length} 条`;
    return;
  }
  if (error) {
    signalMonitorStatus.textContent = "连接失败 · 将自动重试";
    return;
  }
  if (!payload || !health) {
    signalMonitorStatus.textContent = "正在连接";
    return;
  }
  const dateNote = payload.data_is_stale ? ` · 数据日 ${payload.trading_date}` : "";
  const coverage = healthState.requestedCodes
    ? `${healthState.returnedCodes}/${healthState.requestedCodes} 只`
    : `${healthState.returnedCodes} 只`;
  if (healthFailed && healthState.reason) {
    signalMonitorStatus.textContent = `${signalHealthReasonLabel(healthState.reason)} · 最近返回 ${coverage} · 展示 ${state.signalEvents.length} 条${dateNote}`;
    return;
  }
  if (healthState.reason === "healthy_outside_market_session") {
    signalMonitorStatus.textContent = `非交易时段 · 最近有效 ${coverage} · 展示 ${state.signalEvents.length} 条${dateNote}`;
    return;
  }
  if (healthState.reason === "healthy_waiting_for_open") {
    signalMonitorStatus.textContent = "监控已就绪 · 等待 09:30 开盘后采样";
    return;
  }
  if (!healthState.processAlive) {
    signalMonitorStatus.textContent = `监控进程已停止 · 最近返回 ${coverage} · 展示 ${state.signalEvents.length} 条${dateNote}`;
    return;
  }
  if (!healthState.statusFresh) {
    signalMonitorStatus.textContent = `监控状态已过期 · ${healthState.updatedTime} · 最近返回 ${coverage} · 展示 ${state.signalEvents.length} 条${dateNote}`;
    return;
  }
  if (!healthState.currentTradingDate) {
    signalMonitorStatus.textContent = `等待今日行情 · 数据日 ${healthState.tradingDate} · 最近返回 ${coverage} · 展示 ${state.signalEvents.length} 条`;
    return;
  }
  if (healthState.returnedCodes === 0) {
    signalMonitorStatus.textContent = `等待QMT有效行情 · 实际返回 ${coverage} · 展示 ${state.signalEvents.length} 条${dateNote}`;
    return;
  }
  signalMonitorStatus.textContent = `实时 · ${healthState.updatedTime} · QMT有效 ${coverage} · 展示 ${state.signalEvents.length} 条${dateNote}`;
}

function monitoredSignalCodes() {
  return [];
}

async function refreshSignalFeed(options = {}) {
  if (state.signalMode === "auction") {
    await refreshAuctionSignalFeed(options);
    return;
  }
  const monitoredCodes = monitoredSignalCodes();
  const signature = monitoredCodes.length ? monitoredCodes.join(",") : "*";
  const sourcesChanged = signature !== state.signalCodeSignature;
  state.signalCodeSignature = signature;
  state.signalCodeCount = monitoredCodes.length;
  const resetRequested = Boolean(options.reset || sourcesChanged);
  if (state.signalLoading && !resetRequested) return;
  if (resetRequested) {
    state.signalRequestGeneration += 1;
    state.signalLatestId = 0;
    state.signalEvents = [];
  }
  const requestGeneration = state.signalRequestGeneration;
  state.signalLoading = true;
  if (resetRequested) renderSignalFeed();
  try {
    const query = new URLSearchParams({
      scope: state.signalScope,
      limit: String(SIGNAL_EVENT_LIMIT),
    });
    if (monitoredCodes.length) query.set("codes", monitoredCodes.join(","));
    if (state.signalTypes.size > 0) {
      query.set("types", [...state.signalTypes].join(","));
    }
    if (state.signalMinDailyAmount > 0) {
      query.set("min_daily_amount", String(state.signalMinDailyAmount));
    }
    if (state.signalMinDailyAmplitude > 0) {
      query.set("min_daily_amplitude", String(state.signalMinDailyAmplitude));
    }
    if (state.signalLatestId > 0) {
      query.set("after_id", String(state.signalLatestId));
    }
    if (state.signalTradingDate) {
      query.set("trading_date", state.signalTradingDate);
    }
    const [payload, health] = await Promise.all([
      fetchJson(`/api/miniqmt/events?${query}`, 8000),
      fetchJson("/api/miniqmt/health", 8000),
    ]);
    if (requestGeneration !== state.signalRequestGeneration) return;
    const responseTradingDate = String(payload.trading_date || "");
    const cursorReset = Boolean(payload.cursor_reset);
    if (
      !cursorReset
      && responseTradingDate
      && state.signalTradingDate
      && responseTradingDate !== state.signalTradingDate
    ) {
      state.signalTradingDate = responseTradingDate;
      return refreshSignalFeed({ reset: true });
    }
    if (cursorReset) {
      state.signalEvents = [];
      state.signalLatestId = 0;
    }
    if (responseTradingDate) state.signalTradingDate = responseTradingDate;
    const incoming = Array.isArray(payload.events) ? payload.events : [];
    const existingIds = new Set(state.signalEvents.map((event) => event.id));
    const additions = incoming.filter((event) => !existingIds.has(event.id));
    const newIds = new Set(additions.map((event) => event.id));
    if (state.signalLatestId === 0) {
      state.signalEvents = incoming.slice(0, SIGNAL_EVENT_LIMIT);
    } else if (additions.length > 0) {
      state.signalEvents = [...additions, ...state.signalEvents]
        .sort((left, right) => right.id - left.id)
        .slice(0, SIGNAL_EVENT_LIMIT);
    }
    state.signalLatestId = Math.max(
      Number(payload.latest_id || 0),
      state.signalLatestId,
      ...state.signalEvents.map((event) => Number(event.id || 0)),
    );
    renderSignalFeed(newIds);
    void ensureSignalSparklines();
    state.signalStatusPayload = payload;
    state.signalHealth = health;
    updateSignalMonitorStatus(payload, health);
  } catch (error) {
    if (requestGeneration !== state.signalRequestGeneration) return;
    console.warn("QMT signal monitor failed.", error);
    updateSignalMonitorStatus(null, null, error);
  } finally {
    if (requestGeneration === state.signalRequestGeneration) {
      state.signalLoading = false;
      if (!state.signalEvents.length) renderSignalFeed();
    }
  }
}

function retainQuotesForStocks(stocks) {
  const allowedSecids = new Set(stocks.map((stock) => stock.secid).filter(Boolean));
  state.quotes = new Map(
    [...state.quotes].filter(([secid]) => allowedSecids.has(secid)),
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hydrateSectors(quoteMap) {
  return state.sectors.map((sector) => {
    const stocks = sector.stocks.map((stock) => ({
      ...stock,
      ...(quoteMap.get(stock.secid) ?? null),
      quoteUnavailable: !quoteMap.has(stock.secid),
    }));

    const changes = stocks.map((stock) => stock.change).filter(Number.isFinite);
    const change =
      changes.length > 0 ? changes.reduce((total, value) => total + value, 0) / changes.length : 0;

    return {
      ...sector,
      stocks,
      change,
    };
  });
}

function quoteClass(change) {
  if (change > 0.005) return "up";
  if (change < -0.005) return "down";
  return "flat";
}

function barScale(change) {
  if (!Number.isFinite(change)) return 0;
  return Math.min(1, Math.abs(change) / 10);
}

function dragPlaceAfter(event, element) {
  const rect = element.getBoundingClientRect();
  if (rect.width > rect.height * 1.6) {
    return event.clientX > rect.left + rect.width / 2;
  }
  return event.clientY > rect.top + rect.height / 2;
}

function hasDragType(event, type) {
  return Array.from(event.dataTransfer?.types || []).includes(type);
}

function formatPrice(price, secid = "") {
  if (!Number.isFinite(price)) return "-";
  if (isConvertibleBondSecid(secid)) return price.toFixed(price >= 100 ? 1 : 2);
  if (isFundSecid(secid)) return price.toFixed(3);
  if (isHongKongSecid(secid)) return price >= 100 ? price.toFixed(1) : price.toFixed(2);
  if (Math.abs(price) >= 100) return price.toFixed(0);
  if (Math.abs(price) >= 10) return price.toFixed(1);
  return price.toFixed(2);
}

function isConvertibleBondSecid(secid) {
  const code = codeForEditor(secid);
  return /^(110|111|113|118|123|127|128)\d{3}$/.test(code);
}

function isFundSecid(secid) {
  const code = codeForEditor(secid);
  return /^[01]\.(15|16|50|51|52|56|58)\d{4}$/.test(String(secid || "")) || /^(15|16|50|51|52|56|58)\d{4}$/.test(code);
}

function isHongKongSecid(secid) {
  return /^116\.\d{5}$/.test(String(secid || ""));
}

function stockTypeLabel(item) {
  if (item.type === "Bond") return "转债";
  if (item.type === "HKStock") return "港股";
  if (item.type === "Fund") return /ETF/i.test(item.name || "") ? "ETF" : "基金";
  return "股票";
}

function formatPercent(change, withUnit = false) {
  if (!Number.isFinite(change)) return "-";
  const value = change.toFixed(1);
  return withUnit ? `${value}%` : value;
}

function formatSignedPercent(change) {
  if (!Number.isFinite(change)) return "-";
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

function formatIndexPrice(price) {
  if (!Number.isFinite(price)) return "-";
  if (Math.abs(price) >= 10000) return price.toFixed(0);
  if (Math.abs(price) >= 1000) return price.toFixed(1);
  return price.toFixed(2);
}

function formatMetricValue(value, unit = "") {
  if (!Number.isFinite(value)) return "-";
  const text = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${text}${unit}`;
}

function quoteUrl(secid) {
  return `https://quote.eastmoney.com/unify/r/${secid}`;
}

function miniQmtBondUrl(stock) {
  const query = new URLSearchParams({
    code: codeForEditor(stock.secid),
    name: stock.name,
  });
  return `./bond.html?${query}`;
}

async function openQuoteInTdx(stock) {
  flashStatus(`正在通达信打开 ${stock.name}...`);
  try {
    await postJson("/api/open-tdx", { secid: stock.secid, code: codeForEditor(stock.secid) }, 7000);
    flashStatus(`已发送到通达信：${stock.name}`);
  } catch (error) {
    console.warn("Tdx open failed, falling back to Eastmoney.", error);
    flashStatus(`通达信打开失败，已打开东方财富：${stock.name}`, 3500);
    const opened = window.open(quoteUrl(stock.secid), "_blank", "noreferrer");
    if (!opened) window.location.href = quoteUrl(stock.secid);
  }
}

function flashStatus(message, timeoutMs = 2200) {
  window.clearTimeout(temporaryStatusTimer);
  statusNode.textContent = message;
  temporaryStatusTimer = window.setTimeout(updateStatus, timeoutMs);
}

function renderIndices() {
  globalIndicesNode.replaceChildren();

  if (state.indices.length === 0) {
    const placeholder = document.createElement("span");
    placeholder.className = "index-placeholder";
    placeholder.textContent = "指数连接中";
    globalIndicesNode.append(placeholder);
    return;
  }

  for (const item of state.indices) {
    const tone = quoteClass(Number(item.percent));
    const pill = document.createElement("div");
    pill.className = `index-pill index-${tone}${item.kind === "metric" ? " is-metric" : ""}`;
    pill.title =
      item.note ||
      `${item.group ? `${item.group}·` : ""}${item.name} ${formatIndexPrice(Number(item.price))} ${formatSignedPercent(
        Number(item.percent),
      )}`;

    const name = document.createElement("span");
    name.className = "index-name";
    name.textContent = item.name;

    const price = document.createElement("span");
    price.className = "index-price";
    price.textContent =
      item.kind === "metric"
        ? formatMetricValue(Number(item.price), item.unit || "")
        : formatIndexPrice(Number(item.price));

    const change = document.createElement("span");
    change.className = "index-change";
    change.textContent =
      item.kind === "metric" ? "估" : formatSignedPercent(Number(item.percent));

    pill.append(name, change, renderIndexSparkline(item), price);
    globalIndicesNode.append(pill);
  }

  renderKospiMarketChart();
}

function renderKospiMarketChart() {
  renderNativeMarketChart(kospiMarketChart, state.indices.find((row) => row.key === "kospi"));
}

function renderNativeMarketChart(target, item, { isYield = false, failed = false } = {}) {
  if (!target) return;
  target.replaceChildren();
  const points = Array.isArray(item?.points)
    ? item.points.map(Number).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const price = Number(item?.price);
  const percent = Number(item?.percent);
  if (!item || !Number.isFinite(price) || !Number.isFinite(percent) || (!isYield && points.length < 2)) {
    target.className = "native-market-chart";
    const loading = document.createElement("span");
    loading.className = "native-market-loading";
    loading.textContent = isYield ? "美债收益率暂不可用，稍后重试" : "今日KOSPI分时暂未到达";
    target.append(loading);
    return;
  }

  const tone = quoteClass(percent);
  target.className = `native-market-chart is-${tone}`;

  const quote = document.createElement("div");
  quote.className = "native-market-quote";
  const priceNode = document.createElement("strong");
  priceNode.className = "native-market-price";
  priceNode.textContent = isYield ? `${price.toFixed(item.priceDecimals ?? 4)}%` : formatIndexPrice(price);
  const changeNode = document.createElement("span");
  changeNode.className = "native-market-change";
  changeNode.textContent = isYield
    ? `${item.changeBps > 0 ? "+" : ""}${item.changeBps.toFixed(1)} bp`
    : formatSignedPercent(percent);
  if (isYield) changeNode.title = "较前收盘变化：1 bp = 0.01 个百分点";
  quote.append(priceNode, changeNode);

  const chartPoints = [...points, price];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "native-market-plot");
  svg.setAttribute("viewBox", "0 0 100 55");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");

  const previousClose = isYield ? item.previousClose : price / (1 + percent / 100);
  const low = Math.min(...chartPoints, previousClose);
  const high = Math.max(...chartPoints, previousClose);
  const span = high - low || 1;
  const yFor = (value) => 52 - ((value - low) / span) * 49;

  const baseline = document.createElementNS("http://www.w3.org/2000/svg", "line");
  baseline.setAttribute("class", "native-market-baseline");
  baseline.setAttribute("x1", "0");
  baseline.setAttribute("x2", "100");
  baseline.setAttribute("y1", String(yFor(previousClose)));
  baseline.setAttribute("y2", String(yFor(previousClose)));

  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("class", "native-market-line");
  const sampleTimes = item.sparkTimestamps;
  const useSampleTime = isYield && item.chartKind === "sampled" &&
    sampleTimes?.length === points.length && sampleTimes.at(-1) > sampleTimes[0];
  line.setAttribute(
    "d",
    points
      .map((value, index) => {
        const x = useSampleTime
          ? (sampleTimes[index] - sampleTimes[0]) / (sampleTimes.at(-1) - sampleTimes[0]) * 98
          : points.length > 1 ? (index / (points.length - 1)) * 98 : 0;
        return `${index === 0 || item.sparkBreaks?.[index] ? "M" : "L"}${x.toFixed(2)},${yFor(value).toFixed(2)}`;
      })
      .join(" "),
  );

  const latest = document.createElementNS("http://www.w3.org/2000/svg", "line");
  latest.setAttribute("class", "native-market-latest");
  latest.setAttribute("x1", "98");
  latest.setAttribute("y1", String(yFor(points.at(-1))));
  latest.setAttribute("x2", "100");
  latest.setAttribute("y2", String(yFor(price)));
  svg.append(baseline, line, latest);

  const meta = document.createElement("div");
  meta.className = "native-market-meta";
  const session = document.createElement("span");
  const chartDate = item.sparkDate || item.date || "今日";
  session.textContent = isYield
    ? item.timetag ? `报价 ${item.time} 北京` : "源报价时间未提供"
    : `${chartDate} · ${item.sparkTime || "--:--"} KST`;
  const quoteTime = document.createElement("span");
  const quoteAgeMinutes = item.timetag ? Math.max(0, Math.floor((Date.now() / 1000 - item.timetag) / 60)) : null;
  const fetchedTime = item.fetchedAt ? new Date(item.fetchedAt).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai", hour12: false,
  }) : "--";
  quoteTime.textContent = failed
    ? "更新失败 · 保留上次行情"
    : isYield
      ? quoteAgeMinutes >= 15
        ? `报价时间距今 ${quoteAgeMinutes} 分钟`
        : `获取 ${fetchedTime} · 30秒刷新`
      : item.time ? `报价 ${item.time} 北京时间` : "延迟行情";
  meta.title = isYield
    ? `${item.source} · 源报价 ${item.timetag ? `${item.date} ${item.time}` : "时间未提供"}（北京时间） · 本站采样 ${item.sparkStartDate || "--"} ${item.sparkTimes?.[0] || "--"} 至 ${chartDate} ${item.sparkTime || "--"}，非全天分时 · 最近成功获取 ${fetchedTime}`
    : `${session.textContent} · ${quoteTime.textContent}`;
  if (isYield) meta.classList.add("native-market-meta-stacked");
  meta.append(session, quoteTime);

  let plot = svg;
  if (points.length < 2) {
    const unavailable = document.createElement("span");
    unavailable.className = "native-market-plot-unavailable";
    unavailable.textContent = item.chartKind === "sampled" ? "正在积累采样点" : "分时暂不可用";
    plot = unavailable;
  }
  if (isYield && item.chartKind === "sampled") {
    const wrapper = document.createElement("div");
    wrapper.className = "native-market-sampled";
    const caption = document.createElement("small");
    caption.textContent = points.length ? `本次采样 · ${item.sparkTimes[0].slice(0, 5)} 起` : "本站采样 · 非全天分时";
    wrapper.append(caption, plot);
    plot = wrapper;
  }
  target.append(quote, plot, meta);
}

function renderIndexSparkline(item) {
  const tone = quoteClass(Number(item.percent ?? item.sparkChange));
  const box = document.createElement("span");
  box.className = `index-sparkline is-${tone}`;
  const source = item.sparkSource || "今日分时";
  box.title = item.sparkTime ? `${source}：${item.sparkTime}` : source;

  let points = Array.isArray(item.points) ? item.points : [];
  if (points.length < 2) {
    return box;
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 68 18");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("class", `spark-${tone}`);
  path.setAttribute("d", sparklinePath(points, 68, 18));
  svg.append(path);
  box.append(svg);
  return box;
}

function render() {
  const auctionDisplay = isAuctionDisplaySession();
  state.auctionPresentationActive = auctionDisplay;
  grid.classList.toggle("is-auction", auctionDisplay);
  if (state.activeView === "themes") {
    renderThemeBondBoard();
    return;
  }

  if (!isRenaming()) {
    state.needsRenderAfterRename = false;
  }

  let sectors = [...state.hydrated];
  const query = state.query.trim().toLowerCase();
  grid.classList.toggle("has-sparks", state.showSparklines);
  grid.classList.toggle("is-editing", state.editMode);

  if (state.range === "up") {
    sectors = sectors.filter((sector) => sector.change > 0);
  } else if (state.range === "down") {
    sectors = sectors.filter((sector) => sector.change < 0);
  }

  if (query) {
    sectors = sectors
      .map((sector) => {
        const sectorMatched = sector.name.toLowerCase().includes(query);
        const matchingStocks = sector.stocks.filter((stock) =>
          `${stock.name}${stock.secid}${codeForEditor(stock.secid)}`.toLowerCase().includes(query),
        );
        return sectorMatched ? sector : { ...sector, stocks: matchingStocks };
      })
      .filter((sector) => sector.name.toLowerCase().includes(query) || sector.stocks.length > 0);
  }

  if (state.sort === "change") {
    sectors.sort((a, b) => b.change - a.change);
  } else if (state.sort === "name") {
    sectors.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  } else {
    sectors.sort((a, b) => a.index - b.index);
  }

  grid.replaceChildren();

  const boardItems = buildBoardItems(sectors, Boolean(query));

  if (boardItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent =
      state.sectors.length === 0 ? "没有监控板块，点“列表”添加或恢复默认" : "没有匹配的板块";
    grid.append(empty);
    return;
  }

  for (const item of boardItems) {
    grid.append(item.type === "stack" ? renderStackCard(item) : renderSectorCard(item.sector));
  }

  ensureSparklinesFor(sectors);
}

function marketCodeToSecid(value) {
  const match = String(value || "").trim().toUpperCase().match(/^(\d{6})\.(SH|SZ)$/);
  if (!match) return normalizeSecidInput(value);
  return `${match[2] === "SH" ? "1" : "0"}.${match[1]}`;
}

function themeBondRows() {
  return state.themeRows
    .map((row) => {
      const secid = marketCodeToSecid(row.code);
      return {
        ...row,
        secid,
        ...(state.themeQuotes.get(secid) || {}),
      };
    })
    .filter((row) => row.secid && Array.isArray(row.tags) && row.tags.length > 0);
}

function formatCompactAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "--";
  if (amount >= 1e8) return `${(amount / 1e8).toFixed(amount >= 1e9 ? 1 : 2)}亿`;
  if (amount >= 1e4) return `${(amount / 1e4).toFixed(0)}万`;
  return `${amount.toFixed(0)}`;
}

function themeGroupRows(rows, tag) {
  const query = state.query.trim().toLowerCase();
  let bonds = rows.filter((row) => row.tags.includes(tag));
  if (state.range === "up") bonds = bonds.filter((row) => Number(row.change) > 0);
  if (state.range === "down") bonds = bonds.filter((row) => Number(row.change) < 0);
  if (query) {
    bonds = bonds.filter((row) =>
      `${row.name}${row.code}${row.stockName || ""}${row.tags.join("")}`.toLowerCase().includes(query),
    );
  }
  bonds.sort((left, right) => {
    const primaryDifference = Number(right.primaryTag === tag) - Number(left.primaryTag === tag);
    if (primaryDifference) return primaryDifference;
    if (state.sort === "change") return Number(right.change || 0) - Number(left.change || 0);
    if (state.sort === "name") return String(left.name).localeCompare(String(right.name), "zh-CN");
    return Number(right.amount || 0) - Number(left.amount || 0);
  });
  return bonds;
}

function renderThemeTagFilters(rows) {
  const counts = new Map(
    state.themeTagOrder.map((tag) => [tag, rows.filter((row) => row.tags.includes(tag)).length]),
  );
  if (state.activeThemeTag !== "all" && !counts.has(state.activeThemeTag)) {
    state.activeThemeTag = "all";
  }
  themeTagFilters.replaceChildren();
  const options = [
    ["all", "全部题材", state.themeTagOrder.filter((tag) => counts.get(tag) > 0).length],
    ...state.themeTagOrder.filter((tag) => counts.get(tag) > 0).map((tag) => [tag, tag, counts.get(tag)]),
  ];
  for (const [value, label, count] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `theme-tag-filter${state.activeThemeTag === value ? " is-active" : ""}`;
    button.setAttribute("aria-pressed", String(state.activeThemeTag === value));
    button.textContent = `${label} ${count}`;
    button.addEventListener("click", () => {
      state.activeThemeTag = value;
      saveBoardViewState();
      renderThemeBondBoard();
    });
    themeTagFilters.append(button);
  }
}

function renderThemeBondRow(row, tag) {
  const tone = quoteClass(Number(row.change));
  const link = document.createElement("a");
  link.className = "theme-bond-row";
  link.href = miniQmtBondUrl(row);
  link.title = `${row.name} ${row.code} · ${row.stockName || ""}`;

  const name = document.createElement("span");
  name.className = "theme-bond-name";
  const isPrimary = row.primaryTag === tag;
  name.textContent = `${isPrimary ? "★ " : ""}${row.name || row.code}`;
  name.classList.toggle("is-primary", Boolean(isPrimary));

  const spark = state.showSparklines ? renderSparkline(row) : null;
  if (spark) spark.classList.add("theme-bond-sparkline");

  const price = document.createElement("span");
  price.className = "theme-bond-price";
  price.textContent = formatPrice(Number(row.price), row.secid);

  const change = document.createElement("span");
  change.className = `theme-bond-change cell-${tone}`;
  change.textContent = formatSignedPercent(Number(row.change));

  const amount = document.createElement("span");
  amount.className = "theme-bond-amount";
  amount.textContent = `额${formatCompactAmount(row.amount)}`;

  link.append(name);
  if (spark) link.append(spark);
  link.append(price, change, amount);
  return link;
}

function renderThemeGroup(tag, bonds) {
  const changes = bonds.map((row) => Number(row.change)).filter(Number.isFinite);
  const average = changes.length
    ? changes.reduce((sum, value) => sum + value, 0) / changes.length
    : 0;
  const tone = quoteClass(average);
  const expanded = state.themeExpandedTags.has(tag);
  const visible = expanded ? bonds : bonds.slice(0, 10);

  const card = document.createElement("article");
  card.className = `theme-group-card is-${tone}`;
  card.dataset.tag = tag;
  const head = document.createElement("header");
  head.className = "theme-group-title";
  const name = document.createElement("strong");
  name.textContent = tag;
  const count = document.createElement("span");
  count.textContent = `${bonds.length}只`;
  const change = document.createElement("span");
  change.className = `theme-group-change cell-${tone}`;
  change.textContent = formatSignedPercent(average);
  head.append(name, count, change);

  const list = document.createElement("div");
  list.className = `theme-group-list${state.showSparklines ? " has-sparks" : ""}`;
  visible.forEach((row) => list.append(renderThemeBondRow(row, tag)));
  card.append(head, list);

  if (bonds.length > 10) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "theme-group-more";
    more.textContent = expanded ? "收起" : `展开其余 ${bonds.length - 10} 只`;
    more.addEventListener("click", () => {
      if (expanded) state.themeExpandedTags.delete(tag);
      else state.themeExpandedTags.add(tag);
      renderThemeBondBoard();
    });
    card.append(more);
  }
  return card;
}

function renderThemeBondBoard() {
  const rows = themeBondRows();
  renderThemeTagFilters(rows);
  themeBondGrid.replaceChildren();

  if (state.themeLoading && rows.length === 0) {
    themeBoardSummary.textContent = "正在读取转债标签和QMT实时行情…";
    themeBondGrid.innerHTML = '<div class="empty-state">正在加载题材转债…</div>';
    return;
  }

  const tags = state.activeThemeTag === "all" ? state.themeTagOrder : [state.activeThemeTag];
  const groups = tags
    .map((tag) => [tag, themeGroupRows(rows, tag)])
    .filter(([, bonds]) => bonds.length > 0);
  const quoted = rows.filter((row) => Number.isFinite(Number(row.price))).length;
  const uniqueShown = new Set(groups.flatMap(([, bonds]) => bonds.map((row) => row.code))).size;
  const time = state.themeUpdatedAt
    ? state.themeUpdatedAt.toLocaleTimeString("zh-CN", { hour12: false })
    : "--:--:--";
  themeBoardSummary.textContent = `${uniqueShown}只转债 · ${groups.length}个题材 · 实时行情 ${quoted}/${rows.length} · ${time}`;

  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.query ? "没有匹配的题材转债" : "当前筛选下没有转债";
    themeBondGrid.append(empty);
    return;
  }
  groups.forEach(([tag, bonds]) => themeBondGrid.append(renderThemeGroup(tag, bonds)));
  ensureSparklinesFor(groups.map(([name, stocks]) => ({ name, stocks })));
}

async function loadThemeBondBoard(options = {}) {
  if (state.themeLoading) return;
  if (state.themeLoaded && !options.force) {
    renderThemeBondBoard();
    return;
  }
  state.themeLoading = true;
  renderThemeBondBoard();
  try {
    const payload = await fetchJson("/api/miniqmt/tags", 15000);
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    state.themeRows = rows;
    state.themeTagOrder = Array.isArray(payload?.tagOrder) ? payload.tagOrder.map(String) : [];
    const stocks = rows.map((row) => ({ name: row.name, secid: marketCodeToSecid(row.code) }));
    const live = await fetchMiniQmtQuotes(stocks);
    state.themeQuotes = live.quotes;
    state.themeLoaded = true;
    state.themeUpdatedAt = new Date();
  } catch (error) {
    console.warn("Theme bond board request failed.", error);
    flashStatus(`题材转债读取失败：${error.message}`, 4000);
  } finally {
    state.themeLoading = false;
    renderThemeBondBoard();
  }
}

function setActiveView(view) {
  state.activeView = view === "themes" ? "themes" : "main";
  localStorage.setItem(ACTIVE_BOARD_STORAGE_KEY, state.activeView);
  const isThemes = state.activeView === "themes";
  boardTitle.textContent = isThemes ? "题材转债实时看板" : "A股/转债实时板块表";
  mainViewButton.classList.toggle("is-active", !isThemes);
  themeViewButton.classList.toggle("is-active", isThemes);
  mainViewButton.setAttribute("aria-pressed", String(!isThemes));
  themeViewButton.setAttribute("aria-pressed", String(isThemes));
  grid.hidden = isThemes;
  themeBondBoard.hidden = !isThemes;
  signalMonitor.hidden = isThemes;
  marketMonitorRow.classList.toggle("is-themes-view", isThemes);
  editListButton.hidden = isThemes;
  addSectorButton.hidden = isThemes;
  addStackButton.hidden = isThemes;
  bulkEditButton.hidden = isThemes;
  searchInput.placeholder = isThemes ? "题材 / 转债 / 正股 / 代码" : "板块 / 股票 / 转债";
  saveBoardViewState();
  render();
  if (isThemes) void loadThemeBondBoard();
}

function buildBoardItems(sectors, forceFlat = false) {
  const sectorByName = new Map(sectors.map((sector) => [sector.name, sector]));
  const usedStacks = new Set();
  const items = [];

  for (const sector of sectors) {
    const stack = forceFlat ? null : findStackBySector(sector.name);
    if (!stack) {
      items.push({ type: "sector", sector });
      continue;
    }

    if (usedStacks.has(stack.name)) continue;
    const stackSectors = stack.sectorNames.map((name) => sectorByName.get(name)).filter(Boolean);
    if (stackSectors.length > 0) {
      items.push({ type: "stack", group: stack, sectors: stackSectors });
      usedStacks.add(stack.name);
    }
  }

  if (state.editMode && !forceFlat) {
    for (const stack of state.stackGroups) {
      if (usedStacks.has(stack.name)) continue;
      const stackSectors = stack.sectorNames.map((name) => sectorByName.get(name)).filter(Boolean);
      items.push({ type: "stack", group: stack, sectors: stackSectors });
      usedStacks.add(stack.name);
    }
  }

  return items;
}

function startStackDrag(event, card, stackName) {
  if (!state.editMode) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-stack", stackName);
  card.classList.add("is-dragging");
}

function stackAverageChange(sectors) {
  const changes = sectors.map((sector) => sector.change).filter(Number.isFinite);
  return changes.length > 0 ? changes.reduce((total, value) => total + value, 0) / changes.length : 0;
}

function renderStackCard(item) {
  const { group, sectors } = item;
  const expandedSectorNames = new Set(group.expandedSectorNames);
  const changeValue = stackAverageChange(sectors);
  const cardTone = quoteClass(changeValue);
  const card = document.createElement("article");
  card.className = `sector-card stack-card is-${cardTone}${state.editMode ? " is-editing" : ""}`;
  card.dataset.stackName = group.name;
  card.draggable = state.editMode && state.renamingStackName !== group.name;
  card.title = `${group.name}：${sectors.length} 个板块叠组`;

  card.addEventListener("dragstart", (event) => {
    if (!state.editMode) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-stack", group.name);
    card.classList.add("is-dragging");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("is-dragging");
  });
  card.addEventListener("dragover", (event) => {
    if (!state.editMode) return;
    const isSector = hasDragType(event, "application/x-sector");
    const isStack = hasDragType(event, "application/x-stack");
    if (!isSector && !isStack) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    card.classList.toggle("drop-after", isStack && dragPlaceAfter(event, card));
    card.classList.add("is-drag-over");
  });
  card.addEventListener("dragleave", () => {
    card.classList.remove("is-drag-over", "drop-after");
  });
  card.addEventListener("drop", (event) => {
    if (!state.editMode) return;
    const stackName = event.dataTransfer.getData("application/x-stack");
    if (stackName) {
      event.preventDefault();
      card.classList.remove("is-drag-over", "drop-after");
      moveStack(stackName, group.name, "stack", dragPlaceAfter(event, card));
      return;
    }

    const sectorName = event.dataTransfer.getData("application/x-sector");
    if (!sectorName) return;
    event.preventDefault();
    card.classList.remove("is-drag-over", "drop-after");
    addSectorToStack(sectorName, group.name);
  });

  const head = document.createElement("header");
  head.className = "sector-head stack-head";

  if (state.editMode && state.renamingStackName !== group.name) {
    head.classList.add("has-stack-grip");
    head.draggable = true;
    head.addEventListener("dragstart", (event) => {
      if (event.target.closest("button,input")) return;
      event.stopPropagation();
      startStackDrag(event, card, group.name);
    });
    head.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
    });

    const grip = document.createElement("span");
    grip.className = "stack-grip";
    grip.textContent = "⋮";
    grip.title = "拖拽叠组排序";
    grip.draggable = true;
    grip.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      startStackDrag(event, card, group.name);
    });
    grip.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
    });
    head.append(grip);
  }

  if (state.editMode && state.renamingStackName === group.name) {
    const input = document.createElement("input");
    input.className = "sector-name-input";
    input.value = group.name;
    input.setAttribute("aria-label", `修改 ${group.name} 叠组名`);
    input.addEventListener("blur", () => {
      commitStackRenameInput(input, group.name);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        state.renamingStackName = "";
        render();
      }
    });
    head.append(input);
    window.requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  } else {
    const name = document.createElement("span");
    name.className = "sector-name stack-name";
    name.textContent = group.name;
    if (state.editMode) {
      name.classList.add("is-editable");
      name.title = "点击修改叠组名";
      name.tabIndex = 0;
      name.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startRenameStack(group.name);
      });
      name.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startRenameStack(group.name);
        }
      });
    }
    head.append(name);
  }

  const change = document.createElement("span");
  change.className = `sector-change cell-${cardTone}`;
  change.style.setProperty("--bar-scale", barScale(changeValue).toFixed(3));
  change.replaceChildren(createChangeValue(formatPercent(changeValue, true)));
  head.append(change);

  head.append(
    createEdgeButton("top", `置顶 ${group.name}`, () => moveStackToEdge(group.name, "top")),
    createEdgeButton("bottom", `置底 ${group.name}`, () => moveStackToEdge(group.name, "bottom")),
  );

  const deleteButton = document.createElement("button");
  deleteButton.className = "sector-delete";
  deleteButton.type = "button";
  deleteButton.textContent = "×";
  deleteButton.title = `解散 ${group.name}`;
  deleteButton.setAttribute("aria-label", `解散 ${group.name}`);
  deleteButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeStackGroup(group.name);
  });
  head.append(deleteButton);
  card.append(head);

  const tabs = document.createElement("div");
  if (group.name === (state.limitLadder?.stackName || "连板天梯")) {
    card.id = "board-limit-ladder";
    const caption = document.createElement("div");
    caption.id = "boardLadderCaption";
    caption.className = "board-ladder-caption";
    caption.textContent = ladderCaption();
    card.append(caption);
    window.requestAnimationFrame(updateLadderCaption);
  }
  tabs.className = "stack-tabs";
  for (const sector of sectors) {
    tabs.append(renderStackSection(group, sector, expandedSectorNames.has(sector.name)));
  }
  card.append(tabs);

  if (sectors.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-sector-hint stack-drop-hint";
    hint.textContent = state.editMode ? "把小板块拖到这里" : "空叠组";
    card.append(hint);
  }

  return card;
}

function renderStackSection(group, sector, isExpanded) {
  const tone = quoteClass(sector.change);
  const section = document.createElement("div");
  section.className = `stack-section${isExpanded ? " is-expanded" : ""}`;

  const button = document.createElement("button");
  button.className = `stack-tab stack-tab-${tone}${isExpanded ? " is-expanded" : ""}`;
  button.type = "button";
  button.title = `${sector.name} ${formatPercent(sector.change, true)}`;
  button.setAttribute("aria-expanded", String(isExpanded));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.target.closest(".stack-tab-action")) return;
    toggleStackSector(group.name, sector.name);
  });

  const toggle = document.createElement("span");
  toggle.className = "stack-toggle";
  toggle.textContent = isExpanded ? "▾" : "▸";

  const name = document.createElement("span");
  name.className = "stack-tab-name";
  name.textContent = sector.name;
  if (state.limitLadder?.groups?.some((item) => item.name === sector.name)) {
    name.textContent += ` · ${sector.stocks.length}`;
  }

  const change = document.createElement("span");
  change.className = `stack-tab-change cell-${tone}`;
  change.style.setProperty("--bar-scale", barScale(sector.change).toFixed(3));
  change.append(createChangeValue(formatPercent(sector.change, true)));

  button.append(toggle, name, change);

  if (state.editMode) {
    const moveUp = createStackTabAction("↑", `上移 ${sector.name}`, () =>
      moveStackMember(group.name, sector.name, "up"),
    );
    const moveDown = createStackTabAction("↓", `下移 ${sector.name}`, () =>
      moveStackMember(group.name, sector.name, "down"),
    );
    button.append(moveUp, moveDown);

    const add = document.createElement("span");
    add.className = "stack-tab-action stack-tab-add";
    add.textContent = "+";
    add.title = `添加到 ${sector.name}`;
    add.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openAddStockDialog(sector.name);
    });
    button.append(add);

    const remove = document.createElement("span");
    remove.className = "stack-tab-action stack-tab-remove";
    remove.textContent = "↗";
    remove.title = `移出 ${group.name}`;
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeSectorFromStack(sector.name, group.name);
    });
    button.append(remove);
  }

  section.append(button);

  if (isExpanded) {
    const stockList = document.createElement("div");
    stockList.className = "stock-list stack-section-list";
    for (const stock of sector.stocks) {
      stockList.append(renderStockRow(stock, sector.name));
    }
    if (sector.stocks.length === 0 && state.editMode) {
      const hint = document.createElement("div");
      hint.className = "empty-sector-hint";
      hint.textContent = "点 + 添加";
      stockList.append(hint);
    }
    section.append(stockList);
  }

  return section;
}

function createStackTabAction(text, title, onClick) {
  const button = document.createElement("span");
  button.className = "stack-tab-action stack-tab-move";
  button.textContent = text;
  button.title = title;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function createEdgeButton(edge, label, onClick) {
  const button = document.createElement("button");
  button.className = `sector-edge sector-edge-${edge}`;
  button.type = "button";
  button.textContent = edge === "top" ? "↑" : "↓";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function commitStackRenameInput(input, oldName) {
  try {
    renameStackGroup(oldName, input.value);
  } catch (error) {
    input.classList.add("is-error");
    input.title = error instanceof Error ? error.message : "修改失败";
    input.focus();
    input.select();
  }
}

function renderSectorCard(sector) {
  const fragment = cardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".sector-card");
  const name = fragment.querySelector(".sector-name");
  const change = fragment.querySelector(".sector-change");
  const head = fragment.querySelector(".sector-head");
  const stockList = fragment.querySelector(".stock-list");
  const cardTone = quoteClass(sector.change);

  card.classList.add(`is-${cardTone}`);
  card.classList.toggle("is-editing", state.editMode);
  card.dataset.sectorName = sector.name;
  card.draggable = state.editMode && state.renamingSectorName !== sector.name;
  card.title = `${sector.name}：成分股平均涨跌幅 ${formatPercent(sector.change, true)}`;
  if (state.editMode && state.renamingSectorName === sector.name) {
    const input = document.createElement("input");
    input.className = "sector-name-input";
    input.value = sector.name;
    input.setAttribute("aria-label", `修改 ${sector.name} 板块名`);
    input.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    input.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });
    input.addEventListener("blur", () => {
      commitSectorRenameInput(input, sector.name);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        state.renamingSectorName = "";
        render();
      }
    });
    name.replaceWith(input);
    window.requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  } else {
    name.textContent = sector.name;
    if (state.editMode) {
      name.classList.add("is-editable");
      name.title = "点击修改板块名";
      name.tabIndex = 0;
      name.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startRenameSector(sector.name);
      });
      name.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startRenameSector(sector.name);
        }
      });
      name.addEventListener("mousedown", (event) => {
        event.stopPropagation();
      });
    }
  }
  change.classList.add(`cell-${cardTone}`);
  change.style.setProperty("--bar-scale", barScale(sector.change).toFixed(3));
  change.replaceChildren(createChangeValue(formatPercent(sector.change, true)));

  card.addEventListener("dragstart", (event) => {
    if (!state.editMode) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-sector", sector.name);
    card.classList.add("is-dragging");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("is-dragging");
  });
  card.addEventListener("dragover", (event) => {
    if (!state.editMode) return;
    const isSector = hasDragType(event, "application/x-sector");
    const isStack = hasDragType(event, "application/x-stack");
    if (!isSector && !isStack) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    card.classList.toggle("drop-after", dragPlaceAfter(event, card));
    card.classList.add("is-drag-over");
  });
  card.addEventListener("dragleave", () => {
    card.classList.remove("is-drag-over", "drop-after");
  });
  card.addEventListener("drop", (event) => {
    if (!state.editMode) return;
    const stackName = event.dataTransfer.getData("application/x-stack");
    if (stackName) {
      event.preventDefault();
      moveStack(stackName, sector.name, "sector", dragPlaceAfter(event, card));
      return;
    }

    const sourceName = event.dataTransfer.getData("application/x-sector");
    if (!sourceName) return;
    event.preventDefault();
    moveSector(sourceName, sector.name, dragPlaceAfter(event, card));
  });

  head.append(
    createEdgeButton("top", `置顶 ${sector.name}`, () => moveSectorToEdge(sector.name, "top")),
    createEdgeButton("bottom", `置底 ${sector.name}`, () => moveSectorToEdge(sector.name, "bottom")),
  );

  const addButton = document.createElement("button");
  addButton.className = "sector-add";
  addButton.type = "button";
  addButton.textContent = "+";
  addButton.title = `添加到 ${sector.name}`;
  addButton.setAttribute("aria-label", `添加到 ${sector.name}`);
  addButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openAddStockDialog(sector.name);
  });
  head.append(addButton);

  const deleteButton = document.createElement("button");
  deleteButton.className = "sector-delete";
  deleteButton.type = "button";
  deleteButton.textContent = "×";
  deleteButton.title = `删除 ${sector.name}`;
  deleteButton.setAttribute("aria-label", `删除 ${sector.name}`);
  deleteButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeSector(sector.name);
  });
  head.append(deleteButton);

  for (const stock of sector.stocks) {
    stockList.append(renderStockRow(stock, sector.name));
  }

  if (sector.stocks.length === 0 && state.editMode) {
    const hint = document.createElement("div");
    hint.className = "empty-sector-hint";
    hint.textContent = "点 + 添加";
    stockList.append(hint);
  }

  return fragment;
}

function commitSectorRenameInput(input, oldName) {
  try {
    renameSector(oldName, input.value);
  } catch (error) {
    input.classList.add("is-error");
    input.title = error instanceof Error ? error.message : "修改失败";
    input.focus();
    input.select();
  }
}

function createChangeValue(text) {
  const value = document.createElement("span");
  value.className = "change-value";
  value.textContent = text;
  return value;
}

function renderStockRow(stock, sectorName) {
  const isHongKong = /^116\.\d{5}$/.test(stock.secid);
  const auctionDisplay = !isHongKong && (state.auctionPresentationActive ?? isAuctionDisplaySession());
  const tone = quoteClass(stock.change);
  const nameTone = stockNameClass(stock.change);
  const row = state.editMode ? document.createElement("div") : document.createElement("a");
  row.className = "stock-row";
  row.classList.toggle("is-cached-quote", Boolean(stock.cached));
  row.classList.toggle("is-auction", auctionDisplay);
  row.dataset.sectorName = sectorName;
  row.dataset.secid = stock.secid;
  row.draggable = state.editMode;
  if (!state.editMode) {
    if (isConvertibleBondSecid(stock.secid)) {
      row.href = miniQmtBondUrl(stock);
    } else {
      row.href = quoteUrl(stock.secid);
      row.target = "_blank";
      row.rel = "noreferrer";
    }
  }
  const priceLabel = auctionDisplay ? "集合竞价参考价" : "最新价";
  row.title = `${stock.name} ${codeForEditor(stock.secid)} ${priceLabel} ${formatPrice(stock.price, stock.secid)} 涨跌幅 ${formatPercent(
    stock.change,
    true,
  )}`;
  if (stock.cached) row.title += ` · 缓存报价 ${stock.date || ""} ${stock.time || ""} · ${stock.source || "QMT"}`;
  const ladderInfo = state.limitLadder?.stockInfo?.[stock.secid];
  if (ladderInfo && state.limitLadder.groups?.some((group) => group.name === sectorName)) {
    row.title += ` · ${state.limitLadder.baseDate} ${ladderInfo.boards}板 · ${ladderInfo.poolSource}${ladderInfo.reason ? ` · ${ladderInfo.reason}` : ""} · 行情 ${stock.date || ""} ${stock.time || "待报价"}`;
  }
  if (isHongKong) {
    row.title += ` · 港元 · ${stock.source || "新浪港股"} ${stock.date || ""} ${stock.time || ""}`;
  }
  if (state.marketFeed?.failedSecids?.includes(stock.secid)) {
    row.title += " · 本次报价未返回";
  }
  row.addEventListener("click", (event) => {
    if (state.editMode) {
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (isConvertibleBondSecid(stock.secid)) {
      window.location.href = miniQmtBondUrl(stock);
      return;
    }
    openQuoteInTdx(stock);
  });
  row.addEventListener("dragstart", (event) => {
    if (!state.editMode) return;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/x-stock",
      JSON.stringify({ sectorName, secid: stock.secid }),
    );
    row.classList.add("is-dragging");
  });
  row.addEventListener("dragend", () => {
    row.classList.remove("is-dragging");
  });
  row.addEventListener("dragover", (event) => {
    if (!state.editMode || !hasDragType(event, "application/x-stock")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    row.classList.toggle("drop-after", dragPlaceAfter(event, row));
    row.classList.add("is-drag-over");
  });
  row.addEventListener("dragleave", () => {
    row.classList.remove("is-drag-over", "drop-after");
  });
  row.addEventListener("drop", (event) => {
    if (!state.editMode) return;
    const raw = event.dataTransfer.getData("application/x-stock");
    if (!raw) return;
    event.preventDefault();
    event.stopPropagation();
    const source = JSON.parse(raw);
    moveStock(source.sectorName, source.secid, sectorName, stock.secid, dragPlaceAfter(event, row));
  });

  if (state.editMode) {
    const grip = document.createElement("span");
    grip.className = "stock-grip";
    grip.textContent = "⋮";
    grip.title = "拖拽排序";
    row.append(grip);
  }

  const name = document.createElement("span");
  name.className = `stock-name${nameTone ? ` ${nameTone}` : ""}`;
  name.textContent = stock.name;

  const price = document.createElement("span");
  price.className = "stock-price";
  price.title = priceLabel;
  price.textContent = formatPrice(stock.price, stock.secid);

  const change = document.createElement("span");
  change.className = `stock-change cell-${tone}`;
  change.style.setProperty("--bar-scale", barScale(stock.change).toFixed(3));
  change.append(createChangeValue(formatPercent(stock.change)));

  if (state.showSparklines) {
    row.append(
      name,
      auctionDisplay ? renderAuctionSparkline(stock) : renderSparkline(stock),
      price,
      change,
    );
  } else {
    row.append(name, price, change);
  }

  if (state.editMode) {
    const deleteButton = document.createElement("button");
    deleteButton.className = "stock-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "×";
    deleteButton.title = `删除 ${stock.name}`;
    deleteButton.setAttribute("aria-label", `删除 ${stock.name}`);
    deleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeStock(sectorName, stock.secid);
    });
    row.append(deleteButton);
  }
  return row;
}

function stockNameClass(change) {
  const value = Number(change);
  if (value > 3) return "name-strong-up";
  if (value < -3) return "name-strong-down";
  return "";
}

function renderSparkline(stock) {
  const spark = state.sparklines.get(stock.secid);
  const pending = state.sparkPending.has(stock.secid);
  const tone = quoteClass(Number(stock.change ?? spark?.change));
  const box = document.createElement("span");
  box.className = `sparkline is-${tone}${pending ? " is-loading" : ""}`;
  const source = spark?.source || "今日分时";
  box.title = spark?.time ? `${source}：${spark.date || ""} ${spark.time}` : source;

  const points = spark?.points || [];
  if (points.length < 2 && !pending) {
    box.title = /^116\./.test(stock.secid) ? "暂无港股分时数据" : spark?.data_is_stale
      ? "最近交易日QMT分时数据不足"
      : "暂无QMT分时数据";
  }

  if (!points.length || points.length < 2) {
    return box;
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 58 16");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("class", `spark-${tone}`);
  path.setAttribute("d", sparklinePath(points, 58, 16));
  svg.append(path);
  box.append(svg);
  return box;
}

function renderAuctionSparkline(stock) {
  const series = state.auctionSeries.get(stock.secid);
  const samples = Array.isArray(series?.samples) ? series.samples : [];
  const box = document.createElement("span");
  box.className = `sparkline auction-sparkline${state.auctionLoading ? " is-loading" : ""}`;
  if (samples.length === 0) {
    box.title = state.auctionLoading ? "正在读取QMT竞价轨迹" : "暂无竞价采样";
    return box;
  }

  const latest = samples.at(-1);
  const tone = quoteClass(Number(latest.change) || 0);
  const finalAmount = latest.time >= "09:25:00" && Number(latest.amount) > 0;
  box.classList.add(`is-${tone}`);
  box.title = `${series.source || "QMT竞价"} ${latest.time || ""} · ${finalAmount ? `成交额 ${formatAuctionAmount(Number(latest.amount), false)}` : latest.time < "09:25:00" ? "成交额待撮合" : "成交额暂缺"} · 横轴09:15—09:25:30，虚线为昨收`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${AUCTION_SPARK_WIDTH} ${AUCTION_SPARK_HEIGHT}`);
  svg.setAttribute("aria-hidden", "true");
  const points = samples.map((sample) => ({
    time: sample.time, timestamp: sample.timestamp,
    change: Number(series.previousClose) > 0 ? (Number(sample.price) / Number(series.previousClose) - 1) * 100
      : sample.change == null ? null : Number(sample.change),
  }));
  const geometry = auctionChartGeometry(points, AUCTION_SPARK_WIDTH, AUCTION_PRICE_HEIGHT);
  if (geometry) {
    const baseline = document.createElementNS("http://www.w3.org/2000/svg", "line");
    baseline.setAttribute("x1", "0"); baseline.setAttribute("x2", AUCTION_SPARK_WIDTH);
    baseline.setAttribute("y1", geometry.baseline); baseline.setAttribute("y2", geometry.baseline);
    baseline.setAttribute("class", "auction-zero-line");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", `spark-${tone}`);
    path.setAttribute("d", geometry.path);
    svg.append(baseline, path);
  }
  box.append(svg);

  const amount = document.createElement("small");
  amount.className = "auction-amount";
  amount.textContent = finalAmount ? formatAuctionAmount(Number(latest.amount)) : latest.time < "09:25:00" ? "待撮合" : "竞--";
  box.append(amount);
  return box;
}

function formatAuctionAmount(value, compact = true) {
  if (!Number.isFinite(value) || value <= 0) return compact ? "竞--" : "--";
  let text;
  if (value >= 1e8) {
    text = `${(value / 1e8).toFixed(2)}亿`;
  } else if (value >= 1e4) {
    text = `${(value / 1e4).toFixed(2)}万`;
  } else {
    text = `${value.toFixed(0)}元`;
  }
  return compact ? `竞${text}` : text;
}

function sparklinePath(points, width, height) {
  const values = points.map(Number).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(1, Math.abs(max) * 0.01);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const padding = 1.5;

  return values
    .map((value, index) => {
      const x = index * step;
      const y = padding + (1 - (value - min) / range) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function syncAuctionDisplayPresentation(auctionDisplay = isAuctionDisplaySession()) {
  grid.classList.toggle("is-auction", auctionDisplay);
  if (
    state.auctionPresentationActive === null
    || state.auctionPresentationActive === auctionDisplay
  ) {
    return false;
  }
  renderAfterBackgroundUpdate();
  return true;
}

function compactMarketStatusSource(source) {
  const value = String(source || "连接中").trim();
  const qmt = value.match(/^(大 QMT|QMT回退|QMT|QMT)实时\s+(\d+\/\d+)/);
  return qmt ? `${qmt[1]} ${qmt[2]}` : value;
}

function marketFeedPresentation(feed, source = "") {
  let active = String(feed?.active || "unknown").toLowerCase();
  if (active === "unknown" && /^大 QMT实时/.test(source)) active = "bigqmt";
  const requested = Math.max(0, Number(feed?.requested) || 0);
  const returned = Math.max(0, Number(feed?.returned) || 0);
  const coverage = requested > 0 ? `${returned}/${requested}` : "";
  if (feed?.cached) {
    return {
      icon: "Q",
      label: active === "bigqmt" ? "大 QMT" : "QMT",
      mode: "缓存",
      coverage,
      className: "is-cached",
    };
  }
  if (requested === 0 && feed?.hongKongRequested > 0) {
    const available = active !== "unavailable" && feed.hongKongReturned > 0;
    return {
      icon: "港",
      label: "新浪",
      mode: available ? "港股" : "异常",
      coverage: `${available ? feed.hongKongReturned : 0}/${feed.hongKongRequested}`,
      className: available ? "is-miniqmt" : "is-unavailable",
    };
  }
  if (active === "bigqmt") {
    const staleReference = feed?.bigQmtReferenceStatus === "stale";
    return {
      icon: "Q",
      label: "大 QMT",
      mode: feed?.partial ? `缺${requested - returned}只` : staleReference ? "行情·昨收修复" : "行情",
      coverage,
      className: feed?.partial || staleReference ? "is-fallback" : "is-bigqmt",
    };
  }
  if (active === "unavailable") {
    return { icon: "!", label: "QMT", mode: "异常", coverage: "", className: "is-unavailable" };
  }
  return { icon: "Q", label: "QMT", mode: "连接中", coverage, className: "is-unknown" };
}

function marketStatusItem(text, className, title = "") {
  const item = document.createElement("span");
  item.className = `market-status-item ${className}`;
  item.textContent = text;
  if (title) item.title = title;
  return item;
}

function marketFeedStatusItem(feed, source) {
  const presentation = marketFeedPresentation(feed, source);
  const item = document.createElement("button");
  item.type = "button";
  item.addEventListener("click", openMarketSourcePicker);
  item.className = `market-status-item market-feed-badge ${presentation.className}`;

  const icon = document.createElement("span");
  icon.className = "market-feed-icon";
  icon.textContent = presentation.icon;
  icon.setAttribute("aria-hidden", "true");

  const name = document.createElement("strong");
  name.className = "market-feed-name";
  name.textContent = presentation.label;

  const mode = document.createElement("small");
  mode.className = "market-feed-mode";
  mode.textContent = presentation.mode;

  item.append(icon, name, mode);

  const configured = feed?.configured === "auto" ? "自动切换" : "固定数据源";
  const switches = Math.max(0, Number(feed?.switchCount) || 0);
  const transport = feed?.transport ? String(feed.transport).toUpperCase() : "";
  const previousCloseReference = String(feed?.previousCloseReference || "").toLowerCase();
  const previousCloseAuditReference = String(
    feed?.previousCloseAuditReference || "",
  ).toLowerCase();
  const previousCloseValidated = Math.max(0, Number(feed?.previousCloseValidatedCodes) || 0);
  const previousCloseNative = Math.max(0, Number(feed?.previousCloseNativeCodes) || 0);
  const previousCloseMismatched = Math.max(
    0,
    Number(feed?.previousCloseMismatchedCodes) || 0,
  );
  const previousCloseCorrected = Math.max(0, Number(feed?.previousCloseCorrectedCodes) || 0);
  const previousCloseAuditPending = Math.max(
    0,
    Number(feed?.previousCloseAuditPending) || 0,
  );
  const previousCloseBackfillPending = Math.max(
    0,
    Number(feed?.previousCloseBackfillPending) || 0,
  );
  const bigQmtReferenceStatus = String(feed?.bigQmtReferenceStatus || "unknown");
  const bigQmtReferenceChecked = Math.max(
    0,
    Number(feed?.bigQmtReferenceCheckedCodes) || 0,
  );
  const bigQmtReferenceMismatched = Math.max(
    0,
    Number(feed?.bigQmtReferenceMismatchedCodes) || 0,
  );
  const previousCloseSummary = previousCloseReference === "bigqmt_native_xtdata"
    ? `昨收：大 QMT 原生 ${previousCloseNative} 只`
    : "";
  item.title = [
    `主看板当前行情：${presentation.label}${presentation.mode === "回退" ? "（自动回退）" : ""}`,
    transport ? `通信：${transport}` : "",
    presentation.coverage ? `返回：${presentation.coverage}` : "",
    feed?.configured && feed.configured !== "unknown" ? `${configured} · 切换 ${switches} 次` : "",
    previousCloseSummary,
    bigQmtReferenceStatus === "stale"
      ? `大QMT原始昨收会话异常 ${bigQmtReferenceMismatched}/${bigQmtReferenceChecked} 只，建议盘前重启大QMT并复验`
      : "",
    previousCloseBackfillPending > 0
      ? `大QMT日线后台补齐 ${previousCloseBackfillPending} 只`
      : "",
    feed?.previousCloseValidationError ? "昨收校验暂不可用" : "",
    source,
  ].filter(Boolean).join(" · ");
  item.setAttribute("aria-label", "行情连接状态");
  item.setAttribute("aria-haspopup", "dialog");
  item.title += " · 点击查看连接状态";
  return item;
}

async function openMarketSourcePicker() {
  if (document.getElementById("marketSourceDialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "marketSourceDialog";
  dialog.className = "market-source-dialog";
  dialog.setAttribute("aria-label", "行情连接状态");
  dialog.innerHTML = `<h2>行情连接状态</h2><p>行情与历史数据由大 QMT 提供。</p>
    <p class="market-source-feedback" role="status">正在读取连接状态…</p>
    <button type="button" class="market-source-close">关闭</button>`;
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector(".market-source-close").addEventListener("click", () => dialog.close());
  dialog.showModal();
  const feedback = dialog.querySelector(".market-source-feedback");
  try {
    const payload = await fetchJson("/api/qmt-backends", 6000);
    const error = payload.backends?.bigqmt?.last_error;
    feedback.textContent = error
      ? "大 QMT 连接异常，请检查 Windows 中继与 QMT 数据策略。"
      : payload.market?.active === "bigqmt"
        ? "最近一次大 QMT 请求成功。"
        : "等待大 QMT 数据请求。";
  } catch {
    feedback.textContent = "无法读取行情服务状态，请稍后重试。";
  }
}

function mergeBoardQuoteSnapshot(previous, fresh, stocks) {
  const merged = new Map();
  for (const stock of stocks) {
    const current = fresh.get(stock.secid);
    const cached = previous.get(stock.secid);
    const stamp = (quote) => `${String(quote?.date || "").replaceAll("-", "")}${quote?.time || ""}`;
    if (current && (!cached || stamp(current) >= stamp(cached))) {
      merged.set(stock.secid, { ...current, cached: false, fetchedAt: Date.now() });
    }
    else if (cached) merged.set(stock.secid, { ...cached, cached: true });
  }
  return merged;
}

function updateQuoteCacheNote() {
  const cached = [...state.quotes.values()].filter((quote) => quote.cached);
  const dates = [...new Set(cached.map((quote) => String(quote.date || "").replaceAll("-", "")))].filter(Boolean).sort();
  const format = (date) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  state.quoteCacheNote = dates.length
    ? `缓存 ${format(dates[0])}${dates.length > 1 ? ` 至 ${format(dates.at(-1))}` : ""} · ${cached.length}只`
    : "";
}

async function restoreQuoteSnapshot() {
  try {
    const payload = await fetchJson("/api/quote-snapshot", 2000);
    for (const row of payload.quotes || []) {
      if (row.secid && Number.isFinite(row.price) && row.price > 0) {
        state.quotes.set(row.secid, { ...row, cached: true });
      }
    }
    if (!state.quotes.size) return;
    state.marketFeed = { ...quoteBackendFromPayload(payload), cached: true };
    state.source = "本地保存的行情";
    state.lastUpdated = new Date(Math.max(...[...state.quotes.values()].map((quote) => Number(quote.fetchedAt) || 0)));
    state.hydrated = hydrateSectors(state.quotes);
    updateQuoteCacheNote();
    render();
  } catch (error) {
    console.warn("Saved quote snapshot unavailable.", error);
  }
}

function canReuseClosedSnapshot(stocks, now = Date.now()) {
  if (marketSession().canAutoRefresh) return false;
  const supported = stocks.filter((stock) => miniQmtMarketCode(stock.secid) || /^116\./.test(stock.secid));
  // The date stays visible even for a closed-market snapshot. A bounded age
  // ensures reopening after a new session still refreshes in the background.
  return supported.length > 0 && supported.every((stock) => {
    const quote = state.quotes.get(stock.secid);
    return quote && now - Number(quote.fetchedAt) >= 0 && now - Number(quote.fetchedAt) < 15 * 60_000;
  });
}

function updateStatus() {
  const session = marketSession();
  const seconds = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
  const indexSeconds = Math.max(0, Math.ceil((state.nextIndexRefreshAt - Date.now()) / 1000));
  const time = state.lastUpdated
    ? state.lastUpdated.toLocaleTimeString("zh-CN", { hour12: false })
    : "--:--:--";
  const secondDayRows = Array.isArray(state.newBondStatus?.candidates)
    ? state.newBondStatus.candidates
    : [];
  const secondDayNames = secondDayRows
    .map((row) => String(row?.name || row?.code || "").trim())
    .filter(Boolean);
  const secondDayHint = secondDayNames.length > 0
    ? `上市第二日候选 ${secondDayNames.join("、")}`
    : "";
  syncAuctionDisplayPresentation();
  const items = [
    marketFeedStatusItem(state.marketFeed, state.source),
    marketStatusItem(time, "market-status-time"),
    marketStatusItem(session.label, "market-status-session"),
  ];
  if (state.quoteCacheNote) items.push(marketStatusItem(state.quoteCacheNote, "market-status-cache"));
  let refreshSummary = "";
  if (state.boardUpdatesPaused) {
    refreshSummary = "转债详情打开 · 主看板暂停刷新";
    items.push(marketStatusItem("主看板暂停", "market-status-refresh is-paused"));
  } else if (state.loading) {
    refreshSummary = "板块刷新中";
    items.push(marketStatusItem("板块刷新中", "market-status-refresh is-busy"));
  } else if (session.canAutoRefresh) {
    refreshSummary = `板块${seconds}s 后刷新 · 分时${SPARKLINE_REFRESH_MS / 1000}s · 指数${indexSeconds}s`;
    items.push(
      marketStatusItem(`板块 ${seconds}s`, "market-status-refresh"),
      marketStatusItem(`分时 ${SPARKLINE_REFRESH_MS / 1000}s`, "market-status-interval"),
      marketStatusItem(`指数 ${indexSeconds}s`, "market-status-interval"),
    );
  } else {
    refreshSummary = `停止自动刷新 · 下次 ${formatScheduleTime(session.nextAt)}`;
    items.push(marketStatusItem("自动刷新已停", "market-status-refresh is-paused"));
  }
  if (secondDayHint) {
    const note = document.createElement("span");
    note.className = "market-status-note";
    note.textContent = secondDayHint;
    note.title = secondDayHint;
    items.push(note);
  }
  const fullStatus = `${state.source} · ${time} · ${session.label} · ${refreshSummary}${secondDayHint ? ` · ${secondDayHint}` : ""}`;
  statusNode.replaceChildren(...items);
  statusNode.title = fullStatus;
  statusNode.setAttribute("aria-label", fullStatus);
}

async function refreshQuotes(options = {}) {
  if (state.marketSwitching) return;
  if (state.boardUpdatesPaused) {
    state.boardRenderPending = true;
    updateStatus();
    return;
  }
  if (!options.force && !marketSession().canAutoRefresh) {
    updateNextRefreshAt();
    updateStatus();
    return;
  }
  if (state.loading && !options.force) return;

  const requestId = (state.quoteRequestId += 1);
  const stocks = getAllStocks(state.sectors);
  state.loading = true;
  refreshButton.disabled = true;
  updateStatus();

  try {
    if (stocks.length === 0) {
      if (requestId === state.quoteRequestId) {
        state.quotes = new Map();
        state.hydrated = [];
        state.source = "空列表";
        state.marketFeed = { ...state.marketFeed, active: "unknown", requested: 0, returned: 0 };
        state.lastUpdated = new Date();
        updateNextRefreshAt();
        render();
      }
      return;
    }

    const preferred = await fetchPreferredQuotes(stocks);
    const quotes = preferred.quotes;
    const source = preferred.source;

    if (requestId === state.quoteRequestId && !state.boardUpdatesPaused) {
      state.quotes = mergeBoardQuoteSnapshot(state.quotes, quotes, stocks);
      state.hydrated = hydrateSectors(state.quotes);
      updateQuoteCacheNote();
      state.source = source;
      state.marketFeed = preferred.feed;
      state.lastUpdated = new Date();
      updateNextRefreshAt();
      renderAfterBackgroundUpdate();
    }
  } catch (error) {
    console.warn("Board quote request failed.", error);
    if (requestId === state.quoteRequestId) {
      state.source = "行情不可用 · 保留上次报价";
      for (const quote of state.quotes.values()) quote.cached = true;
      updateQuoteCacheNote();
      state.marketFeed = { ...state.marketFeed, active: "unavailable" };
      updateStatus();
    }
  } finally {
    if (requestId === state.quoteRequestId) {
      state.loading = false;
      refreshButton.disabled = false;
      updateStatus();
    }
  }
}

async function refreshBondQuotes(options = {}) {
  if (state.marketSwitching) return;
  if (state.boardUpdatesPaused) {
    state.boardRenderPending = true;
    return;
  }
  if (!options.force && !marketSession().canAutoRefresh) return;
  if (state.loading || (state.bondLoading && !options.force)) return;

  const bonds = getConvertibleBondStocks(state.sectors);
  if (bonds.length === 0) return;

  const requestId = (state.bondQuoteRequestId += 1);
  state.bondLoading = true;

  try {
    const preferred = await fetchPreferredQuotes(bonds);
    const quotes = preferred.quotes;
    if (requestId !== state.bondQuoteRequestId || state.boardUpdatesPaused) return;

    for (const secid of preferred.feed.failedSecids || []) {
      const saved = state.quotes.get(secid);
      if (saved) state.quotes.set(secid, { ...saved, cached: true });
    }
    for (const [secid, quote] of quotes) {
      state.quotes.set(secid, { ...quote, cached: false, fetchedAt: Date.now() });
    }
    updateQuoteCacheNote();
    state.hydrated = hydrateSectors(state.quotes);
    state.marketFeed = {
      ...preferred.feed,
      hongKongRequested: state.marketFeed.hongKongRequested || 0,
      hongKongReturned: state.marketFeed.hongKongReturned || 0,
    };
    state.source = [preferred.source, hongKongQuoteStatus(state.marketFeed)].filter(Boolean).join(" · ");
    state.lastUpdated = new Date();
    renderAfterBackgroundUpdate();
    updateStatus();
  } catch (error) {
    console.warn("Convertible bond quote request failed.", error);
  } finally {
    if (requestId === state.bondQuoteRequestId) {
      state.bondLoading = false;
    }
  }

  if (state.activeView === "themes" && (options.force || marketSession().canAutoRefresh)) {
    await loadThemeBondBoard({ force: true });
  }
}

async function refreshIndices(options = {}) {
  if (!options.force && !marketSession().canAutoRefresh) return;

  try {
    const json = await fetchJson("/api/indices", 10000);
    const indices = Array.isArray(json?.indices) ? json.indices : [];
    state.indices = indices.filter((item) => Number.isFinite(Number(item.percent)));
  } catch (error) {
    console.warn("Index request failed.", error);
  }

  renderIndices();
}

async function refreshUs10y({ force = false } = {}) {
  if (!us10yMarketChart || state.us10yLoading || (!force && document.hidden)) return;
  state.us10yLoading = true;
  try {
    const quote = await fetchJson("/api/us10y", 12000);
    if (!Number.isFinite(quote?.price) || !Number.isFinite(quote?.changeBps)) {
      throw new Error("Invalid US10Y quote");
    }
    state.us10yQuote = quote;
    state.us10yError = Boolean(quote.refreshFailed);
  } catch (error) {
    state.us10yError = true;
    console.warn("US10Y request failed.", error);
  } finally {
    state.us10yLoading = false;
  }
  renderNativeMarketChart(us10yMarketChart, state.us10yQuote, {
    isYield: true,
    failed: state.us10yError,
  });
}

async function boot() {
  restoreMarketSplit();
  restoreMarketPanelHeight();
  void refreshUs10y({ force: true });
  window.setInterval(refreshUs10y, US10Y_UPDATE_INTERVAL_MS);
  await Promise.all([loadServerBoardState(), restoreQuoteSnapshot()]);
  const restoredView = restoreBoardViewState();
  syncAuctionSignalMode();
  syncSignalPauseButton();
  const stocks = getAllStocks(state.sectors);
  sparkToggle.checked = state.showSparklines;
  retainQuotesForStocks(stocks);
  state.hydrated = hydrateSectors(state.quotes);
  if (!state.quotes.size) state.source = "读取行情中";
  if (!state.quotes.size) state.marketFeed = {
    active: "unknown",
    configured: "unknown",
    fallbackActive: false,
    switchCount: 0,
    transport: "",
    previousCloseReference: "",
    previousCloseAuditReference: "",
    previousCloseValidatedCodes: 0,
    previousCloseNativeCodes: 0,
    previousCloseMismatchedCodes: 0,
    previousCloseCorrectedCodes: 0,
    previousCloseValidationError: "",
    previousCloseAuditPending: 0,
    previousCloseBackfillPending: 0,
    requested: 0,
    returned: 0,
  };
  if (!state.quotes.size) state.lastUpdated = null;
  updateQuoteCacheNote();
  updateEditModeControls();
  setActiveView(state.activeView);
  renderIndices();
  render();
  if (!canReuseClosedSnapshot(stocks)) void refreshQuotes({ force: true });
  void refreshIndices({ force: true });
  await refreshNewBondSecondDayState();
  scheduleMainRefresh();
  scheduleIndexRefresh();
  scheduleBondRefresh();
  signalMode.value = state.signalMode;
  updateSignalModeView();
  signalScope.value = state.signalScope;
  renderSignalTypeOptions();
  await refreshSignalFeed({ reset: true });
  scheduleSignalRefresh();
  restoreBoardViewport(restoredView);
  if (location.hash === "#board-limit-ladder") {
    window.requestAnimationFrame(() => document.getElementById("board-limit-ladder")?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }

  window.setInterval(updateStatus, 1000);
  window.setInterval(refreshBoardLadderState, 10_000);
  state.newBondStatusTimer = window.setInterval(
    refreshNewBondSecondDayState,
    NEW_BOND_STATUS_INTERVAL_MS,
  );

  document.addEventListener("visibilitychange", () => {
    setBondPreviewActive(!document.hidden && !bondMarketPreview.hidden);
    updateStatus();
    if (!document.hidden) {
      void refreshUs10y();
      void refreshBoardLadderState();
      refreshNewBondSecondDayState();
      refreshVisibleDataImmediately();
    }
    scheduleMainRefresh();
    scheduleIndexRefresh();
    scheduleBondRefresh();
    scheduleSignalRefresh();
  });
}

window.addEventListener("pagehide", saveBoardViewState);
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  scheduleMainRefresh();
  scheduleIndexRefresh();
  scheduleBondRefresh();
  scheduleSignalRefresh();
  updateStatus();
  if (marketSession().canAutoRefresh) {
    refreshIndices({ force: true });
    if (!state.boardUpdatesPaused) {
      refreshQuotes();
      refreshBondQuotes({ force: true });
    }
    if (!state.signalPaused) refreshSignalFeed();
  }
});
window.addEventListener("popstate", (event) => {
  if (event.state?.bondOverlay) {
    showBondOverlay(window.location.href, false);
  } else {
    hideBondOverlay();
    restoreBoardViewport(restoreBoardViewState());
  }
});
window.addEventListener("message", (event) => {
  if (
    event.origin === window.location.origin &&
    event.source === bondOverlayFrame.contentWindow &&
    event.data?.type === "finance:close-bond-overlay"
  ) {
    closeBondOverlay();
    return;
  }
  if (
    event.origin === window.location.origin &&
    event.source === bondMarketPreviewFrame.contentWindow &&
    event.data?.type === "finance:open-bond-overlay"
  ) {
    showBondOverlay(event.data.url || state.bondPreviewUrl);
  }
});
bondMarketPreviewFrame.addEventListener("load", handleBondPreviewLoad);
bondMarketPreviewFrame.addEventListener("error", handleBondPreviewError);
bondPreviewReset.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  showExternalMarkets();
});
marketMonitorResizer.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || window.matchMedia("(max-width: 1180px)").matches) return;
  event.preventDefault();
  marketResizePointerId = event.pointerId;
  marketMonitorResizer.classList.add("is-dragging");
  document.body.classList.add("is-resizing-market-panels");
});
window.addEventListener("pointermove", (event) => {
  if (marketResizePointerId === null || event.pointerId !== marketResizePointerId) return;
  const rect = marketMonitorRow.getBoundingClientRect();
  if (!(rect.width > 0)) return;
  setMarketSplitRatio((event.clientX - rect.left) / rect.width);
});
window.addEventListener("pointerup", finishMarketResize);
window.addEventListener("pointercancel", finishMarketResize);
marketMonitorResizer.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Home") {
    setMarketSplitRatio(MARKET_SPLIT_DEFAULT, true);
    return;
  }
  const delta = event.key === "ArrowLeft" ? -0.025 : 0.025;
  setMarketSplitRatio(marketSplitRatio + delta, true);
});
marketMonitorResizer.addEventListener("dblclick", () => {
  setMarketSplitRatio(MARKET_SPLIT_DEFAULT, true);
});
marketMonitorHeightResizer.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  marketHeightPointerId = event.pointerId;
  marketHeightDragStartY = event.clientY;
  marketHeightDragStartValue = marketPanelBodyHeight;
  marketMonitorHeightResizer.classList.add("is-dragging");
  document.body.classList.add("is-resizing-market-height");
});
window.addEventListener("pointermove", (event) => {
  if (marketHeightPointerId === null || event.pointerId !== marketHeightPointerId) return;
  setMarketPanelHeight(marketHeightDragStartValue + event.clientY - marketHeightDragStartY);
});
window.addEventListener("pointerup", finishMarketHeightResize);
window.addEventListener("pointercancel", finishMarketHeightResize);
marketMonitorHeightResizer.addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Home") {
    setMarketPanelHeight(MARKET_HEIGHT_DEFAULT, true);
    return;
  }
  const delta = event.key === "ArrowUp" ? -16 : 16;
  setMarketPanelHeight(marketPanelBodyHeight + delta, true);
});
marketMonitorHeightResizer.addEventListener("dblclick", () => {
  setMarketPanelHeight(MARKET_HEIGHT_DEFAULT, true);
});
document.addEventListener(
  "click",
  (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href*="bond.html"]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.detail > 1) return;
    showBondMarketPreview(link.href);
  },
  true,
);
document.addEventListener(
  "dblclick",
  (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href*="bond.html"]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    showBondOverlay(link.href);
    if (!bondMarketPreview.hidden) showExternalMarkets();
  },
  true,
);

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

mainViewButton.addEventListener("click", () => setActiveView("main"));
themeViewButton.addEventListener("click", () => setActiveView("themes"));

sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});

rangeSelect.addEventListener("change", (event) => {
  state.range = event.target.value;
  render();
});

sparkToggle.addEventListener("change", (event) => {
  state.showSparklines = event.target.checked;
  localStorage.setItem(SPARKLINE_STORAGE_KEY, state.showSparklines ? "1" : "0");
  render();
});

refreshButton.addEventListener("click", () => {
  state.nextRefreshAt = Date.now();
  void refreshUs10y({ force: true });
  refreshQuotes({ force: true });
  refreshIndices({ force: true });
  refreshBondQuotes({ force: true });
  refreshSignalFeed();
  scheduleMainRefresh();
  scheduleIndexRefresh();
  scheduleBondRefresh();
  scheduleSignalRefresh();
});

window.addEventListener("resize", () => {
  window.clearTimeout(marketResizeTimer);
  marketResizeTimer = window.setTimeout(() => {
    if (window.innerWidth > 1180) setMarketSplitRatio(marketSplitRatio);
  }, 100);
});

signalScope.addEventListener("change", async (event) => {
  state.signalScope = event.target.value === "all" ? "all" : "focus";
  saveBoardViewState();
  await refreshSignalFeed({ reset: true });
  scheduleSignalRefresh();
});

signalMode.addEventListener("change", async (event) => {
  state.signalMode = event.target.value === "auction" ? "auction" : "intraday";
  updateSignalModeView();
  saveBoardViewState();
  await refreshSignalFeed({ reset: true });
  scheduleSignalRefresh(state.signalMode === "auction" ? AUCTION_SIGNAL_UPDATE_INTERVAL_MS : SIGNAL_UPDATE_INTERVAL_MS);
});

signalAmountFilter.addEventListener("change", async (event) => {
  const amount = Number(event.target.value);
  state.signalMinDailyAmount = [100_000_000, 200_000_000].includes(amount)
    ? amount
    : 0;
  saveBoardViewState();
  await refreshSignalFeed({ reset: true });
  scheduleSignalRefresh();
});

signalAmplitudeFilter.addEventListener("change", async (event) => {
  const amplitude = Number(event.target.value);
  state.signalMinDailyAmplitude = [0.01, 0.02].includes(amplitude)
    ? amplitude
    : 0;
  saveBoardViewState();
  await refreshSignalFeed({ reset: true });
  scheduleSignalRefresh();
});

signalTypeClear.addEventListener("click", () => {
  state.signalTypes.clear();
  renderSignalTypeOptions();
  saveBoardViewState();
  scheduleSignalTypeRefresh();
});

signalTypeSelectAll.addEventListener("click", () => {
  state.signalTypes = new Set(Object.keys(SIGNAL_EVENT_LABELS));
  renderSignalTypeOptions();
  saveBoardViewState();
  scheduleSignalTypeRefresh();
});

document.addEventListener("click", (event) => {
  if (
    signalTypeFilter.open
    && !signalTypeFilter.contains(event.target)
  ) {
    signalTypeFilter.open = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && signalTypeFilter.open) {
    signalTypeFilter.open = false;
    signalTypeSummary.focus();
  }
});

signalPauseButton.addEventListener("click", () => {
  state.signalPaused = !state.signalPaused;
  syncSignalPauseButton();
  updateSignalMonitorStatus();
  if (state.signalPaused) {
    window.clearTimeout(state.signalTimer);
  } else {
    refreshSignalFeed();
    scheduleSignalRefresh(SIGNAL_UPDATE_INTERVAL_MS);
  }
});

editListButton.addEventListener("click", () => {
  state.editMode = !state.editMode;
  state.renamingSectorName = "";
  state.renamingStackName = "";
  if (state.editMode) {
    state.query = "";
    state.sort = "hot";
    state.range = "all";
    searchInput.value = "";
    sortSelect.value = "hot";
    rangeSelect.value = "all";
  }
  updateEditModeControls();
  render();
});

addSectorButton.addEventListener("click", () => {
  if (!state.editMode) {
    state.editMode = true;
    state.query = "";
    state.sort = "hot";
    state.range = "all";
    searchInput.value = "";
    sortSelect.value = "hot";
    rangeSelect.value = "all";
    updateEditModeControls();
  }
  addSector();
});

addStackButton.addEventListener("click", () => {
  if (!state.editMode) {
    state.editMode = true;
    state.query = "";
    state.sort = "hot";
    state.range = "all";
    searchInput.value = "";
    sortSelect.value = "hot";
    rangeSelect.value = "all";
    updateEditModeControls();
  }
  addStackGroup();
});

bulkEditButton.addEventListener("click", () => {
  openListEditor();
});

function openListEditor() {
  stockListEditor.value = sectorsToEditorText(state.sectors);
  stockListEditor.scrollTop = 0;
  stockListEditor.setSelectionRange(0, 0);
  editorMessage.textContent = "";
  editorMessage.classList.remove("is-error");
  editorDialog.showModal();
  stockListEditor.focus();
}

function openAddStockDialog(sectorName) {
  state.addTargetSector = sectorName;
  addStockTitle.textContent = `添加到 ${sectorName}`;
  clearAddStockSearch();
  addStockDialog.showModal();
  addStockInput.focus();
}

function clearAddStockSearch(message = "") {
  window.clearTimeout(state.addSearchTimer);
  state.addSearchRequestId += 1;
  state.addSelectedStock = null;
  addStockInput.value = "";
  addStockMessage.textContent = message;
  addStockMessage.classList.remove("is-error");
  renderSuggestions([]);
}

function closeAddStockDialog() {
  if (addStockDialog.open) {
    addStockDialog.close();
  } else {
    clearAddStockSearch();
  }
}

function renderSuggestions(items) {
  addStockSuggestions.replaceChildren();

  if (!addStockInput.value.trim()) {
    const empty = document.createElement("div");
    empty.className = "suggestion-empty";
    empty.textContent = "输入名称或代码后显示候选";
    addStockSuggestions.append(empty);
    return;
  }

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "suggestion-empty";
    empty.textContent = "没有匹配结果";
    addStockSuggestions.append(empty);
    return;
  }

  for (const item of items) {
    const button = document.createElement("button");
    button.className = `suggestion-item${
      state.addSelectedStock?.secid === item.secid ? " is-selected" : ""
    }`;
    button.type = "button";
    button.addEventListener("click", () => {
      state.addSelectedStock = item;
      addStockInput.value = `${item.code} ${item.name}`;
      addStockMessage.textContent = "";
      addStockMessage.classList.remove("is-error");
      renderSuggestions(items);
    });

    const code = document.createElement("span");
    code.className = "suggestion-code";
    code.textContent = item.code;

    const name = document.createElement("span");
    name.className = "suggestion-name";
    name.textContent = item.name;

    const market = document.createElement("span");
    market.className = "suggestion-market";
    market.textContent = item.market || "-";

    const type = document.createElement("span");
    type.className = "suggestion-type";
    type.textContent = stockTypeLabel(item);

    button.append(code, name, market, type);
    addStockSuggestions.append(button);
  }
}

function scheduleAddSearch() {
  window.clearTimeout(state.addSearchTimer);
  state.addSelectedStock = null;
  addStockMessage.textContent = "";
  addStockMessage.classList.remove("is-error");

  const keyword = addStockInput.value.trim();
  if (!keyword) {
    renderSuggestions([]);
    return;
  }

  const requestId = (state.addSearchRequestId += 1);
  state.addSearchTimer = window.setTimeout(async () => {
    try {
      const results = await searchStocks(keyword);
      if (requestId !== state.addSearchRequestId) return;
      if (results.length === 1) {
        state.addSelectedStock = results[0];
      }
      renderSuggestions(results);
    } catch (error) {
      if (requestId !== state.addSearchRequestId) return;
      addStockMessage.textContent = error instanceof Error ? error.message : "搜索失败";
      addStockMessage.classList.add("is-error");
      renderSuggestions([]);
    }
  }, ADD_SEARCH_DEBOUNCE_MS);
}

function addSearchKeyword(raw) {
  return raw.trim().split(/\s+/)[0] || raw.trim();
}

closeEditorButton.addEventListener("click", () => {
  editorDialog.close();
});

cancelEditorButton.addEventListener("click", () => {
  editorDialog.close();
});

closeAddStockButton.addEventListener("click", () => {
  closeAddStockDialog();
});

cancelAddStockButton.addEventListener("click", () => {
  closeAddStockDialog();
});

addStockDialog.addEventListener("close", () => {
  clearAddStockSearch();
});

addStockInput.addEventListener("input", () => {
  scheduleAddSearch();
});

addStockInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    const first = addStockSuggestions.querySelector(".suggestion-item");
    if (first) {
      event.preventDefault();
      first.focus();
    }
  }
});

addStockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  addStockMessage.textContent = "正在添加...";
  addStockMessage.classList.remove("is-error");

  try {
    const raw = addStockInput.value.trim();
    if (!raw) {
      throw new Error("请输入名称或代码");
    }

    const stock = state.addSelectedStock || (await resolveStock(addSearchKeyword(raw)));
    addStockToSector(state.addTargetSector, {
      name: stock.name,
      secid: stock.secid,
    });
    clearAddStockSearch(`已添加 ${stock.name}，继续输入可再添加`);
    addStockInput.focus();
    refreshQuotes({ force: true });
  } catch (error) {
    addStockMessage.textContent = error instanceof Error ? error.message : "添加失败";
    addStockMessage.classList.add("is-error");
  }
});

resetListButton.addEventListener("click", () => {
  backupCurrentLocalState("reset-to-default");
  localStorage.removeItem(STOCK_LIST_STORAGE_KEY);
  localStorage.removeItem(STACK_GROUP_STORAGE_KEY);
  localStorage.setItem(STOCK_LIST_VERSION_STORAGE_KEY, ACTIVE_DEFAULT_SECTOR_VERSION);
  state.sectors = normalizeSectors(ACTIVE_DEFAULT_SECTORS);
  state.stackGroups = [];
  saveSectors(state.sectors);
  saveStackGroups();
  stockListEditor.value = sectorsToEditorText(state.sectors);
  editorMessage.textContent = "已恢复默认股票池";
  editorMessage.classList.remove("is-error");
  retainQuotesForStocks(getAllStocks(state.sectors));
  state.hydrated = hydrateSectors(state.quotes);
  render();
  refreshQuotes({ force: true });
});

editorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setEditorBusy(true);
  editorMessage.textContent = "正在保存...";
  editorMessage.classList.remove("is-error");

  try {
    const parsed = parseEditorText(stockListEditor.value);
    const resolved = await resolveMissingSecids(parsed);
    saveSectors(resolved);
    state.sectors = resolved;
    syncStackGroupsWithSectors();
    retainQuotesForStocks(getAllStocks(state.sectors));
    state.hydrated = hydrateSectors(state.quotes);
    render();
    editorDialog.close();
    await refreshQuotes({ force: true });
  } catch (error) {
    editorMessage.textContent = error instanceof Error ? error.message : "保存失败";
    editorMessage.classList.add("is-error");
  } finally {
    setEditorBusy(false);
  }
});

function setEditorBusy(isBusy) {
  stockListEditor.disabled = isBusy;
  for (const button of editorDialog.querySelectorAll("button")) {
    button.disabled = isBusy;
  }
}

boot();
