# AEGIS-CMO 内容扩充矩阵（Catalog 2026.12 已实现）

> 审计基线：`2026.11-TANKER-DECOY-1`，23 平台 / 16 武器 / 15 传感器 / 9 Loadout / 3 想定。
> 当前版本：`2026.12-CONTENT-EXPANSION-1`，**38 平台 / 27 武器 / 24 传感器 / 27 Loadout / 4 想定**。
> 目标下限 38 / 24 / 21 / 27 / 4 已全部达到；四层外键、全部挂载和想定消费由自动化门禁显式断言。

## 1. 当前 Catalog 审计

### 1.1 平台（23）

| 作战层 | 现有 ID | 已有玩法 | 缺口 |
|---|---|---|---|
| 红方制空/舰载 | `j20_mighty_dragon`, `j35_naval_stealth` | 隐身 CAP、反预警机、舰载制空/反舰 | 缺少重载多用途舰载机和岸基中坚战机 |
| 红方电子/支援 | `j16d_roaring_wolf`, `kj500_awacs`, `y20u_tanker` | OECM、ESM、预警、加油 | 缺少远距慢速电子支援/方位定位平台 |
| 红方远程/UAV | `h6n_bomber`, `wz8_recon_uav` | 远程反舰、可部署侦察 UAV | 缺少大载荷亚音速巡航导弹母机的蓝方对称项 |
| 红方水面/水下 | `cv18_fujian_carrier`, `type055_destroyer`, `type052d_destroyer`, `type093b_ssn` | 航母机库、远中程防空、核潜艇伏击 | 缺少低成本护卫舰、AIP 常规潜艇、两栖高价值核心 |
| 红方岸基 | `hq9b_sam_site`, `yj12b_coastal_asm` | 岸基防空/反舰 | 缺少中程 HQ-16 层和岸基电子支援联动 |
| 蓝方舰载/电子 | `f35c_lightning`, `ea18g_growler`, `e2d_hawkeye` | 隐身 CAP/反舰、电子压制、舰载预警 | 缺少 F/A-18E/F 多用途重锤、F-35B 两栖舰载机 |
| 蓝方支援/UAV | `kc135_tanker`, `p8a_poseidon`, `adm160_mald` | 加油、海上巡逻、可部署诱饵 | P-8A 使用重型鱼雷抽象；缺少长航时海上 ISR UAV |
| 蓝方水面/水下 | `cvn_carrier`, `arleigh_burke_flt3`, `virginia_ssn` | 航母机库、远程 AEGIS、SSN | 缺少 FFG、SSK、LHA 与有机反潜直升机 |
| 蓝方岸基 | `patriot_pac3_site` | 岛链反导 | 缺少中近程舰载防空层 |

### 1.2 武器（16）

- 空空：`pl15_aam`, `pl17_ulraam`, `aim120d_aam`, `aim260_jakt`
- 防空/反导：`hhq9b_sam`, `sm6_eram`, `pac3_mse`
- 反辐射：`ld10_arm`, `agm88g_aargm`
- 反舰/对陆：`yj21_hypersonic`, `yj18_ashm`, `yj12_supersonic`, `agm158c_lrasm`, `bgm109_tlahm`
- 重型鱼雷：`yu6_torpedo`, `mk48_adcap`

缺口：中程舰空弹、近程空空弹、轻型空投鱼雷、护卫舰轻型反舰弹。P-8A 当前重型潜射鱼雷路径必须替换为轻型空投鱼雷。

### 1.3 传感器（15）

- 机载雷达/光电：`klj5_aesa`, `apg81_aesa`, `klc7_awacs_radar`, `apy9_hawkeye_radar`, `eots_irst`
- 电子战：`airborne_esm_rwr`, `kg800_escort_jammer`, `alq249_ngj_jammer`, `shipborne_esm`
- 舰载/岸基雷达：`type346b_aesa`, `spy6_amdr`, `land_jy27a_vhf`, `an_tpy2_radar`
- 水声：`towed_array_sonar`, `hull_active_sonar`

缺口：护卫舰中程雷达、AIP 侧舷阵、直升机吊放声呐、海上巡逻雷达、慢速电子支援阵列。

### 1.4 Loadout（9）

现有挂载全部集中在 J-20/J-35/J-16D/H-6N/F-35C/EA-18G。缺少 J-15T、F/A-18E/F、B-1B、F-35B、反潜直升机、岸基中坚战机、ISR UAV 的可选构型。

### 1.5 想定消费情况

| 想定 | 当前强项 | 缺口 |
|---|---|---|
| `op_east_sea_thunder_2027` | 岛链防空、CEC、加油、电子战、动态增援 | 浅海 AIP/FFG 反潜幕、轻型鱼雷、诱饵→SEAD→饱和链 |
| `op_deep_sea_carrier_hunt_2028` | 双航母、SSN、远程反舰、Blink EMCON | 舰载机联队过窄、分类分波次、可靠机库出动、加油前出 |
| `limited_information_exercise` | 有限信息和目标教学 | 保持小型训练定位，不承担大型内容消费 |
| 新增 `op_bashi_channel_blockade_2029` | — | LHD/LHA preserve+withdraw、浅深海交界 ASW、护航 Turnaround |

## 2. 新增平台矩阵（15，全部必须实际消费）

| ID | 阵营/类别 | 独特玩法 | 最少合法配置 | 实际消费位置 |
|---|---|---|---|---|
| `j15t_flanker` | RED 舰载重型机 | 大挂载、非隐身、高 RCS、高航程 | CAP / maritime / SEAD | 福建舰机库；深海猎杀满挂载波次 |
| `y9g_jammer` | RED 电子支援机 | 远距 Bearing-only ESM 与 OECM，不承担主战攻击 | EW support | 东海岸基电子战事件 |
| `j10c_multirole` | RED 岸基多用途机 | 中成本 CAP/SEAD，补充 J-20 以下层级 | CAP / SEAD | 东海岸基增援 |
| `fa18ef_super_hornet` | BLUE 舰载多用途机 | CAP、LRASM、AIM-174B 远程制空 | CAP / maritime / ULRAAM | 美航母机库；深海猎杀波次 |
| `b1b_lancer` | BLUE 远程轰炸机 | 大批量 LRASM，但依赖加油与 WRA | mass LRASM / mixed strike | 东海嘉手纳/关岛方向事件 |
| `f35b_lightning` | BLUE STOVL 舰载机 | America LHA 有限机库制空/对海 | CAP / strike | 巴士海峡蓝方 LHA 机库 |
| `mq4c_triton` | BLUE 长航时 ISR UAV | 海上确认、分类升级、无武装 | maritime ISR | 深海猎杀侦察阶段；东海蓝方 ISR |
| `type054b_frigate` | RED 护卫舰 | 低成本 ASW 外屏 + HQ-16FE 中程层 | 平台默认配置 | 东海红方反潜幕、巴士海峡护航 |
| `constellation_ffg` | BLUE 护卫舰 | 拖曳阵 + ESSM 中近程层 + NSM | 平台默认配置 | 东海蓝方外屏、巴士海峡护航 |
| `type075_lhd` | RED 两栖舰 | 慢速 HVA、直-20F 机库、preserve/withdraw | 舰体 + 机库 | 巴士海峡红方/对抗变体核心 |
| `america_lha` | BLUE 两栖舰 | F-35B/MH-60R 机库、高价值撤离核心 | 舰体 + 机库 | 巴士海峡蓝方核心 |
| `type039c_ssk` | RED AIP SSK | 浅海低速低噪声伏击 | 鱼雷/轻型反舰 | 东海浅海、巴士海峡西侧 |
| `taigei_ssk` | BLUE/JPN AIP SSK | 浅海守峡、被动声呐伏击 | 鱼雷/NSM 抽象 | 东海蓝方、巴士海峡东口 |
| `z20f_asw` | RED 舰载反潜直升机 | 吊放声呐 + 轻型鱼雷 | search / prosecute | 054B、075 机库 |
| `mh60r_seahawk` | BLUE 舰载反潜直升机 | AQS-22 + Mk54 + 海面雷达 | search / prosecute | 星座级、America 机库 |

替换原则：若 `j10c_multirole` 或 `mq4c_triton` 在实现时无法形成独特可测试用途，可替换为同阵营同域、能被想定实际消费的平台，但必须保持新增平台总数 ≥15 并记录理由。

## 3. 新增武器矩阵（实际 11，目标至少 8）

| ID | 类别 | 玩法区间 | 平台/挂载 | 验证方式 |
|---|---|---|---|---|
| `hq16fe_sam` | SAM | 中程舰队防空，介于 HHQ-9B 与近程层 | 054B | 分层拦截选中测试 |
| `essm_blk2` | SAM | 中近程点防空、较低单发成本 | Constellation / America | 近距来袭拦截测试 |
| `aim174b_ulraam` | AAM | 超远程高价值目标/轰炸机截击，有限库存 | F/A-18E/F | WRA、库存和发射测试 |
| `yu11_lwt` | 轻型鱼雷 | 红方空投反潜、短航程声自导 | 直-20F / 海上巡逻机 | 入水与潜艇命中路径 |
| `mk54_lwt` | 轻型鱼雷 | 蓝方空投反潜 | MH-60R / P-8A | 入水与潜艇命中路径 |
| `pl10_wvr` | 近程 AAM | 红方近距自卫，防止 PL-15 浪费 | J-15T / J-10C | WRA 近距选弹 |
| `aim9x_wvr` | 近程 AAM | 蓝方近距自卫 | F/A-18E/F / F-35B | WRA 近距选弹 |
| `yj83_ashm` | 轻型反舰 | 护卫舰/直升机有限反舰 | 054B/J-15T | 水面目标发射测试 |
| `nsm_ashm` | 轻型反舰 | 蓝方 FFG/直升机反舰 | Constellation/MH-60R | 水面目标发射测试 |
| `hq10_point_defense` | 近程 SAM | 红方5–15km点防御层 | 054B/075 | 近距实际选弹测试 |
| `ram_blk2` | 近程 SAM | 蓝方5–18km点防御层 | Constellation/America | 近距实际选弹测试 |

## 4. 新增传感器矩阵（实际 9，目标至少 6）

| ID | 类型 | 用途 | 消费平台 |
|---|---|---|---|
| `type382b_mfr` | 舰载雷达 | 054B 中程对空/对海搜索 | 054B |
| `spy6v3_ffg_radar` | 舰载雷达 | Constellation 区域态势与 ESSM 火控 | Constellation |
| `red_aip_flank_array` | 被动声呐 | 039C 低速浅海伏击 | 039C |
| `blue_aip_flank_array` | 被动声呐 | 大鲸级浅海守峡 | Taigei |
| `z20f_dipping_sonar` | 主/被动吊放声呐 | 红方航空反潜 | 直-20F Loadout |
| `aqs22_dipping_sonar` | 主/被动吊放声呐 | 蓝方航空反潜 | MH-60R Loadout |
| `apy10_maritime_radar` | 海上搜索雷达 | P-8A/MQ-4C 海面确认 | P-8A、MQ-4C |
| `y9g_esm_array` | ESM | 远距辐射走廊与交叉定位 | 运-9G |
| `y9g_oecm_suite` | OECM | 防区外伴随干扰 | 运-9G |

## 5. 新增 Loadout 矩阵（计划 18）

| ID | 平台 | 角色 |
|---|---|---|
| `loadout_j15t_heavy_cap` | J-15T | PL-15/PL-10 重型 CAP |
| `loadout_j15t_maritime_strike` | J-15T | YJ-83/YJ-12 对海 |
| `loadout_j15t_sead` | J-15T | LD-10 + 自卫弹 |
| `loadout_fa18ef_fleet_cap` | F/A-18E/F | AIM-120/AIM-9X CAP |
| `loadout_fa18ef_lrasm_strike` | F/A-18E/F | LRASM 对海 |
| `loadout_fa18ef_aim174_barcap` | F/A-18E/F | AIM-174B 远程制空 |
| `loadout_b1b_mass_lrasm` | B-1B | 大批量 LRASM |
| `loadout_b1b_maritime_mixed` | B-1B | LRASM/Tomahawk 抽象混合打击 |
| `loadout_y9g_esm_support` | 运-9G | 远距 ESM/OECM |
| `loadout_f35b_stovl_cap` | F-35B | 隐身 CAP |
| `loadout_f35b_stovl_strike` | F-35B | LRASM/近距自卫 |
| `loadout_z20f_asw_search` | 直-20F | 吊放声呐搜索 |
| `loadout_z20f_asw_prosecute` | 直-20F | 吊放声呐 + Yu-11 |
| `loadout_mh60r_asw_search` | MH-60R | AQS-22 搜索 |
| `loadout_mh60r_asw_prosecute` | MH-60R | AQS-22 + Mk54 |
| `loadout_j10c_multirole_cap` | J-10C | PL-15/PL-10 CAP |
| `loadout_j10c_sead` | J-10C | LD-10 SEAD |
| `loadout_mq4c_maritime_isr` | MQ-4C | APY-10/ESM 无武装 ISR |

## 6. 机制依赖矩阵

| 内容 | 必须先完成 |
|---|---|
| HQ-16FE/ESSM/近程 AAM | 全挂架分层选弹、在途拦截量与库存保留 |
| 深海猎杀分类波次 | `minimumClassification`、可靠出动队列、重试/失败日志 |
| LHD/LHA withdraw | Objective 撤离区、非航空单位退出战场 |
| 直升机/P-8A 空投鱼雷 | 轻型鱼雷投放/入水/声自导路径 |
| AIP/FFG 浅海链 | 声学区因子、拖曳阵/侧舷阵和合法 ASW 挂载 |
| 第四想定护航轮换 | Turnaround、可靠机库出动、撤离区、主目标终局 |

## 7. 无占位消费规则

每个新增条目必须同时满足：

1. Catalog 外键和范围校验通过；
2. 平台至少一个合法 Loadout 或默认 mounts；
3. 平台出现在内置想定、机库槽位或事件动作中；
4. 武器至少有一个合法挂载并有发射/投放/拦截测试；
5. 传感器至少挂载到一个实际平台/Loadout 并参与一次检测测试；
6. Loadout 通过平台兼容、速度、续航、RCS、库存测试；
7. 文档数量与 `validate:db` 输出一致，不手工猜测。

当前显式消费门禁逐一检查15个新增平台；逐一实例化27套Loadout并核对速度、续航、RCS和弹药；逐一对11种新增武器生成合法观测Contact发射/投放。固定种子终局结果见 [`SCENARIO_SMOKE_RESULTS.json`](SCENARIO_SMOKE_RESULTS.json)。
