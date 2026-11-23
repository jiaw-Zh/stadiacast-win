# 让 Stadia 手柄在 Windows 上通过 Wi-Fi 当 Xbox 手柄用

[English](README.en.md)

这是一份实践记录：两只 Stadia 手柄，原来是蓝牙固件，按下面的步骤刷回 Wi-Fi 固件，接入家里的 OpenWrt 路由器，再由电脑上运行的 [stadiacast](https://github.com/jkfran/stadiacast) 变成 Windows 里的两个 Xbox 360 手柄。按键、摇杆、扳机和游戏震动都能用，两只同时在线。

这里提供三样东西：

- **步骤**（`docs\guide.md`）：从判断固件到手柄连上，逐步写清楚，标出了每一步容易出错的地方。
- **提示**（`docs\tips.md`）：踩过的坑和对应的解决办法。stadiacast 的文档以 macOS 热点为主，这里补充了 Windows + OpenWrt 的情况。
- **一个本机网页控制台**（`webui\`，中英文）：启动和停止 stadiacast，实时查看每只手柄的状态、电量、玩家编号和按键，测试震动。

本项目和 Google、stadiacast 都没有关系，也不包含任何固件。

## 先看适不适合你

| 你的情况 | 结论 |
|---|---|
| 只想在电脑上用手柄，不在乎震动 | 不用这么麻烦。保持蓝牙固件，直接蓝牙配对就行 |
| 想要 Wi-Fi 直连电脑、在 Windows 上有震动、两只手柄同时用，或者用耳机孔 | 适合 |
| 手柄是 Wi-Fi 固件（从没升级过蓝牙） | 跳过刷机这一步 |
| 手柄是蓝牙固件 | 要先刷回 Wi-Fi 固件，有一定变砖风险（见 `docs\guide.md` 第 3 步） |
| 路由器不能给单个设备指定 DNS | 要换个办法，让电脑成为手柄的 DNS 服务器，比如用电脑开热点。我们没有实测过，Windows 热点的做法见 stadiacast [#18](https://github.com/jkfran/stadiacast/issues/18) |

## 需要准备

- Windows 10/11 桌面版电脑，有蓝牙（配网用）。Windows Server 不行，它缺少 Xbox 360 手柄驱动。
- 一台可以登录 SSH 的 OpenWrt / ImmortalWrt 路由器。
- 一个 WPA2-Personal（AES）的 Wi-Fi，关闭 PMF 和 AP 隔离。手柄不支持 WPA3。
- 一根 USB 数据线，刷机时用。
- Chrome 或 Edge 浏览器，刷机时用。
- [uv](https://docs.astral.sh/uv/)，用来安装 stadiacast；它会自带所需的 Python。

## 流程概览

1. 安装 stadiacast 和 ViGEmBus 驱动。
2. 判断手柄固件：用数据线把手柄连到电脑，在[刷机网页](https://luigimannoni.github.io/stadia-controller-flasher/)上点 **Check mode and updates**。不接线的话，也可以运行 `scripts\find-controllers.py`。
3. 如果是蓝牙固件，用社区工具刷回 Wi-Fi 固件。
4. 用 `stadiacast-provision` 通过蓝牙给手柄写入 Wi-Fi 名称和密码。
5. 在路由器上给手柄和电脑固定 IP，并且**只让手柄**使用电脑做 DNS。
6. 在 Windows 防火墙里只对手柄 IP 开放端口。
7. 启动 stadiacast，然后唤醒手柄。

详细步骤见 `docs\guide.md`。

## 最重要的几条提示

1. **配网模式进不去时，先拔掉 USB 线。** 插着线，手柄由电脑供电，关机后会自己重新开机。
2. **配网后的第一次开机一定连不上。** 灯会一直闪白光。等一分钟，关机后再唤醒一次。
3. **只给手柄下发电脑作为 DNS，而且只写电脑这一个。** 如果附带一个公共 DNS，手柄会去问它，拿到 Google 的真实地址；如果给全网都下发，其他设备上的 Google 服务都会失效。
4. **ImmortalWrt / 较老的 LuCI 网页上不能设置"标签"**，要用命令行，见 `scripts\router-dhcp-tag.sh`。改完要重启 dnsmasq 才生效。
5. **Windows 会自动替 Python 建防火墙规则**。在"公用网络"下，这些是阻止规则，优先级高于允许规则。运行 `scripts\firewall.ps1 -RemoveAutoRules` 可以处理掉。
6. **`VIGEM_ERROR_BUS_NOT_FOUND`，但驱动服务明明在运行**：这是之前残留的坏安装，重新安装 ViGEmBus 1.22.0 即可。
7. **玩家顺序按唤醒先后决定。** 先唤醒的是玩家 1。
8. **在 PowerShell 里不要用 `curl.exe -d '{"..."}'`**。PowerShell 会去掉参数里的双引号，stadiacast 收到的 JSON 就坏了。改用 `Invoke-RestMethod`，或者直接用这里的脚本。

更多提示见 `docs\tips.md`。

## 目录

| 文件 | 内容 |
|---|---|
| `docs\guide.md` | 完整步骤 |
| `docs\tips.md` | 踩过的坑 |
| `docs\troubleshooting.md` | 连不上时的排查顺序（看日志） |
| `docs\battery.md` | 电量为什么经常显示为空，以及控制台怎么补上 |
| `docs\background.md` | stadiacast 是怎么工作的，以及它和 StadiaWireless 的区别 |
| `stadia-console.cmd` | 双击打开网页控制台 |
| `webui\` | 控制台：`server.py`（只用 Python 标准库）和页面；说明见 `webui\README.md` |
| `scripts\` | 启动和停止脚本、状态和震动测试、防火墙规则、路由器命令、手柄固件检测 |

## 测试环境

| 项目 | 版本 |
|---|---|
| stadiacast | 1.3.0 |
| 手柄型号 / 固件 | GA00827-US，固件 316382（用社区工具刷回的 Wi-Fi 固件） |
| ViGEmBus | 1.22.0 |
| 系统 | Windows 11（中文），PowerShell 7.5 |
| 路由器 | ImmortalWrt（MT7981），5 GHz，WPA2-PSK (CCMP) |

两只手柄同时连接；按键、摇杆、扳机和游戏震动都验证过。耳机音频和麦克风没有试过。

## 致谢

- [jkfran/stadiacast](https://github.com/jkfran/stadiacast)（MIT）：做了所有协议层面的工作，这里只是在它上面配置和包装。
- [luigimannoni/stadia-controller-flasher](https://github.com/luigimannoni/stadia-controller-flasher)：保存了 Google 原版刷机网页，以及刷回 Wi-Fi 用的固件。
- stadiacast 的 issue [#5](https://github.com/jkfran/stadiacast/issues/5)、[#17](https://github.com/jkfran/stadiacast/issues/17) 和 [#18](https://github.com/jkfran/stadiacast/issues/18)：社区在 Windows 和 316382 固件上的经验。
- [ViGEmBus](https://github.com/nefarius/ViGEmBus)：Windows 上的虚拟手柄驱动。

## 许可证

[MIT](LICENSE)。stadiacast 本身没有包含在这里，它也使用 MIT 许可证。
