{ 1. 趋势与环境 }
DAYS_L := BARSCOUNT(C);
IS_NEW := DAYS_L <= 114;
ST_L := EMA(EMA(C, 10), 10);
LT_R := (MA(C, 14) + MA(C, 28) + MA(C, 57) + MA(C, 114)) / 4;

C_DAYS := BARSLAST(CROSS(ST_L, LT_R));
HONEYMOON := C_DAYS >= 0 AND C_DAYS <= 30 AND ST_L > LT_R;
BREAKAWAY := ST_L > LT_R * 1.03;

LT_DIR := IF(DAYS_L > 114, IF(LT_R >= REF(LT_R, 1) * 0.9999, 1, -1), 1);
FLIP_C := COUNT(LT_DIR != REF(LT_DIR, 1), 30);
LT_STABLE := FLIP_C <= 2;
SUPPORT := C >= LT_R * 0.95;

TR_OK := IS_NEW OR HONEYMOON OR BREAKAWAY OR (ST_L > LT_R AND C > LT_R AND LT_STABLE AND SUPPORT);
ABOVE_LT := IF(IS_NEW, 1, C > LT_R);

{ 2. 基础数据与防连发器 }
RSV := (C - LLV(L, 9)) / (MAX(HHV(H, 9) - LLV(L, 9), 0.01)) * 100;
K_V := SMA(RSV, 3, 1);
D_V := SMA(K_V, 3, 1);
J_V := 3 * K_V - 2 * D_V;

J_UP := J_V > REF(J_V, 1);
J_TURN_UP := J_UP AND REF(J_V, 1) <= REF(J_V, 2);
UP_DAYS := BARSLAST(J_TURN_UP);

PCT := (C - REF(C, 1)) / REF(C, 1) * 100;
SHAKE := ABS(PCT) < 5.05;

{ 3. 核心信号逻辑 (已同步兼容假阴真阳) }
PRE_OK := REF(PCT, 1) < 3.7 AND REF(J_V, 1) < 39;

{ 修改1：上影线的计算必须取最高价减去(开盘价和收盘价的最大值)，防止假阴线上影线计算错误 }
UP_SHADOW := H - MAX(C, O);

{ 有效实体保持不变 }
EF_BODY := C - MIN(O, REF(C, 1));

{ 修改2：将 C > O 替换为 C > REF(C, 1)，允许收盘价低于开盘价，但必须高于昨收 }
K_SHAPE := UP_SHADOW <= EF_BODY AND C > REF(C, 1);

RAW_B2 := PCT >= 3.7 AND V > REF(V, 1) AND K_SHAPE AND PRE_OK AND J_UP AND TR_OK AND ABOVE_LT;

B2 := RAW_B2 AND COUNT(RAW_B2, UP_DAYS + 1) == 1;
B3 := REF(B2, 1) AND SHAKE AND V <= REF(V, 1) * 0.9 AND J_UP AND TR_OK AND ABOVE_LT;
B4 := REF(B2, 1) AND SHAKE AND V > REF(V, 1) * 0.9 AND V <= REF(V, 1) * 1.3 AND J_UP AND TR_OK AND ABOVE_LT;
B5 := (REF(B3, 1) OR REF(B4, 1)) AND SHAKE AND V <= REF(V, 1) * 0.9 AND J_UP AND TR_OK AND ABOVE_LT;

{ 4. 选股输出：删除对应行前面的花括号进行切换 }
{XG: B2 ;}         { 选今天符合核心起涨信号（涨幅达标、形态健康、趋势向上）的初次爆发点 B2 }
{ XG: B3; }     { 选昨天是B2信号，今天价格小幅震荡且明显缩量（量能<=昨天的90%）的洗盘 B3 }
{ XG: B4; }     { 选昨天是B2信号，今天价格小幅震荡且平量/微放量（量能90%~130%）的震荡 B4 }
{ XG: B5; }     { 选昨天经历B3或B4震荡后，今天继续小幅震荡且再次明显缩量的接力洗盘 B5 }
XG: B2 OR B3 OR B4 OR B5;{一次选出B3-B5};
