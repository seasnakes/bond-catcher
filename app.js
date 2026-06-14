const EASTMONEY_TOKEN = "fa5fd1943c7b386f172d6893dbfba10b";
const EASTMONEY_FIELDS = "f1,f2,f3,f4,f6,f12,f13,f14,f152";
const UPDATE_INTERVAL_MS = 15000;
const AUCTION_UPDATE_INTERVAL_MS = 3000;
const BOND_UPDATE_INTERVAL_MS = 5000;
const STOCK_LIST_STORAGE_KEY = "finance-board-stock-list-v1";
const STOCK_LIST_VERSION_STORAGE_KEY = "finance-board-stock-list-version-v1";
const STACK_GROUP_STORAGE_KEY = "finance-board-stack-groups-v1";
const LOCAL_BACKUP_STORAGE_KEY = "finance-board-local-backup-v1";
const SPARKLINE_STORAGE_KEY = "finance-board-show-sparklines-v1";
const SPARKLINE_BATCH_SIZE = 24;
const SPARKLINE_REFRESH_MS = 2 * 60 * 1000;
const ADD_SEARCH_DEBOUNCE_MS = 220;
const ACTIVE_DEFAULT_SECTOR_VERSION = "screenshot-2026-05-18-v1";

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
  hydrated: [],
  indices: [],
  sparklines: new Map(),
  sparkPending: new Set(),
  sparkCacheDate: localDateKey(),
  source: "连接中",
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
  mainRefreshTimer: 0,
  bondRefreshTimer: 0,
};
let serverPersistTimer = 0;

const grid = document.querySelector("#boardGrid");
const statusNode = document.querySelector("#marketStatus");
const globalIndicesNode = document.querySelector("#globalIndices");
const searchInput = document.querySelector("#searchInput");
const sortSelect = document.querySelector("#sortSelect");
const rangeSelect = document.querySelector("#rangeSelect");
const sparkToggle = document.querySelector("#sparkToggle");
const refreshButton = document.querySelector("#refreshButton");
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

async function loadServerBoardState() {
  try {
    const json = await fetchJson("/api/state", 4000);
    if (!json?.exists) return false;

    const sectors = normalizeSectors(json.sectors);
    if (sectors.length === 0) return false;

    const stackGroups = normalizeStackGroups(json.stackGroups, sectors);
    state.sectors = sectors;
    state.stackGroups = stackGroups;
    state.boardStateUpdatedAt = json.updatedAt || "";
    writeLocalBoardState(sectors, stackGroups);
    return true;
  } catch (error) {
    console.warn("Server board state unavailable, using browser/local defaults.", error);
    return false;
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
    persistBoardState();
  }, 250);
}

async function persistBoardState() {
  try {
    const result = await postJson("/api/state", {
      version: ACTIVE_DEFAULT_SECTOR_VERSION,
      baseUpdatedAt: state.boardStateUpdatedAt,
      sectors: serializeSectors(state.sectors),
      stackGroups: serializeStackGroups(state.stackGroups),
    });
    state.boardStateUpdatedAt = result.updatedAt || state.boardStateUpdatedAt;
  } catch (error) {
    console.warn("Failed to persist board state to local file.", error);
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
  const demo = createDemoQuotes([normalized]);
  for (const [secid, quote] of demo) {
    state.quotes.set(secid, quote);
  }
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
      quoteMap.set(row.secid, {
        secid: row.secid,
        code: row.secid.split(".")[1],
        price: Number(row.price),
        change: Number(row.change),
        amount: Number(row.amount) || 0,
        date: row.date || "",
        time: row.time || "",
        previousClose: Number(row.previousClose),
      });
    }
  }

  if (quoteMap.size === 0) {
    throw new Error("本地行情代理为空");
  }

  return quoteMap;
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

async function ensureSparklinesFor(sectors) {
  if (!state.showSparklines) return;
  if (isRenaming()) return;
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

function marketSession(now = new Date()) {
  const day = now.getDay();
  const isWeekday = day >= 1 && day <= 5;
  const minute = now.getHours() * 60 + now.getMinutes();

  if (!isWeekday) {
    return closedSession("休市", nextWeekdayAt(now, 9, 15));
  }
  if (minute < 9 * 60 + 15) {
    return closedSession("等待集合竞价", todayAt(now, 9, 15));
  }
  if (minute < 9 * 60 + 25) {
    return openSession("集合竞价", "auction", AUCTION_UPDATE_INTERVAL_MS);
  }
  if (minute < 9 * 60 + 30) {
    return closedSession("竞价撮合中", todayAt(now, 9, 30));
  }
  if (minute < 11 * 60 + 30) {
    return openSession("连续竞价", "trading", UPDATE_INTERVAL_MS);
  }
  if (minute < 13 * 60) {
    return closedSession("午间休市", todayAt(now, 13, 0));
  }
  if (minute < 15 * 60) {
    return openSession("连续竞价", "trading", UPDATE_INTERVAL_MS);
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
  const session = updateNextRefreshAt();
  const delay = Math.max(1000, state.nextRefreshAt - Date.now());
  state.mainRefreshTimer = window.setTimeout(async () => {
    if (!document.hidden && marketSession().canAutoRefresh) {
      await refreshQuotes();
      await refreshIndices();
    }
    scheduleMainRefresh();
  }, delay);
  updateStatus();
}

function scheduleBondRefresh() {
  window.clearTimeout(state.bondRefreshTimer);
  const session = marketSession();
  const canFastRefreshBonds = session.canAutoRefresh && session.phase !== "auction";
  const delay = canFastRefreshBonds
    ? BOND_UPDATE_INTERVAL_MS
    : Math.max(1000, session.nextAt.getTime() - Date.now());
  state.bondRefreshTimer = window.setTimeout(async () => {
    const currentSession = marketSession();
    if (!document.hidden && currentSession.canAutoRefresh && currentSession.phase !== "auction") {
      await refreshBondQuotes();
    }
    scheduleBondRefresh();
  }, delay);
}

function createDemoQuotes(stocks) {
  const minuteSeed = Math.floor(Date.now() / 60000);
  const quoteMap = new Map();

  for (const stock of stocks) {
    const hash = hashText(stock.secid + stock.name);
    const base = 4 + (hash % 45000) / 100;
    const drift = ((hash % 1600) - 800) / 170;
    const wave = Math.sin((minuteSeed + (hash % 360)) / 11) * 2.2;
    const change = clamp(drift + wave, -9.8, 12.6);
    const price = base * (1 + change / 100);

    quoteMap.set(stock.secid, {
      ...stock,
      code: stock.secid.split(".")[1],
      price,
      change,
      amount: 0,
    });
  }

  return quoteMap;
}

function hashText(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hydrateSectors(quoteMap) {
  return state.sectors.map((sector) => {
    const stocks = sector.stocks
      .map((stock) => ({
        ...stock,
        ...(quoteMap.get(stock.secid) ?? null),
      }))
      .filter((stock) => stock.price !== undefined);

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
  const session = marketSession();
  const tone = quoteClass(stock.change);
  const nameTone = stockNameClass(stock.change);
  const row = state.editMode ? document.createElement("div") : document.createElement("a");
  row.className = "stock-row";
  row.classList.toggle("is-auction", session.phase === "auction");
  row.dataset.sectorName = sectorName;
  row.dataset.secid = stock.secid;
  row.draggable = state.editMode;
  if (!state.editMode) {
    row.href = quoteUrl(stock.secid);
    row.target = "_blank";
    row.rel = "noreferrer";
  }
  const priceLabel = session.phase === "auction" ? "集合竞价参考价" : "最新价";
  row.title = `${stock.name} ${codeForEditor(stock.secid)} ${priceLabel} ${formatPrice(stock.price, stock.secid)} 涨跌幅 ${formatPercent(
    stock.change,
    true,
  )}`;
  row.addEventListener("click", (event) => {
    if (state.editMode) event.preventDefault();
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
    row.append(name, renderSparkline(stock), price, change);
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
  box.title = spark?.time ? `${source}：${spark.time}` : source;

  let points = spark?.points || [];
  if (points.length < 2 && !pending) {
    const price = Number(stock.price);
    if (Number.isFinite(price) && price > 0) {
      points = flatSparklinePoints(price);
      box.title = "暂无分时数据，按当前价占位";
    }
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

function flatSparklinePoints(value) {
  return Array.from({ length: 12 }, () => value);
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

function updateStatus() {
  const session = marketSession();
  const seconds = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
  const time = state.lastUpdated
    ? state.lastUpdated.toLocaleTimeString("zh-CN", { hour12: false })
    : "--:--:--";
  const loadingText = state.loading
    ? "刷新中"
    : session.canAutoRefresh
      ? `${seconds}s 后刷新`
      : `停止自动刷新 · 下次 ${formatScheduleTime(session.nextAt)}`;
  grid.classList.toggle("is-auction", session.phase === "auction");
  statusNode.textContent = `${state.source} · ${time} · ${session.label} · ${loadingText}`;
}

async function refreshQuotes(options = {}) {
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
        state.lastUpdated = new Date();
        updateNextRefreshAt();
        render();
      }
      return;
    }

    let quotes;
    let source = "东方财富实时";

    try {
      quotes = await fetchLocalQuotes(stocks);
      source = "新浪实时";
    } catch (localError) {
      try {
        quotes = await fetchEastmoneyQuotes(stocks);
      } catch (eastmoneyError) {
        console.warn("Live quote request failed, using demo data.", localError, eastmoneyError);
        quotes = createDemoQuotes(stocks);
        source = "演示数据";
      }
    }

    if (requestId === state.quoteRequestId) {
      state.quotes = quotes;
      state.hydrated = hydrateSectors(quotes);
      state.source = source;
      state.lastUpdated = new Date();
      updateNextRefreshAt();
      renderAfterBackgroundUpdate();
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
  if (!options.force && !marketSession().canAutoRefresh) return;
  if (state.loading || (state.bondLoading && !options.force)) return;

  const bonds = getConvertibleBondStocks(state.sectors);
  if (bonds.length === 0) return;

  const requestId = (state.bondQuoteRequestId += 1);
  state.bondLoading = true;

  try {
    const quotes = await fetchLocalQuotes(bonds);
    if (requestId !== state.bondQuoteRequestId) return;

    for (const [secid, quote] of quotes) {
      state.quotes.set(secid, quote);
    }
    state.hydrated = hydrateSectors(state.quotes);
    state.source = "新浪实时";
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

async function boot() {
  await loadServerBoardState();
  const stocks = getAllStocks(state.sectors);
  sparkToggle.checked = state.showSparklines;
  state.quotes = createDemoQuotes(stocks);
  state.hydrated = hydrateSectors(state.quotes);
  state.source = "演示数据";
  state.lastUpdated = new Date();
  updateEditModeControls();
  renderIndices();
  render();
  await refreshQuotes({ force: true });
  await refreshIndices({ force: true });
  scheduleMainRefresh();
  scheduleBondRefresh();

  window.setInterval(updateStatus, 1000);

  document.addEventListener("visibilitychange", () => {
    scheduleMainRefresh();
    scheduleBondRefresh();
    if (!document.hidden && marketSession().canAutoRefresh && Date.now() > state.nextRefreshAt) {
      refreshQuotes();
      refreshIndices();
      refreshBondQuotes({ force: true });
    }
  });
}

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

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
  refreshQuotes({ force: true });
  refreshIndices({ force: true });
  refreshBondQuotes({ force: true });
  scheduleMainRefresh();
  scheduleBondRefresh();
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
  state.quotes = createDemoQuotes(getAllStocks(state.sectors));
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
    state.quotes = createDemoQuotes(getAllStocks(state.sectors));
    state.hydrated = hydrateSectors(state.quotes);
    state.source = "演示数据";
    state.lastUpdated = new Date();
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
